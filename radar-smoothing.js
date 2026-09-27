/* =========================================================
   CLOrad — DMRL Radar Smoothing
   Отдельный модуль сглаживания ДМРЛ-композита

   0%   — без сглаживания
   25%  — слабое
   50%  — среднее
   75%  — сильное
   100% — максимальное

   Не изменяет:
   - палитру
   - значения радара
   - разрешение ДМРЛ
   - ДМРЛ-сетку
   - GIF
   - таймлайн
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const SETTING_ID =
    "cloradRadarSmoothingSetting";

  const STYLE_ID =
    "clorad-radar-smoothing-style";

  const STORAGE_KEY =
    "cloradRadarSmoothing";

  const DEFAULT_LEVEL = 45;

  /*
     Максимальное физическое размытие.

     Значение специально небольшое:
     нам нужно именно сглаживание
     радарной сетки, а не эффект
     сильного Gaussian Blur.
  */
  const MAX_BLUR_PX = 2.4;

  let smoothingLevel =
    DEFAULT_LEVEL;

  /* =======================================================
     HELPERS
     ======================================================= */

  const $ = id =>
    document.getElementById(id);

  /* =======================================================
     LEVEL → BLUR
     ======================================================= */

  function levelToBlur(level) {
    const value =
      Math.max(
        0,
        Math.min(
          100,
          Number(level) || 0
        )
      );

    /*
       Нелинейная шкала.

       На первых значениях изменение
       очень мягкое, а после 50%
       сглаживание становится заметнее.
    */
    const normalized =
      value / 100;

    const amount =
      Math.pow(
        normalized,
        1.35
      );

    return (
      amount *
      MAX_BLUR_PX
    );
  }

  /* =======================================================
     APPLY
     ======================================================= */

  function applySmoothing() {
    const blur =
      levelToBlur(
        smoothingLevel
      );

    document.documentElement.style
      .setProperty(
        "--clorad-radar-smoothing",
        `${blur}px`
      );

    /*
       Дополнительно выставляем filter
       непосредственно на существующие
       радарные изображения.

       Это нужно для уже созданного
       Leaflet ImageOverlay.
    */
    document
      .querySelectorAll(
        ".clorad-gif-radar-image"
      )
      .forEach(image => {
        image.style.filter =
          blur > 0
            ? `blur(${blur}px)`
            : "none";

        /*
           Небольшое увеличение
           компенсирует визуальное
           появление пустого края
           при blur.
        */
        image.style.transformOrigin =
          "center center";

        image.style.transform =
          blur > 0
            ? "scale(1.004)"
            : "none";
      });

    updateValue();
  }

  /* =======================================================
     VALUE LABEL
     ======================================================= */

  function updateValue() {
    const value =
      $("cloradRadarSmoothingValue");

    if (!value) {
      return;
    }

    value.textContent =
      `${smoothingLevel}%`;
  }

  /* =======================================================
     STYLE
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
      document.createElement(
        "style"
      );

    style.id =
      STYLE_ID;

    style.textContent = `
      #${SETTING_ID}
      .clorad-radar-smoothing-value {
        min-width: 42px;
        text-align: right;
        color: rgba(255,255,255,.68);
        font-size: 12px;
        font-weight: 600;
      }

      #${SETTING_ID}
      .clorad-radar-smoothing-slider {
        width: 100%;
        height: 28px;
        margin: 0;
        padding: 0;
        cursor: pointer;
        accent-color: #65c98a;
      }

      #${SETTING_ID}
      .clorad-radar-smoothing-scale {
        display: flex;
        justify-content: space-between;
        margin-top: 2px;
        color: rgba(255,255,255,.38);
        font-size: 10px;
      }

      #${SETTING_ID}
      .clorad-radar-smoothing-head-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
      }

      body.light
      #${SETTING_ID}
      .clorad-radar-smoothing-value {
        color: rgba(0,0,0,.55);
      }

      body.light
      #${SETTING_ID}
      .clorad-radar-smoothing-scale {
        color: rgba(0,0,0,.40);
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     SETTING
     ======================================================= */

  function installSetting() {
    const settings =
      $("settings");

    if (!settings) {
      return false;
    }

    if (
      $(SETTING_ID)
    ) {
      return true;
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
        id="cloradRadarSmoothingHead"
        type="button"
      >
        <span
          class="clorad-radar-smoothing-head-row"
        >
          <span>
            Сглаживание ДМРЛ
          </span>

          <span
            class="clorad-radar-smoothing-value"
            id="cloradRadarSmoothingValue"
          >
            ${smoothingLevel}%
          </span>

          <span class="settingArrow">
            ›
          </span>
        </span>
      </button>

      <div
        class="settingBody"
        id="cloradRadarSmoothingBody"
      >
        <input
          class="clorad-radar-smoothing-slider"
          id="cloradRadarSmoothingSlider"
          type="range"
          min="0"
          max="100"
          step="1"
          value="${smoothingLevel}"
        >

        <div
          class="clorad-radar-smoothing-scale"
        >
          <span>
            Резко
          </span>

          <span>
            Плавно
          </span>
        </div>
      </div>
    `;

    /*
       Ставим настройку после
       настройки разрешения ДМРЛ,
       если она уже существует.
    */
    const resolution =
      $("gifResolutionSetting");

    const palette =
      $("gifPaletteSetting");

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

    /* =====================================================
       OPEN / CLOSE
       ===================================================== */

    const head =
      $("cloradRadarSmoothingHead");

    if (head) {
      head.addEventListener(
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
    }

    /* =====================================================
       SLIDER
       ===================================================== */

    const slider =
      $("cloradRadarSmoothingSlider");

    if (slider) {
      slider.addEventListener(
        "input",
        event => {
          smoothingLevel =
            Number(
              event.target.value
            );

          saveLevel();
          applySmoothing();
        }
      );
    }

    updateValue();

    return true;
  }

  /* =======================================================
     STORAGE
     ======================================================= */

  function loadLevel() {
    try {
      const saved =
        localStorage.getItem(
          STORAGE_KEY
        );

      if (
        saved === null
      ) {
        return;
      }

      const value =
        Number(saved);

      if (
        Number.isFinite(value)
      ) {
        smoothingLevel =
          Math.max(
            0,
            Math.min(
              100,
              value
            )
          );
      }
    } catch {
      /*
         Если localStorage
         недоступен — используем
         значение по умолчанию.
      */
    }
  }

  function saveLevel() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        String(
          smoothingLevel
        )
      );
    } catch {
      /*
         Ничего не делаем.
      */
    }
  }

  /* =======================================================
     WATCH RADAR LAYERS
     ======================================================= */

  function installRadarObserver() {
    const observer =
      new MutationObserver(
        mutations => {
          let radarChanged =
            false;

          for (
            const mutation of mutations
          ) {
            if (
              mutation.type !==
              "childList"
            ) {
              continue;
            }

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
                  ".clorad-gif-radar-image"
                ) ||
                node.querySelector?.(
                  ".clorad-gif-radar-image"
                )
              ) {
                radarChanged =
                  true;
              }
            }
          }

          if (
            radarChanged
          ) {
            applySmoothing();
          }
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradSetRadarSmoothing =
    function(level) {
      smoothingLevel =
        Math.max(
          0,
          Math.min(
            100,
            Number(level) || 0
          )
        );

      const slider =
        $("cloradRadarSmoothingSlider");

      if (slider) {
        slider.value =
          smoothingLevel;
      }

      saveLevel();
      applySmoothing();

      return smoothingLevel;
    };

  window.CLOradRadarSmoothing =
    function() {
      return smoothingLevel;
    };

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    loadLevel();

    installStyle();

    installSetting();

    applySmoothing();

    installRadarObserver();

    /*
       Если настройки создаются
       другими скриптами позже —
       ждём появления блока.
    */
    if (
      !$(SETTING_ID)
    ) {
      const observer =
        new MutationObserver(
          () => {
            if (
              installSetting()
            ) {
              applySmoothing();
              observer.disconnect();
            }
          }
        );

      observer.observe(
        document.body,
        {
          childList: true,
          subtree: true
        }
      );
    }
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
