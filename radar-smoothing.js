/* =========================================================
   CLOrad — RADAR PIXEL INTERPOLATION
   ---------------------------------------------------------
   • Интерполяция исходного радарного растра
   • Никаких контуров
   • Никаких marching squares
   • Никаких morphology
   • Никаких Chaikin
   • Никакого CSS blur
   • Не удаляет облачность
   • Не удаляет слабые радарные области
   • Не добавляет новые геометрические области
   • Цвета интерполируются только между соседними пикселями
   • Географические координаты GIF не изменяются
   • 0% = оригинальный кадр
   • 1–100% = увеличение качества интерполяции
   • Обработка только после отпускания ползунка
   • Настройка находится внутри «Настройки»
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

  let sourceImageElement = null;

  let sourceOriginalOpacity = "1";

  let processing = false;

  let processToken = 0;

  let releaseTimer = null;

  let installed = false;

  let frameObserverStarted = false;

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
     FIND CURRENT GIF
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

    /*
       Берём последний настоящий
       GIF-слой.

       Наш собственный слой
       имеет другой className.
    */

    for (
      let i = images.length - 1;
      i >= 0;
      i--
    ) {
      const image = images[i];

      if (
        image &&
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

        /*
           Нужно для data/blob URL,
           которые используются GIF-радаром.
        */

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
     INTERPOLATION SCALE
     -------------------------------------------------------
     Здесь нет изменения цветов вручную.

     Мы просто создаём растр большего
     разрешения и включаем стандартную
     билинейную интерполяцию Canvas.

     Чем выше значение — тем выше
     промежуточное разрешение.
     ======================================================= */

  function getInterpolationScale(strength) {
    const value =
      clamp(
        Number(strength) || 0,
        0,
        100
      );

    if (value <= 0) {
      return 1;
    }

    /*
       1%:
       почти исходный растр.

       100%:
       4x разрешение.

       Это специально ограничено 4x,
       чтобы iPhone не получил
       огромный canvas.
    */

    return (
      1 +
      (value / 100) * 3
    );
  }

  /* =======================================================
     DRAW INTERPOLATED IMAGE
     ======================================================= */

  function createInterpolatedImage(
    image,
    strength
  ) {
    const sourceWidth =
      image.naturalWidth ||
      image.width;

    const sourceHeight =
      image.naturalHeight ||
      image.height;

    if (
      !sourceWidth ||
      !sourceHeight
    ) {
      throw new Error(
        "Некорректный размер GIF"
      );
    }

    const scale =
      getInterpolationScale(
        strength
      );

    /*
       При 1x ничего не пересчитываем.
    */

    if (scale <= 1.001) {
      return null;
    }

    let width =
      Math.round(
        sourceWidth * scale
      );

    let height =
      Math.round(
        sourceHeight * scale
      );

    /*
       Защита iPhone от слишком
       большого canvas.

       1122×1136 → максимум примерно 4x.
    */

    const MAX_SIDE =
      4600;

    if (
      width > MAX_SIDE ||
      height > MAX_SIDE
    ) {
      const limit =
        Math.min(
          MAX_SIDE / width,
          MAX_SIDE / height
        );

      width =
        Math.max(
          sourceWidth,
          Math.floor(
            width * limit
          )
        );

      height =
        Math.max(
          sourceHeight,
          Math.floor(
            height * limit
          )
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
          alpha: true,
          willReadFrequently: false
        }
      );

    if (!ctx) {
      throw new Error(
        "Canvas недоступен"
      );
    }

    /*
       КЛЮЧЕВОЙ МОМЕНТ.

       Мы НЕ рисуем квадраты.

       Canvas сам вычисляет цвет
       промежуточных точек между
       соседними пикселями.

       Это стандартная билинейная
       интерполяция изображения.
    */

    ctx.imageSmoothingEnabled =
      true;

    /*
       Высокое качество интерполяции.
    */

    if (
      "imageSmoothingQuality" in ctx
    ) {
      ctx.imageSmoothingQuality =
        "high";
    }

    /*
       Весь исходный кадр,
       включая облачность,
       полностью переносится
       на новый canvas.

       Никакой классификации
       цветов здесь НЕТ.
    */

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

    /*
       PNG сохраняет:
       • радар
       • облачность
       • прозрачность
       • все исходные области
    */

    return canvas.toDataURL(
      "image/png"
    );
  }

  /* =======================================================
     REMOVE INTERPOLATED LAYER
     ======================================================= */

  function removeSmoothingLayer() {
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

    removeSmoothingLayer();

    const source =
      getSourceImage();

    if (source) {
      source.style.opacity =
        sourceOriginalOpacity ||
        "1";

      sourceImageElement =
        source;
    }

    processing = false;
  }

  /* =======================================================
     INSTALL INTERPOLATED LAYER
     ======================================================= */

  function installInterpolatedLayer(
    dataURL,
    source
  ) {
    if (
      !window.map ||
      !dataURL
    ) {
      return false;
    }

    /*
       Сначала создаём новый слой.

       Старый GIF пока остаётся
       полностью видимым.
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

    /*
       Только после успешного
       добавления интерполированного
       слоя скрываем исходный.

       Поэтому GIF не должен
       исчезать во время обработки.
    */

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
     PROCESS CURRENT FRAME
     ======================================================= */

  async function processCurrentFrame(
    strength
  ) {
    const token =
      ++processToken;

    const value =
      clamp(
        Number(strength) || 0,
        0,
        100
      );

    /*
       0% = полностью исходный
       радар.
    */

    if (value <= 0) {
      restoreOriginal();
      return;
    }

    const source =
      getSourceImage();

    if (!source) {
      processing = false;
      return;
    }

    /*
       Если изображение ещё
       не успело загрузиться,
       ждём его.
    */

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
            processCurrentFrame(
              value
            );
          }
        },
        120
      );

      return;
    }

    if (processing) {
      return;
    }

    processing = true;

    try {
      /*
         Берём именно текущий кадр.
      */

      const url =
        source.currentSrc ||
        source.src;

      if (!url) {
        throw new Error(
          "URL текущего кадра отсутствует"
        );
      }

      const image =
        await loadImage(
          url
        );

      if (
        token !== processToken
      ) {
        return;
      }

      /*
         Создаём интерполированный
         вариант целиком.

         Никаких масок.
         Никаких классов.
         Никаких фильтров.
      */

      const result =
        createInterpolatedImage(
          image,
          value
        );

      if (
        token !== processToken
      ) {
        return;
      }

      if (!result) {
        restoreOriginal();
        return;
      }

      /*
         Ещё раз проверяем,
         что текущий GIF не сменился
         пока canvas обрабатывался.
      */

      const currentSource =
        getSourceImage();

      if (
        !currentSource ||
        currentSource !== source
      ) {
        return;
      }

      if (
        token !== processToken
      ) {
        return;
      }

      /*
         Устанавливаем новый слой.
      */

      installInterpolatedLayer(
        result,
        source
      );

    } catch (error) {
      console.error(
        "CLOrad radar interpolation:",
        error
      );

      /*
         При любой ошибке
         НЕ удаляем оригинальный GIF.
      */

      if (
        source
      ) {
        source.style.opacity =
          sourceOriginalOpacity ||
          "1";
      }

    } finally {
      if (
        token === processToken
      ) {
        processing = false;
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
        <span>Интерполяция радара</span>
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
          Плавность пикселей
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
            accent-color:#53e39b;
            touch-action:pan-y;
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

    /*
       Ставим именно после
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

    /* =====================================================
       SLIDER INPUT
       -----------------------------------------------------
       Здесь НЕ запускаем обработку.

       Только показываем значение.
       ===================================================== */

    if (range) {
      range.addEventListener(
        "input",
        () => {
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
             При движении ползунка
             не пересчитываем радар.

             Если пользователь уже
             использовал интерполяцию,
             оставляем текущий слой,
             пока он не отпустит
             ползунок.

             Это также предотвращает
             лаги и случайное исчезновение
             GIF.
          */

          if (
            smoothingValue === 0
          ) {
            restoreOriginal();
          }
        }
      );

      /* ===================================================
         RELEASE
         =================================================== */

      const release =
        event => {
          /*
             Не даём событию
             закрыть настройки.
          */

          if (
            event
          ) {
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
              180
            );
        };

      range.addEventListener(
        "pointerup",
        release
      );

      range.addEventListener(
        "touchend",
        release
      );

      range.addEventListener(
        "mouseup",
        release
      );

      /*
         Если палец ушёл за пределы
         ползунка, всё равно
         обрабатываем последнее
         значение.
      */

      range.addEventListener(
        "change",
        () => {
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
      );
    }

    installed = true;
  }

  /* =======================================================
     WATCH GIF FRAME
     ======================================================= */

  function watchGIFFrame() {
    if (
      frameObserverStarted
    ) {
      return;
    }

    frameObserverStarted =
      true;

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
               GIF переключился
               на новый кадр.

               Старый интерполированный
               слой теперь больше
               не соответствует кадру.
            */

            processToken++;

            removeSmoothingLayer();

            processing = false;

            /*
               Новый кадр сначала
               показываем полностью.
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
               создаём её заново.
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
                  120
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
        smoothingValue <= 0
      ) {
        restoreOriginal();
      } else {
        processCurrentFrame(
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
        range.value = "0";
      }

      if (value) {
        value.textContent =
          "0%";
      }

      restoreOriginal();
    }
  };

})();
