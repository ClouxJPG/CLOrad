/* =========================================================
   CLOrad — Lightweight Radar Smoothing
   ---------------------------------------------------------
   0%   = оригинальный GIF
   1-100% = лёгкое data-aware сглаживание

   ВАЖНО:
   - RGB цветов НЕ смешивается
   - используются только цвета исходной палитры
   - фон не превращается в радар
   - Leaflet ImageOverlay не перемещается
   - нет MutationObserver на весь body
   - нет постоянного рендера
   - обработка только по запросу
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const DEFAULT_LEVEL = 0;
  const MIN_LEVEL = 0;
  const MAX_LEVEL = 100;

  /*
     2x достаточно для сглаживания краёв.
     Не ставим 3x/4x — это сильно тяжелее на iPhone.
  */
  const SCALE = 2;

  /*
     Максимальное количество сохранённых
     обработанных кадров.
  */
  const MAX_CACHE = 4;

  /* =======================================================
     STATE
     ======================================================= */

  let smoothingLevel = DEFAULT_LEVEL;

  let currentFrameURL = null;

  let processing = false;
  let processingToken = 0;

  const cache = new Map();

  /* =======================================================
     BASIC HELPERS
     ======================================================= */

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function getRadarImages() {
    return Array.from(
      document.querySelectorAll(
        "img.clorad-gif-radar-image"
      )
    );
  }

  /* =======================================================
     PALETTE
     ======================================================= */

  function hexToRGB(hex) {
    if (
      typeof hex !== "string"
    ) {
      return null;
    }

    let value =
      hex.replace("#", "");

    if (
      value.length === 3
    ) {
      value =
        value[0] + value[0] +
        value[1] + value[1] +
        value[2] + value[2];
    }

    if (
      value.length !== 6
    ) {
      return null;
    }

    return [
      parseInt(
        value.slice(0, 2),
        16
      ),
      parseInt(
        value.slice(2, 4),
        16
      ),
      parseInt(
        value.slice(4, 6),
        16
      )
    ];
  }

  function readPalette() {
    const result = [];

    for (
      let i = 1;
      i <= 19;
      i++
    ) {
      const el =
        document.querySelector(
          ".l" + i
        );

      if (!el) {
        result.push(null);
        continue;
      }

      const color =
        getComputedStyle(el)
          .backgroundColor;

      const match =
        color.match(
          /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/i
        );

      if (match) {
        result.push([
          Number(match[1]),
          Number(match[2]),
          Number(match[3])
        ]);

        continue;
      }

      result.push(
        hexToRGB(color)
      );
    }

    /*
       Если легенда ещё не готова,
       пытаемся использовать палитры
       из gif-radar.js.
    */

    if (
      result.filter(Boolean)
        .length !== 19
    ) {
      if (
        Array.isArray(
          window.RGMC_OY_PALETTE
        )
      ) {
        return window.RGMC_OY_PALETTE
          .map(hexToRGB);
      }

      if (
        Array.isArray(
          window.IRAM_OY_PALETTE
        )
      ) {
        return window.IRAM_OY_PALETTE
          .map(hexToRGB);
      }
    }

    return result;
  }

  /* =======================================================
     COLOR MATCH
     ======================================================= */

  function nearestColor(
    r,
    g,
    b,
    palette
  ) {
    let best = 0;
    let bestDistance =
      Infinity;

    for (
      let i = 0;
      i < palette.length;
      i++
    ) {
      const color =
        palette[i];

      if (!color) {
        continue;
      }

      const dr =
        r - color[0];

      const dg =
        g - color[1];

      const db =
        b - color[2];

      const distance =
        dr * dr +
        dg * dg +
        db * db;

      if (
        distance <
        bestDistance
      ) {
        bestDistance =
          distance;

        best = i;
      }
    }

    return best;
  }

  /* =======================================================
     LOAD IMAGE
     ======================================================= */

  function loadImage(url) {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        image.crossOrigin =
          "anonymous";

        image.onload = () =>
          resolve(image);

        image.onerror = reject;

        image.src = url;
      }
    );
  }

  /* =======================================================
     READ IMAGE
     ======================================================= */

  function readImage(image) {
    const width =
      image.naturalWidth ||
      image.width;

    const height =
      image.naturalHeight ||
      image.height;

    if (
      !width ||
      !height
    ) {
      return null;
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

    ctx.drawImage(
      image,
      0,
      0
    );

    return {
      width,
      height,
      data:
        ctx.getImageData(
          0,
          0,
          width,
          height
        ).data
    };
  }

  /* =======================================================
     BUILD RADAR FIELD
     ======================================================= */

  /*
     0..18 = реальный класс радара
     -1    = прозрачный фон
  */

  function buildField(
    raster,
    palette
  ) {
    const width =
      raster.width;

    const height =
      raster.height;

    const source =
      raster.data;

    const field =
      new Int8Array(
        width * height
      );

    field.fill(-1);

    for (
      let i = 0,
      p = 0;
      i < field.length;
      i++,
      p += 4
    ) {
      const alpha =
        source[p + 3];

      /*
         Прозрачный GIF-фон.
      */

      if (
        alpha < 30
      ) {
        continue;
      }

      const r =
        source[p];

      const g =
        source[p + 1];

      const b =
        source[p + 2];

      /*
         Почти прозрачные служебные
         пиксели не считаем осадками.
      */

      if (
        alpha < 80 &&
        r > 170 &&
        g > 170 &&
        b > 170
      ) {
        continue;
      }

      field[i] =
        nearestColor(
          r,
          g,
          b,
          palette
        );
    }

    return field;
  }

  /* =======================================================
     LIGHT DATA SMOOTHING
     ======================================================= */

  /*
     Очень дешёвое сглаживание.

     В отличие от предыдущей версии:
     - нет полного 3x3/5x5 пересчёта
       для каждого пикселя;
     - нет нескольких проходов;
     - исходный класс сохраняется;
     - соседний цвет может изменить пиксель
       только если он действительно преобладает.
  */

  function smoothField(
    field,
    width,
    height,
    level
  ) {
    if (
      level <= 0
    ) {
      return field;
    }

    const result =
      new Int8Array(
        field
      );

    /*
       При слабом сглаживании
       вообще используем только
       прямых соседей.

       При сильном — добавляем
       диагонали.
    */

    const useDiagonal =
      level >= 55;

    for (
      let y = 1;
      y < height - 1;
      y++
    ) {
      for (
        let x = 1;
        x < width - 1;
        x++
      ) {
        const index =
          y * width + x;

        const center =
          field[index];

        if (
          center < 0
        ) {
          continue;
        }

        let best =
          center;

        let bestScore =
          3;

        /*
           Верх
        */

        let value =
          field[
            index - width
          ];

        if (
          value >= 0
        ) {
          if (
            value === center
          ) {
            bestScore += 2;
          } else {
            bestScore += 1;
          }
        }

        /*
           Низ
        */

        value =
          field[
            index + width
          ];

        if (
          value >= 0 &&
          value === center
        ) {
          bestScore += 2;
        }

        /*
           Лево
        */

        value =
          field[index - 1];

        if (
          value >= 0 &&
          value === center
        ) {
          bestScore += 2;
        }

        /*
           Право
        */

        value =
          field[index + 1];

        if (
          value >= 0 &&
          value === center
        ) {
          bestScore += 2;
        }

        /*
           При сильном сглаживании
           учитываем диагонали.
        */

        if (
          useDiagonal
        ) {
          const neighbors = [
            index - width - 1,
            index - width + 1,
            index + width - 1,
            index + width + 1
          ];

          for (
            let i = 0;
            i < neighbors.length;
            i++
          ) {
            value =
              field[
                neighbors[i]
              ];

            if (
              value === center
            ) {
              bestScore += 1;
            }
          }
        }

        /*
           Ничего не меняем,
           если соседние данные
           не подтверждают изменение.
        */

        result[index] =
          best;
      }
    }

    /*
       Лёгкое удаление одиночных
       дыр внутри радарного поля.

       Только если окружающие пиксели
       имеют тот же класс.
    */

    if (
      level >= 30
    ) {
      for (
        let y = 1;
        y < height - 1;
        y++
      ) {
        for (
          let x = 1;
          x < width - 1;
          x++
        ) {
          const index =
            y * width + x;

          if (
            field[index] >= 0
          ) {
            continue;
          }

          const left =
            field[index - 1];

          const right =
            field[index + 1];

          const top =
            field[
              index - width
            ];

          const bottom =
            field[
              index + width
            ];

          if (
            left >= 0 &&
            left === right &&
            left === top &&
            left === bottom
          ) {
            result[index] =
              left;
          }
        }
      }
    }

    return result;
  }

  /* =======================================================
     RENDER
     ======================================================= */

  function render(
    field,
    width,
    height,
    palette
  ) {
    const outputWidth =
      width * SCALE;

    const outputHeight =
      height * SCALE;

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      outputWidth;

    canvas.height =
      outputHeight;

    const ctx =
      canvas.getContext(
        "2d"
      );

    /*
       Отключаем браузерную
       интерполяцию.

       Мы сами контролируем
       радарные классы.
    */

    ctx.imageSmoothingEnabled =
      false;

    const imageData =
      ctx.createImageData(
        outputWidth,
        outputHeight
      );

    const output =
      imageData.data;

    /*
       Каждый исходный радарный
       пиксель превращаем в блок 2x2.

       Цвет строго берётся
       из палитры.
    */

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
        const classIndex =
          field[
            y * width + x
          ];

        if (
          classIndex < 0
        ) {
          continue;
        }

        const color =
          palette[
            classIndex
          ];

        if (!color) {
          continue;
        }

        const baseX =
          x * SCALE;

        const baseY =
          y * SCALE;

        /*
           Определяем, находится ли
           пиксель на краю.

           Это даёт лёгкое округление
           без появления нового RGB.
        */

        let neighbours = 0;

        if (
          x > 0 &&
          field[
            y * width +
            x - 1
          ] >= 0
        ) {
          neighbours++;
        }

        if (
          x < width - 1 &&
          field[
            y * width +
            x + 1
          ] >= 0
        ) {
          neighbours++;
        }

        if (
          y > 0 &&
          field[
            (y - 1) * width +
            x
          ] >= 0
        ) {
          neighbours++;
        }

        if (
          y < height - 1 &&
          field[
            (y + 1) * width +
            x
          ] >= 0
        ) {
          neighbours++;
        }

        let alpha =
          255;

        /*
           Только внешние края
           получают прозрачность.

           Внутри радар полностью
           непрозрачный.
        */

        if (
          neighbours === 1
        ) {
          alpha = 190;
        } else if (
          neighbours === 2
        ) {
          alpha = 220;
        }

        for (
          let dy = 0;
          dy < SCALE;
          dy++
        ) {
          for (
            let dx = 0;
            dx < SCALE;
            dx++
          ) {
            const ox =
              baseX + dx;

            const oy =
              baseY + dy;

            const outputIndex =
              (
                oy *
                  outputWidth +
                ox
              ) * 4;

            output[
              outputIndex
            ] = color[0];

            output[
              outputIndex + 1
            ] = color[1];

            output[
              outputIndex + 2
            ] = color[2];

            output[
              outputIndex + 3
            ] = alpha;
          }
        }
      }
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }

  /* =======================================================
     CACHE
     ======================================================= */

  function getCacheKey(
    url,
    level
  ) {
    return (
      String(url) +
      "|" +
      String(level)
    );
  }

  function cacheGet(
    key
  ) {
    const value =
      cache.get(key);

    if (
      value === undefined
    ) {
      return null;
    }

    /*
       LRU.
    */

    cache.delete(key);
    cache.set(
      key,
      value
    );

    return value;
  }

  function cacheSet(
    key,
    value
  ) {
    cache.delete(key);

    cache.set(
      key,
      value
    );

    while (
      cache.size >
      MAX_CACHE
    ) {
      const first =
        cache.keys()
          .next()
          .value;

      cache.delete(
        first
      );
    }
  }

  function clearCache() {
    cache.clear();
  }

  /* =======================================================
     RESTORE ORIGINAL
     ======================================================= */

  function restoreOriginal() {
    const images =
      getRadarImages();

    for (
      const img of images
    ) {
      const original =
        img.dataset
          .cloradOriginalSrc;

      if (
        original &&
        img.src !== original
      ) {
        img.src =
          original;
      }
    }
  }

  /* =======================================================
     PROCESS CURRENT FRAME
     ======================================================= */

  async function processCurrentFrame() {
    if (
      processing
    ) {
      return;
    }

    /*
       0% = вообще ничего
       не делаем.
    */

    if (
      smoothingLevel <= 0
    ) {
      restoreOriginal();
      return;
    }

    const images =
      getRadarImages();

    if (
      images.length === 0
    ) {
      return;
    }

    const img =
      images[0];

    /*
       Сохраняем настоящий URL
       GIF-кадра.

       Если сейчас img.src —
       уже обработанный PNG,
       берём сохранённый оригинал.
    */

    const sourceURL =
      img.dataset
        .cloradOriginalSrc ||
      img.src;

    if (!sourceURL) {
      return;
    }

    /*
       Если это тот же кадр
       и он уже обработан —
       ничего не делаем.
    */

    const key =
      getCacheKey(
        sourceURL,
        smoothingLevel
      );

    const cached =
      cacheGet(key);

    if (cached) {
      img.src =
        cached;

      currentFrameURL =
        sourceURL;

      return;
    }

    processing = true;

    const token =
      ++processingToken;

    try {
      const image =
        await loadImage(
          sourceURL
        );

      if (
        token !==
        processingToken
      ) {
        return;
      }

      const raster =
        readImage(
          image
        );

      if (!raster) {
        return;
      }

      const palette =
        readPalette();

      if (
        palette.filter(Boolean)
          .length !== 19
      ) {
        return;
      }

      const field =
        buildField(
          raster,
          palette
        );

      if (
        token !==
        processingToken
      ) {
        return;
      }

      const smoothed =
        smoothField(
          field,
          raster.width,
          raster.height,
          smoothingLevel
        );

      if (
        token !==
        processingToken
      ) {
        return;
      }

      const canvas =
        render(
          smoothed,
          raster.width,
          raster.height,
          palette
        );

      if (
        token !==
        processingToken
      ) {
        return;
      }

      const output =
        canvas.toDataURL(
          "image/png"
        );

      cacheSet(
        key,
        output
      );

      /*
         Проверяем, что Leaflet
         всё ещё показывает тот
         же кадр.
      */

      const currentSource =
        img.dataset
          .cloradOriginalSrc ||
        img.src;

      if (
        currentSource ===
        sourceURL
      ) {
        img.src =
          output;

        currentFrameURL =
          sourceURL;
      }

    } catch (
      error
    ) {
      console.warn(
        "CLOrad smoothing:",
        error
      );
    } finally {
      processing =
        false;
    }
  }

  /* =======================================================
     DETECT NEW LEAFLET FRAME
     ======================================================= */

  function watchRadarImage() {
    const images =
      getRadarImages();

    if (
      images.length === 0
    ) {
      return;
    }

    for (
      const img of images
    ) {
      if (
        img.dataset
          .cloradSmoothingWatch
      ) {
        continue;
      }

      img.dataset
        .cloradSmoothingWatch =
        "1";

      /*
         Небольшой индивидуальный
         observer только на самом
         radar img.

         НЕ на весь body.
      */

      const observer =
        new MutationObserver(
          mutations => {
            for (
              const mutation
                of mutations
            ) {
              if (
                mutation.attributeName !==
                "src"
              ) {
                continue;
              }

              const src =
                img.src;

              /*
                 Если это уже наш
                 обработанный PNG —
                 не запускаем обработку.
              */

              if (
                src.startsWith(
                  "data:image/png"
                )
              ) {
                return;
              }

              /*
                 Сохраняем настоящий
                 источник GIF-кадра.
              */

              img.dataset
                .cloradOriginalSrc =
                src;

              if (
                smoothingLevel > 0
              ) {
                processCurrentFrame();
              }
            }
          }
        );

      observer.observe(
        img,
        {
          attributes: true,
          attributeFilter: [
            "src"
          ]
        }
      );
    }
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRadarSmoothing = {
    getLevel() {
      return smoothingLevel;
    },

    setLevel(value) {
      const level =
        Math.round(
          clamp(
            Number(value) || 0,
            MIN_LEVEL,
            MAX_LEVEL
          )
        );

      smoothingLevel =
        level;

      processingToken++;

      clearCache();

      if (
        level === 0
      ) {
        restoreOriginal();
        return;
      }

      processCurrentFrame();
    },

    refresh() {
      clearCache();
      processingToken++;

      if (
        smoothingLevel > 0
      ) {
        processCurrentFrame();
      }
    },

    clearCache
  };

  /* =======================================================
     UI
     ======================================================= */

  function createUI() {
    if (
      document.getElementById(
        "cloradSmoothingSetting"
      )
    ) {
      return;
    }

    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    const block =
      document.createElement(
        "div"
      );

    block.id =
      "cloradSmoothingSetting";

    block.innerHTML = `
      <div style="
        margin-top:12px;
        padding-top:12px;
        border-top:1px solid rgba(255,255,255,.12);
      ">
        <div style="
          font-size:13px;
          font-weight:600;
          margin-bottom:8px;
        ">
          Сглаживание радара
        </div>

        <div style="
          display:flex;
          align-items:center;
          gap:10px;
        ">
          <input
            id="cloradSmoothingRange"
            type="range"
            min="0"
            max="100"
            step="1"
            value="0"
            style="
              flex:1;
              min-width:0;
            "
          >

          <span
            id="cloradSmoothingValue"
            style="
              width:42px;
              text-align:right;
              font-variant-numeric:tabular-nums;
            "
          >0%</span>
        </div>
      </div>
    `;

    const framesSetting =
      document.getElementById(
        "framesSetting"
      );

    const gifResolutionSetting =
      document.getElementById(
        "gifResolutionSetting"
      );

    if (
      framesSetting &&
      framesSetting.parentNode ===
        settings
    ) {
      framesSetting.after(
        block
      );
    } else if (
      gifResolutionSetting &&
      gifResolutionSetting.parentNode ===
        settings
    ) {
      gifResolutionSetting.after(
        block
      );
    } else {
      settings.appendChild(
        block
      );
    }

    const range =
      document.getElementById(
        "cloradSmoothingRange"
      );

    if (range) {
      range.addEventListener(
        "input",
        () => {
          const value =
            Number(
              range.value
            );

          const label =
            document.getElementById(
              "cloradSmoothingValue"
            );

          if (label) {
            label.textContent =
              value + "%";
          }

          window
            .CLOradRadarSmoothing
            .setLevel(value);
        }
      );
    }
  }

  /* =======================================================
     INITIALIZATION
     ======================================================= */

  function init() {
    /*
       По умолчанию ВСЕГДА 0%.
    */

    smoothingLevel =
      DEFAULT_LEVEL;

    createUI();

    /*
       Ждём создания Leaflet
       ImageOverlay.
    */

    setTimeout(
      () => {
        createUI();
        watchRadarImage();

        /*
           При 0% здесь ничего
           не обрабатывается.
        */
      },
      500
    );

    /*
       Ещё одна проверка только
       при инициализации.

       Это НЕ постоянный observer.
    */

    setTimeout(
      () => {
        watchRadarImage();
      },
      1500
    );
  }

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
