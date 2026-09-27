/* =========================================================
   CLOrad — Radar Smoothing
   Интерполяция радарных пикселей
   Без blur и без изменения географической привязки
   ========================================================= */

(() => {
  "use strict";

  const SETTING_ID = "cloradRadarSmoothingSetting";
  const STYLE_ID = "cloradRadarSmoothingStyle";
  const STORAGE_KEY = "cloradRadarSmoothing";

  /*
     0 = исходные квадратные пиксели
     100 = максимальная интерполяция
  */
  const DEFAULT_LEVEL = 55;

  let smoothingLevel = DEFAULT_LEVEL;
  let processing = false;
  let processTimer = null;

  /* =======================================================
     ЗАГРУЗКА НАСТРОЙКИ
     ======================================================= */

  function loadLevel() {
    const value = Number(
      localStorage.getItem(
        STORAGE_KEY
      )
    );

    if (
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100
    ) {
      smoothingLevel = value;
    }
  }

  function saveLevel() {
    localStorage.setItem(
      STORAGE_KEY,
      String(smoothingLevel)
    );
  }

  /* =======================================================
     СТИЛЬ
     ======================================================= */

  function installStyle() {
    if (
      document.getElementById(
        STYLE_ID
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      STYLE_ID;

    style.textContent = `
      #${SETTING_ID}
      .clorad-smoothing-value {
        min-width: 42px;
        text-align: right;
        color: rgba(255,255,255,.62);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      #${SETTING_ID}
      .clorad-smoothing-slider {
        width: 100%;
        height: 30px;
        margin: 4px 0 0;
        accent-color: #72d39b;
        cursor: pointer;
      }

      #${SETTING_ID}
      .clorad-smoothing-row {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
      }

      #${SETTING_ID}
      .clorad-smoothing-scale {
        display: flex;
        justify-content: space-between;
        width: 100%;
        margin-top: 1px;
        color: rgba(255,255,255,.38);
        font-size: 10px;
      }

      body.light
      #${SETTING_ID}
      .clorad-smoothing-value {
        color: rgba(0,0,0,.55);
      }

      body.light
      #${SETTING_ID}
      .clorad-smoothing-scale {
        color: rgba(0,0,0,.42);
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     УРОВЕНЬ
     ======================================================= */

  function getScaleFactor() {
    /*
       Чем выше уровень,
       тем сильнее увеличиваем
       изображение перед интерполяцией.

       Само изображение при этом
       остаётся в тех же GIF_BOUNDS.
    */

    if (
      smoothingLevel <= 0
    ) {
      return 1;
    }

    if (
      smoothingLevel < 35
    ) {
      return 2;
    }

    if (
      smoothingLevel < 70
    ) {
      return 3;
    }

    if (
      smoothingLevel < 90
    ) {
      return 4;
    }

    return 5;
  }

  /* =======================================================
     СГЛАЖИВАНИЕ КАДРА
     ======================================================= */

  async function smoothImage(
    img
  ) {
    if (
      smoothingLevel <= 0
    ) {
      return null;
    }

    if (
      !img ||
      !img.naturalWidth ||
      !img.naturalHeight
    ) {
      return null;
    }

    const factor =
      getScaleFactor();

    /*
       Для получения интерполяции
       исходный кадр сначала рисуется
       на увеличенный canvas.

       imageSmoothingEnabled = true
       заставляет браузер интерполировать
       соседние радарные пиксели.
    */

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      img.naturalWidth *
      factor;

    canvas.height =
      img.naturalHeight *
      factor;

    const ctx =
      canvas.getContext(
        "2d",
        {
          alpha: true
        }
      );

    if (!ctx) {
      return null;
    }

    ctx.imageSmoothingEnabled =
      true;

    /*
       На максимальных уровнях
       используем максимально качественную
       доступную браузерную интерполяцию.
    */
    try {
      ctx.imageSmoothingQuality =
        smoothingLevel >= 70
          ? "high"
          : "medium";
    } catch (
      error
    ) {}

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      img,
      0,
      0,
      canvas.width,
      canvas.height
    );

    /*
       Теперь уменьшаем обратно
       до исходного размера.

       Второй проход дополнительно
       смешивает соседние пиксели,
       создавая именно эффект
       плавной радарной области,
       а не CSS blur.
    */

    const resultCanvas =
      document.createElement(
        "canvas"
      );

    resultCanvas.width =
      img.naturalWidth;

    resultCanvas.height =
      img.naturalHeight;

    const resultCtx =
      resultCanvas.getContext(
        "2d",
        {
          alpha: true
        }
      );

    if (!resultCtx) {
      return null;
    }

    resultCtx.imageSmoothingEnabled =
      true;

    try {
      resultCtx.imageSmoothingQuality =
        smoothingLevel >= 70
          ? "high"
          : "medium";
    } catch (
      error
    ) {}

    resultCtx.drawImage(
      canvas,
      0,
      0,
      canvas.width,
      canvas.height,
      0,
      0,
      resultCanvas.width,
      resultCanvas.height
    );

    return resultCanvas.toDataURL(
      "image/png"
    );
  }

  /* =======================================================
     ОБРАБОТКА LEAFLET IMAGEOVERLAY
     ======================================================= */

  async function processRadarImage(
    img
  ) {
    if (
      processing
    ) {
      return;
    }

    if (
      !img ||
      !img.classList.contains(
        "clorad-gif-radar-image"
      )
    ) {
      return;
    }

    if (
      smoothingLevel <= 0
    ) {
      return;
    }

    /*
       Не обрабатываем один и тот же
       результат повторно.
    */
    if (
      img.dataset.cloradSmoothed ===
      String(smoothingLevel)
    ) {
      return;
    }

    if (
      img.dataset.cloradSmoothingBusy ===
      "1"
    ) {
      return;
    }

    img.dataset.cloradSmoothingBusy =
      "1";

    try {
      if (
        !img.complete ||
        !img.naturalWidth
      ) {
        await new Promise(
          resolve => {
            const done =
              () => {
                img.removeEventListener(
                  "load",
                  done
                );

                resolve();
              };

            img.addEventListener(
              "load",
              done,
              {
                once: true
              }
            );
          }
        );
      }

      if (
        !img.naturalWidth
      ) {
        return;
      }

      const source =
        img.currentSrc ||
        img.src;

      const smooth =
        await smoothImage(
          img
        );

      /*
         Кадр мог смениться,
         пока canvas обрабатывался.
      */
      if (
        source !==
        (
          img.currentSrc ||
          img.src
        )
      ) {
        return;
      }

      if (
        smooth
      ) {
        img.src =
          smooth;

        img.dataset.cloradSmoothed =
          String(
            smoothingLevel
          );
      }

    } catch (
      error
    ) {
      console.error(
        "CLOrad radar smoothing:",
        error
      );

    } finally {
      delete img.dataset
        .cloradSmoothingBusy;
    }
  }

  /* =======================================================
     ПОИСК РАДАРНОГО КАДРА
     ======================================================= */

  function processCurrentRadarImages() {
    if (
      smoothingLevel <= 0
    ) {
      return;
    }

    document
      .querySelectorAll(
        "img.clorad-gif-radar-image"
      )
      .forEach(
        img => {
          processRadarImage(
            img
          );
        }
      );
  }

  /* =======================================================
     НАСТРОЙКА
     ======================================================= */

  function setSmoothing(
    value
  ) {
    value =
      Number(value);

    if (
      !Number.isFinite(value)
    ) {
      value =
        DEFAULT_LEVEL;
    }

    value =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(value)
        )
      );

    smoothingLevel =
      value;

    saveLevel();

    updateSetting();

    /*
       Удаляем только обработанный
       результат сглаживания.

       Географические bounds Leaflet
       вообще не трогаем.
    */
    document
      .querySelectorAll(
        "img.clorad-gif-radar-image"
      )
      .forEach(
        img => {
          delete img.dataset
            .cloradSmoothed;

          /*
             Важный момент:
             нельзя просто вернуть src
             из dataURL.

             Текущий Leaflet layer сам
             установит следующий кадр.
          */
        }
      );

    scheduleProcess();
  }

  function scheduleProcess() {
    if (
      processTimer
    ) {
      clearTimeout(
        processTimer
      );
    }

    processTimer =
      setTimeout(
        () => {
          processTimer =
            null;

          processCurrentRadarImages();
        },
        40
      );
  }

  /* =======================================================
     UI
     ======================================================= */

  function updateSetting() {
    const setting =
      document.getElementById(
        SETTING_ID
      );

    if (!setting) {
      return;
    }

    const slider =
      setting.querySelector(
        ".clorad-smoothing-slider"
      );

    const value =
      setting.querySelector(
        ".clorad-smoothing-value"
      );

    if (slider) {
      slider.value =
        smoothingLevel;
    }

    if (value) {
      value.textContent =
        smoothingLevel +
        "%";
    }
  }

  function installSetting() {
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
      updateSetting();
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
        id="cloradSmoothingHead"
        type="button"
      >
        <span>
          Сглаживание радара
        </span>

        <span class="settingArrow">
          ›
        </span>
      </button>

      <div
        class="settingBody"
        id="cloradSmoothingBody"
      >
        <div
          class="clorad-smoothing-row"
        >
          <input
            class="clorad-smoothing-slider"
            type="range"
            min="0"
            max="100"
            step="1"
            value="${smoothingLevel}"
          >

          <span
            class="clorad-smoothing-value"
          >
            ${smoothingLevel}%
          </span>
        </div>

        <div
          class="clorad-smoothing-scale"
        >
          <span>
            Исходное
          </span>

          <span>
            Плавное
          </span>
        </div>
      </div>
    `;

    /*
       Ставим сразу после разрешения ДМРЛ.
    */

    const resolution =
      document.getElementById(
        "gifResolutionSetting"
      );

    const palette =
      document.getElementById(
        "gifPaletteSetting"
      );

    if (resolution) {
      resolution.after(
        setting
      );
    } else if (palette) {
      palette.after(
        setting
      );
    } else {
      settings.appendChild(
        setting
      );
    }

    const head =
      document.getElementById(
        "cloradSmoothingHead"
      );

    head?.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        const isOpen =
          setting.classList.contains(
            "open"
          );

        document
          .querySelectorAll(
            ".setting.open"
          )
          .forEach(
            other => {
              if (
                other !==
                setting
              ) {
                other.classList.remove(
                  "open"
                );
              }
            }
          );

        setting.classList.toggle(
          "open",
          !isOpen
        );
      }
    );

    const slider =
      setting.querySelector(
        ".clorad-smoothing-slider"
      );

    slider?.addEventListener(
      "input",
      event => {
        event.stopPropagation();

        setSmoothing(
          event.target.value
        );
      }
    );

    updateSetting();
  }

  /* =======================================================
     НОВЫЕ КАДРЫ
     ======================================================= */

  const observer =
    new MutationObserver(
      mutations => {
        let radarChanged =
          false;

        for (
          const mutation of mutations
        ) {
          for (
            const node of mutation.addedNodes
          ) {
            if (
              node.nodeType !==
              Node.ELEMENT_NODE
            ) {
              continue;
            }

            if (
              node.matches?.(
                "img.clorad-gif-radar-image"
              ) ||
              node.querySelector?.(
                "img.clorad-gif-radar-image"
              )
            ) {
              radarChanged =
                true;

              break;
            }
          }

          if (
            radarChanged
          ) {
            break;
          }
        }

        if (
          radarChanged
        ) {
          scheduleProcess();
        }
      }
    );

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradSetRadarSmoothing =
    setSmoothing;

  window.CLOradRadarSmoothing =
    () =>
      smoothingLevel;

  /* =======================================================
     INIT
     ======================================================= */

  loadLevel();

  installStyle();

  installSetting();

  if (
    document.body
  ) {
    observer.observe(
      document.body,
      {
        childList:
          true,
        subtree:
          true
      }
    );
  }

  /*
     Панель settings может
     создаваться позже index.html.
  */
  const settingsObserver =
    new MutationObserver(
      () => {
        if (
          document.getElementById(
            "settings"
          ) &&
          !document.getElementById(
            SETTING_ID
          )
        ) {
          installSetting();
        }
      }
    );

  if (
    document.body
  ) {
    settingsObserver.observe(
      document.body,
      {
        childList:
          true,
        subtree:
          true
      }
    );
  }

})();
