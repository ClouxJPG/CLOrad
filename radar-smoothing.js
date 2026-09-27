/* =========================================================
   CLOrad — Radar Smoothing
   Геометрическое сглаживание радарных областей

   НЕ:
   - blur
   - RGB interpolation
   - прозрачность
   - смешивание цветов

   ДА:
   - сглаживание формы областей
   - округление углов
   - соединение соседних пикселей
   - удаление мелких квадратных ступеней
   - только реальные цвета текущей палитры

   Оптимизировано для мобильных устройств.
   ========================================================= */

(() => {
  "use strict";

  const BUTTON_ID = "cloradSmoothingButton";
  const PANEL_ID = "cloradSmoothingPanel";
  const RANGE_ID = "cloradSmoothingRange";
  const VALUE_ID = "cloradSmoothingValue";
  const STYLE_ID = "cloradSmoothingStyle";

  let level = 0;
  let busy = false;

  const originalUrls = new WeakMap();
  const cache = new Map();

  /* =======================================================
     PALETTE
     ======================================================= */

  function readPalette() {
    const colors = [];

    for (let i = 1; i <= 19; i++) {
      const el = document.querySelector(".l" + i);

      if (!el) continue;

      const css = getComputedStyle(el).backgroundColor;

      const m = css.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/i
      );

      if (!m) continue;

      colors.push([
        Number(m[1]),
        Number(m[2]),
        Number(m[3])
      ]);
    }

    if (colors.length === 19) {
      return colors;
    }

    return [
      [185, 193, 199],
      [169, 199, 244],
      [99, 237, 165],
      [67, 207, 137],
      [77, 184, 78],
      [255, 248, 156],
      [117, 166, 239],
      [82, 121, 237],
      [80, 74, 155],
      [255, 192, 168],
      [250, 130, 160],
      [255, 77, 77],
      [219, 146, 72],
      [173, 117, 68],
      [146, 75, 72],
      [242, 170, 240],
      [232, 90, 231],
      [202, 60, 199],
      [119, 124, 145]
    ];
  }

  /* =======================================================
     IMAGE
     ======================================================= */

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);

      img.onerror = () => {
        reject(
          new Error("Radar frame load error")
        );
      };

      img.decoding = "async";
      img.src = url;
    });
  }

  /* =======================================================
     COLOR -> CLASS
     ======================================================= */

  function nearestColor(r, g, b, palette) {
    let best = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];

      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];

      const d =
        dr * dr +
        dg * dg +
        db * db;

      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }

    return best;
  }

  function makeClassMap(data, width, height, palette) {
    const map = new Uint8Array(
      width * height
    );

    let p = 0;

    for (let i = 0; i < map.length; i++) {
      const a = data[p + 3];

      if (a < 20) {
        map[i] = 255;
      } else {
        map[i] = nearestColor(
          data[p],
          data[p + 1],
          data[p + 2],
          palette
        );
      }

      p += 4;
    }

    return map;
  }

  /* =======================================================
     GEOMETRIC SMOOTHING
     =======================================================

     Здесь главное отличие от прошлого варианта.

     Мы не спрашиваем:
       "какой цвет чаще?"

     Вместо этого определяем:
       - границу области
       - угловые выступы
       - угловые выемки
       - разрывы между соседними клетками

     И меняем геометрию класса.

     ======================================================= */

  function smoothGeometry(source, width, height, strength) {
    if (strength <= 0) {
      return source;
    }

    let current = new Uint8Array(source);

    /*
       Сила операции.

       0–20:
       лёгкое округление

       21–45:
       заметное округление

       46–70:
       сильное соединение

       71–100:
       максимальное округление
    */

    let passes = 1;

    if (strength >= 25) passes = 2;
    if (strength >= 55) passes = 3;
    if (strength >= 80) passes = 4;

    /*
       Размер локального окна.

       Не используем огромное окно:
       это сохраняет реальные структуры радара.
    */

    const radius =
      strength >= 70 ? 2 : 1;

    for (let pass = 0; pass < passes; pass++) {
      const next =
        new Uint8Array(current);

      for (
        let y = radius;
        y < height - radius;
        y++
      ) {
        for (
          let x = radius;
          x < width - radius;
          x++
        ) {
          const pos =
            y * width + x;

          const center =
            current[pos];

          /*
             Прозрачность не трогаем.
          */

          if (center === 255) {
            continue;
          }

          /*
             Считаем только классы,
             которые реально соприкасаются
             с текущим пикселем.
          */

          const counts =
            new Uint8Array(19);

          let neighbors = 0;

          /*
             3x3 всегда.
          */

          for (
            let yy = -1;
            yy <= 1;
            yy++
          ) {
            const row =
              (y + yy) * width;

            for (
              let xx = -1;
              xx <= 1;
              xx++
            ) {
              if (
                xx === 0 &&
                yy === 0
              ) {
                continue;
              }

              const v =
                current[
                  row + x + xx
                ];

              if (v === 255) {
                continue;
              }

              counts[v]++;
              neighbors++;
            }
          }

          /*
             Ищем наиболее поддерживаемый
             соседний класс.
          */

          let candidate = center;
          let best = 0;

          for (
            let i = 0;
            i < 19;
            i++
          ) {
            if (
              counts[i] > best
            ) {
              best = counts[i];
              candidate = i;
            }
          }

          /*
             -------------------------------------------------
             1. УДАЛЕНИЕ ОДИНОЧНЫХ КВАДРАТНЫХ ВЫСТУПОВ
             -------------------------------------------------

             Если центр отличается от почти всех
             соседей — это скорее всего маленькая
             квадратная ступенька.
          */

          if (
            candidate !== center &&
            best >= 6 &&
            counts[center] <= 2
          ) {
            next[pos] =
              candidate;

            continue;
          }

          /*
             -------------------------------------------------
             2. ЗАПОЛНЕНИЕ УГЛОВЫХ ВЫЕМOК
             -------------------------------------------------

             Пример:

               X X
               X .
 
             Точка "." получает X.

             Это как раз убирает характерный
             квадратный угол.
          */

          const nw =
            current[
              (y - 1) * width +
              (x - 1)
            ];

          const ne =
            current[
              (y - 1) * width +
              (x + 1)
            ];

          const sw =
            current[
              (y + 1) * width +
              (x - 1)
            ];

          const se =
            current[
              (y + 1) * width +
              (x + 1)
            ];

          if (
            nw !== 255 &&
            nw === ne &&
            nw === sw &&
            nw !== center
          ) {
            next[pos] = nw;
            continue;
          }

          if (
            ne !== 255 &&
            ne === nw &&
            ne === se &&
            ne !== center
          ) {
            next[pos] = ne;
            continue;
          }

          if (
            sw !== 255 &&
            sw === nw &&
            sw === se &&
            sw !== center
          ) {
            next[pos] = sw;
            continue;
          }

          if (
            se !== 255 &&
            se === ne &&
            se === sw &&
            se !== center
          ) {
            next[pos] = se;
            continue;
          }

          /*
             -------------------------------------------------
             3. СОЕДИНЕНИЕ ДВУХ ОБЛАСТЕЙ
             -------------------------------------------------

             Если по горизонтали/вертикали
             одна область почти полностью окружает
             маленький разрыв — закрываем его.
          */

          const left =
            current[pos - 1];

          const right =
            current[pos + 1];

          const top =
            current[pos - width];

          const bottom =
            current[pos + width];

          if (
            left !== 255 &&
            left === right &&
            left !== center
          ) {
            next[pos] = left;
            continue;
          }

          if (
            top !== 255 &&
            top === bottom &&
            top !== center
          ) {
            next[pos] = top;
            continue;
          }

          /*
             -------------------------------------------------
             4. СИЛЬНОЕ СГЛАЖИВАНИЕ
             -------------------------------------------------
          */

          if (
            strength >= 45 &&
            candidate !== center
          ) {
            let threshold = 6;

            if (strength >= 70) {
              threshold = 5;
            }

            if (strength >= 90) {
              threshold = 4;
            }

            if (
              best >= threshold &&
              counts[center] <= 3
            ) {
              next[pos] =
                candidate;
            }
          }

          /*
             -------------------------------------------------
             5. РАДИУС 5x5 НА ВЫСОКОЙ СИЛЕ
             -------------------------------------------------
          */

          if (
            strength >= 70 &&
            radius === 2
          ) {
            const localCounts =
              new Uint8Array(19);

            for (
              let yy = -2;
              yy <= 2;
              yy++
            ) {
              const row =
                (y + yy) * width;

              for (
                let xx = -2;
                xx <= 2;
                xx++
              ) {
                const v =
                  current[
                    row + x + xx
                  ];

                if (
                  v !== 255
                ) {
                  localCounts[v]++;
                }
              }
            }

            let localBest =
              center;

            let localCount = 0;

            for (
              let i = 0;
              i < 19;
              i++
            ) {
              if (
                localCounts[i] >
                localCount
              ) {
                localCount =
                  localCounts[i];

                localBest = i;
              }
            }

            if (
              localBest !== center &&
              localCount >= 14 &&
              counts[center] <= 4
            ) {
              next[pos] =
                localBest;
            }
          }
        }
      }

      current = next;
    }

    return current;
  }

  /* =======================================================
     ROUND PIXEL EDGES
     =======================================================

     После изменения class-map делаем второй этап:
     каждый исходный квадрат превращается в 2x2
     геометрически более аккуратную форму.

     Важно:
     цвета НЕ смешиваются.
     ======================================================= */

  function renderRounded(
    classes,
    width,
    height,
    palette,
    strength
  ) {
    const scale = 2;

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      width * scale;

    canvas.height =
      height * scale;

    const ctx =
      canvas.getContext(
        "2d"
      );

    ctx.imageSmoothingEnabled =
      false;

    /*
       Сначала увеличиваем карту классов.
    */

    const output =
      ctx.createImageData(
        canvas.width,
        canvas.height
      );

    const out =
      output.data;

    /*
       Определяем, насколько агрессивно
       округлять углы.
    */

    const rounding =
      strength >= 70
        ? 2
        : 1;

    for (
      let y = 0;
      y < height;
      y++
    ) {
      for (
        let x = 0;
        x < width;
        x++
      ) {
        const pos =
          y * width + x;

        const center =
          classes[pos];

        if (center === 255) {
          continue;
        }

        /*
           Соседи.
        */

        const left =
          x > 0
            ? classes[pos - 1]
            : center;

        const right =
          x < width - 1
            ? classes[pos + 1]
            : center;

        const top =
          y > 0
            ? classes[pos - width]
            : center;

        const bottom =
          y < height - 1
            ? classes[pos + width]
            : center;

        const nw =
          x > 0 && y > 0
            ? classes[
                pos - width - 1
              ]
            : center;

        const ne =
          x < width - 1 && y > 0
            ? classes[
                pos - width + 1
              ]
            : center;

        const sw =
          x > 0 && y < height - 1
            ? classes[
                pos + width - 1
              ]
            : center;

        const se =
          x < width - 1 &&
          y < height - 1
            ? classes[
                pos + width + 1
              ]
            : center;

        /*
           -------------------------------------------------
           ЧЕТЫРЕ SUBPIXELS
           -------------------------------------------------
        */

        let tl = center;
        let tr = center;
        let bl = center;
        let br = center;

        /*
           Если угол окружён другим классом,
           немного закругляем его.

           Но используем только уже существующий
           класс.
        */

        if (
          nw === center &&
          top !== center &&
          left !== center
        ) {
          tl = center;
        } else if (
          nw !== center &&
          top === left &&
          top !== 255
        ) {
          tl = top;
        }

        if (
          ne === center &&
          top !== center &&
          right !== center
        ) {
          tr = center;
        } else if (
          ne !== center &&
          top === right &&
          top !== 255
        ) {
          tr = top;
        }

        if (
          sw === center &&
          bottom !== center &&
          left !== center
        ) {
          bl = center;
        } else if (
          sw !== center &&
          bottom === left &&
          bottom !== 255
        ) {
          bl = bottom;
        }

        if (
          se === center &&
          bottom !== center &&
          right !== center
        ) {
          br = center;
        } else if (
          se !== center &&
          bottom === right &&
          bottom !== 255
        ) {
          br = bottom;
        }

        /*
           При высокой силе дополнительно
           сглаживаем диагональные углы.
        */

        if (rounding >= 2) {
          if (
            nw === center &&
            top === left &&
            top !== center &&
            top !== 255
          ) {
            tl = top;
          }

          if (
            ne === center &&
            top === right &&
            top !== center &&
            top !== 255
          ) {
            tr = top;
          }

          if (
            sw === center &&
            bottom === left &&
            bottom !== center &&
            bottom !== 255
          ) {
            bl = bottom;
          }

          if (
            se === center &&
            bottom === right &&
            bottom !== center &&
            bottom !== 255
          ) {
            br = bottom;
          }
        }

        const px =
          x * 2;

        const py =
          y * 2;

        const p1 =
          (py * canvas.width +
            px) * 4;

        const p2 =
          (py * canvas.width +
            px + 1) * 4;

        const p3 =
          ((py + 1) *
            canvas.width +
            px) * 4;

        const p4 =
          ((py + 1) *
            canvas.width +
            px + 1) * 4;

        const c1 =
          palette[tl];

        const c2 =
          palette[tr];

        const c3 =
          palette[bl];

        const c4 =
          palette[br];

        out[p1] =
          c1[0];
        out[p1 + 1] =
          c1[1];
        out[p1 + 2] =
          c1[2];
        out[p1 + 3] =
          255;

        out[p2] =
          c2[0];
        out[p2 + 1] =
          c2[1];
        out[p2 + 2] =
          c2[2];
        out[p2 + 3] =
          255;

        out[p3] =
          c3[0];
        out[p3 + 1] =
          c3[1];
        out[p3 + 2] =
          c3[2];
        out[p3 + 3] =
          255;

        out[p4] =
          c4[0];
        out[p4 + 1] =
          c4[1];
        out[p4 + 2] =
          c4[2];
        out[p4 + 3] =
          255;
      }
    }

    ctx.putImageData(
      output,
      0,
      0
    );

    return canvas;
  }

  /* =======================================================
     PROCESS
     ======================================================= */

  async function processFrame(
    image,
    url
  ) {
    if (
      !image ||
      !url ||
      level <= 0 ||
      busy
    ) {
      return;
    }

    const key =
      url +
      "::" +
      level;

    const cached =
      cache.get(key);

    if (cached) {
      if (
        originalUrls.get(image) ===
        url
      ) {
        image.src =
          cached;
      }

      return;
    }

    busy = true;

    try {
      /*
         Перед тяжёлой операцией отдаём
         управление браузеру.
      */

      await new Promise(
        resolve =>
          requestAnimationFrame(
            resolve
          )
      );

      const source =
        await loadImage(url);

      const width =
        source.naturalWidth ||
        source.width;

      const height =
        source.naturalHeight ||
        source.height;

      if (
        !width ||
        !height
      ) {
        return;
      }

      /*
         Защита iPhone от слишком
         больших случайных изображений.
      */

      if (
        width * height >
        2500000
      ) {
        return;
      }

      const canvas =
        document.createElement(
          "canvas"
        );

      canvas.width =
        width;

      canvas.height =
        height;

      const ctx =
        canvas.getContext(
          "2d",
          {
            willReadFrequently: true
          }
        );

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      ctx.drawImage(
        source,
        0,
        0,
        width,
        height
      );

      const imageData =
        ctx.getImageData(
          0,
          0,
          width,
          height
        );

      const palette =
        readPalette();

      /*
         1.
         RGB -> реальные классы
      */

      const classMap =
        makeClassMap(
          imageData.data,
          width,
          height,
          palette
        );

      /*
         2.
         Геометрическое сглаживание
      */

      const smoothMap =
        smoothGeometry(
          classMap,
          width,
          height,
          level
        );

      /*
         3.
         Закругление границ
      */

      const result =
        renderRounded(
          smoothMap,
          width,
          height,
          palette,
          level
        );

      /*
         4.
         Готовый результат.
      */

      const dataURL =
        result.toDataURL(
          "image/png"
        );

      cache.set(
        key,
        dataURL
      );

      /*
         Показываем только если кадр
         всё ещё тот же.
      */

      if (
        image.isConnected &&
        originalUrls.get(image) ===
          url
      ) {
        image.src =
          dataURL;
      }

    } catch (error) {
      console.warn(
        "CLOrad radar smoothing:",
        error
      );
    } finally {
      busy = false;
    }
  }

  /* =======================================================
     FRAME CHANGE
     ======================================================= */

  function onFrame(
    image,
    url
  ) {
    if (
      !image ||
      !url
    ) {
      return;
    }

    originalUrls.set(
      image,
      url
    );

    if (level <= 0) {
      image.src =
        url;

      return;
    }

    processFrame(
      image,
      url
    );
  }

  /* =======================================================
     LEAFLET HOOK
     ======================================================= */

  function installHook() {
    if (
      !window.L ||
      !L.ImageOverlay
    ) {
      return false;
    }

    const proto =
      L.ImageOverlay.prototype;

    if (
      proto.__cloradGeometrySmoothing
    ) {
      return true;
    }

    const original =
      proto.setUrl;

    proto.setUrl =
      function(url) {
        const result =
          original.call(
            this,
            url
          );

        const image =
          this._image;

        if (
          image &&
          image.classList &&
          image.classList.contains(
            "clorad-gif-radar-image"
          )
        ) {
          onFrame(
            image,
            url
          );
        }

        return result;
      };

    proto.__cloradGeometrySmoothing =
      true;

    return true;
  }

  /* =======================================================
     FIND RADAR IMAGE
     ======================================================= */

  function getRadarImage() {
    return document.querySelector(
      "img.clorad-gif-radar-image"
    );
  }

  /* =======================================================
     APPLY LEVEL
     ======================================================= */

  function applyLevel(value) {
    level =
      Math.max(
        0,
        Math.min(
          100,
          Number(value) || 0
        )
      );

    const label =
      document.getElementById(
        VALUE_ID
      );

    if (label) {
      label.textContent =
        level + "%";
    }

    /*
       0% = оригинальный GIF.
    */

    if (level === 0) {
      const image =
        getRadarImage();

      if (image) {
        const url =
          originalUrls.get(
            image
          );

        if (url) {
          image.src =
            url;
        }
      }

      return;
    }

    /*
       Ограничиваем память.
    */

    if (cache.size > 8) {
      cache.clear();
    }

    const image =
      getRadarImage();

    if (!image) {
      return;
    }

    const url =
      originalUrls.get(
        image
      ) ||
      image.src;

    originalUrls.set(
      image,
      url
    );

    processFrame(
      image,
      url
    );
  }

  /* =======================================================
     UI
     ======================================================= */

  function createUI() {
    if (
      document.getElementById(
        BUTTON_ID
      )
    ) {
      return;
    }

    /*
       Сначала ищем конкретные контейнеры
       настроек CLOrad.
    */

    const container =
      document.getElementById(
        "framesSetting"
      ) ||
      document.getElementById(
        "gifResolutionSetting"
      ) ||
      document.getElementById(
        "settings"
      );

    if (!container) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      STYLE_ID;

    style.textContent = `
      #${BUTTON_ID} {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        height:36px;
        min-height:36px;
        padding:0 12px;
        margin:0;
        box-sizing:border-box;
        border:1px solid rgba(255,255,255,.14);
        border-radius:9px;
        background:rgba(255,255,255,.07);
        color:#fff;
        font:inherit;
        font-size:13px;
        line-height:1;
        white-space:nowrap;
        -webkit-tap-highlight-color:transparent;
        touch-action:manipulation;
      }

      #${BUTTON_ID}:active {
        background:rgba(255,255,255,.15);
      }

      #${PANEL_ID} {
        display:none;
        align-items:center;
        gap:7px;
        width:100%;
        margin-top:7px;
        padding:6px 8px;
        box-sizing:border-box;
        border-radius:9px;
        background:rgba(255,255,255,.055);
      }

      #${PANEL_ID}.open {
        display:flex;
      }

      #${RANGE_ID} {
        flex:1;
        width:100%;
        min-width:90px;
        height:30px;
        margin:0;
        padding:0;
        accent-color:#63eda5;
        touch-action:pan-x;
      }

      #${VALUE_ID} {
        width:38px;
        min-width:38px;
        text-align:right;
        font-size:12px;
        color:rgba(255,255,255,.78);
        font-variant-numeric:tabular-nums;
      }
    `;

    document.head.appendChild(
      style
    );

    /*
       Кнопка добавляется в существующий
       ряд настроек.
    */

    const row =
      document.createElement(
        "div"
      );

    row.style.display =
      "flex";

    row.style.flexWrap =
      "wrap";

    row.style.alignItems =
      "center";

    row.style.gap =
      "6px";

    const button =
      document.createElement(
        "button"
      );

    button.id =
      BUTTON_ID;

    button.type =
      "button";

    button.textContent =
      "Сглаживание";

    row.appendChild(
      button
    );

    container.appendChild(
      row
    );

    /*
       Панель шкалы.
    */

    const panel =
      document.createElement(
        "div"
      );

    panel.id =
      PANEL_ID;

    const range =
      document.createElement(
        "input"
      );

    range.id =
      RANGE_ID;

    range.type =
      "range";

    range.min =
      "0";

    range.max =
      "100";

    range.step =
      "1";

    range.value =
      "0";

    const value =
      document.createElement(
        "span"
      );

    value.id =
      VALUE_ID;

    value.textContent =
      "0%";

    panel.appendChild(
      range
    );

    panel.appendChild(
      value
    );

    container.appendChild(
      panel
    );

    /*
       Открытие шкалы.
    */

    button.addEventListener(
      "click",
      () => {
        panel.classList.toggle(
          "open"
        );
      }
    );

    /*
       Во время движения пальца
       НЕ обрабатываем изображение.
    */

    range.addEventListener(
      "input",
      () => {
        value.textContent =
          range.value + "%";
      }
    );

    /*
       Обрабатываем один раз
       после отпускания.
    */

    range.addEventListener(
      "change",
      () => {
        applyLevel(
          range.value
        );
      }
    );
  }

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    installHook();
    createUI();

    if (
      !window.L ||
      !L.ImageOverlay
    ) {
      setTimeout(
        init,
        300
      );
    }
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRadarSmoothing = {
    setLevel(value) {
      applyLevel(value);
    },

    getLevel() {
      return level;
    },

    clearCache() {
      cache.clear();
    },

    onNewFrame(
      image,
      url
    ) {
      onFrame(
        image,
        url
      );
    }
  };

  /* =======================================================
     START
     ======================================================= */

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }

})();
