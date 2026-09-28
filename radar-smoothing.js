/* =========================================================
   CLOrad — RADAR INTERPOLATION
   ---------------------------------------------------------
   • Кнопка внутри «Настройки»
   • После «Кол. кадров»
   • 0% = оригинальный радар
   • 1–100% = интерполяция радарного поля
   • Без CSS blur
   • Без RGB-размытия
   • Без новых цветов
   • Без удаления слоистой облачности
   • Исходные радарные пиксели не удаляются намеренно
   • Интерполируется именно поле классов радара
   • Результат имеет те же географические bounds
   • Обработка только после отпускания ползунка
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     GEOGRAPHIC BOUNDS
     ======================================================= */

  const GIF_BOUNDS = [
    [38.2155955810, 14.9892981264],
    [69.6543707199, 72.9237642948]
  ];

  /* =======================================================
     SETTINGS IDS
     ======================================================= */

  const SETTING_ID =
    "cloradSmoothingSetting";

  const BUTTON_ID =
    "cloradSmoothingButton";

  const PANEL_ID =
    "cloradSmoothingPanel";

  const RANGE_ID =
    "cloradSmoothingRange";

  const VALUE_ID =
    "cloradSmoothingValue";

  /* =======================================================
     RADAR PALETTE
     ======================================================= */

  const SOURCE_CLASS_START = 2;

  const SOURCE_OY_COLORS = [
    "#b9c1c7",
    "#a9a9a9",
    "#00ff00",
    "#00cc00",
    "#009900",
    "#00ffff",
    "#4da6ff",
    "#3366ff",
    "#0000cc",
    "#ff66cc",
    "#ff00ff",
    "#cc0099",
    "#ffff00",
    "#ff9900",
    "#ff0000",
    "#cc99ff",
    "#cc33ff",
    "#9900cc",
    "#000000"
  ];

  const DEFAULT_TARGET_COLORS = [
    "#b9c1c7",
    "#a9c7f4",
    "#63eda5",
    "#43cf89",
    "#4db84e",
    "#fff89c",
    "#75a6ef",
    "#5279ed",
    "#504a9b",
    "#ffc0a8",
    "#fa82a0",
    "#ff4d4d",
    "#db9248",
    "#ad7544",
    "#f2aaf0",
    "#e85ae7",
    "#ca3cc7",
    "#777c91"
  ];

  /*
     Небольшой допуск нужен только для
     определения уже существующих цветов.

     Цвета между классами НЕ создаются.
  */

  const MAX_COLOR_DISTANCE = 28;

  /* =======================================================
     STATE
     ======================================================= */

  let smoothingValue = 0;

  let smoothingLayer = null;

  let sourceImageElement = null;

  let sourceOriginalOpacity = "1";

  let processing = false;

  let processToken = 0;

  let releaseTimer = null;

  let installed = false;

  let frameObserver = null;

  /* =======================================================
     HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function hexToRGB(hex) {
    if (typeof hex !== "string") {
      return null;
    }

    let value = hex.trim();

    if (value[0] === "#") {
      value = value.slice(1);
    }

    if (value.length === 3) {
      value = value
        .split("")
        .map(x => x + x)
        .join("");
    }

    if (value.length !== 6) {
      return null;
    }

    const number = parseInt(
      value,
      16
    );

    if (!Number.isFinite(number)) {
      return null;
    }

    return {
      r: (number >> 16) & 255,
      g: (number >> 8) & 255,
      b: number & 255
    };
  }

  function rgbDistance(
    r,
    g,
    b,
    color
  ) {
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;

    return Math.sqrt(
      dr * dr +
      dg * dg +
      db * db
    );
  }

  /* =======================================================
     CURRENT PALETTE
     ======================================================= */

  function getCurrentPalette() {
    try {
      if (
        typeof window.CLOradGetCurrentPalette ===
        "function"
      ) {
        const result =
          window.CLOradGetCurrentPalette();

        if (
          result &&
          Array.isArray(result.colors) &&
          result.colors.length >= 19
        ) {
          const colors =
            result.colors
              .slice(0, 19)
              .map(hexToRGB);

          if (
            colors.every(
              color => color
            )
          ) {
            return colors;
          }
        }
      }
    } catch (error) {
      console.warn(
        "CLOrad interpolation palette:",
        error
      );
    }

    return DEFAULT_TARGET_COLORS.map(
      hexToRGB
    );
  }

  /* =======================================================
     SOURCE IMAGE
     ======================================================= */

  function getSourceImage() {
    const images =
      Array.from(
        document.querySelectorAll(
          "img.clorad-gif-radar-image"
        )
      );

    if (!images.length) {
      return null;
    }

    for (
      let i = images.length - 1;
      i >= 0;
      i--
    ) {
      const image = images[i];

      if (
        image &&
        image.dataset &&
        image.dataset.cloradSmoothing !== "1"
      ) {
        return image;
      }
    }

    return null;
  }

  /* =======================================================
     IMAGE LOADER
     ======================================================= */

  function loadImage(url) {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        image.decoding = "async";

        image.onload = () => {
          resolve(image);
        };

        image.onerror = () => {
          reject(
            new Error(
              "Не удалось загрузить кадр радара"
            )
          );
        };

        image.src = url;
      }
    );
  }

  /* =======================================================
     COLOR CLASSIFICATION
     ======================================================= */

  function buildLabelMap(
    imageData,
    width,
    height,
    palette
  ) {
    const data =
      imageData.data;

    const labels =
      new Int16Array(
        width * height
      );

    /*
       -1 = прозрачный / фон
       0–1 = служебные серые классы
       2–18 = радар
    */

    labels.fill(-1);

    const paletteCache =
      new Map();

    let radarPixels = 0;

    for (
      let y = 0;
      y < height;
      y++
    ) {
      const row =
        y * width;

      for (
        let x = 0;
        x < width;
        x++
      ) {
        const index =
          row + x;

        const p =
          index * 4;

        const alpha =
          data[p + 3];

        if (alpha < 32) {
          continue;
        }

        const r =
          data[p];

        const g =
          data[p + 1];

        const b =
          data[p + 2];

        const key =
          (r << 16) |
          (g << 8) |
          b;

        let classIndex;

        if (
          paletteCache.has(key)
        ) {
          classIndex =
            paletteCache.get(key);
        } else {
          let best =
            -1;

          let bestDistance =
            Infinity;

          /*
             Ищем ближайший цвет
             ТОЛЬКО среди радарных
             классов.

             Серый фон сюда не попадает.
          */

          for (
            let i =
              SOURCE_CLASS_START;
            i < palette.length;
            i++
          ) {
            const color =
              palette[i];

            if (!color) {
              continue;
            }

            const distance =
              rgbDistance(
                r,
                g,
                b,
                color
              );

            if (
              distance <
              bestDistance
            ) {
              bestDistance =
                distance;

              best =
                i;
            }
          }

          if (
            best <
              SOURCE_CLASS_START ||
            bestDistance >
              MAX_COLOR_DISTANCE
          ) {
            best = -1;
          }

          paletteCache.set(
            key,
            best
          );

          classIndex =
            best;
        }

        labels[index] =
          classIndex;

        if (
          classIndex >=
          SOURCE_CLASS_START
        ) {
          radarPixels++;
        }
      }
    }

    return {
      labels,
      radarPixels
    };
  }

  /* =======================================================
     INTERPOLATION
     -------------------------------------------------------
     Здесь НЕТ morphology,
     НЕТ marching squares,
     НЕТ Chaikin.

     Это обычная пространственная
     интерполяция числового поля классов.

     После интерполяции значение
     снова переводится в существующий
     цвет палитры.
     ======================================================= */

  function interpolateClass(
    labels,
    width,
    height,
    x,
    y,
    radius
  ) {
    /*
       Базовая точка.
    */

    const x0 =
      Math.floor(x);

    const y0 =
      Math.floor(y);

    const x1 =
      Math.min(
        width - 1,
        x0 + 1
      );

    const y1 =
      Math.min(
        height - 1,
        y0 + 1
      );

    const fx =
      x - x0;

    const fy =
      y - y0;

    function value(
      px,
      py
    ) {
      if (
        px < 0 ||
        py < 0 ||
        px >= width ||
        py >= height
      ) {
        return -1;
      }

      return labels[
        py * width + px
      ];
    }

    /*
       Сначала обычная bilinear
       interpolation.

       Она работает только если
       вокруг точки действительно
       есть радар.
    */

    const a =
      value(x0, y0);

    const b =
      value(x1, y0);

    const c =
      value(x0, y1);

    const d =
      value(x1, y1);

    const values = [];

    if (a >= SOURCE_CLASS_START) {
      values.push([
        a,
        (1 - fx) *
          (1 - fy)
      ]);
    }

    if (b >= SOURCE_CLASS_START) {
      values.push([
        b,
        fx *
          (1 - fy)
      ]);
    }

    if (c >= SOURCE_CLASS_START) {
      values.push([
        c,
        (1 - fx) *
          fy
      ]);
    }

    if (d >= SOURCE_CLASS_START) {
      values.push([
        d,
        fx * fy
      ]);
    }

    /*
       Если локальная bilinear-точка
       полностью оказалась в фоне,
       проверяем ближайшее
       интерполяционное окружение.

       Это не позволяет маленьким
       радарным участкам исчезать.
    */

    if (
      !values.length
    ) {
      let weighted =
        0;

      let weightSum =
        0;

      const r =
        Math.max(
          1,
          radius
        );

      for (
        let dy = -r;
        dy <= r;
        dy++
      ) {
        for (
          let dx = -r;
          dx <= r;
          dx++
        ) {
          const px =
            Math.round(x) + dx;

          const py =
            Math.round(y) + dy;

          const v =
            value(px, py);

          if (
            v <
            SOURCE_CLASS_START
          ) {
            continue;
          }

          const distance =
            Math.sqrt(
              dx * dx +
              dy * dy
            );

          if (
            distance >
            r
          ) {
            continue;
          }

          const weight =
            1 /
            (
              1 +
              distance
            );

          weighted +=
            v *
            weight;

          weightSum +=
            weight;
        }
      }

      if (
        weightSum <= 0
      ) {
        return -1;
      }

      return (
        weighted /
        weightSum
      );
    }

    let weighted =
      0;

    let weightSum =
      0;

    for (
      const item of values
    ) {
      weighted +=
        item[0] *
        item[1];

      weightSum +=
        item[1];
    }

    if (
      weightSum <= 0
    ) {
      return -1;
    }

    return (
      weighted /
      weightSum
    );
  }

  /* =======================================================
     INTERPOLATED RADAR
     ======================================================= */

  function createInterpolatedRadar(
    labels,
    width,
    height,
    palette,
    strength
  ) {
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
          willReadFrequently:
            false
        }
      );

    if (!ctx) {
      return null;
    }

    /*
       Прозрачный canvas.

       Поэтому:
       • карта остаётся снизу;
       • слоистая облачность остаётся;
       • фон GIF не закрашивается.
    */

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    /*
       Сила интерполяции.

       1–10%:
       практически исходная форма.

       100%:
       более широкая интерполяция
       соседних значений.
    */

    const s =
      clamp(
        strength,
        0,
        100
      ) / 100;

    const radius =
      Math.max(
        1,
        Math.min(
          4,
          1 +
            Math.floor(
              s * 3
            )
        )
      );

    /*
       ВАЖНО:

       Мы не рисуем каждый пиксель
       отдельным прямоугольником.

       Сначала создаётся интерполированное
       поле, затем оно окрашивается
       существующими цветами.
    */

    const output =
      new Uint8ClampedArray(
        width *
        height
      );

    /*
       0 = прозрачный
       1 = радар
    */

    const outputClass =
      new Int16Array(
        width *
        height
      );

    outputClass.fill(-1);

    /*
       Чтобы не перегружать iPhone,
       обрабатываем строками.
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
        const index =
          y * width + x;

        /*
           Исходный класс.
        */

        const original =
          labels[index];

        /*
           Если это радарный пиксель,
           он обязательно остаётся
           представленным в результате.
        */

        if (
          original >=
          SOURCE_CLASS_START
        ) {
          const interpolated =
            interpolateClass(
              labels,
              width,
              height,
              x,
              y,
              radius
            );

          if (
            interpolated >=
            SOURCE_CLASS_START
          ) {
            /*
               Привязываем результат
               обратно к существующим
               дискретным классам.

               НОВЫХ RGB-ЦВЕТОВ НЕТ.
            */

            const nearest =
              clamp(
                Math.round(
                  interpolated
                ),
                SOURCE_CLASS_START,
                palette.length - 1
              );

            outputClass[index] =
              nearest;
          } else {
            /*
               Если интерполяция около
               границы потеряла значение,
               оставляем оригинал.
            */

            outputClass[index] =
              original;
          }

          continue;
        }

        /*
           Для фона пытаемся аккуратно
           продолжить интерполированную
           область только если рядом
           есть радар.

           Это позволяет сглаживать
           границу, не удаляя исходные
           радарные пиксели.
        */

        if (
          strength <= 0
        ) {
          continue;
        }

        const interpolated =
          interpolateClass(
            labels,
            width,
            height,
            x,
            y,
            radius
          );

        if (
          interpolated <
          SOURCE_CLASS_START
        ) {
          continue;
        }

        /*
           Чем выше сила,
           тем больше допускаем
           интерполяционное продолжение
           границы.

           Но максимум — радиус
           самого интерполяционного
           окна.
        */

        const distance =
          Math.abs(
            interpolated -
            Math.round(
              interpolated
            )
          );

        /*
           На границе используем только
           достаточно уверенные значения.
        */

        if (
          distance <=
          0.48
        ) {
          outputClass[index] =
            clamp(
              Math.round(
                interpolated
              ),
              SOURCE_CLASS_START,
              palette.length - 1
            );
        }
      }
    }

    /*
       Рисуем только радар.

       Каждый класс получает
       СУЩЕСТВУЮЩИЙ цвет палитры.
    */

    const data =
      ctx.createImageData(
        width,
        height
      );

    const rgba =
      data.data;

    for (
      let i = 0;
      i < outputClass.length;
      i++
    ) {
      const classIndex =
        outputClass[i];

      if (
        classIndex <
        SOURCE_CLASS_START
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

      const p =
        i * 4;

      rgba[p] =
        color.r;

      rgba[p + 1] =
        color.g;

      rgba[p + 2] =
        color.b;

      rgba[p + 3] =
        255;
    }

    ctx.putImageData(
      data,
      0,
      0
    );

    return canvas;
  }

  /* =======================================================
     REMOVE INTERPOLATION
     ======================================================= */

  function removeSmoothedLayer() {
    if (
      smoothingLayer &&
      window.map &&
      window.map.hasLayer(
        smoothingLayer
      )
    ) {
      window.map.removeLayer(
        smoothingLayer
      );
    }

    smoothingLayer =
      null;
  }

  /* =======================================================
     RESTORE ORIGINAL RADAR
     ======================================================= */

  function restoreOriginal() {
    processToken++;

    removeSmoothedLayer();

    const source =
      getSourceImage();

    if (source) {
      source.style.opacity =
        sourceOriginalOpacity ||
        "1";
    }

    sourceImageElement =
      source;

    processing =
      false;
  }

  /* =======================================================
     INSTALL RESULT
     ======================================================= */

  function installInterpolatedLayer(
    dataURL
  ) {
    if (
      !window.map ||
      !dataURL
    ) {
      return false;
    }

    /*
       Сначала добавляем результат.

       Только после успешного добавления
       скрываем оригинальный радар.
    */

    const layer =
      L.imageOverlay(
        dataURL,
        GIF_BOUNDS,
        {
          opacity: 1,
          interactive: false,
          zIndex: 7,
          className:
            "clorad-gif-radar-smoothed"
        }
      );

    layer.addTo(
      window.map
    );

    smoothingLayer =
      layer;

    const source =
      getSourceImage();

    if (source) {
      sourceImageElement =
        source;

      sourceOriginalOpacity =
        source.style.opacity ||
        "1";

      source.style.opacity =
        "0";
    }

    if (
      typeof layer.bringToFront ===
      "function"
    ) {
      layer.bringToFront();
    }

    return true;
  }

  /* =======================================================
     PROCESS FRAME
     ======================================================= */

  async function processCurrentFrame(
    strength
  ) {
    const token =
      ++processToken;

    if (
      strength <= 0
    ) {
      restoreOriginal();
      return;
    }

    const source =
      getSourceImage();

    if (!source) {
      return;
    }

    if (
      !source.complete ||
      !source.naturalWidth ||
      !source.naturalHeight
    ) {
      setTimeout(
        () => {
          if (
            token ===
            processToken
          ) {
            processCurrentFrame(
              strength
            );
          }
        },
        150
      );

      return;
    }

    if (processing) {
      return;
    }

    processing =
      true;

    /*
       Пока вычисляем,
       оригинал НЕ скрываем.

       Это важно: если canvas
       или кадр не загрузится,
       радар не пропадёт.
    */

    try {
      const url =
        source.currentSrc ||
        source.src;

      if (!url) {
        throw new Error(
          "Нет URL текущего кадра"
        );
      }

      const image =
        await loadImage(
          url
        );

      if (
        token !==
        processToken
      ) {
        return;
      }

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
        throw new Error(
          "Некорректный размер кадра"
        );
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
            willReadFrequently:
              true
          }
        );

      if (!ctx) {
        throw new Error(
          "Canvas недоступен"
        );
      }

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      ctx.drawImage(
        image,
        0,
        0,
        width,
        height
      );

      let imageData;

      try {
        imageData =
          ctx.getImageData(
            0,
            0,
            width,
            height
          );
      } catch (error) {
        throw new Error(
          "Canvas заблокирован"
        );
      }

      if (
        token !==
        processToken
      ) {
        return;
      }

      const palette =
        getCurrentPalette();

      if (
        !palette ||
        palette.length < 19
      ) {
        throw new Error(
          "Палитра радара недоступна"
        );
      }

      const mapData =
        buildLabelMap(
          imageData,
          width,
          height,
          palette
        );

      if (
        token !==
        processToken
      ) {
        return;
      }

      /*
         Защита от пустого результата.
      */

      if (
        mapData.radarPixels <
        20
      ) {
        throw new Error(
          "Радарные пиксели не найдены"
        );
      }

      const resultCanvas =
        createInterpolatedRadar(
          mapData.labels,
          width,
          height,
          palette,
          strength
        );

      if (!resultCanvas) {
        throw new Error(
          "Не удалось создать интерполированный слой"
        );
      }

      if (
        token !==
        processToken
      ) {
        return;
      }

      const result =
        resultCanvas.toDataURL(
          "image/png"
        );

      if (
        !result ||
        result === "data:,"
      ) {
        throw new Error(
          "Пустой результат интерполяции"
        );
      }

      if (
        token !==
        processToken
      ) {
        return;
      }

      /*
         Старый результат удаляем
         только когда новый уже готов.
      */

      removeSmoothedLayer();

      /*
         Оригинальный радар пока виден.
      */

      const installedResult =
        installInterpolatedLayer(
          result
        );

      if (!installedResult) {
        throw new Error(
          "Не удалось установить слой"
        );
      }
    } catch (error) {
      console.error(
        "CLOrad radar interpolation:",
        error
      );

      /*
         При любой ошибке оригинальный
         радар остаётся видимым.
      */

      removeSmoothedLayer();

      const sourceAfterError =
        getSourceImage();

      if (
        sourceAfterError
      ) {
        sourceAfterError.style.opacity =
          sourceOriginalOpacity ||
          "1";
      }
    } finally {
      if (
        token ===
        processToken
      ) {
        processing =
          false;
      }
    }
  }

  /* =======================================================
     SETTINGS UI
     ======================================================= */

  function installSetting() {
    if (installed) {
      return;
    }

    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    if (
      document.getElementById(
        SETTING_ID
      )
    ) {
      installed =
        true;

      return;
    }

    const setting =
      document.createElement(
        "div"
      );

    setting.className =
      "setting";

    setting.id =
      SETTING_ID;

    setting.innerHTML = `
      <button
        class="settingHead"
        id="${BUTTON_ID}"
        type="button"
      >
        <span>Сглаживание радара</span>
        <span class="settingArrow">›</span>
      </button>

      <div
        class="settingBody"
        id="${PANEL_ID}"
      >
        <div
          class="cloradInterpolationTitle"
          style="
            font-size:12px;
            color:#9da7ad;
            margin-bottom:8px;
          "
        >
          Интерполяция радарного поля
        </div>

        <div
          class="cloradInterpolationSlider"
          style="
            width:100%;
            height:32px;
            display:flex;
            align-items:center;
            touch-action:none;
            user-select:none;
            -webkit-user-select:none;
          "
        >
          <input
            id="${RANGE_ID}"
            type="range"
            min="0"
            max="100"
            step="1"
            value="0"
            style="
              display:block;
              width:100%;
              height:28px;
              margin:0;
              padding:0;
              cursor:pointer;
              touch-action:pan-x;
              accent-color:#53e39b;
            "
          >
        </div>

        <div
          id="${VALUE_ID}"
          style="
            margin-top:4px;
            font-size:13px;
            color:#dfe4e7;
            text-align:right;
            line-height:18px;
          "
        >
          0%
        </div>
      </div>
    `;

    /*
       Ставим строго после
       «Кол. кадров».
    */

    const framesSetting =
      document.getElementById(
        "framesSetting"
      );

    if (framesSetting) {
      framesSetting.after(
        setting
      );
    } else {
      settings.appendChild(
        setting
      );
    }

    const button =
      document.getElementById(
        BUTTON_ID
      );

    const panel =
      document.getElementById(
        PANEL_ID
      );

    const range =
      document.getElementById(
        RANGE_ID
      );

    const value =
      document.getElementById(
        VALUE_ID
      );

    /* =====================================================
       OPEN / CLOSE
       ===================================================== */

    button?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        setting.classList.toggle(
          "open"
        );
      }
    );

    /*
       Ничего внутри панели
       не должно закрывать
       «Настройки».
    */

    panel?.addEventListener(
      "click",
      event => {
        event.stopPropagation();
      }
    );

    panel?.addEventListener(
      "pointerdown",
      event => {
        event.stopPropagation();
      }
    );

    panel?.addEventListener(
      "pointerup",
      event => {
        event.stopPropagation();
      }
    );

    panel?.addEventListener(
      "touchstart",
      event => {
        event.stopPropagation();
      },
      {
        passive: true
      }
    );

    panel?.addEventListener(
      "touchend",
      event => {
        event.stopPropagation();
      },
      {
        passive: true
      }
    );

    /* =====================================================
       SLIDER INPUT
       -----------------------------------------------------
       Здесь НИЧЕГО не пересчитывается.
       ===================================================== */

    range?.addEventListener(
      "input",
      event => {
        event.stopPropagation();

        smoothingValue =
          clamp(
            Number(
              range.value
            ),
            0,
            100
          );

        if (value) {
          value.textContent =
            smoothingValue +
            "%";
        }

        /*
           Старый результат убираем,
           но оригинальный радар
           оставляем.

           Поэтому GIF никогда
           не исчезает при движении
           ползунка.
        */

        if (
          smoothingLayer
        ) {
          removeSmoothedLayer();
        }

        const source =
          getSourceImage();

        if (source) {
          source.style.opacity =
            sourceOriginalOpacity ||
            "1";
        }

        /*
           0% — сразу оригинал.
        */

        if (
          smoothingValue ===
          0
        ) {
          clearTimeout(
            releaseTimer
          );

          restoreOriginal();
        }
      }
    );

    /* =====================================================
       RELEASE
       ===================================================== */

    const scheduleRelease =
      event => {
        if (event) {
          event.stopPropagation();
        }

        clearTimeout(
          releaseTimer
        );

        releaseTimer =
          setTimeout(
            () => {
              processCurrentFrame(
                smoothingValue
              );
            },
            220
          );
      };

    range?.addEventListener(
      "pointerup",
      scheduleRelease
    );

    range?.addEventListener(
      "touchend",
      scheduleRelease,
      {
        passive: false
      }
    );

    range?.addEventListener(
      "mouseup",
      scheduleRelease
    );

    /*
       Если пользователь закончил
       движение за пределами элемента.
    */

    range?.addEventListener(
      "pointercancel",
      event => {
        event.stopPropagation();

        clearTimeout(
          releaseTimer
        );

        releaseTimer =
          setTimeout(
            () => {
              processCurrentFrame(
                smoothingValue
              );
            },
            220
          );
      }
    );

    installed =
      true;
  }

  /* =======================================================
     WATCH GIF FRAME
     ======================================================= */

  function watchGIFFrame() {
    if (frameObserver) {
      return;
    }

    frameObserver =
      new MutationObserver(
        mutations => {
          for (
            const mutation of mutations
          ) {
            if (
              mutation.type !==
              "attributes"
            ) {
              continue;
            }

            if (
              mutation.attributeName !==
              "src"
            ) {
              continue;
            }

            const target =
              mutation.target;

            if (
              !target.matches?.(
                "img.clorad-gif-radar-image"
              )
            ) {
              continue;
            }

            /*
               Новый кадр.

               Старый интерполированный
               слой больше не соответствует
               GIF.
            */

            processToken++;

            removeSmoothedLayer();

            processing =
              false;

            /*
               Новый GIF всегда сначала
               показываем оригинальным.
            */

            target.style.opacity =
              "1";

            sourceImageElement =
              target;

            sourceOriginalOpacity =
              "1";

            /*
               Если интерполяция включена,
               после загрузки нового кадра
               строим её заново.
            */

            if (
              smoothingValue > 0
            ) {
              clearTimeout(
                releaseTimer
              );

              releaseTimer =
                setTimeout(
                  () => {
                    processCurrentFrame(
                      smoothingValue
                    );
                  },
                  180
                );
            }
          }
        }
      );

    frameObserver.observe(
      document.body,
      {
        subtree: true,
        attributes: true,
        attributeFilter: [
          "src"
        ]
      }
    );
  }

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    installSetting();

    if (!installed) {
      setTimeout(
        init,
        250
      );

      return;
    }

    watchGIFFrame();
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

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRadarSmoothing = {
    getValue() {
      return smoothingValue;
    },

    setValue(value) {
      smoothingValue =
        clamp(
          Number(value) || 0,
          0,
          100
        );

      const range =
        document.getElementById(
          RANGE_ID
        );

      const valueElement =
        document.getElementById(
          VALUE_ID
        );

      if (range) {
        range.value =
          String(
            smoothingValue
          );
      }

      if (valueElement) {
        valueElement.textContent =
          smoothingValue +
          "%";
      }

      if (
        smoothingValue ===
        0
      ) {
        restoreOriginal();
      } else {
        processCurrentFrame(
          smoothingValue
        );
      }
    },

    restore() {
      smoothingValue =
        0;

      const range =
        document.getElementById(
          RANGE_ID
        );

      const value =
        document.getElementById(
          VALUE_ID
        );

      if (range) {
        range.value =
          "0";
      }

      if (value) {
        value.textContent =
          "0%";
      }

      restoreOriginal();
    }
  };
})();
