/* =========================================================
   CLOrad — Meteoinfo GIF Radar
   ДМРЛ композит
   Разрешение ДМРЛ + сетка данных ДМРЛ
   Палитры ОЯ: РГМЦ / ИРАМ / Пользовательские
   ========================================================= */
(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const API = "/api/radar-gif";

  const GIF_BOUNDS = [
    [38.2155955810, 14.9892981264],
    [69.6543707199, 72.9237642948]
  ];

  const DMRL_GRID_MIN_ZOOM = 7;

  const ALLOWED_RESOLUTIONS = [
    1,
    2,
    4
  ];

  /* =======================================================
     ПАЛИТРЫ ОЯ
     ======================================================= */

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

  const RGMC_OY_PALETTE = [
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
    "#924b48",
    "#f2aaf0",
    "#e85ae7",
    "#ca3cc7",
    "#777c91"
  ];

  /*
     ИРАМ пока оставляем таким же,
     как исходная палитра GIF.
  */
  const IRAM_OY_PALETTE = [
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

  const OY_PALETTES = {
    rgmc: {
      name: "РГМЦ",
      colors: RGMC_OY_PALETTE
    },

    iram: {
      name: "ИРАМ",
      colors: IRAM_OY_PALETTE
    }
  };

  let gifPalette = "rgmc";

  let gifCustomPalette = null;

  let gifCustomPaletteName =
    "Пользовательская";

  let gifPaletteCache = new Map();

  /*
     Отдельный кеш LUT для исходных палитр.
     Это особенно важно на iPhone.
  */
  let gifSourceLUTCache = new Map();

  /* =======================================================
     STATE
     ======================================================= */

  let gifActive = false;

  let gifFrames = [];

  let gifFrameTimes = [];

  let gifFrameDelays = [];

  let gifFrameRequest = 0;

  let gifMeta = null;

  let gifImageCache = new Map();

  let gifPlaying = false;

  let gifPlayTimer = null;

  let gifOriginalLayer = null;

  let gifPaintedLayer = null;

  let gifResolution = 1;

  let dmrlGridEnabled = false;

  let dmrlGridCanvas = null;

  let dmrlGridLayer = null;

  /* =======================================================
     HELPER
     ======================================================= */

  const $ = id =>
    document.getElementById(id);

  function showLoading() {
    $("loadingFrames")?.classList.add("show");
  }

  function hideLoading() {
    $("loadingFrames")?.classList.remove("show");
  }

  /* =======================================================
     SETTINGS — ОБЩИЙ СТИЛЬ
     ======================================================= */

  function installDMRLSettingsStyle() {
    if (
      document.getElementById(
        "clorad-dmrl-settings-style"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "clorad-dmrl-settings-style";

    style.textContent = `
      #gifResolutionSetting
      .clorad-dmrl-resolution-options {
        display: flex;
        width: 100%;
        gap: 7px;
      }

      #gifResolutionSetting
      .clorad-dmrl-resolution-option {
        flex: 1;
        height: 38px;
        padding: 0;
        border: 1px solid
          rgba(255,255,255,.10);
        border-radius: 9px;
        background:
          rgba(255,255,255,.055);
        color:
          rgba(255,255,255,.72);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        -webkit-tap-highlight-color:
          transparent;
        transition:
          background .15s ease,
          color .15s ease,
          border-color .15s ease;
      }

      #gifResolutionSetting
      .clorad-dmrl-resolution-option.active {
        background:
          rgba(255,255,255,.13);
        border-color:
          rgba(255,255,255,.20);
        color:
          #fff;
      }

      #gifResolutionSetting
      .clorad-dmrl-resolution-option:active {
        transform:
          scale(.97);
      }

      #gifPaletteSetting
      .clorad-dmrl-palette-options {
        display: flex;
        width: 100%;
        gap: 7px;
      }

      #gifPaletteSetting
      .clorad-dmrl-palette-option {
        flex: 1;
        height: 38px;
        padding: 0;
        border: 1px solid
          rgba(255,255,255,.10);
        border-radius: 9px;
        background:
          rgba(255,255,255,.055);
        color:
          rgba(255,255,255,.72);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        -webkit-tap-highlight-color:
          transparent;
        transition:
          background .15s ease,
          color .15s ease,
          border-color .15s ease;
      }

      #gifPaletteSetting
      .clorad-dmrl-palette-option.active {
        background:
          rgba(255,255,255,.13);
        border-color:
          rgba(255,255,255,.20);
        color:
          #fff;
      }

      #gifPaletteSetting
      .clorad-dmrl-palette-option:active {
        transform:
          scale(.97);
      }

      #dmrlGridSetting
      .clorad-dmrl-grid-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        cursor: pointer;
      }

      #dmrlGridSetting
      .clorad-dmrl-grid-toggle-text {
        color:
          rgba(255,255,255,.76);
        font-size: 13px;
        font-weight: 500;
      }

      #dmrlGridSetting
      .clorad-dmrl-grid-switch {
        position: relative;
        flex: 0 0 auto;
        width: 42px;
        height: 24px;
        border-radius: 999px;
        background:
          rgba(255,255,255,.12);
        border:
          1px solid rgba(255,255,255,.12);
        transition:
          background .15s ease;
      }

      #dmrlGridSetting
      .clorad-dmrl-grid-switch::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        transition:
          transform .15s ease;
      }

      #dmrlGridSetting.active
      .clorad-dmrl-grid-switch {
        background:
          rgba(95,190,130,.65);
      }

      #dmrlGridSetting.active
      .clorad-dmrl-grid-switch::after {
        transform:
          translateX(18px);
      }

      body.light
      #gifResolutionSetting
      .clorad-dmrl-resolution-option {
        background:
          rgba(0,0,0,.045);
        border-color:
          rgba(0,0,0,.10);
        color:
          rgba(0,0,0,.62);
      }

      body.light
      #gifResolutionSetting
      .clorad-dmrl-resolution-option.active {
        background:
          rgba(0,0,0,.09);
        border-color:
          rgba(0,0,0,.16);
        color:
          #111;
      }

      body.light
      #gifPaletteSetting
      .clorad-dmrl-palette-option {
        background:
          rgba(0,0,0,.045);
        border-color:
          rgba(0,0,0,.10);
        color:
          rgba(0,0,0,.62);
      }

      body.light
      #gifPaletteSetting
      .clorad-dmrl-palette-option.active {
        background:
          rgba(0,0,0,.09);
        border-color:
          rgba(0,0,0,.16);
        color:
          #111;
      }

      body.light
      #dmrlGridSetting
      .clorad-dmrl-grid-toggle-text {
        color:
          rgba(0,0,0,.68);
      }

      body.light
      #dmrlGridSetting
      .clorad-dmrl-grid-switch {
        background:
          rgba(0,0,0,.10);
        border-color:
          rgba(0,0,0,.10);
      }

      body.light
      #dmrlGridSetting.active
      .clorad-dmrl-grid-switch {
        background:
          rgba(70,160,100,.65);
      }
    `;

    document.head.appendChild(style);
  }

  /* =======================================================
     SETTINGS — РАЗРЕШЕНИЕ ДМРЛ
     ======================================================= */

  function installGIFResolutionSetting() {
    const settings =
      document.getElementById("settings");

    if (!settings) {
      return;
    }

    if (
      document.getElementById(
        "gifResolutionSetting"
      )
    ) {
      return;
    }

    const setting =
      document.createElement("div");

    setting.className = "setting";

    setting.id =
      "gifResolutionSetting";

    setting.innerHTML = `
      <button
        class="settingHead"
        id="gifResolutionHead"
        type="button"
      >
        <span>
          Разрешение ДМРЛ
        </span>

        <span class="settingArrow">
          ›
        </span>
      </button>

      <div
        class="settingBody"
        id="gifResolutionBody"
      >
        <div
          class="clorad-dmrl-resolution-options"
        >
          <button
            class="clorad-dmrl-resolution-option active"
            type="button"
            data-resolution="1"
          >
            1×1
          </button>

          <button
            class="clorad-dmrl-resolution-option"
            type="button"
            data-resolution="2"
          >
            2×2
          </button>

          <button
            class="clorad-dmrl-resolution-option"
            type="button"
            data-resolution="4"
          >
            4×4
          </button>
        </div>
      </div>
    `;

    const framesSetting =
      document.getElementById(
        "framesSetting"
      );

    if (framesSetting) {
      framesSetting.after(setting);
    } else {
      settings.appendChild(setting);
    }

    const head =
      document.getElementById(
        "gifResolutionHead"
      );

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
            .forEach(other => {
              if (other !== setting) {
                other.classList.remove(
                  "open"
                );
              }
            });

          setting.classList.toggle(
            "open",
            !isOpen
          );
        }
      );
    }

    setting
      .querySelectorAll(
        ".clorad-dmrl-resolution-option"
      )
      .forEach(option => {
        option.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            const value =
              Number(
                option.dataset.resolution
              );

            if (
              !ALLOWED_RESOLUTIONS.includes(
                value
              )
            ) {
              return;
            }

            setGIFResolution(value);
          }
        );
      });

    updateGIFResolutionButtons();
  }

  function updateGIFResolutionButtons() {
    document
      .querySelectorAll(
        ".clorad-dmrl-resolution-option"
      )
      .forEach(option => {
        option.classList.toggle(
          "active",
          Number(
            option.dataset.resolution
          ) === gifResolution
        );
      });
  }

  /* =======================================================
     SETTINGS — ПАЛИТРА
     ======================================================= */

  function installGIFPaletteSetting() {
    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    if (
      document.getElementById(
        "gifPaletteSetting"
      )
    ) {
      return;
    }

    const setting =
      document.createElement("div");

    setting.className = "setting";

    setting.id =
      "gifPaletteSetting";

    setting.innerHTML = `
      <button
        class="settingHead"
        id="gifPaletteHead"
        type="button"
      >
        <span>
          Палитра
        </span>

        <span class="settingArrow">
          ›
        </span>
      </button>

      <div
        class="settingBody"
        id="gifPaletteBody"
      >
        <div
          class="clorad-dmrl-palette-options"
        >
          <button
            class="clorad-dmrl-palette-option active"
            type="button"
            data-palette="rgmc"
          >
            РГМЦ
          </button>

          <button
            class="clorad-dmrl-palette-option"
            type="button"
            data-palette="iram"
          >
            ИРАМ
          </button>
        </div>
      </div>
    `;

    const resolutionSetting =
      document.getElementById(
        "gifResolutionSetting"
      );

    if (resolutionSetting) {
      resolutionSetting.after(setting);
    } else {
      settings.appendChild(setting);
    }

    const head =
      document.getElementById(
        "gifPaletteHead"
      );

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
            .forEach(other => {
              if (other !== setting) {
                other.classList.remove(
                  "open"
                );
              }
            });

          setting.classList.toggle(
            "open",
            !isOpen
          );
        }
      );
    }

    setting
      .querySelectorAll(
        ".clorad-dmrl-palette-option"
      )
      .forEach(option => {
        option.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            setGIFPalette(
              option.dataset.palette
            );
          }
        );
      });

    updateGIFPaletteButtons();
  }

  function updateGIFPaletteButtons() {
    document
      .querySelectorAll(
        ".clorad-dmrl-palette-option"
      )
      .forEach(option => {
        option.classList.toggle(
          "active",
          option.dataset.palette ===
            gifPalette
        );
      });
  }

  /* =======================================================
     PALETTE — HELPERS
     ======================================================= */

  function hexToRGB(hex) {
    if (
      typeof hex !== "string"
    ) {
      return {
        r: 0,
        g: 0,
        b: 0
      };
    }

    let value =
      hex
        .trim()
        .replace("#", "");

    if (
      value.length === 3
    ) {
      value =
        value
          .split("")
          .map(
            char =>
              char + char
          )
          .join("");
    }

    if (
      !/^[0-9a-fA-F]{6}$/.test(
        value
      )
    ) {
      return {
        r: 0,
        g: 0,
        b: 0
      };
    }

    return {
      r:
        parseInt(
          value.slice(0, 2),
          16
        ),

      g:
        parseInt(
          value.slice(2, 4),
          16
        ),

      b:
        parseInt(
          value.slice(4, 6),
          16
        )
    };
  }

  function normalizeHexColor(
    color
  ) {
    if (
      typeof color !==
      "string"
    ) {
      return null;
    }

    let value =
      color.trim();

    if (
      !value.startsWith("#")
    ) {
      value =
        "#" + value;
    }

    if (
      /^#[0-9a-fA-F]{3}$/.test(
        value
      )
    ) {
      value =
        "#" +
        value
          .slice(1)
          .split("")
          .map(
            char =>
              char + char
          )
          .join("");
    }

    if (
      !/^#[0-9a-fA-F]{6}$/.test(
        value
      )
    ) {
      return null;
    }

    return value.toLowerCase();
  }

  function paletteToRGB(colors) {
    if (
      !Array.isArray(
        colors
      )
    ) {
      return [];
    }

    return colors.map(
      hexToRGB
    );
  }

  const SOURCE_PALETTE_RGB =
    paletteToRGB(
      SOURCE_OY_COLORS
    );

  const RGMC_PALETTE_RGB =
    paletteToRGB(
      RGMC_OY_PALETTE
    );

  const IRAM_PALETTE_RGB =
    paletteToRGB(
      IRAM_OY_PALETTE
    );

  function colorDistance(
    r1,
    g1,
    b1,
    r2,
    g2,
    b2
  ) {
    const dr =
      r1 - r2;

    const dg =
      g1 - g2;

    const db =
      b1 - b2;

    return (
      dr * dr * 0.30 +
      dg * dg * 0.59 +
      db * db * 0.11
    );
  }

  function nearestColorIndex(
    r,
    g,
    b,
    source
  ) {
    let bestIndex = 0;

    let bestDistance =
      Infinity;

    for (
      let i = 0;
      i < source.length;
      i++
    ) {
      const color =
        source[i];

      const distance =
        colorDistance(
          r,
          g,
          b,
          color.r,
          color.g,
          color.b
        );

      if (
        distance <
        bestDistance
      ) {
        bestDistance =
          distance;

        bestIndex =
          i;
      }
    }

    return bestIndex;
  }

  /* =======================================================
     PALETTE — ОПРЕДЕЛЕНИЕ ИСХОДНОЙ ПАЛИТРЫ
     ======================================================= */

  function detectFrameSourcePalette(
    data
  ) {
    /*
       SOURCE и IRAM сейчас одинаковые.
       Поэтому их нет смысла отдельно
       различать.

       Реально нам нужны:
       1. исходные цвета GIF;
       2. РГМЦ.
    */

    const candidates = [
      {
        id: "source",
        colors:
          SOURCE_PALETTE_RGB
      },

      {
        id: "rgmc",
        colors:
          RGMC_PALETTE_RGB
      }
    ];

    const scores =
      candidates.map(
        () => 0
      );

    const totalPixels =
      Math.floor(
        data.length / 4
      );

    /*
       Берём до 5000 образцов.
       Это намного дешевле полного
       анализа перед основной перекраской.
    */
    const sampleStep =
      Math.max(
        1,
        Math.floor(
          totalPixels / 5000
        )
      );

    let samples = 0;

    for (
      let pixel = 0;
      pixel < totalPixels;
      pixel += sampleStep
    ) {
      const p =
        pixel * 4;

      const alpha =
        data[p + 3];

      if (
        alpha < 16
      ) {
        continue;
      }

      const r =
        data[p];

      const g =
        data[p + 1];

      const b =
        data[p + 2];

      for (
        let i = 0;
        i < candidates.length;
        i++
      ) {
        const source =
          candidates[i].colors;

        const index =
          nearestColorIndex(
            r,
            g,
            b,
            source
          );

        const ref =
          source[index];

        scores[i] +=
          colorDistance(
            r,
            g,
            b,
            ref.r,
            ref.g,
            ref.b
          );
      }

      samples++;

      if (
        samples >= 5000
      ) {
        break;
      }
    }

    /*
       Если данных для определения
       практически нет — используем
       исходную палитру.
    */
    if (
      samples === 0
    ) {
      return SOURCE_PALETTE_RGB;
    }

    let best = 0;

    for (
      let i = 1;
      i < scores.length;
      i++
    ) {
      if (
        scores[i] <
        scores[best]
      ) {
        best = i;
      }
    }

    return candidates[
      best
    ].colors;
  }

  /* =======================================================
     PALETTE — TARGET
     ======================================================= */

  function getPaletteColors() {
    if (
      gifPalette ===
        "custom" &&
      Array.isArray(
        gifCustomPalette
      ) &&
      gifCustomPalette.length ===
        SOURCE_OY_COLORS.length
    ) {
      return gifCustomPalette.slice();
    }

    const palette =
      OY_PALETTES[
        gifPalette
      ];

    if (
      !palette ||
      !Array.isArray(
        palette.colors
      )
    ) {
      return OY_PALETTES
        .rgmc
        .colors
        .slice();
    }

    return palette.colors.slice();
  }

  function getPaletteRGB() {
    return paletteToRGB(
      getPaletteColors()
    );
  }

  /* =======================================================
     PALETTE — LUT ДЛЯ ИСХОДНОГО КАДРА
     ======================================================= */

  function getSourceLUT(
    source
  ) {
    /*
       Используем ключ по ссылке.
       SOURCE и RGMC имеют стабильные
       массивы на протяжении всей работы.
    */

    let cacheKey =
      "unknown";

    if (
      source ===
      SOURCE_PALETTE_RGB
    ) {
      cacheKey =
        "source";
    }

    else if (
      source ===
      RGMC_PALETTE_RGB
    ) {
      cacheKey =
        "rgmc";
    }

    else if (
      source ===
      IRAM_PALETTE_RGB
    ) {
      cacheKey =
        "iram";
    }

    if (
      gifSourceLUTCache.has(
        cacheKey
      )
    ) {
      return gifSourceLUTCache.get(
        cacheKey
      );
    }

    const lut =
      new Uint8Array(
        4096
      );

    for (
      let key = 0;
      key < 4096;
      key++
    ) {
      const r =
        ((key >> 8) & 15) *
        17;

      const g =
        ((key >> 4) & 15) *
        17;

      const b =
        (key & 15) *
        17;

      lut[key] =
        nearestColorIndex(
          r,
          g,
          b,
          source
        );
    }

    gifSourceLUTCache.set(
      cacheKey,
      lut
    );

    return lut;
  }

  function buildSourceLUT(
    source
  ) {
    return getSourceLUT(
      source
    );
  }

  /* =======================================================
     PALETTE — LUT TARGET
     ======================================================= */

  function buildPaletteLUT(
    source
  ) {
    const target =
      getPaletteRGB();

    const lut =
      buildSourceLUT(
        source
      );

    return {
      lut,
      target
    };
  }

  /* =======================================================
     PALETTE — PREPARE FRAME
     ======================================================= */

  function prepareGIFFrame(
    url
  ) {
    /*
       РГМЦ является исходным
       отображением кадра.

       Здесь Canvas не нужен.
    */
    if (
      gifPalette ===
      "rgmc"
    ) {
      return Promise.resolve(
        url
      );
    }

    /*
       Ключ обязательно содержит
       все цвета кастомной палитры.

       Это важно, если пользователь
       изменил хотя бы один цвет.
    */
    const customKey =
      gifPalette ===
        "custom" &&
      Array.isArray(
        gifCustomPalette
      )
        ? gifCustomPalette.join(
            ","
          )
        : "";

    const cacheKey =
      url +
      "|" +
      gifPalette +
      "|" +
      customKey;

    if (
      gifPaletteCache.has(
        cacheKey
      )
    ) {
      return gifPaletteCache.get(
        cacheKey
      );
    }

    const promise =
      loadImage(url)
        .then(
          img => {
            const width =
              img.naturalWidth ||
              img.width;

            const height =
              img.naturalHeight ||
              img.height;

            if (
              !width ||
              !height
            ) {
              throw new Error(
                "Пустой ДМРЛ-кадр"
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
              img,
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
            } catch (
              error
            ) {
              console.error(
                "CLOrad palette canvas:",
                error
              );

              throw new Error(
                "Canvas заблокирован для перекраски ДМРЛ-кадра"
              );
            }

            const data =
              imageData.data;

            /*
               Определяем фактическую
               цветовую схему исходного
               PNG/GIF-кадра.
            */
            const source =
              detectFrameSourcePalette(
                data
              );

            /*
               Получаем LUT именно для
               обнаруженной исходной схемы.
            */
            const sourceLUT =
              buildSourceLUT(
                source
              );

            /*
               Получаем ЦЕЛЕВУЮ палитру.

               Для custom здесь будут
               именно цвета, которые
               передал менеджер.
            */
            const target =
              getPaletteRGB();

            if (
              !Array.isArray(
                target
              ) ||
              target.length !==
                SOURCE_OY_COLORS.length
            ) {
              throw new Error(
                "Некорректная палитра ДМРЛ"
              );
            }

            /*
               Реальная перекраска
               каждого пикселя.
            */
            for (
              let p = 0;
              p < data.length;
              p += 4
            ) {
              const alpha =
                data[p + 3];

              if (
                alpha === 0
              ) {
                continue;
              }

              const r =
                data[p];

              const g =
                data[p + 1];

              const b =
                data[p + 2];

              /*
                 Сводим RGB к 12-битному
                 ключу.

                 Это резко уменьшает
                 количество вычислений
                 nearestColorIndex.
              */
              const key =
                ((r >> 4) << 8) |
                ((g >> 4) << 4) |
                (b >> 4);

              const index =
                sourceLUT[key];

              const color =
                target[index];

              if (
                !color
              ) {
                continue;
              }

              data[p] =
                color.r;

              data[p + 1] =
                color.g;

              data[p + 2] =
                color.b;
            }

            ctx.putImageData(
              imageData,
              0,
              0
            );

            const result =
              canvas.toDataURL(
                "image/png"
              );

            if (
              !result ||
              result ===
                "data:,"
            ) {
              throw new Error(
                "Не удалось создать перекрашенный кадр"
              );
            }

            return result;
          }
        )
        .catch(
          error => {
            console.error(
              "CLOrad palette frame:",
              error
            );

            /*
               Никакого возврата
               исходного URL.

               Если custom не удалось
               применить — ошибка должна
               быть видна.
            */
            throw error;
          }
        );

    gifPaletteCache.set(
      cacheKey,
      promise
    );

    return promise;
  }

  /* =======================================================
     PALETTE — LEGEND
     ======================================================= */

  function applyGIFPaletteToLegend() {
    const colors =
      getPaletteColors();

    if (
      !Array.isArray(
        colors
      )
    ) {
      return;
    }

    colors.forEach(
      (
        color,
        index
      ) => {
        const element =
          document.querySelector(
            ".l" +
              (index + 1)
          );

        if (
          element
        ) {
          element.style.background =
            color;
        }
      }
    );
  }

  /* =======================================================
     PALETTE — ФИЗИЧЕСКОЕ ПЕРЕКЛЮЧЕНИЕ СЛОЁВ
     ======================================================= */

  function removeOriginalGIFLayer() {
    if (
      gifOriginalLayer &&
      window.map &&
      window.map.hasLayer(
        gifOriginalLayer
      )
    ) {
      window.map.removeLayer(
        gifOriginalLayer
      );
    }

    gifOriginalLayer =
      null;
  }

  function removePaintedGIFLayer() {
    if (
      gifPaintedLayer &&
      window.map &&
      window.map.hasLayer(
        gifPaintedLayer
      )
    ) {
      window.map.removeLayer(
        gifPaintedLayer
      );
    }

    gifPaintedLayer =
      null;
  }

  function removeAllGIFDisplayLayers() {
    removeOriginalGIFLayer();
    removePaintedGIFLayer();
  }

  function createOriginalGIFLayer(
    url
  ) {
    if (
      !window.map
    ) {
      return null;
    }

    removePaintedGIFLayer();

    removeOriginalGIFLayer();

    const layer =
      L.imageOverlay(
        url,
        GIF_BOUNDS,
        {
          opacity: 1,
          interactive: false,
          zIndex: 6,
          className:
            "clorad-gif-radar-image"
        }
      );

    layer.addTo(
      window.map
    );

    gifOriginalLayer =
      layer;

    return layer;
  }

  function createPaintedGIFLayer(
    url
  ) {
    if (
      !window.map
    ) {
      return null;
    }

    removeOriginalGIFLayer();

    removePaintedGIFLayer();

    const layer =
      L.imageOverlay(
        url,
        GIF_BOUNDS,
        {
          opacity: 1,
          interactive: false,
          zIndex: 6,
          className:
            "clorad-gif-radar-image"
        }
      );

    layer.addTo(
      window.map
    );

    gifPaintedLayer =
      layer;

    return layer;
  }

  function switchGIFDisplayLayer(
    displayUrl,
    originalUrl
  ) {
    if (
      gifPalette ===
      "rgmc"
    ) {
      if (
        gifPaintedLayer
      ) {
        removePaintedGIFLayer();
      }

      if (
        !gifOriginalLayer
      ) {
        return createOriginalGIFLayer(
          originalUrl ||
            displayUrl
        );
      }

      gifOriginalLayer.setUrl(
        originalUrl ||
          displayUrl
      );

      return gifOriginalLayer;
    }

    if (
      gifOriginalLayer
    ) {
      removeOriginalGIFLayer();
    }

    if (
      !gifPaintedLayer
    ) {
      return createPaintedGIFLayer(
        displayUrl
      );
    }

    gifPaintedLayer.setUrl(
      displayUrl
    );

    return gifPaintedLayer;
  }

  /* =======================================================
     PALETTE — STANDARD
     ======================================================= */

  function setGIFPalette(
    value
  ) {
    if (
      !OY_PALETTES[
        value
      ]
    ) {
      value =
        "rgmc";
    }

    gifFrameRequest++;

    gifCustomPalette =
      null;

    gifCustomPaletteName =
      "";

    gifPalette =
      value;

    updateGIFPaletteButtons();

    applyGIFPaletteToLegend();

    gifPaletteCache.clear();

    removeAllGIFDisplayLayers();

    if (
      gifActive &&
      gifFrames.length
    ) {
      const index =
        Number(
          $("range")?.value ||
          0
        );

      showGIFFrame(
        index
      );
    }
  }

  /* =======================================================
     PALETTE — CUSTOM
     ======================================================= */

  function applyCustomPalette(
    colors,
    name
  ) {
    /*
       Допускаем два варианта:

       1. applyCustomPalette(colors, name)
       2. applyCustomPalette({
            colors: [...],
            name: "..."
          })

       Это делает мост совместимее
       с менеджером палитр.
    */

    if (
      colors &&
      !Array.isArray(
        colors
      ) &&
      typeof colors ===
        "object"
    ) {
      name =
        colors.name ||
        name;

      colors =
        colors.colors;
    }

    if (
      !Array.isArray(
        colors
      )
    ) {
      console.error(
        "CLOrad custom palette: colors is not an array",
        colors
      );

      return false;
    }

    /*
       Кастомная палитра должна
       содержать ровно 19 цветов.
    */
    if (
      colors.length !==
      SOURCE_OY_COLORS.length
    ) {
      console.error(
        "CLOrad custom palette: требуется 19 цветов, получено:",
        colors.length
      );

      return false;
    }

    /*
       Нормализуем каждый цвет.

       Поддерживаются:
       #rrggbb
       rrggbb
       #rgb
       rgb
    */
    const normalized =
      colors.map(
        normalizeHexColor
      );

    if (
      normalized.some(
        color =>
          !color
      )
    ) {
      console.error(
        "CLOrad custom palette: один или несколько цветов имеют неверный HEX"
      );

      return false;
    }

    /*
       Копируем массив, чтобы менеджер
       не мог случайно изменить его
       после установки.
    */
    gifCustomPalette =
      normalized.slice();

    gifCustomPaletteName =
      String(
        name ||
          "Пользовательская"
      );

    /*
       Регистрируем custom-палитру
       внутри основного объекта.
    */
    OY_PALETTES.custom = {
      name:
        gifCustomPaletteName,

      colors:
        gifCustomPalette.slice()
    };

    /*
       Переключаем активный режим.
    */
    gifPalette =
      "custom";

    /*
       Отменяем ожидающиеся кадры.
    */
    gifFrameRequest++;

    /*
       Полностью очищаем результаты
       старой перекраски.
    */
    gifPaletteCache.clear();

    /*
       Оригинальные изображения
       можно оставить в gifImageCache,
       потому что это только исходные
       PNG-кадры.

       Но отображаемый слой обязательно
       пересоздаётся.
    */
    removeAllGIFDisplayLayers();

    updateGIFPaletteButtons();

    applyGIFPaletteToLegend();

    /*
       Если радар уже активен —
       немедленно перекрашиваем
       текущий кадр.
    */
    if (
      gifActive &&
      gifFrames.length
    ) {
      const index =
        Number(
          $("range")?.value ||
          0
        );

      showGIFFrame(
        index
      );
    }

    return true;
  }

  /* =======================================================
     PALETTE — PUBLIC MANAGER BRIDGE
     ======================================================= */

  window.CLOradApplyPalette =
    function (
      value,
      colors,
      name
    ) {
      if (
        value ===
        "rgmc"
      ) {
        gifFrameRequest++;

        gifCustomPalette =
          null;

        gifCustomPaletteName =
          "";

        gifPalette =
          "rgmc";

        gifPaletteCache.clear();
        removeAllGIFDisplayLayers();

        updateGIFPaletteButtons();

        applyGIFPaletteToLegend();

        if (
          gifActive &&
          gifFrames.length
        ) {
          const index =
            Number(
              $("range")?.value ||
              0
            );

          showGIFFrame(
            index
          );
        }

        return true;
      }

      if (
        value ===
        "iram"
      ) {
        gifFrameRequest++;

        gifCustomPalette =
          null;

        gifCustomPaletteName =
          "";

        gifPalette =
          "iram";

        gifPaletteCache.clear();
        removeAllGIFDisplayLayers();

        updateGIFPaletteButtons();

        applyGIFPaletteToLegend();

        if (
          gifActive &&
          gifFrames.length
        ) {
          const index =
            Number(
              $("range")?.value ||
              0
            );

          showGIFFrame(
            index
          );
        }

        return true;
      }

      if (
        value ===
        "custom"
      ) {
        return applyCustomPalette(
          colors,
          name
        );
      }

      return false;
    };

  window.CLOradGetSourcePalette =
    function () {
      return SOURCE_OY_COLORS.slice();
    };

  window.CLOradGetCurrentPalette =
    function () {
      if (
        gifPalette ===
          "custom" &&
        Array.isArray(
          gifCustomPalette
        )
      ) {
        return {
          id:
            "custom",

          name:
            gifCustomPaletteName,

          colors:
            gifCustomPalette.slice()
        };
      }

      const palette =
        OY_PALETTES[
          gifPalette
        ];

      return {
        id:
          gifPalette,

        name:
          palette?.name ||
          gifPalette,

        colors:
          palette?.colors
            ? palette.colors.slice()
            : []
      };
    };

  /* =======================================================
     SETTINGS — СЕТКА ДМРЛ
     ======================================================= */

  function installDMRLGridSetting() {
    const settings =
      document.getElementById(
        "settings"
      );

    if (!settings) {
      return;
    }

    if (
      document.getElementById(
        "dmrlGridSetting"
      )
    ) {
      return;
    }

    const setting =
      document.createElement(
        "div"
      );

    setting.className =
      "setting";

    setting.id =
      "dmrlGridSetting";

    setting.innerHTML = `
      <button
        class="settingHead"
        id="dmrlGridHead"
        type="button"
      >
        <span>
          Сетка данных ДМРЛ
        </span>

        <span class="settingArrow">
          ›
        </span>
      </button>

      <div
        class="settingBody"
        id="dmrlGridBody"
      >
        <div
          class="clorad-dmrl-grid-toggle"
          id="dmrlGridToggle"
          role="button"
          tabindex="0"
        >
          <span
            class="clorad-dmrl-grid-toggle-text"
          >
            Показывать сетку данных
          </span>

          <span
            class="clorad-dmrl-grid-switch"
          ></span>
        </div>
      </div>
    `;

    const paletteSetting =
      document.getElementById(
        "gifPaletteSetting"
      );

    if (paletteSetting) {
      paletteSetting.after(
        setting
      );
    } else {
      settings.appendChild(
        setting
      );
    }

    const head =
      document.getElementById(
        "dmrlGridHead"
      );

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
                  other !== setting
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

    const toggle =
      document.getElementById(
        "dmrlGridToggle"
      );

    if (toggle) {
      toggle.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          setDMRLGridEnabled(
            !dmrlGridEnabled
          );
        }
      );

      toggle.addEventListener(
        "keydown",
        event => {
          if (
            event.key ===
              "Enter" ||
            event.key ===
              " "
          ) {
            event.preventDefault();
            event.stopPropagation();

            setDMRLGridEnabled(
              !dmrlGridEnabled
            );
          }
        }
      );
    }

    updateDMRLGridButton();
  }

  function updateDMRLGridButton() {
    const setting =
      document.getElementById(
        "dmrlGridSetting"
      );

    if (!setting) {
      return;
    }

    setting.classList.toggle(
      "active",
      dmrlGridEnabled
    );
  }

  /* =======================================================
     RESOLUTION
     ======================================================= */

  function setGIFResolution(
    value
  ) {
    if (
      !ALLOWED_RESOLUTIONS.includes(
        value
      )
    ) {
      value =
        1;
    }

    gifFrameRequest++;

    gifResolution =
      value;

    updateGIFResolutionButtons();

    if (
      dmrlGridEnabled
    ) {
      drawDMRLGrid();
    }

    if (
      gifActive &&
      gifFrames.length
    ) {
      const index =
        Number(
          $("range")?.value ||
          0
        );

      gifImageCache.clear();

      gifPaletteCache.clear();

      rebuildFrameUrls();

      removeAllGIFDisplayLayers();

      showGIFFrame(
        index
      );
    }
  }

  /* =======================================================
     GRID — CANVAS LAYER
     ======================================================= */

  function createDMRLGridLayer() {
    if (
      dmrlGridLayer ||
      !window.map
    ) {
      return;
    }

    if (
      !window.map.getPane(
        "dmrlGridPane"
      )
    ) {
      window.map.createPane(
        "dmrlGridPane"
      );

      window.map.getPane(
        "dmrlGridPane"
      ).style.zIndex =
        "650";
    }

    const GridLayer =
      L.Layer.extend({
        onAdd(map) {
          this._map =
            map;

          this._canvas =
            document.createElement(
              "canvas"
            );

          this._canvas.className =
            "clorad-dmrl-grid-canvas";

          this._canvas.style.position =
            "absolute";

          this._canvas.style.pointerEvents =
            "none";

          this._canvas.style.zIndex =
            "650";

          this._canvas.style.display =
            "block";

          map.getPane(
            "dmrlGridPane"
          ).appendChild(
            this._canvas
          );

          dmrlGridCanvas =
            this._canvas;

          map.on(
            "move zoom resize viewreset",
            this._reset,
            this
          );

          this._reset();
        },

        onRemove(map) {
          map.off(
            "move zoom resize viewreset",
            this._reset,
            this
          );

          if (
            this._canvas &&
            this._canvas.parentNode
          ) {
            this._canvas.parentNode
              .removeChild(
                this._canvas
              );
          }

          dmrlGridCanvas =
            null;

          this._canvas =
            null;

          this._map =
            null;
        },

        bringToFront() {
          if (
            !this._canvas ||
            !this._canvas.parentNode
          ) {
            return this;
          }

          const pane =
            this._canvas.parentNode;

          pane.appendChild(
            this._canvas
          );

          this._canvas.style.zIndex =
            "650";

          return this;
        },

        _reset() {
          if (
            !this._map ||
            !this._canvas
          ) {
            return;
          }

          if (
            !dmrlGridEnabled ||
            this._map.getZoom() <
              DMRL_GRID_MIN_ZOOM
          ) {
            this._canvas.style.display =
              "none";

            return;
          }

          this._canvas.style.display =
            "block";

          drawDMRLGrid();
        }
      });

    dmrlGridLayer =
      new GridLayer();

    if (
      dmrlGridEnabled
    ) {
      dmrlGridLayer.addTo(
        window.map
      );
    }
  }

  /* =======================================================
     GRID — DRAW
     ======================================================= */

  function drawDMRLGrid() {
    if (
      !dmrlGridCanvas ||
      !window.map
    ) {
      return;
    }

    if (
      !dmrlGridEnabled ||
      window.map.getZoom() <
        DMRL_GRID_MIN_ZOOM
    ) {
      dmrlGridCanvas.style.display =
        "none";

      return;
    }

    dmrlGridCanvas.style.display =
      "block";

    const map =
      window.map;

    const canvas =
      dmrlGridCanvas;

    const size =
      map.getSize();

    const dpr =
      Math.min(
        window.devicePixelRatio ||
          1,
        2
      );

    canvas.width =
      Math.max(
        1,
        Math.round(
          size.x * dpr
        )
      );

    canvas.height =
      Math.max(
        1,
        Math.round(
          size.y * dpr
        )
      );

    canvas.style.width =
      size.x + "px";

    canvas.style.height =
      size.y + "px";

    const topLeft =
      map.containerPointToLayerPoint(
        [0, 0]
      );

    L.DomUtil.setPosition(
      canvas,
      topLeft
    );

    const ctx =
      canvas.getContext(
        "2d"
      );

    if (!ctx) {
      return;
    }

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    ctx.clearRect(
      0,
      0,
      size.x,
      size.y
    );

    const rasterWidth =
      Number(
        gifMeta?.width
      ) ||
      1122;

    const rasterHeight =
      Number(
        gifMeta?.height
      ) ||
      1136;

    const columns =
      Math.ceil(
        rasterWidth /
          gifResolution
      );

    const rows =
      Math.ceil(
        rasterHeight /
          gifResolution
      );

    if (
      columns < 1 ||
      rows < 1
    ) {
      return;
    }

    const north =
      GIF_BOUNDS[1][0];

    const east =
      GIF_BOUNDS[1][1];

    const south =
      GIF_BOUNDS[0][0];

    const west =
      GIF_BOUNDS[0][1];

    function mercatorY(
      lat
    ) {
      const rad =
        lat *
        Math.PI /
        180;

      return Math.log(
        Math.tan(
          Math.PI / 4 +
            rad / 2
        )
      );
    }

    function inverseMercatorY(
      value
    ) {
      return (
        Math.atan(
          Math.sinh(
            value
          )
        ) *
        180 /
        Math.PI
      );
    }

    const northMerc =
      mercatorY(
        north
      );

    const southMerc =
      mercatorY(
        south
      );

    const northWest =
      map.latLngToContainerPoint(
        [
          north,
          west
        ]
      );

    const northEast =
      map.latLngToContainerPoint(
        [
          north,
          east
        ]
      );

    const southWest =
      map.latLngToContainerPoint(
        [
          south,
          west
        ]
      );

    const southEast =
      map.latLngToContainerPoint(
        [
          south,
          east
        ]
      );

    const westX =
      northWest.x;

    const eastX =
      northEast.x;

    const rasterPixelWidth =
      (
        eastX -
        westX
      ) /
      rasterWidth;

    const northY =
      northWest.y;

    const southY =
      southWest.y;

    const rasterPixelHeight =
      (
        southY -
        northY
      ) /
      rasterHeight;

    const left =
      Math.min(
        northWest.x,
        southWest.x
      );

    const right =
      Math.max(
        northEast.x,
        southEast.x
      );

    const top =
      Math.min(
        northWest.y,
        northEast.y
      );

    const bottom =
      Math.max(
        southWest.y,
        southEast.y
      );

    if (
      right < 0 ||
      bottom < 0 ||
      left > size.x ||
      top > size.y
    ) {
      return;
    }

    ctx.lineWidth =
      1;

    ctx.strokeStyle =
      "rgba(255,255,255,0.28)";

    ctx.beginPath();

    for (
      let i = 1;
      i < columns;
      i++
    ) {
      const pixelX =
        Math.min(
          rasterWidth,
          i *
            gifResolution
        );

      const x =
        westX +
        pixelX *
          rasterPixelWidth;

      if (
        x < -2 ||
        x > size.x + 2
      ) {
        continue;
      }

      ctx.moveTo(
        Math.round(
          x
        ) + 0.5,
        Math.max(
          0,
          top
        )
      );

      ctx.lineTo(
        Math.round(
          x
        ) + 0.5,
        Math.min(
          size.y,
          bottom
        )
      );
    }

    for (
      let i = 1;
      i < rows;
      i++
    ) {
      const pixelY =
        Math.min(
          rasterHeight,
          i *
            gifResolution
        );

      const merc =
        northMerc -
        (
          pixelY /
            rasterHeight
        ) *
        (
          northMerc -
          southMerc
        );

      const lat =
        inverseMercatorY(
          merc
        );

      const p1 =
        map.latLngToContainerPoint(
          [
            lat,
            west
          ]
        );

      const p2 =
        map.latLngToContainerPoint(
          [
            lat,
            east
          ]
        );

      const lineY =
        (
          p1.y +
          p2.y
        ) /
        2;

      if (
        lineY < -2 ||
        lineY > size.y + 2
      ) {
        continue;
      }

      ctx.moveTo(
        Math.max(
          0,
          left
        ),
        Math.round(
          lineY
        ) + 0.5
      );

      ctx.lineTo(
        Math.min(
          size.x,
          right
        ),
        Math.round(
          lineY
        ) + 0.5
      );
    }

    ctx.stroke();
  }

  /* =======================================================
     GRID — ENABLE / DISABLE
     ======================================================= */

  function setDMRLGridEnabled(
    enabled
  ) {
    dmrlGridEnabled =
      Boolean(
        enabled
      );

    updateDMRLGridButton();

    if (
      !window.map
    ) {
      return;
    }

    if (
      dmrlGridEnabled
    ) {
      createDMRLGridLayer();

      if (
        dmrlGridLayer &&
        !window.map.hasLayer(
          dmrlGridLayer
        )
      ) {
        dmrlGridLayer.addTo(
          window.map
        );
      }

      drawDMRLGrid();

      if (
        dmrlGridLayer &&
        typeof dmrlGridLayer.bringToFront ===
          "function"
      ) {
        dmrlGridLayer.bringToFront();
      }
    } else {
      if (
        dmrlGridCanvas
      ) {
        const ctx =
          dmrlGridCanvas.getContext(
            "2d"
          );

        if (ctx) {
          ctx.clearRect(
            0,
            0,
            dmrlGridCanvas.width,
            dmrlGridCanvas.height
          );
        }

        dmrlGridCanvas.style.display =
          "none";
      }
    }
  }

  /* =======================================================
     GRID — RESIZE
     ======================================================= */

  window.addEventListener(
    "resize",
    () => {
      if (
        dmrlGridEnabled
      ) {
        requestAnimationFrame(
          drawDMRLGrid
        );
      }
    }
  );

  /* =======================================================
     GIF STYLE
     ======================================================= */

  function installGIFStyle() {
    if (
      document.getElementById(
        "clorad-gif-style"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "clorad-gif-style";

    style.textContent = `
      .clorad-gif-radar-image {
        image-rendering:
          pixelated !important;
        image-rendering:
          crisp-edges !important;
        pointer-events:
          none !important;
        user-select:
          none !important;
        -webkit-user-drag:
          none !important;
        max-width:
          none !important;
        max-height:
          none !important;
      }

      .clorad-dmrl-grid-canvas {
        pointer-events:
          none !important;
        user-select:
          none !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     IMAGE PRELOAD
     ======================================================= */

  function loadImage(
    url
  ) {
    if (
      gifImageCache.has(
        url
      )
    ) {
      return gifImageCache.get(
        url
      );
    }

    const promise =
      new Promise(
        (
          resolve,
          reject
        ) => {
          const img =
            new Image();

          img.decoding =
            "async";

          img.onload =
            () => {
              resolve(
                img
              );
            };

          img.onerror =
            () => {
              gifImageCache.delete(
                url
              );

              reject(
                new Error(
                  "Не удалось загрузить ДМРЛ-кадр"
                )
              );
            };

          img.src =
            url;
        }
      );

    gifImageCache.set(
      url,
      promise
    );

    return promise;
  }

  /* =======================================================
     META
     ======================================================= */

  async function loadGIFMeta() {
    const response =
      await fetch(
        `${API}?mode=meta`,
        {
          method:
            "GET",
          cache:
            "no-store"
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        "GIF API: HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    if (
      !data ||
      !Number.isInteger(
        Number(
          data.frames
        )
      ) ||
      Number(
        data.frames
      ) < 1
    ) {
      throw new Error(
        data?.message ||
        data?.error ||
        "GIF API вернул некорректные данные"
      );
    }

    gifMeta =
      data;

    return data;
  }

  /* =======================================================
     FRAME URLS
     ======================================================= */

  function buildFrameUrls(
    count
  ) {
    const result =
      [];

    for (
      let i = 0;
      i < count;
      i++
    ) {
      result.push(
        `${API}?frame=${i}&resolution=${gifResolution}`
      );
    }

    return result;
  }

  /* =======================================================
     REBUILD URLS
     ======================================================= */

  function rebuildFrameUrls() {
    if (!gifMeta) {
      return;
    }

    gifFrames =
      buildFrameUrls(
        Number(
          gifMeta.frames
        )
      );
  }

  /* =======================================================
     FRAME DELAYS
     ======================================================= */

  function buildGIFDelays(
    count,
    delays
  ) {
    const result =
      [];

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const value =
        Number(
          delays?.[i]
        );

      result.push(
        Number.isFinite(
          value
        ) &&
        value > 0
          ? value
          : 700
      );
    }

    return result;
  }

  /* =======================================================
     FRAME TIMES
     ======================================================= */

  function buildGIFTimes(
    count
  ) {
    const result =
      [];

    const newest =
      new Date();

    newest.setSeconds(
      0,
      0
    );

    newest.setMinutes(
      Math.floor(
        newest.getMinutes() /
          10
      ) * 10
    );

    const spanMinutes =
      180;

    const step =
      count > 1
        ? spanMinutes /
          (count - 1)
        : 0;

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const minutesAgo =
        spanMinutes -
        i * step;

      const date =
        new Date(
          newest.getTime() -
          minutesAgo *
            60000
        );

      result.push(
        date.toLocaleTimeString(
          "ru-RU",
          {
            hour:
              "2-digit",
            minute:
              "2-digit",
            timeZone:
              "Europe/Moscow"
          }
        )
      );
    }

    return result;
  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function updateGIFTimeline(
    index
  ) {
    if (
      !$("range")
    ) {
      return;
    }

    const count =
      gifFrames.length;

    $("range").min =
      0;

    $("range").max =
      Math.max(
        0,
        count - 1
      );

    $("range").value =
      index;

    const time =
      gifFrameTimes[
        index
      ] ||
      "—";

    $("timeLabel").textContent =
      "ДМРЛ композит · " +
      time;

    $("times").innerHTML =
      "<span>" +
      (
        gifFrameTimes[0] ||
        "—"
      ) +
      "</span>" +
      "<span>" +
      (
        gifFrameTimes[
          gifFrameTimes.length - 1
        ] ||
        "—"
      ) +
      "</span>";

    $("framesInfo").textContent =
      "ДМРЛ композит • кадров: " +
      count;

    $("intensityValue").textContent =
      "радар";
  }

  /* =======================================================
     PRELOAD
     ======================================================= */

  function preloadGIFNeighbors(
    index
  ) {
    return;
  }

  /* =======================================================
     CREATE GIF OVERLAY
     ======================================================= */

  function createGIFLayer(
    url
  ) {
    return createOriginalGIFLayer(
      url
    );
  }

  /* =======================================================
     SHOW FRAME
     ======================================================= */

  async function showGIFFrame(
    index
  ) {
    if (
      !gifActive ||
      !gifFrames.length
    ) {
      return;
    }

    index =
      Math.max(
        0,
        Math.min(
          Number(
            index
          ),
          gifFrames.length -
            1
        )
      );

    const requestId =
      ++gifFrameRequest;

    const url =
      gifFrames[index];

    try {
      if (
        gifPalette ===
        "rgmc"
      ) {
        removePaintedGIFLayer();

        if (
          !gifOriginalLayer
        ) {
          createOriginalGIFLayer(
            url
          );
        } else {
          gifOriginalLayer.setUrl(
            url
          );
        }

        if (
          gifOriginalLayer
        ) {
          gifOriginalLayer.setOpacity(
            1
          );

          if (
            typeof gifOriginalLayer.bringToFront ===
            "function"
          ) {
            gifOriginalLayer.bringToFront();
          }
        }
      }

      else {
        const displayUrl =
          await prepareGIFFrame(
            url
          );

        if (
          !gifActive ||
          requestId !==
            gifFrameRequest
        ) {
          return;
        }

        /*
           Если пользователь успел
           переключить палитру во время
           Canvas-обработки — старый
           результат не показываем.
        */
        if (
          gifPalette ===
          "rgmc"
        ) {
          removePaintedGIFLayer();

          if (
            !gifOriginalLayer
          ) {
            createOriginalGIFLayer(
              url
            );
          } else {
            gifOriginalLayer.setUrl(
              url
            );
          }

          if (
            gifOriginalLayer
          ) {
            gifOriginalLayer.setOpacity(
              1
            );

            if (
              typeof gifOriginalLayer.bringToFront ===
              "function"
            ) {
              gifOriginalLayer.bringToFront();
            }
          }
        }

        else {
          removeOriginalGIFLayer();

          if (
            !gifPaintedLayer
          ) {
            createPaintedGIFLayer(
              displayUrl
            );
          } else {
            gifPaintedLayer.setUrl(
              displayUrl
            );
          }

          if (
            gifPaintedLayer
          ) {
            gifPaintedLayer.setOpacity(
              1
            );

            if (
              typeof gifPaintedLayer.bringToFront ===
              "function"
            ) {
              gifPaintedLayer.bringToFront();
            }
          }
        }
      }

      updateGIFTimeline(
        index
      );

      preloadGIFNeighbors(
        index
      );

      if (
        dmrlGridEnabled &&
        dmrlGridLayer
      ) {
        dmrlGridLayer.bringToFront();
      }

    } catch (
      error
    ) {
      console.error(
        "CLOrad GIF frame:",
        error
      );

      if (
        requestId ===
        gifFrameRequest
      ) {
        if (
          typeof msg ===
          "function"
        ) {
          msg(
            error?.message ||
            "Ошибка ДМРЛ-кадра"
          );
        }
      }

    } finally {
      if (
        requestId ===
        gifFrameRequest
      ) {
        hideLoading();
      }
    }
  }

  /* =======================================================
     ACTIVATE
     ======================================================= */

  async function activateGIF() {
    if (
      gifActive
    ) {
      return;
    }

    if (
      typeof window.CLOradStopRadar ===
      "function"
    ) {
      window.CLOradStopRadar();
    }

    removeAllGIFDisplayLayers();

    gifActive =
      true;

    setActiveNav(
      gifButton
    );

    showLoading();

    $("framesInfo").textContent =
      "Загрузка ДМРЛ композита…";

    $("timeLabel").textContent =
      "Загрузка ДМРЛ композита…";

    try {
      const meta =
        await loadGIFMeta();

      if (
        !gifActive
      ) {
        return;
      }

      gifMeta =
        meta;

      const count =
        Number(
          meta.frames
        );

      gifFrames =
        buildFrameUrls(
          count
        );

      gifFrameTimes =
        buildGIFTimes(
          count
        );

      gifFrameDelays =
        buildGIFDelays(
          count,
          meta.delays
        );

      applyGIFPaletteToLegend();

      if (
        dmrlGridEnabled
      ) {
        drawDMRLGrid();
      }

      const newestIndex =
        gifFrames.length -
        1;

      await showGIFFrame(
        newestIndex
      );

    } catch (
      error
    ) {
      console.error(
        "CLOrad GIF:",
        error
      );

      gifActive =
        false;

      removeAllGIFDisplayLayers();

      $("timeLabel").textContent =
        "Ошибка ДМРЛ композита";

      $("framesInfo").textContent =
        error?.message ||
        "Не удалось загрузить ДМРЛ";

      if (
        typeof msg ===
        "function"
      ) {
        msg(
          error?.message ||
          "Ошибка ДМРЛ композита"
        );
      }

    } finally {
      hideLoading();
    }
  }

  /* =======================================================
     DEACTIVATE
     ======================================================= */

  function deactivateGIF() {
    gifFrameRequest++;

    gifActive =
      false;

    stopGIFPlayback();

    removeAllGIFDisplayLayers();

    gifFrames =
      [];

    gifFrameTimes =
      [];

    gifFrameDelays =
      [];

    gifMeta =
      null;

    gifImageCache.clear();

    gifPaletteCache.clear();

    if (
      dmrlGridLayer &&
      window.map &&
      window.map.hasLayer(
        dmrlGridLayer
      )
    ) {
      window.map.removeLayer(
        dmrlGridLayer
      );
    }

    if (
      $("range")
    ) {
      $("range").max =
        0;

      $("range").value =
        0;
    }

    if (
      $("times")
    ) {
      $("times").textContent =
        "";
    }

    if (
      $("timeLabel")
    ) {
      $("timeLabel").textContent =
        "Радар не подключён";
    }

    if (
      $("framesInfo")
    ) {
      $("framesInfo").textContent =
        "Радар пока не подключён";
    }

    if (
      $("intensityValue")
    ) {
      $("intensityValue").textContent =
        "Нет данных";
    }
  }

  /* =======================================================
     PLAY
     ======================================================= */

  function playGIF() {
    if (
      !gifActive ||
      !gifFrames.length
    ) {
      return;
    }

    if (
      gifPlaying
    ) {
      stopGIFPlayback();
      return;
    }

    gifPlaying =
      true;

    $("play").innerHTML =
      '<svg viewBox="0 0 24 24">' +
      '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' +
      '</svg>';

    const playNext =
      () => {
        if (
          !gifActive ||
          !gifPlaying
        ) {
          stopGIFPlayback();
          return;
        }

        let index =
          Number(
            $("range").value
          );

        index++;

        if (
          index >=
          gifFrames.length
        ) {
          index =
            0;
        }

        $("range").value =
          index;

        const delay =
          Number(
            gifFrameDelays[
              index
            ]
          ) ||
          700;

        showGIFFrame(
          index
        );

        gifPlayTimer =
          setTimeout(
            playNext,
            delay
          );
      };

    const currentIndex =
      Number(
        $("range").value
      );

    const firstDelay =
      Number(
        gifFrameDelays[
          currentIndex
        ]
      ) ||
      700;

    gifPlayTimer =
      setTimeout(
        playNext,
        firstDelay
      );
  }

  function stopGIFPlayback() {
    gifPlaying =
      false;

    if (
      gifPlayTimer
    ) {
      clearTimeout(
        gifPlayTimer
      );
    }

    gifPlayTimer =
      null;

    if (
      $("play")
    ) {
      $("play").innerHTML =
        '<svg viewBox="0 0 24 24">' +
        '<path d="M7 4l13 8-13 8z"/>' +
        '</svg>';
    }
  }

  /* =======================================================
     GIF BUTTON
     ======================================================= */

  let gifButton =
    document.getElementById(
      "gifRadarNav"
    );

  if (
    !gifButton
  ) {
    gifButton =
      document.createElement(
        "button"
      );

    gifButton.className =
      "n";

    gifButton.id =
      "gifRadarNav";

    gifButton.innerHTML = `
      <svg viewBox="0 0 24 24">
        <rect
          x="4"
          y="4"
          width="16"
          height="16"
          rx="2"
        />

        <path
          d="M9 8v8l6-4z"
        />
      </svg>

      ДМРЛ композит
    `;

    const rainButton =
      $("rainProduct");

    if (
      rainButton
    ) {
      rainButton.after(
        gifButton
      );
    } else {
      const navElement =
        document.querySelector(
          ".nav"
        );

      navElement?.appendChild(
        gifButton
      );
    }

  } else {
    const textNodes =
      [];

    gifButton.childNodes
      .forEach(
        node => {
          if (
            node.nodeType ===
            Node.TEXT_NODE
          ) {
            textNodes.push(
              node
            );
          }
        }
      );

    textNodes.forEach(
      node => {
        node.textContent =
          node.textContent.replace(
            /GIF\s*радар/gi,
            "ДМРЛ композит"
          );
      }
    );
  }

  /* =======================================================
     ACTIVE NAV
     ======================================================= */

  function setActiveNav(
    button
  ) {
    document
      .querySelectorAll(
        ".n"
      )
      .forEach(
        item =>
          item.classList.remove(
            "active"
          )
      );

    if (
      button
    ) {
      button.classList.add(
        "active"
      );
    }
  }

  /* =======================================================
     RANGE
     ======================================================= */

  $("range")?.addEventListener(
    "input",
    () => {
      if (
        !gifActive
      ) {
        return;
      }

      showGIFFrame(
        Number(
          $("range").value
        )
      );
    }
  );

  /* =======================================================
     PLAY BUTTON
     ======================================================= */

  $("play")?.addEventListener(
    "click",
    event => {
      if (
        !gifActive
      ) {
        return;
      }

      event.stopImmediatePropagation();

      playGIF();
    },
    true
  );

  /* =======================================================
     GIF BUTTON
     ======================================================= */

  gifButton.addEventListener(
    "click",
    event => {
      event.stopPropagation();

      activateGIF();
    }
  );

  /* =======================================================
     NAV SWITCHING
     ======================================================= */

  const nav =
    document.querySelector(
      ".nav"
    );

  nav?.addEventListener(
    "click",
    event => {
      const button =
        event.target.closest(
          ".n"
        );

      if (
        !button
      ) {
        return;
      }

      if (
        button.id ===
        "layersNav"
      ) {
        return;
      }

      if (
        button ===
        gifButton
      ) {
        return;
      }

      deactivateGIF();
    },
    true
  );

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradDeactivateGIF =
    deactivateGIF;

  window.CLOradGIFActive =
    () =>
      gifActive;

  window.CLOradShowGIFFrame =
    showGIFFrame;

  window.CLOradPlayGIF =
    playGIF;

  window.CLOradSetDMRLGrid =
    setDMRLGridEnabled;

  window.CLOradSetGIFPalette =
    setGIFPalette;

  window.CLOradGIFPalette =
    () =>
      gifPalette;

  window.CLOradDMRLGridActive =
    () =>
      dmrlGridEnabled;

  /* =======================================================
     INIT
     ======================================================= */

  installGIFStyle();

  installDMRLSettingsStyle();

  installGIFResolutionSetting();

  installGIFPaletteSetting();

  installDMRLGridSetting();

  applyGIFPaletteToLegend();

  if (
    !document.getElementById(
      "gifResolutionSetting"
    ) ||
    !document.getElementById(
      "gifPaletteSetting"
    ) ||
    !document.getElementById(
      "dmrlGridSetting"
    )
  ) {
    const observer =
      new MutationObserver(
        () => {
          installGIFResolutionSetting();

          installGIFPaletteSetting();

          installDMRLGridSetting();

          applyGIFPaletteToLegend();

          if (
            document.getElementById(
              "gifResolutionSetting"
            ) &&
            document.getElementById(
              "gifPaletteSetting"
            ) &&
            document.getElementById(
              "dmrlGridSetting"
            )
          ) {
            observer.disconnect();
          }
        }
      );

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
  }

})();
