/* =========================================================
   CLOrad — RADAR PIXEL INTERPOLATION
   ---------------------------------------------------------
   • Только интерполяция пикселей
   • Без морфологии
   • Без marching squares
   • Без контурной векторизации
   • Без CSS blur
   • Без изменения gif-radar.js
   • 0% = оригинальный радар
   • 1–100% = интерполяция
   • GIF не исчезает во время обработки
   • Другие слои CLOrad не затрагиваются
   • Обработка после отпускания ползунка
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
     SETTINGS
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
     STATE
     ======================================================= */

  let smoothingValue = 0;

  let smoothingLayer = null;

  let processing = false;

  let processToken = 0;

  let releaseTimer = null;

  let installed = false;

  let observerStarted = false;

  let lastSource = null;

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

  /* =======================================================
     FIND ONLY RADAR GIF
     -------------------------------------------------------
     Никакие другие слои здесь не ищутся.
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

    for (let i = images.length - 1; i >= 0; i--) {
      const image = images[i];

      if (
        image &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0
      ) {
        return image;
      }
    }

    return images[images.length - 1] || null;
  }

  /* =======================================================
     REMOVE ONLY OUR INTERPOLATION LAYER
     ======================================================= */

  function removeSmoothedLayer() {
    if (
      smoothingLayer &&
      window.map &&
      window.map.hasLayer &&
      window.map.hasLayer(
        smoothingLayer
      )
    ) {
      window.map.removeLayer(
        smoothingLayer
      );
    }

    smoothingLayer = null;
  }

  /* =======================================================
     RESTORE ORIGINAL
     ======================================================= */

  function restoreOriginal() {
    processToken++;

    removeSmoothedLayer();

    processing = false;
  }

  /* =======================================================
     LOAD IMAGE
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
     INTERPOLATION STRENGTH
     -------------------------------------------------------
     Мы НЕ используем blur.

     Метод:

       исходник
          ↓
       увеличение
          ↓
       imageSmoothingQuality = high
          ↓
       уменьшение обратно

     Именно уменьшение большого изображения
     обратно в исходный размер заставляет Canvas
     интерполировать соседние пиксели.

     Максимум намеренно ограничен 3x,
     чтобы iPhone не получил огромный canvas.
     ======================================================= */

  function getInterpolationScale(strength) {
    const s =
      clamp(
        Number(strength) || 0,
        0,
        100
      ) / 100;

    /*
       0% не обрабатывается вообще.

       При 1% уже есть минимальная
       интерполяция.

       100% = 3x supersampling.
    */

    return (
      1.08 +
      s * 1.92
    );
  }

  /* =======================================================
     INTERPOLATE FRAME
     ======================================================= */

  async function interpolateFrame(
    strength
  ) {
    const token =
      ++processToken;

    strength =
      clamp(
        Number(strength) || 0,
        0,
        100
      );

    /* -----------------------------------------------------
       0% = вообще ничего не рисуем.
       ----------------------------------------------------- */

    if (strength <= 0) {
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
            token === processToken
          ) {
            interpolateFrame(
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

    processing = true;

    try {
      const sourceURL =
        source.currentSrc ||
        source.src;

      if (!sourceURL) {
        throw new Error(
          "У радара отсутствует src"
        );
      }

      const image =
        await loadImage(
          sourceURL
        );

      if (
        token !== processToken
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
        return;
      }

      /* ---------------------------------------------------
         ORIGINAL CANVAS
         --------------------------------------------------- */

      const sourceCanvas =
        document.createElement(
          "canvas"
        );

      sourceCanvas.width =
        width;

      sourceCanvas.height =
        height;

      const sourceContext =
        sourceCanvas.getContext(
          "2d"
        );

      if (!sourceContext) {
        throw new Error(
          "Canvas недоступен"
        );
      }

      /*
         Очень важно:

         не меняем альфа-канал,
         не перекрашиваем изображение,
         не классифицируем цвета.
      */

      sourceContext.clearRect(
        0,
        0,
        width,
        height
      );

      sourceContext.imageSmoothingEnabled =
        false;

      sourceContext.drawImage(
        image,
        0,
        0,
        width,
        height
      );

      if (
        token !== processToken
      ) {
        return;
      }

      /* ---------------------------------------------------
         UPSCALE
         --------------------------------------------------- */

      const scale =
        getInterpolationScale(
          strength
        );

      const largeWidth =
        Math.max(
          width,
          Math.ceil(
            width * scale
          )
        );

      const largeHeight =
        Math.max(
          height,
          Math.ceil(
            height * scale
          )
        );

      const largeCanvas =
        document.createElement(
          "canvas"
        );

      largeCanvas.width =
        largeWidth;

      largeCanvas.height =
        largeHeight;

      const largeContext =
        largeCanvas.getContext(
          "2d"
        );

      if (!largeContext) {
        throw new Error(
          "Большой Canvas недоступен"
        );
      }

      largeContext.clearRect(
        0,
        0,
        largeWidth,
        largeHeight
      );

      /*
         Первый этап интерполяции.
      */

      largeContext.imageSmoothingEnabled =
        true;

      largeContext.imageSmoothingQuality =
        "high";

      largeContext.drawImage(
        sourceCanvas,
        0,
        0,
        width,
        height,
        0,
        0,
        largeWidth,
        largeHeight
      );

      if (
        token !== processToken
      ) {
        return;
      }

      /* ---------------------------------------------------
         DOWNSCALE
         ---------------------------------------------------
         Главное место интерполяции.

         Большое изображение возвращается
         в исходные 1122×1136.

         Canvas смешивает соседние
         значения пикселей.
         --------------------------------------------------- */

      const resultCanvas =
        document.createElement(
          "canvas"
        );

      resultCanvas.width =
        width;

      resultCanvas.height =
        height;

      const resultContext =
        resultCanvas.getContext(
          "2d"
        );

      if (!resultContext) {
        throw new Error(
          "Result Canvas недоступен"
        );
      }

      resultContext.clearRect(
        0,
        0,
        width,
        height
      );

      resultContext.imageSmoothingEnabled =
        true;

      resultContext.imageSmoothingQuality =
        "high";

      resultContext.drawImage(
        largeCanvas,
        0,
        0,
        largeWidth,
        largeHeight,
        0,
        0,
        width,
        height
      );

      if (
        token !== processToken
      ) {
        return;
      }

      /* ---------------------------------------------------
         RESULT
         --------------------------------------------------- */

      const result =
        resultCanvas.toDataURL(
          "image/png"
        );

      if (
        !result ||
        result === "data:,"
      ) {
        throw new Error(
          "Canvas вернул пустой результат"
        );
      }

      if (
        token !== processToken
      ) {
        return;
      }

      /* ---------------------------------------------------
         НОВЫЙ СЛОЙ ДОБАВЛЯЕМ ПЕРЕД УДАЛЕНИЕМ
         СТАРОГО.

         Поэтому GIF не исчезает во время
         обработки.
         --------------------------------------------------- */

      installInterpolatedLayer(
        result
      );

    } catch (error) {
      console.error(
        "CLOrad radar interpolation:",
        error
      );

      /*
         Если интерполяция не удалась,
         оригинальный GIF остаётся видимым.
      */

    } finally {
      if (
        token === processToken
      ) {
        processing = false;
      }
    }
  }

  /* =======================================================
     INSTALL RESULT
     ======================================================= */

  function installInterpolatedLayer(
    dataURL
  ) {
    if (
      !window.map
    ) {
      return;
    }

    const newLayer =
      L.imageOverlay(
        dataURL,
        GIF_BOUNDS,
        {
          opacity: 1,
          interactive: false,
          zIndex: 7,
          className:
            "clorad-gif-radar-interpolated"
        }
      );

    /*
       Сначала добавляем новый слой.
       Старый остаётся под ним.
    */

    newLayer.addTo(
      window.map
    );

    /*
       Только после добавления
       результата убираем предыдущий
       интерполированный слой.
    */

    const oldLayer =
      smoothingLayer;

    smoothingLayer =
      newLayer;

    if (
      oldLayer &&
      window.map.hasLayer &&
      window.map.hasLayer(
        oldLayer
      )
    ) {
      window.map.removeLayer(
        oldLayer
      );
    }

    if (
      typeof newLayer.bringToFront ===
      "function"
    ) {
      newLayer.bringToFront();
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
      installed = true;
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
          style="
            font-size:12px;
            color:#9da7ad;
            margin-bottom:10px;
          "
        >
          Интерполяция пикселей
        </div>

        <input
          id="${RANGE_ID}"
          type="range"
          min="0"
          max="100"
          step="1"
          value="0"
          style="
            width:100%;
            display:block;
            margin:0;
            accent-color:#53e39b;
            touch-action:none;
          "
        >

        <div
          id="${VALUE_ID}"
          style="
            margin-top:7px;
            font-size:13px;
            color:#dfe4e7;
            text-align:right;
          "
        >
          0%
        </div>
      </div>
    `;

    /* -----------------------------------------------------
       ПОСЛЕ «КОЛ. КАДРОВ»
       ----------------------------------------------------- */

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

    /* =====================================================
       НЕ ПЕРЕДАЁМ КЛИКИ ПОЛЗУНКА
       НАРУЖУ НАСТРОЕК
       ===================================================== */

    [
      panel,
      range
    ].forEach(
      element => {
        if (!element) {
          return;
        }

        [
          "pointerdown",
          "pointermove",
          "pointerup",
          "touchstart",
          "touchmove",
          "touchend",
          "mousedown",
          "mousemove",
          "mouseup",
          "click"
        ].forEach(
          eventName => {
            element.addEventListener(
              eventName,
              event => {
                event.stopPropagation();
              }
            );
          }
        );
      }
    );

    /* =====================================================
       INPUT
       -----------------------------------------------------
       Только меняем значение.

       Интерполяция НЕ запускается здесь.
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
      }
    );

    /* =====================================================
       RELEASE
       ===================================================== */

    function release() {
      clearTimeout(
        releaseTimer
      );

      releaseTimer =
        setTimeout(
          () => {
            interpolateFrame(
              smoothingValue
            );
          },
          180
        );
    }

    range?.addEventListener(
      "pointerup",
      event => {
        event.stopPropagation();
        release();
      }
    );

    range?.addEventListener(
      "touchend",
      event => {
        event.stopPropagation();
        release();
      }
    );

    range?.addEventListener(
      "mouseup",
      event => {
        event.stopPropagation();
        release();
      }
    );

    installed = true;
  }

  /* =======================================================
     FRAME CHANGE
     ======================================================= */

  function watchGIFFrame() {
    if (observerStarted) {
      return;
    }

    observerStarted = true;

    const observer =
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

               Старый результат больше
               нельзя использовать.
            */

            processToken++;

            removeSmoothedLayer();

            processing = false;

            lastSource =
              target;

            /*
               Если сглаживание включено,
               после загрузки нового кадра
               снова интерполируем его.
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
                    interpolateFrame(
                      smoothingValue
                    );
                  },
                  140
                );
            }
          }
        }
      );

    observer.observe(
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
        interpolateFrame(
          smoothingValue
        );
      }
    },

    restore() {
      smoothingValue = 0;

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
