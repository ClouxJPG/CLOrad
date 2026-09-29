/* =========================================================
   CLOrad — RainRadar Russia Composite

   RainRadar:
   - grayscale source
   - reflectivity palette
   - black = transparent
   - pixelated rendering
   - atomic frame loading
   - working global timeline
   - playback
   - automatic refresh
   - automatic stop when another layer opens

   Настройки:
   - Накрутка RainRadar: 1..30
   - По умолчанию: 23
   - Применяется кнопкой "Применить"

   ЛЕГЕНДА:
   - RainRadar → О
   - другой слой → ОЯ

   ВАЖНО:
   index.html НЕ ИЗМЕНЯЕТСЯ.
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const API = "/api/rainradar";

  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  const MIN_ZOOM = 3;
  const MIN_NATIVE_ZOOM = 3;
  const MAX_NATIVE_ZOOM = 5;
  const MAX_ZOOM = 14;

  const REFRESH_TIME = 60 * 1000;

  /* =======================================================
     BOOST
     ======================================================= */

  const BOOST_MIN = 1;
  const BOOST_MAX = 30;
  const BOOST_DEFAULT = 23;

  const BOOST_STORAGE_KEY =
    "clorad_rainradar_boost";

  let rainRadarBoost = loadBoost();
  let selectedBoost = rainRadarBoost;

  function loadBoost() {
    try {
      const value = Number(
        localStorage.getItem(
          BOOST_STORAGE_KEY
        )
      );

      if (Number.isFinite(value)) {
        return Math.max(
          BOOST_MIN,
          Math.min(
            BOOST_MAX,
            Math.round(value)
          )
        );
      }
    } catch {}

    return BOOST_DEFAULT;
  }

  function saveBoost(value) {
    try {
      localStorage.setItem(
        BOOST_STORAGE_KEY,
        String(value)
      );
    } catch {}
  }

  /* =======================================================
     REFLECTIVITY PALETTE
     ======================================================= */

  const REFLECTIVITY_PALETTE = [
    "#dadada",
    "#e4e4e4",
    "#c0c0c0",
    "#c9dced",
    "#e3fdbe",
    "#a3fb83",
    "#6ebff7",
    "#5880f7",
    "#4d4cd4",
    "#4b4c9f",
    "#fffe6e",
    "#f1a75c",
    "#ed7e77",
    "#eb5a55",
    "#98e364",
    "#6fbf5c",
    "#e459f0",
    "#b454f4",
    "#91504e"
  ];

  const REFLECTIVITY_LABELS = [
    "empty",
    "-30 dBZ",
    "-10 dBZ",
    "-5 dBZ",
    "0 dBZ",
    "5 dBZ",
    "10 dBZ",
    "15 dBZ",
    "20 dBZ",
    "25 dBZ",
    "30 dBZ",
    "35 dBZ",
    "40 dBZ",
    "45 dBZ",
    "50 dBZ",
    "55 dBZ",
    "60 dBZ",
    "65 dBZ",
    "70 dBZ"
  ];

  const COLOR_LEVELS =
    REFLECTIVITY_PALETTE.length;

  const PALETTE_RGB =
    REFLECTIVITY_PALETTE.map(hex => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    }));

  /* =======================================================
     STATE
     ======================================================= */

  let rainRadarNav = null;
  let rainRadarLayer = null;

  let timestamps = [];
  let currentIndex = -1;

  let active = false;
  let loading = false;

  let refreshTimer = null;
  let playbackTimer = null;

  let playback = false;
  let playbackBusy = false;

  /*
   * requestId = поколение всего RainRadar-сеанса.
   *
   * frameRequestId = поколение конкретного запрошенного
   * кадра. При смене кадра НЕ инвалидирует уже отображаемый
   * старый слой.
   */

  let requestId = 0;
  let frameRequestId = 0;

  let suppressTimelineInput = false;

  let settingsControl = null;

  /*
   * Оригинальные обработчики index.html.
   *
   * RainRadar временно подменяет:
   *   #range.oninput
   *   #play.onclick
   *
   * После выхода из RainRadar они возвращаются.
   */

  let savedRangeOnInput = null;
  let savedPlayOnClick = null;
  let timelineHandlersSaved = false;

  /* =======================================================
     CACHE
     ======================================================= */

  const grayscaleCache = new Map();
  const coloredCache = new Map();

  const MAX_CACHE_ITEMS = 600;

  /* =======================================================
     LEGEND
     ======================================================= */

  let originalLegend = null;
  let legendSaved = false;

  /* =======================================================
     HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(id);
  }

  function getMap() {
    return window.map || null;
  }

  function showMessage(text) {
    if (typeof window.msg === "function") {
      window.msg(text);
      return;
    }

    const el =
      document.createElement("div");

    el.textContent = text;

    el.style.cssText = [
      "position:fixed",
      "z-index:2147483646",
      "left:50%",
      "bottom:125px",
      "transform:translateX(-50%)",
      "background:#202930",
      "color:#fff",
      "padding:9px 14px",
      "border-radius:8px",
      "border:1px solid #3d4850",
      "white-space:nowrap",
      "max-width:calc(100% - 30px)",
      "overflow:hidden",
      "text-overflow:ellipsis"
    ].join(";");

    document.body.appendChild(el);

    setTimeout(
      () => el.remove(),
      2200
    );
  }

  /* =======================================================
     SHARP RENDERING
     ======================================================= */

  function installSharpRendering() {
    if (
      $("cloradRainRadarSharpCSS")
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "cloradRainRadarSharpCSS";

    style.textContent = `
      canvas.clorad-rainradar-tile {
        image-rendering: pixelated !important;
        image-rendering: -moz-crisp-edges !important;
        -ms-interpolation-mode: nearest-neighbor !important;
        backface-visibility: hidden !important;
        display: block !important;
      }
    `;

    document.head.appendChild(style);
  }

  /* =======================================================
     CACHE
     ======================================================= */

  function trimCache(cache) {
    while (
      cache.size >
      MAX_CACHE_ITEMS
    ) {
      const first =
        cache.keys().next().value;

      if (
        first === undefined
      ) {
        break;
      }

      cache.delete(first);
    }
  }

  /* =======================================================
     BOOST
     ======================================================= */

  function getGamma(boost) {
    return Math.max(
      0.22,
      1.02 -
        boost * 0.033
    );
  }

  function boostValue(value) {
    if (value <= 0) {
      return 0;
    }

    const normalized =
      value / 255;

    const gamma =
      getGamma(
        rainRadarBoost
      );

    const corrected =
      Math.pow(
        normalized,
        gamma
      );

    return Math.max(
      0,
      Math.min(
        255,
        Math.round(
          corrected * 255
        )
      )
    );
  }

  function valueToPaletteIndex(value) {
    if (value <= 0) {
      return -1;
    }

    const index =
      Math.floor(
        (value * COLOR_LEVELS) /
          256
      );

    return Math.max(
      0,
      Math.min(
        COLOR_LEVELS - 1,
        index
      )
    );
  }

  /* =======================================================
     COLORIZE
     ======================================================= */

  function colorizeImageData(
    imageData
  ) {
    const width =
      imageData.width;

    const height =
      imageData.height;

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = width;
    canvas.height = height;

    canvas.className =
      "clorad-rainradar-tile";

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    ctx.imageSmoothingEnabled =
      false;

    const output =
      new ImageData(
        width,
        height
      );

    const src =
      imageData.data;

    const dst =
      output.data;

    for (
      let i = 0;
      i < src.length;
      i += 4
    ) {
      const sourceValue =
        src[i];

      /*
       * Чёрный RainRadar-фон =
       * полная прозрачность.
       */

      if (
        sourceValue <= 0
      ) {
        dst[i] = 0;
        dst[i + 1] = 0;
        dst[i + 2] = 0;
        dst[i + 3] = 0;
        continue;
      }

      const value =
        boostValue(
          sourceValue
        );

      const paletteIndex =
        valueToPaletteIndex(
          value
        );

      if (
        paletteIndex < 0
      ) {
        dst[i + 3] = 0;
        continue;
      }

      const color =
        PALETTE_RGB[
          paletteIndex
        ];

      dst[i] =
        color.r;

      dst[i + 1] =
        color.g;

      dst[i + 2] =
        color.b;

      dst[i + 3] =
        255;
    }

    ctx.putImageData(
      output,
      0,
      0
    );

    return canvas;
  }

  /* =======================================================
     TILE URL
     ======================================================= */

  function tileUrl(
    timestamp,
    coords
  ) {
    return (
      `${API}` +
      `?timestamp=${encodeURIComponent(timestamp)}` +
      `&z=${coords.z}` +
      `&x=${coords.x}` +
      `&y=${coords.y}`
    );
  }

  /* =======================================================
     LOAD GRAYSCALE TILE
     ======================================================= */

  function loadGrayscaleTile(
    timestamp,
    coords
  ) {
    const key =
      `${timestamp}/${coords.z}/${coords.x}/${coords.y}`;

    const cached =
      grayscaleCache.get(key);

    if (cached) {
      return Promise.resolve(
        cached
      );
    }

    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        image.crossOrigin =
          "anonymous";

        image.decoding =
          "async";

        image.onload = () => {
          try {
            const width =
              image.naturalWidth ||
              256;

            const height =
              image.naturalHeight ||
              256;

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
                "Canvas 2D недоступен"
              );
            }

            ctx.imageSmoothingEnabled =
              false;

            ctx.drawImage(
              image,
              0,
              0
            );

            const imageData =
              ctx.getImageData(
                0,
                0,
                width,
                height
              );

            grayscaleCache.set(
              key,
              imageData
            );

            trimCache(
              grayscaleCache
            );

            resolve(
              imageData
            );
          } catch (error) {
            reject(error);
          }
        };

        image.onerror = () => {
          reject(
            new Error(
              "RainRadar tile unavailable"
            )
          );
        };

        image.src =
          tileUrl(
            timestamp,
            coords
          );
      }
    );
  }

  /* =======================================================
     BUILD COLORED TILE
     ======================================================= */

  async function buildColoredTile(
    timestamp,
    coords
  ) {
    const key =
      `${timestamp}/${coords.z}/${coords.x}/${coords.y}/${rainRadarBoost}`;

    const cached =
      coloredCache.get(key);

    if (cached) {
      return cached;
    }

    const imageData =
      await loadGrayscaleTile(
        timestamp,
        coords
      );

    const canvas =
      colorizeImageData(
        imageData
      );

    coloredCache.set(
      key,
      canvas
    );

    trimCache(
      coloredCache
    );

    return canvas;
  }

  /* =======================================================
     LEGEND
     ======================================================= */

  function findLegendContainer() {
    const first =
      document.querySelector(
        ".l1"
      );

    const last =
      document.querySelector(
        ".l19"
      );

    if (
      !first ||
      !last
    ) {
      return null;
    }

    let node =
      first.parentElement;

    let safety = 0;

    while (
      node &&
      safety < 10
    ) {
      if (
        node.contains(last)
      ) {
        return node;
      }

      node =
        node.parentElement;

      safety++;
    }

    return null;
  }

  function saveOriginalLegend() {
    if (legendSaved) {
      return;
    }

    const container =
      findLegendContainer();

    if (!container) {
      return;
    }

    originalLegend = {
      container,
      html:
        container.innerHTML
    };

    legendSaved = true;
  }

  function replaceLegendText(
    root,
    oldText,
    newText
  ) {
    if (!root) {
      return;
    }

    const walker =
      document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );

    const nodes = [];

    let node;

    while (
      (node =
        walker.nextNode())
    ) {
      nodes.push(node);
    }

    for (
      const textNode of nodes
    ) {
      if (
        textNode.nodeValue.includes(
          oldText
        )
      ) {
        textNode.nodeValue =
          textNode.nodeValue.replaceAll(
            oldText,
            newText
          );
      }
    }
  }

  function findRowForSwatch(
    swatch
  ) {
    let row =
      swatch.parentElement;

    let safety = 0;

    while (
      row &&
      safety < 5
    ) {
      if (
        (row.textContent || "")
          .trim()
          .length
      ) {
        return row;
      }

      row =
        row.parentElement;

      safety++;
    }

    return null;
  }

  function setLegendRowLabel(
    row,
    label
  ) {
    if (!row) {
      return false;
    }

    const elements =
      row.querySelectorAll(
        "span,div,label,p,b,strong"
      );

    for (
      const element of elements
    ) {
      if (
        /^l([1-9]|1[0-9])$/.test(
          element.className
        )
      ) {
        continue;
      }

      if (
        element.children.length ===
          0 &&
        element.textContent.trim()
      ) {
        element.textContent =
          label;

        return true;
      }
    }

    const walker =
      document.createTreeWalker(
        row,
        NodeFilter.SHOW_TEXT
      );

    const nodes = [];

    let node;

    while (
      (node =
        walker.nextNode())
    ) {
      if (
        node.nodeValue.trim()
      ) {
        nodes.push(node);
      }
    }

    if (nodes.length) {
      nodes[
        nodes.length - 1
      ].nodeValue =
        label;

      return true;
    }

    return false;
  }

  function applyReflectivityLegend() {
    saveOriginalLegend();

    const legend =
      findLegendContainer();

    if (!legend) {
      return;
    }

    replaceLegendText(
      legend,
      "ОЯ",
      "О"
    );

    for (
      let i = 1;
      i <= 19;
      i++
    ) {
      const swatch =
        legend.querySelector(
          `.l${i}`
        );

      if (!swatch) {
        continue;
      }

      const color =
        REFLECTIVITY_PALETTE[
          i - 1
        ];

      swatch.style.background =
        color;

      swatch.style.backgroundColor =
        color;

      swatch.style.backgroundImage =
        "none";

      const inner =
        swatch.querySelector("*");

      if (inner) {
        inner.style.background =
          color;

        inner.style.backgroundColor =
          color;

        inner.style.backgroundImage =
          "none";
      }

      if (
        swatch.children.length === 0 &&
        swatch.textContent.trim()
      ) {
        swatch.textContent =
          REFLECTIVITY_LABELS[
            i - 1
          ];
      }

      const row =
        findRowForSwatch(
          swatch
        );

      if (
        row &&
        row !== swatch
      ) {
        setLegendRowLabel(
          row,
          REFLECTIVITY_LABELS[
            i - 1
          ]
        );
      }
    }

    replaceLegendText(
      legend,
      "ОЯ",
      "О"
    );
  }

  function restoreOriginalLegend() {
    if (
      !legendSaved ||
      !originalLegend
    ) {
      return;
    }

    const container =
      originalLegend.container;

    if (!container) {
      return;
    }

    container.innerHTML =
      originalLegend.html;
  }

  /* =======================================================
     NAV
     ======================================================= */

  function createNav() {
    const existing =
      $("rainRadarNav");

    if (existing) {
      rainRadarNav =
        existing;

      if (
        existing.dataset
          .rainRadarClick !==
        "1"
      ) {
        existing.dataset
          .rainRadarClick =
          "1";

        existing.onclick =
          event => {
            event.stopPropagation();

            activate();
            showRainRadar();
          };
      }

      return;
    }

    const rainButton =
      $("rainProduct");

    if (!rainButton) {
      return;
    }

    rainRadarNav =
      document.createElement(
        "button"
      );

    rainRadarNav.id =
      "rainRadarNav";

    rainRadarNav.className =
      "n";

    rainRadarNav.type =
      "button";

    rainRadarNav.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M4 17h16M4 12h16M4 7h16"/>
      </svg>
      RainRadar
    `;

    rainButton.insertAdjacentElement(
      "afterend",
      rainRadarNav
    );

    rainRadarNav.dataset
      .rainRadarClick =
      "1";

    rainRadarNav.onclick =
      event => {
        event.stopPropagation();

        activate();
        showRainRadar();
      };
  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function getTimelineRange() {
    return $("range");
  }

  function getTimelinePlay() {
    return $("play");
  }

  function formatRainRadarTime(
    timestamp
  ) {
    const date =
      new Date(
        Number(timestamp) * 1000
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "—";
    }

    return date.toLocaleString(
      "ru-RU",
      {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }
    );
  }

  function saveTimelineHandlers() {
    if (
      timelineHandlersSaved
    ) {
      return true;
    }

    const range =
      getTimelineRange();

    const play =
      getTimelinePlay();

    if (
      !range ||
      !play
    ) {
      return false;
    }

    savedRangeOnInput =
      range.oninput;

    savedPlayOnClick =
      play.onclick;

    timelineHandlersSaved =
      true;

    return true;
  }

  function restoreTimelineHandlers() {
    if (
      !timelineHandlersSaved
    ) {
      return;
    }

    const range =
      getTimelineRange();

    const play =
      getTimelinePlay();

    if (range) {
      range.oninput =
        savedRangeOnInput;
    }

    if (play) {
      play.onclick =
        savedPlayOnClick;
    }

    savedRangeOnInput =
      null;

    savedPlayOnClick =
      null;

    timelineHandlersSaved =
      false;
  }

  function updateTimeline() {
    if (!active) {
      return;
    }

    const range =
      getTimelineRange();

    if (!range) {
      return;
    }

    suppressTimelineInput =
      true;

    range.min = "0";

    range.max =
      String(
        Math.max(
          0,
          timestamps.length - 1
        )
      );

    range.step = "1";

    range.value =
      String(
        Math.max(
          0,
          currentIndex
        )
      );

    range.disabled =
      timestamps.length <= 1;

    const times =
      $("times");

    if (times) {
      times.innerHTML =
        timestamps
          .map(
            timestamp =>
              `<span>${formatRainRadarTime(timestamp)}</span>`
          )
          .join(" ");
    }

    const label =
      $("timeLabel");

    if (
      label &&
      timestamps[
        currentIndex
      ]
    ) {
      label.textContent =
        formatRainRadarTime(
          timestamps[
            currentIndex
          ]
        );
    }

    suppressTimelineInput =
      false;
  }

  function updatePlayButton() {
    if (!active) {
      return;
    }

    const button =
      getTimelinePlay();

    if (!button) {
      return;
    }

    if (playback) {
      button.innerHTML =
        '<svg viewBox="0 0 24 24">' +
        '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' +
        "</svg>";
    } else {
      button.innerHTML =
        '<svg viewBox="0 0 24 24">' +
        '<path d="M7 4l13 8-13 8z"/>' +
        "</svg>";
    }
  }

  function hookTimeline() {
    if (!active) {
      return;
    }

    const range =
      getTimelineRange();

    const play =
      getTimelinePlay();

    if (
      !range ||
      !play
    ) {
      return;
    }

    if (
      !saveTimelineHandlers()
    ) {
      return;
    }

    /*
     * ВАЖНО:
     * именно oninput, а не addEventListener.
     * index.html использует range.oninput.
     */

    range.oninput =
      () => {
        if (
          !active ||
          suppressTimelineInput
        ) {
          return;
        }

        stopPlayback();

        const index =
          Number(
            range.value
          );

        if (
          !Number.isFinite(
            index
          )
        ) {
          return;
        }

        setFrame(index);
      };

    /*
     * ВАЖНО:
     * именно onclick, потому что index.html
     * использует play.onclick.
     */

    play.onclick =
      event => {
        if (!active) {
          if (
            typeof savedPlayOnClick ===
            "function"
          ) {
            savedPlayOnClick.call(
              play,
              event
            );
          }

          return;
        }

        event.preventDefault();
        event.stopPropagation();

        togglePlayback();
      };

    updateTimeline();
    updatePlayButton();
  }

  /* =======================================================
     ACTIVATE
     ======================================================= */

  function activate() {
    ++requestId;
    ++frameRequestId;

    active = true;

    stopPlayback();

    document
      .querySelectorAll(
        ".nav .n"
      )
      .forEach(button => {
        button.classList.remove(
          "active"
        );
      });

    if (rainRadarNav) {
      rainRadarNav.classList.add(
        "active"
      );
    }

    applyReflectivityLegend();

    try {
      if (
        typeof window.CLOradStopRadar ===
        "function"
      ) {
        window.CLOradStopRadar();
      }
    } catch {}

    try {
      if (
        typeof window.CLOradDeactivateGIF ===
        "function"
      ) {
        window.CLOradDeactivateGIF();
      }
    } catch {}

    /*
     * Только здесь RainRadar получает
     * управление глобальным таймлайном.
     */
    hookTimeline();
  }

  /* =======================================================
     OTHER LAYERS
     ======================================================= */

  function hookOtherLayers() {
    const nav =
      document.querySelector(
        ".nav"
      );

    if (
      !nav ||
      nav.dataset
        .rainRadarOtherLayersHooked
    ) {
      return;
    }

    nav.dataset
      .rainRadarOtherLayersHooked =
      "1";

    nav.addEventListener(
      "click",
      event => {
        const button =
          event.target.closest(
            ".nav .n"
          );

        if (!button) {
          return;
        }

        if (
          button.id ===
          "rainRadarNav"
        ) {
          return;
        }

        if (
          active ||
          rainRadarLayer
        ) {
          stop();
        }
      },
      true
    );

    if (
      typeof MutationObserver !==
      "undefined"
    ) {
      const observer =
        new MutationObserver(
          () => {
            if (!active) {
              return;
            }

            const activeButton =
              nav.querySelector(
                ".n.active"
              );

            if (
              activeButton &&
              activeButton.id !==
                "rainRadarNav"
            ) {
              stop();
            }
          }
        );

      observer.observe(
        nav,
        {
          subtree: true,
          attributes: true,
          attributeFilter: [
            "class"
          ]
        }
      );
    }
  }

  /* =======================================================
     RAINRADAR GRID LAYER
     ======================================================= */

  const RainRadarLayer =
    L.GridLayer.extend({
      initialize:
        function(options) {
          L.GridLayer.prototype.initialize.call(
            this,
            options
          );

          this._pendingTiles =
            new Set();

          this._failedTiles =
            new Set();

          this._frameReady =
            false;

          /*
           * Только поколение активации.
           *
           * Здесь НЕ используется frameRequestId,
           * иначе смена кадра могла бы сломать
           * уже отображаемый старый слой.
           */

          this._activationRequestId =
            options.activationRequestId;
        },

      createTile:
        function(coords, done) {
          const tile =
            document.createElement(
              "canvas"
            );

          tile.width = 256;
          tile.height = 256;

          tile.style.width =
            "256px";

          tile.style.height =
            "256px";

          tile.className =
            "clorad-rainradar-tile";

          tile.style.imageRendering =
            "pixelated";

          tile.style.msInterpolationMode =
            "nearest-neighbor";

          tile.style.display =
            "block";

          tile.style.background =
            "transparent";

          const key =
            `${coords.z}:${coords.x}:${coords.y}`;

          this._pendingTiles.add(
            key
          );

          const ctx =
            tile.getContext(
              "2d"
            );

          if (!ctx) {
            this._pendingTiles.delete(
              key
            );

            this._failedTiles.add(
              key
            );

            done(
              new Error(
                "Canvas 2D недоступен"
              ),
              tile
            );

            this._checkReady();

            return tile;
          }

          ctx.imageSmoothingEnabled =
            false;

          const timestamp =
            this.options.timestamp;

          const activationId =
            this._activationRequestId;

          buildColoredTile(
            timestamp,
            coords
          )
            .then(canvas => {
              /*
               * Если RainRadar уже выключен,
               * текущий слой становится неактуальным.
               */

              if (
                !active ||
                activationId !==
                  requestId
              ) {
                this._pendingTiles.delete(
                  key
                );

                done(
                  null,
                  tile
                );

                this._checkReady();

                return;
              }

              ctx.imageSmoothingEnabled =
                false;

              ctx.clearRect(
                0,
                0,
                tile.width,
                tile.height
              );

              ctx.drawImage(
                canvas,
                0,
                0
              );

              this._pendingTiles.delete(
                key
              );

              done(
                null,
                tile
              );

              this._checkReady();
            })
            .catch(error => {
              console.error(
                "RainRadar tile:",
                error
              );

              this._pendingTiles.delete(
                key
              );

              this._failedTiles.add(
                key
              );

              done(
                error,
                tile
              );

              this._checkReady();
            });

          return tile;
        },

      onAdd:
        function(map) {
          this._frameReady =
            false;

          this._pendingTiles.clear();
          this._failedTiles.clear();

          L.GridLayer.prototype.onAdd.call(
            this,
            map
          );

          /*
           * Новый слой всегда невидим
           * до полной загрузки.
           */

          this.setOpacity(0);
        },

      _checkReady:
        function() {
          if (
            this._frameReady
          ) {
            return;
          }

          /*
           * Ждём ВСЕ созданные тайлы.
           */

          if (
            this._pendingTiles.size !==
            0
          ) {
            return;
          }

          this._frameReady =
            true;

          this.fire(
            "frameready",
            {
              ready:
                this._failedTiles
                  .size === 0,

              failed:
                this._failedTiles
                  .size
            }
          );
        }
    });

  /* =======================================================
     CREATE FRAME
     ======================================================= */

  function createLayer(
    timestamp,
    frameToken
  ) {
    const map =
      getMap();

    if (!map) {
      throw new Error(
        "Leaflet map не найден"
      );
    }

    /*
     * rainRadarLayer = ТЕКУЩИЙ ВИДИМЫЙ кадр.
     *
     * Не заменяем его сразу.
     * Это главный фикс отсутствия дыр.
     */

    const oldLayer =
      rainRadarLayer;

    const activationId =
      requestId;

    const layer =
      new RainRadarLayer({
        tileSize: 256,

        bounds:
          RR_BOUNDS,

        minZoom:
          MIN_ZOOM,

        maxZoom:
          MAX_ZOOM,

        minNativeZoom:
          MIN_NATIVE_ZOOM,

        maxNativeZoom:
          MAX_NATIVE_ZOOM,

        noWrap: true,

        zIndex: 620,

        keepBuffer: 1,

        updateWhenIdle: true,

        updateWhenZooming:
          false,

        updateInterval: 100,

        timestamp,

        activationRequestId:
          activationId,

        frameRequestId:
          frameToken
      });

    layer.setOpacity(0);

    layer.once(
      "frameready",
      event => {
        /*
         * Этот запрос уже устарел.
         * Удаляем только его новый слой.
         * Старый видимый кадр не трогаем.
         */

        if (
          !active ||
          activationId !==
            requestId ||
          frameToken !==
            frameRequestId
        ) {
          if (
            map.hasLayer(layer)
          ) {
            map.removeLayer(
              layer
            );
          }

          return;
        }

        /*
         * Новый кадр не загрузился полностью.
         * Оставляем старый.
         */

        if (
          !event.ready
        ) {
          if (
            map.hasLayer(layer)
          ) {
            map.removeLayer(
              layer
            );
          }

          showMessage(
            "Кадр RainRadar загружен не полностью"
          );

          return;
        }

        /*
         * СНАЧАЛА показываем новый.
         */

        layer.setOpacity(1);

        /*
         * ПОТОМ удаляем старый.
         */

        if (
          oldLayer &&
          oldLayer !== layer &&
          map.hasLayer(
            oldLayer
          )
        ) {
          map.removeLayer(
            oldLayer
          );
        }

        /*
         * Теперь новый кадр становится
         * официально текущим.
         */

        rainRadarLayer =
          layer;
      }
    );

    layer.addTo(map);

    /*
     * Защита от случая, когда тайлы
     * уже были взяты из кеша.
     */

    if (
      layer._frameReady
    ) {
      layer.fire(
        "frameready",
        {
          ready:
            layer._failedTiles
              .size === 0,

          failed:
            layer._failedTiles
              .size
        }
      );
    }

    return layer;
  }

  /* =======================================================
     LOAD FRAMES
     ======================================================= */

  async function loadFrames() {
    const response =
      await fetch(
        `${API}?manifest=1&t=${Date.now()}`,
        {
          cache:
            "no-store"
        }
      );

    let data;

    try {
      data =
        await response.json();
    } catch {
      throw new Error(
        `RainRadar API вернул HTTP ${response.status}`
      );
    }

    if (
      !response.ok ||
      !data ||
      data.ok === false
    ) {
      throw new Error(
        data?.error ||
          `RainRadar API HTTP ${response.status}`
      );
    }

    const frames =
      Array.isArray(
        data.frames
      )
        ? data.frames
        : [];

    if (
      !frames.length
    ) {
      throw new Error(
        "RainRadar не вернул кадры"
      );
    }

    timestamps =
      frames
        .map(frame => {
          if (
            typeof frame ===
              "number" ||
            typeof frame ===
              "string"
          ) {
            return Number(
              frame
            );
          }

          return Number(
            frame?.timestamp
          );
        })
        .filter(
          value =>
            Number.isFinite(
              value
            )
        )
        .sort(
          (a, b) =>
            a - b
        );

    if (
      !timestamps.length
    ) {
      throw new Error(
        "Не удалось получить timestamp RainRadar"
      );
    }

    return timestamps;
  }

  /* =======================================================
     SET FRAME
     ======================================================= */

  async function setFrame(index) {
    if (
      !timestamps.length ||
      !active
    ) {
      return false;
    }

    const targetIndex =
      Math.max(
        0,
        Math.min(
          timestamps.length - 1,
          Number(index)
        )
      );

    if (
      !Number.isFinite(
        targetIndex
      )
    ) {
      return false;
    }

    /*
     * Индекс старого реально отображаемого кадра.
     */

    const previousIndex =
      currentIndex;

    /*
     * Новый запрос кадра получает
     * собственный token.
     */

    const frameToken =
      ++frameRequestId;

    currentIndex =
      targetIndex;

    updateTimeline();

    const layer =
      createLayer(
        timestamps[
          targetIndex
        ],
        frameToken
      );

    return new Promise(
      resolve => {
        let finished =
          false;

        const finish =
          event => {
            if (
              finished
            ) {
              return;
            }

            finished =
              true;

            const ready =
              Boolean(
                event?.ready
              );

            /*
             * Если именно последний запрос
             * закончился ошибкой — возвращаем
             * таймлайн на старый кадр.
             */

            if (
              !ready &&
              active &&
              frameToken ===
                frameRequestId &&
              currentIndex ===
                targetIndex
            ) {
              currentIndex =
                previousIndex;

              updateTimeline();
            }

            resolve(
              ready
            );
          };

        layer.once(
          "frameready",
          finish
        );

        /*
         * Если событие уже произошло
         * до установки listener.
         */

        if (
          layer._frameReady
        ) {
          finish({
            ready:
              layer._failedTiles
                .size === 0
          });
        }
      }
    );
  }

  /* =======================================================
     PLAYBACK
     ======================================================= */

  function stopPlayback() {
    playback =
      false;

    playbackBusy =
      false;

    if (
      playbackTimer
    ) {
      clearTimeout(
        playbackTimer
      );
    }

    playbackTimer =
      null;

    updatePlayButton();
  }

  async function playbackStep() {
    if (
      !active ||
      !playback ||
      playbackBusy
    ) {
      return;
    }

    playbackBusy =
      true;

    const next =
      currentIndex >=
      timestamps.length - 1
        ? 0
        : currentIndex + 1;

    try {
      const ok =
        await setFrame(
          next
        );

      if (!ok) {
        return;
      }
    } finally {
      playbackBusy =
        false;
    }

    if (
      active &&
      playback
    ) {
      playbackTimer =
        setTimeout(
          playbackStep,
          700
        );
    }
  }

  function startPlayback() {
    if (
      !active ||
      timestamps.length < 2
    ) {
      return;
    }

    stopPlayback();

    playback =
      true;

    playbackBusy =
      false;

    updatePlayButton();

    playbackTimer =
      setTimeout(
        playbackStep,
        0
      );
  }

  function togglePlayback() {
    if (
      playback
    ) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  /* =======================================================
     SHOW
     ======================================================= */

  async function showRainRadar() {
    if (loading) {
      return;
    }

    const map =
      getMap();

    if (!map) {
      showMessage(
        "Карта ещё не готова"
      );

      return;
    }

    loading =
      true;

    stopPlayback();

    showMessage(
      "Загрузка RainRadar..."
    );

    try {
      await loadFrames();

      if (!active) {
        return;
      }

      /*
       * setFrame сам выставляет
       * currentIndex и timeline.
       */

      await setFrame(
        timestamps.length - 1
      );

      if (!active) {
        return;
      }

      startRefresh();

      showMessage(
        `RainRadar загружен · накрутка ${rainRadarBoost}`
      );
    } catch (error) {
      console.error(
        "RainRadar:",
        error
      );

      showMessage(
        error?.message ||
          "Ошибка загрузки RainRadar"
      );
    } finally {
      loading =
        false;
    }
  }

  /* =======================================================
     BOOST APPLY
     ======================================================= */

  function applyBoost() {
    if (
      selectedBoost ===
      rainRadarBoost
    ) {
      showMessage(
        `Накрутка RainRadar: ${rainRadarBoost}`
      );

      return;
    }

    rainRadarBoost =
      selectedBoost;

    saveBoost(
      rainRadarBoost
    );

    /*
     * Старые цветные тайлы больше
     * не соответствуют новой накрутке.
     */

    coloredCache.clear();

    /*
     * Новый слой загружается поверх старого.
     * Старый остаётся видимым до готовности.
     */

    refreshCurrentFrameInstant();

    showMessage(
      `Накрутка RainRadar применена: ${rainRadarBoost}`
    );
  }

  function refreshCurrentFrameInstant() {
    if (
      !active ||
      currentIndex < 0 ||
      !timestamps.length
    ) {
      return;
    }

    /*
     * НЕ скрываем старый слой.
     *
     * setFrame() создаёт новый слой,
     * ждёт его полного заполнения,
     * показывает его и только потом
     * удаляет старый.
     */

    setFrame(
      currentIndex
    );
  }

  /* =======================================================
     SETTINGS
     ======================================================= */

  function findSettingsContainer() {
    return $("settings");
  }

  function createRainRadarSettings() {
    const settings =
      findSettingsContainer();

    if (!settings) {
      return;
    }

    const existing =
      settings.querySelector(
        "#cloradRainRadarSetting"
      );

    if (existing) {
      settingsControl =
        existing;

      syncBoostUI();

      return;
    }

    const setting =
      document.createElement(
        "div"
      );

    setting.className =
      "setting";

    setting.id =
      "cloradRainRadarSetting";

    const head =
      document.createElement(
        "button"
      );

    head.className =
      "settingHead";

    head.type =
      "button";

    head.innerHTML = `
      <span>Накрутка RainRadar</span>
      <span
        class="settingArrow"
      >›</span>
    `;

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "settingBody";

    const info =
      document.createElement(
        "div"
      );

    info.className =
      "framesInfo";

    info.style.marginBottom =
      "9px";

    info.textContent =
      "Усиление интенсивности данных";

    const valueRow =
      document.createElement(
        "div"
      );

    valueRow.style.cssText =
      [
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "margin-bottom:8px",
        "font-size:13px"
      ].join(";");

    const selectedText =
      document.createElement(
        "span"
      );

    selectedText.textContent =
      "Выбрано:";

    const selectedValue =
      document.createElement(
        "strong"
      );

    selectedValue.id =
      "cloradRainRadarBoostValue";

    selectedValue.textContent =
      String(
        selectedBoost
      );

    selectedValue.style.cssText =
      [
        "font-size:16px",
        "font-variant-numeric:tabular-nums",
        "min-width:28px",
        "text-align:right",
        "color:#53e39b"
      ].join(";");

    valueRow.appendChild(
      selectedText
    );

    valueRow.appendChild(
      selectedValue
    );

    const range =
      document.createElement(
        "input"
      );

    range.type =
      "range";

    range.id =
      "cloradRainRadarBoostRange";

    range.min =
      String(
        BOOST_MIN
      );

    range.max =
      String(
        BOOST_MAX
      );

    range.step =
      "1";

    range.value =
      String(
        selectedBoost
      );

    range.style.cssText =
      [
        "width:100%",
        "display:block",
        "margin:3px 0 4px",
        "accent-color:#53e39b"
      ].join(";");

    const scale =
      document.createElement(
        "div"
      );

    scale.style.cssText =
      [
        "display:flex",
        "justify-content:space-between",
        "font-size:10px",
        "color:#858e95",
        "margin-bottom:10px"
      ].join(";");

    const min =
      document.createElement(
        "span"
      );

    min.textContent =
      "1";

    const max =
      document.createElement(
        "span"
      );

    max.textContent =
      "30";

    scale.appendChild(
      min
    );

    scale.appendChild(
      max
    );

    const apply =
      document.createElement(
        "button"
      );

    apply.id =
      "cloradRainRadarBoostApply";

    apply.type =
      "button";

    apply.textContent =
      "Применить";

    apply.style.cssText =
      [
        "width:100%",
        "height:40px",
        "border:1px solid #3d8e6a",
        "border-radius:8px",
        "background:#194c38",
        "color:#eafff5",
        "font-size:14px",
        "font-weight:600",
        "cursor:pointer"
      ].join(";");

    body.appendChild(
      info
    );

    body.appendChild(
      valueRow
    );

    body.appendChild(
      range
    );

    body.appendChild(
      scale
    );

    body.appendChild(
      apply
    );

    setting.appendChild(
      head
    );

    setting.appendChild(
      body
    );

    const framesSetting =
      settings.querySelector(
        "#framesSetting"
      );

    if (
      framesSetting &&
      framesSetting.parentElement ===
        settings
    ) {
      framesSetting.insertAdjacentElement(
        "afterend",
        setting
      );
    } else {
      settings.appendChild(
        setting
      );
    }

    settingsControl =
      setting;

    head.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        setting.classList.toggle(
          "open"
        );
      }
    );

    range.addEventListener(
      "input",
      () => {
        selectedBoost =
          Math.max(
            BOOST_MIN,
            Math.min(
              BOOST_MAX,
              Math.round(
                Number(
                  range.value
                )
              )
            )
          );

        selectedValue.textContent =
          String(
            selectedBoost
          );
      }
    );

    apply.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        applyBoost();
      }
    );

    syncBoostUI();
  }

  function syncBoostUI() {
    const range =
      $(
        "cloradRainRadarBoostRange"
      );

    const value =
      $(
        "cloradRainRadarBoostValue"
      );

    if (range) {
      range.value =
        String(
          selectedBoost
        );
    }

    if (value) {
      value.textContent =
        String(
          selectedBoost
        );
    }
  }

  /* =======================================================
     AUTO REFRESH
     ======================================================= */

  function startRefresh() {
    stopRefresh();

    refreshTimer =
      setInterval(
        async () => {
          if (
            !active ||
            loading
          ) {
            return;
          }

          try {
            const oldLatest =
              timestamps[
                timestamps.length - 1
              ];

            await loadFrames();

            if (!active) {
              return;
            }

            const newLatest =
              timestamps[
                timestamps.length - 1
              ];

            if (
              newLatest !==
              oldLatest
            ) {
              const wasPlaying =
                playback;

              if (wasPlaying) {
                stopPlayback();
              }

              await setFrame(
                timestamps.length - 1
              );

              if (
                wasPlaying &&
                active
              ) {
                startPlayback();
              }

              showMessage(
                "RainRadar: новый кадр"
              );
            }
          } catch (error) {
            console.warn(
              "RainRadar refresh:",
              error
            );
          }
        },
        REFRESH_TIME
      );
  }

  function stopRefresh() {
    if (
      refreshTimer
    ) {
      clearInterval(
        refreshTimer
      );
    }

    refreshTimer =
      null;
  }

  /* =======================================================
     STOP
     ======================================================= */

  function stop() {
    active =
      false;

    loading =
      false;

    stopPlayback();
    stopRefresh();

    /*
     * Инвалидируем все старые
     * асинхронные операции.
     */

    ++requestId;
    ++frameRequestId;

    /*
     * СНАЧАЛА возвращаем настоящий
     * timeline index.html.
     */

    restoreTimelineHandlers();

    const map =
      getMap();

    if (
      map &&
      rainRadarLayer
    ) {
      try {
        map.removeLayer(
          rainRadarLayer
        );
      } catch {}
    }

    if (map) {
      const toRemove = [];

      map.eachLayer(
        layer => {
          if (
            layer instanceof
            RainRadarLayer
          ) {
            toRemove.push(
              layer
            );
          }
        }
      );

      for (
        const layer of toRemove
      ) {
        try {
          map.removeLayer(
            layer
          );
        } catch {}
      }
    }

    rainRadarLayer =
      null;

    if (
      rainRadarNav
    ) {
      rainRadarNav.classList.remove(
        "active"
      );
    }

    restoreOriginalLegend();
  }

  /* =======================================================
     PUBLIC STOP API
     ======================================================= */

  window.CLOradStopRainRadar =
    stop;

  window.CLOradDeactivateRainRadar =
    stop;

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    installSharpRendering();

    /*
     * В init() timeline НЕ трогаем.
     *
     * Это принципиально:
     * index.html должен полностью сохранить
     * свои обработчики для остальных слоёв.
     */

    createNav();
    hookOtherLayers();
    createRainRadarSettings();

    setTimeout(
      () => {
        createNav();
        hookOtherLayers();
        createRainRadarSettings();
      },
      300
    );

    setTimeout(
      () => {
        createNav();
        hookOtherLayers();
        createRainRadarSettings();
      },
      800
    );

    setTimeout(
      () => {
        createNav();
        hookOtherLayers();
        createRainRadarSettings();
      },
      1500
    );

    setTimeout(
      () => {
        createNav();
        hookOtherLayers();
        createRainRadarSettings();
      },
      3000
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

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRainRadar = {
    show:
      showRainRadar,

    stop,

    reload:
      showRainRadar,

    play:
      startPlayback,

    pause:
      stopPlayback,

    getFrames:
      () =>
        timestamps.slice(),

    getCurrent:
      () =>
        timestamps[
          currentIndex
        ] || null,

    getBoost:
      () =>
        rainRadarBoost,

    setBoost:
      value => {
        const next =
          Math.max(
            BOOST_MIN,
            Math.min(
              BOOST_MAX,
              Math.round(
                Number(
                  value
                )
              )
            )
          );

        selectedBoost =
          next;

        syncBoostUI();

        applyBoost();
      }
  };
})();
