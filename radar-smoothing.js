/* =========================================================
   CLOrad — RADAR PIXEL INTERPOLATION
   ---------------------------------------------------------
   • Кнопка находится внутри «Настройки»
   • После «Кол. кадров»
   • 0% = оригинальный кадр
   • 1–100% = интерполяция всего изображения
   • Никаких контуров
   • Никаких масок цветов
   • Никакого удаления пикселей
   • Не удаляет слоистую облачность
   • Не создаёт отдельные цветовые области
   • Интерполируется ВЕСЬ GIF-КАДР
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
     LOAD IMAGE
     ======================================================= */

  function loadImage(url) {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        image.decoding =
          "async";

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
     Чем больше значение,
     тем сильнее уменьшается промежуточное
     изображение перед обратным увеличением.

     ВАЖНО:
     Мы не удаляем исходные данные.
     Мы интерполируем ВЕСЬ кадр.
     ======================================================= */

  function getInterpolationScale(
    strength
  ) {
    const s =
      clamp(
        Number(strength) || 0,
        0,
        100
      ) / 100;

    /*
       0%:
       исходное изображение.

       100%:
       промежуточный размер примерно 42%.

       Это достаточно сильная
       билинейная интерполяция,
       но без превращения радара
       в полностью размытое пятно.
    */

    return (
      1 -
      s * 0.58
    );
  }

  /* =======================================================
     DRAW INTERPOLATED IMAGE
     ======================================================= */

  function interpolateImage(
    source,
    strength
  ) {
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
      return null;
    }

    /*
       При 0% ничего не интерполируем.
    */

    if (
      strength <= 0
    ) {
      return null;
    }

    const scale =
      getInterpolationScale(
        strength
      );

    const smallWidth =
      Math.max(
        2,
        Math.round(
          width * scale
        )
      );

    const smallHeight =
      Math.max(
        2,
        Math.round(
          height * scale
        )
      );

    /* =====================================================
       CANVAS №1
       Уменьшение.

       Браузер интерполирует соседние
       исходные пиксели.
       ===================================================== */

    const smallCanvas =
      document.createElement(
        "canvas"
      );

    smallCanvas.width =
      smallWidth;

    smallCanvas.height =
      smallHeight;

    const smallCtx =
      smallCanvas.getContext(
        "2d",
        {
          alpha: true
        }
      );

    if (!smallCtx) {
      return null;
    }

    /*
       Именно интерполяция,
       а не nearest-neighbor.
    */

    smallCtx.imageSmoothingEnabled =
      true;

    /*
       В большинстве Safari
       это даёт качественную
       билинейную интерполяцию.
    */

    smallCtx.imageSmoothingQuality =
      "high";

    smallCtx.clearRect(
      0,
      0,
      smallWidth,
      smallHeight
    );

    smallCtx.drawImage(
      source,
      0,
      0,
      width,
      height,
      0,
      0,
      smallWidth,
      smallHeight
    );

    /* =====================================================
       CANVAS №2
       Обратное увеличение.

       Здесь интерполяция повторяется,
       поэтому квадратные пиксели
       становятся визуально плавнее.
       ===================================================== */

    const outputCanvas =
      document.createElement(
        "canvas"
      );

    outputCanvas.width =
      width;

    outputCanvas.height =
      height;

    const outputCtx =
      outputCanvas.getContext(
        "2d",
        {
          alpha: true
        }
      );

    if (!outputCtx) {
      return null;
    }

    outputCtx.imageSmoothingEnabled =
      true;

    outputCtx.imageSmoothingQuality =
      "high";

    outputCtx.clearRect(
      0,
      0,
      width,
      height
    );

    outputCtx.drawImage(
      smallCanvas,
      0,
      0,
      smallWidth,
      smallHeight,
      0,
      0,
      width,
      height
    );

    return outputCanvas.toDataURL(
      "image/png"
    );
  }

  /* =======================================================
     REMOVE INTERPOLATED LAYER
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
     RESTORE ORIGINAL
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

      source.dataset.cloradSmoothing =
        "0";

      sourceImageElement =
        source;
    }

    processing =
      false;
  }

  /* =======================================================
     INSTALL INTERPOLATED IMAGE
     ======================================================= */

  function installInterpolatedLayer(
    dataURL
  ) {
    if (
      !window.map ||
      !dataURL
    ) {
      return;
    }

    removeSmoothedLayer();

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

    /*
       Только после того,
       как новый слой установлен,
       скрываем оригинальный GIF.

       Поэтому при ошибке оригинал
       никогда не пропадает.
    */

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
  }

  /* =======================================================
     PROCESS CURRENT FRAME
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
      processing =
        false;

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

    /*
       Если предыдущая обработка
       ещё выполняется, не запускаем
       вторую одновременно.
    */

    if (processing) {
      return;
    }

    processing =
      true;

    try {
      const url =
        source.currentSrc ||
        source.src;

      if (!url) {
        return;
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

      /*
         ВАЖНО:

         Здесь НЕТ:

         • классификации цветов
         • масок
         • marching squares
         • contour
         • cleanup
         • удаления слабых пикселей
         • отрисовки отдельных классов

         Мы просто интерполируем
         ВЕСЬ исходный кадр.
      */

      const result =
        interpolateImage(
          image,
          strength
        );

      if (
        token !==
        processToken
      ) {
        return;
      }

      if (
        !result
      ) {
        return;
      }

      installInterpolatedLayer(
        result
      );
    } catch (error) {
      console.error(
        "CLOrad radar interpolation:",
        error
      );

      /*
         При любой ошибке
         оригинальный GIF остаётся.
      */
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
    if (
      installed
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
          style="
            font-size:12px;
            color:#9da7ad;
            margin-bottom:10px;
          "
        >
          Интерполяция пикселей
        </div>

        <div
          style="
            position:relative;
            width:100%;
            height:32px;
            display:flex;
            align-items:center;
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
              width:100%;
              height:28px;
              margin:0;
              padding:0;
              accent-color:#53e39b;
              touch-action:pan-y;
            "
          >
        </div>

        <div
          id="${VALUE_ID}"
          style="
            margin-top:5px;
            font-size:13px;
            color:#dfe4e7;
            text-align:right;
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

    if (button) {
      button.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          setting.classList.toggle(
            "open"
          );
        }
      );
    }

    /*
       Не даём кликам по ползунку
       закрывать родительские настройки.
    */

    if (range) {
      range.addEventListener(
        "click",
        event => {
          event.stopPropagation();
        }
      );

      range.addEventListener(
        "pointerdown",
        event => {
          event.stopPropagation();
        }
      );

      range.addEventListener(
        "pointerup",
        event => {
          event.stopPropagation();
        }
      );

      range.addEventListener(
        "touchstart",
        event => {
          event.stopPropagation();
        },
        {
          passive: true
        }
      );

      range.addEventListener(
        "touchend",
        event => {
          event.stopPropagation();
        },
        {
          passive: true
        }
      );
    }

    /* =====================================================
       INPUT
       -----------------------------------------------------
       Здесь НЕТ обработки изображения.
       Только меняем значение.
       ===================================================== */

    if (range) {
      range.addEventListener(
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
    }

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

        /*
           Только здесь запускается
           реальная интерполяция.
        */

        releaseTimer =
          setTimeout(
            () => {
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
            180
          );
      };

    if (range) {
      range.addEventListener(
        "pointerup",
        scheduleRelease
      );

      range.addEventListener(
        "touchend",
        scheduleRelease,
        {
          passive: true
        }
      );

      range.addEventListener(
        "mouseup",
        scheduleRelease
      );
    }

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
               Новый GIF-кадр.

               Старый интерполированный
               слой больше не используется.
            */

            processToken++;

            removeSmoothedLayer();

            processing =
              false;

            /*
               Новый оригинальный кадр
               всегда сначала показываем.
            */

            target.style.opacity =
              "1";

            target.dataset.cloradSmoothing =
              "0";

            sourceImageElement =
              target;

            sourceOriginalOpacity =
              "1";

            /*
               Если интерполяция включена,
               после загрузки нового кадра
               создаём новый интерполированный
               слой.
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
