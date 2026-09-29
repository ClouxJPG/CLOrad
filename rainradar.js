/* =========================================================
   CLOrad — RainRadar Russia Composite

   RainRadar:
   - grayscale source
   - reflectivity palette
   - black = transparent
   - nearest-neighbor / pixelated rendering
   - square pixels
   - atomic frame loading
   - frame timeline
   - playback
   - automatic refresh
   - отключение при открытии другого слоя

   Настройки:
   - Накрутка RainRadar: 1..30
   - По умолчанию: 15
   - Изменение применяется кнопкой "Применить"

   ЛЕГЕНДА:
   - RainRadar → О / Отражаемость
   - другой слой → ОЯ

   ВАЖНО:
   index.html НЕ изменяется.
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const API =
    "/api/rainradar";

  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  const MIN_ZOOM =
    3;

  const MIN_NATIVE_ZOOM =
    3;

  const MAX_NATIVE_ZOOM =
    5;

  const MAX_ZOOM =
    14;

  const REFRESH_TIME =
    60 * 1000;


  /* =======================================================
     RAINRADAR BOOST
     ======================================================= */

  const BOOST_MIN =
    1;

  const BOOST_MAX =
    30;

  const BOOST_DEFAULT =
    23;

  const BOOST_STORAGE_KEY =
    "clorad_rainradar_boost";

  let rainRadarBoost =
    loadBoost();

  let selectedBoost =
    rainRadarBoost;


  function loadBoost() {
    try {
      const stored =
        Number(
          localStorage.getItem(
            BOOST_STORAGE_KEY
          )
        );

      if (
        Number.isFinite(stored)
      ) {
        return Math.max(
          BOOST_MIN,
          Math.min(
            BOOST_MAX,
            Math.round(stored)
          )
        );
      }
    } catch {}

    return BOOST_DEFAULT;
  }


  function saveBoost(
    value
  ) {
    try {
      localStorage.setItem(
        BOOST_STORAGE_KEY,
        String(value)
      );
    } catch {}
  }


  /* =======================================================
     REFLECTIVITY PALETTE

     По предоставленной пользователем легенде:

     empty
     -30 dBZ
     -10 dBZ
     -5 dBZ
      0 dBZ
      5 dBZ
     10 dBZ
     15 dBZ
     20 dBZ
     25 dBZ
     30 dBZ
     35 dBZ
     40 dBZ
     45 dBZ
     50 dBZ
     55 dBZ
     60 dBZ
     65 dBZ
     70 dBZ

     Чёрный / 0 исходного grayscale =
     полностью прозрачный.

     Цвета подобраны непосредственно по
     присланной пользователем легенде.
     ======================================================= */

  const REFLECTIVITY_PALETTE = [

    "#dadada", // empty

    "#e4e4e4", // -30 dBZ

    "#c0c0c0", // -10 dBZ

    "#c9dced", // -5 dBZ

    "#e3fdbe", // 0 dBZ

    "#a3fb83", // 5 dBZ

    "#6ebff7", // 10 dBZ

    "#5880f7", // 15 dBZ

    "#4d4cd4", // 20 dBZ

    "#4b4c9f", // 25 dBZ

    "#fffe6e", // 30 dBZ

    "#f1a75c", // 35 dBZ

    "#ed7e77", // 40 dBZ

    "#eb5a55", // 45 dBZ

    "#98e364", // 50 dBZ

    "#6fbf5c", // 55 dBZ

    "#e459f0", // 60 dBZ

    "#b454f4", // 65 dBZ

    "#91504e"  // 70 dBZ

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
    REFLECTIVITY_PALETTE.map(
      hex => ({
        r: parseInt(
          hex.slice(1, 3),
          16
        ),

        g: parseInt(
          hex.slice(3, 5),
          16
        ),

        b: parseInt(
          hex.slice(5, 7),
          16
        )
      })
    );


  /* =======================================================
     STATE
     ======================================================= */

  let rainRadarNav =
    null;

  let rainRadarLayer =
    null;

  let timestamps =
    [];

  let currentIndex =
    -1;

  let active =
    false;

  let loading =
    false;

  let refreshTimer =
    null;

  let playbackTimer =
    null;

  let playback =
    false;

  let playbackBusy =
    false;

  let requestId =
    0;

  let suppressTimelineInput =
    false;

  let settingsControl =
    null;


  /*
   * Исходные grayscale-данные.
   *
   * timestamp/z/x/y -> ImageData
   */

  const grayscaleCache =
    new Map();


  /*
   * Цветные тайлы.
   *
   * timestamp/z/x/y/boost -> canvas
   */

  const coloredCache =
    new Map();


  const MAX_CACHE_ITEMS =
    600;


  /* =======================================================
     LEGEND STATE
     ======================================================= */

  let originalLegend =
    null;

  let legendSaved =
    false;


  /* =======================================================
     BASIC HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(
      id
    );
  }


  function getMap() {
    return window.map || null;
  }


  function showMessage(
    text
  ) {

    if (
      typeof window.msg ===
      "function"
    ) {
      window.msg(text);
      return;
    }

    const el =
      document.createElement(
        "div"
      );

    el.textContent =
      text;

    el.style.cssText =
      [
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

    document.body.appendChild(
      el
    );

    setTimeout(
      () => el.remove(),
      2200
    );
  }


  /* =======================================================
     FORCE SHARP LEAFLET RENDERING
     ======================================================= */

  function installSharpRendering() {

    if (
      document.getElementById(
        "cloradRainRadarSharpCSS"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "cloradRainRadarSharpCSS";

    style.textContent = `

      .leaflet-layer canvas,
      .leaflet-tile-container canvas,
      .leaflet-tile-container img,
      .leaflet-image-layer {
        image-rendering:
          pixelated !important;

        image-rendering:
          -moz-crisp-edges !important;

        -ms-interpolation-mode:
          nearest-neighbor !important;
      }

      canvas.clorad-rainradar-tile {
        image-rendering:
          pixelated !important;

        image-rendering:
          -moz-crisp-edges !important;

        -ms-interpolation-mode:
          nearest-neighbor !important;

        backface-visibility:
          hidden !important;

        display:
          block !important;
      }

    `;

    document.head.appendChild(
      style
    );
  }


  /* =======================================================
     CACHE MANAGEMENT
     ======================================================= */

  function trimMapCache(
    cache
  ) {

    while (
      cache.size >
      MAX_CACHE_ITEMS
    ) {

      const first =
        cache.keys()
          .next()
          .value;

      if (
        first === undefined
      ) {
        break;
      }

      cache.delete(
        first
      );
    }
  }


  /* =======================================================
     BOOST CURVE
     ======================================================= */

  function getGamma(
    boost
  ) {

    return Math.max(
      0.22,
      1.02 -
      (
        boost *
        0.033
      )
    );
  }


  function boostValue(
    value
  ) {

    if (
      value <= 0
    ) {
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
          corrected *
          255
        )
      )
    );
  }


  /* =======================================================
     PALETTE INDEX
     ======================================================= */

  function valueToPaletteIndex(
    value
  ) {

    if (
      value <= 0
    ) {
      return -1;
    }

    const index =
      Math.floor(
        (
          value *
          COLOR_LEVELS
        ) / 256
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
     COLORIZE IMAGE DATA
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

    canvas.width =
      width;

    canvas.height =
      height;

    canvas.className =
      "clorad-rainradar-tile";

    const ctx =
      canvas.getContext(
        "2d"
      );

    if (
      !ctx
    ) {
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
       * Чёрный фон =
       * прозрачность.
       */

      if (
        sourceValue <= 0
      ) {

        dst[i] =
          0;

        dst[i + 1] =
          0;

        dst[i + 2] =
          0;

        dst[i + 3] =
          0;

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

        dst[i + 3] =
          0;

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

    /*
     * Пиксель-в-пиксель.
     * Никакого resize.
     */

    ctx.putImageData(
      output,
      0,
      0
    );

    return canvas;
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
      grayscaleCache.get(
        key
      );

    if (
      cached
    ) {
      return Promise.resolve(
        cached
      );
    }

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const image =
          new Image();

        image.crossOrigin =
          "anonymous";

        image.decoding =
          "async";

        image.onload =
          () => {

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

              if (
                !ctx
              ) {
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

              trimMapCache(
                grayscaleCache
              );

              resolve(
                imageData
              );

            } catch (
              error
            ) {

              reject(
                error
              );
            }
          };

        image.onerror =
          () => {

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

    const cacheKey =
      `${timestamp}/${coords.z}/${coords.x}/${coords.y}/${rainRadarBoost}`;

    const cached =
      coloredCache.get(
        cacheKey
      );

    if (
      cached
    ) {
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
      cacheKey,
      canvas
    );

    trimMapCache(
      coloredCache
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
     LEGEND HELPERS
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

    let safety =
      0;

    while (
      node &&
      safety < 10
    ) {

      if (
        node.contains(
          last
        )
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

    if (
      legendSaved
    ) {
      return;
    }

    const container =
      findLegendContainer();

    if (
      !container
    ) {
      return;
    }

    originalLegend = {
      container,

      html:
        container.innerHTML
    };

    legendSaved =
      true;
  }


  function replaceLegendText(
    root,
    oldText,
    newText
  ) {

    if (
      !root
    ) {
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
      node =
        walker.nextNode()
    ) {
      nodes.push(
        node
      );
    }

    for (
      const textNode of
      nodes
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

    let safety =
      0;

    while (
      row &&
      safety < 5
    ) {

      const text =
        row.textContent || "";

      /*
       * Обычно строка легенды содержит
       * цветной блок + подпись.
       */

      if (
        text.trim().length > 0
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

    if (
      !row
    ) {
      return false;
    }

    /*
     * Сначала ищем обычные текстовые
     * элементы рядом с цветным блоком.
     */

    const elements =
      row.querySelectorAll(
        "span,div,label,p,b,strong"
      );

    for (
      const element of
      elements
    ) {

      if (
        element.classList.contains(
          "l1"
        ) ||
        element.classList.contains(
          "l2"
        ) ||
        element.classList.contains(
          "l3"
        ) ||
        element.classList.contains(
          "l4"
        ) ||
        element.classList.contains(
          "l5"
        ) ||
        element.classList.contains(
          "l6"
        ) ||
        element.classList.contains(
          "l7"
        ) ||
        element.classList.contains(
          "l8"
        ) ||
        element.classList.contains(
          "l9"
        ) ||
        element.classList.contains(
          "l10"
        ) ||
        element.classList.contains(
          "l11"
        ) ||
        element.classList.contains(
          "l12"
        ) ||
        element.classList.contains(
          "l13"
        ) ||
        element.classList.contains(
          "l14"
        ) ||
        element.classList.contains(
          "l15"
        ) ||
        element.classList.contains(
          "l16"
        ) ||
        element.classList.contains(
          "l17"
        ) ||
        element.classList.contains(
          "l18"
        ) ||
        element.classList.contains(
          "l19"
        )
      ) {
        continue;
      }

      if (
        element.children.length === 0 &&
        element.textContent.trim()
      ) {

        element.textContent =
          label;

        return true;
      }
    }

    /*
     * Второй вариант:
     * ищем текстовые узлы непосредственно
     * в строке.
     */

    const walker =
      document.createTreeWalker(
        row,
        NodeFilter.SHOW_TEXT
      );

    const nodes = [];

    let node;

    while (
      node =
        walker.nextNode()
    ) {

      const text =
        node.nodeValue.trim();

      if (
        text
      ) {
        nodes.push(
          node
        );
      }
    }

    if (
      nodes.length
    ) {

      const target =
        nodes[
          nodes.length - 1
        ];

      target.nodeValue =
        label;

      return true;
    }

    return false;
  }


  function applyReflectivityLegend() {

    saveOriginalLegend();

    const legend =
      findLegendContainer();

    if (
      !legend
    ) {
      return;
    }

    /*
     * Меняем ОЯ → О.
     */

    replaceLegendText(
      legend,
      "ОЯ",
      "О"
    );


    /*
     * Меняем все 19 цветовых блоков.
     */

    for (
      let i = 1;
      i <= 19;
      i++
    ) {

      const swatch =
        legend.querySelector(
          `.l${i}`
        );

      if (
        !swatch
      ) {
        continue;
      }

      const color =
        REFLECTIVITY_PALETTE[
          i - 1
        ];

      /*
       * Не меняем структуру HTML.
       * Только внешний цвет.
       */

      swatch.style.background =
        color;

      swatch.style.backgroundColor =
        color;

      swatch.style.backgroundImage =
        "none";

      /*
       * Если внутри swatch есть
       * цветовой элемент.
       */

      const inner =
        swatch.querySelector(
          "*"
        );

      if (
        inner
      ) {
        inner.style.background =
          color;

        inner.style.backgroundColor =
          color;

        inner.style.backgroundImage =
          "none";
      }

      /*
       * Если .lN сам является строкой
       * с текстом — меняем его.
       */

      if (
        swatch.textContent.trim()
      ) {

        /*
         * Не трогаем текст, если внутри
         * находятся отдельные элементы.
         */

        if (
          swatch.children.length ===
          0
        ) {

          swatch.textContent =
            REFLECTIVITY_LABELS[
              i - 1
            ];
        }
      }


      /*
       * Если подпись находится рядом
       * с цветным квадратом.
       */

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


    /*
     * Заголовок:
     *
     * О
     * Отражаемость
     *
     * Не создаём отдельную панель —
     * используем существующую.
     */

    replaceLegendText(
      legend,
      "ОЯ",
      "О"
    );


    /*
     * Дополнительные возможные подписи.
     */

    const titleCandidates =
      legend.querySelectorAll(
        ".legend-title," +
        ".legend-header," +
        ".legendTitle," +
        ".legendHeader," +
        "h3," +
        "h4"
      );

    for (
      const title of
      titleCandidates
    ) {

      const text =
        title.textContent.trim();

      if (
        text === "ОЯ"
      ) {

        title.textContent =
          "О";
      }
    }
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

    if (
      !container
    ) {
      return;
    }

    /*
     * Возвращаем легенду полностью
     * в состояние до открытия RainRadar.
     */

    container.innerHTML =
      originalLegend.html;
  }


  /* =======================================================
     NAV
     ======================================================= */

  function createNav() {

    const existing =
      $("rainRadarNav");

    if (
      existing
    ) {

      rainRadarNav =
        existing;

      if (
        existing.dataset.rainRadarClick !==
        "1"
      ) {

        existing.dataset.rainRadarClick =
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

    if (
      !rainButton
    ) {
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

    rainRadarNav.innerHTML =
      `
        <svg viewBox="0 0 24 24">
          <path d="M4 17h16M4 12h16M4 7h16"/>
        </svg>
        RainRadar
      `;


    rainButton.insertAdjacentElement(
      "afterend",
      rainRadarNav
    );


    rainRadarNav.dataset.rainRadarClick =
      "1";


    rainRadarNav.onclick =
      event => {

        event.stopPropagation();

        activate();

        showRainRadar();
      };
  }


  /* =======================================================
     ACTIVATE
     ======================================================= */

  function activate() {

    /*
     * Новый запрос RainRadar.
     */

    ++requestId;

    active =
      true;

    stopPlayback();


    /*
     * Убираем active у других
     * пунктов навигации.
     */

    document
      .querySelectorAll(
        ".nav .n"
      )
      .forEach(
        button => {

          button.classList.remove(
            "active"
          );
        }
      );


    if (
      rainRadarNav
    ) {

      rainRadarNav.classList.add(
        "active"
      );
    }


    /*
     * Переключаем легенду:
     *
     * ОЯ → О
     */

    applyReflectivityLegend();


    /*
     * Останавливаем другие радарные
     * системы.
     */

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
  }


  /* =======================================================
     STOP WHEN ANOTHER NAV LAYER OPENS
     ======================================================= */

  function hookOtherLayers() {

    const nav =
      document.querySelector(
        ".nav"
      );

    if (
      !nav ||
      nav.dataset.rainRadarOtherLayersHooked
    ) {
      return;
    }


    nav.dataset.rainRadarOtherLayersHooked =
      "1";


    /*
     * Capture-фаза.
     *
     * RainRadar отключается ДО того,
     * как другой обработчик слоя
     * начнёт свою работу.
     */

    nav.addEventListener(
      "click",
      event => {

        const button =
          event.target.closest(
            ".nav .n"
          );

        if (
          !button
        ) {
          return;
        }


        /*
         * Сам RainRadar.
         */

        if (
          button.id ===
          "rainRadarNav"
        ) {
          return;
        }


        /*
         * Любой другой слой:
         *
         * RainRadar полностью убирается.
         * Легенда возвращается ОЯ.
         */

        if (
          active ||
          rainRadarLayer
        ) {

          stop();
        }

      },
      true
    );


    /*
     * Также отслеживаем программное
     * изменение .active.
     */

    if (
      typeof MutationObserver !==
      "undefined"
    ) {

      const observer =
        new MutationObserver(
          () => {

            if (
              !active
            ) {
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
          subtree:
            true,

          attributes:
            true,

          attributeFilter:
            [
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
        function(
          options
        ) {

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

          this._rainRadarRequestId =
            requestId;
        },


      /* ---------------------------------------------------
         CREATE TILE
         --------------------------------------------------- */

      createTile:
        function(
          coords,
          done
        ) {

          const tile =
            document.createElement(
              "canvas"
            );

          tile.width =
            256;

          tile.height =
            256;

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


          if (
            !ctx
          ) {

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


          const layerRequestId =
            this._rainRadarRequestId;


          buildColoredTile(
            timestamp,
            coords
          )
            .then(
              canvas => {

                /*
                 * Если RainRadar уже выключен
                 * или это старый запрос —
                 * ничего обратно не рисуем.
                 */

                if (
                  !active ||
                  layerRequestId !==
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
                  256,
                  256
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
              }
            )
            .catch(
              error => {

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
              }
            );


          return tile;
        },


      /* ---------------------------------------------------
         ON ADD
         --------------------------------------------------- */

      onAdd:
        function(
          map
        ) {

          this._frameReady =
            false;

          this._pendingTiles.clear();

          this._failedTiles.clear();

          L.GridLayer.prototype.onAdd.call(
            this,
            map
          );

          this.setOpacity(
            0
          );
        },


      /* ---------------------------------------------------
         CHECK FRAME
         --------------------------------------------------- */

      _checkReady:
        function() {

          if (
            this._frameReady
          ) {
            return;
          }


          if (
            this._pendingTiles.size !==
            0
          ) {
            return;
          }


          /*
           * Даже если один tile не загрузился,
           * не показываем неполный кадр.
           */

          if (
            this._failedTiles.size
          ) {

            this._frameReady =
              true;

            this.fire(
              "frameready",
              {
                ready:
                  false,

                failed:
                  this._failedTiles.size
              }
            );

            return;
          }


          this._frameReady =
            true;


          this.fire(
            "frameready",
            {
              ready:
                true,

              failed:
                0
            }
          );
        }

    });


  /* =======================================================
     CREATE FRAME LAYER
     ======================================================= */

  function createLayer(
    timestamp
  ) {

    const map =
      getMap();

    if (
      !map
    ) {
      throw new Error(
        "Leaflet map не найден"
      );
    }


    const oldLayer =
      rainRadarLayer;


    const layerId =
      ++requestId;


    const layer =
      new RainRadarLayer({

        tileSize:
          256,

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

        noWrap:
          true,

        zIndex:
          620,

        keepBuffer:
          1,

        updateWhenIdle:
          true,

        updateWhenZooming:
          false,

        updateInterval:
          100,

        timestamp:
          timestamp

      });


    layer.setOpacity(
      0
    );


    rainRadarLayer =
      layer;


    layer.once(
      "frameready",
      event => {

        /*
         * Старый / отменённый кадр.
         */

        if (
          layerId !==
            requestId ||
          !active
        ) {

          if (
            map.hasLayer(
              layer
            )
          ) {

            map.removeLayer(
              layer
            );
          }

          return;
        }


        /*
         * Неполный кадр.
         */

        if (
          !event.ready
        ) {

          if (
            map.hasLayer(
              layer
            )
          ) {

            map.removeLayer(
              layer
            );
          }


          if (
            rainRadarLayer ===
            layer
          ) {

            rainRadarLayer =
              oldLayer ||
              null;
          }


          showMessage(
            "Кадр RainRadar загружен не полностью"
          );

          return;
        }


        /*
         * Новый кадр полностью готов.
         */

        layer.setOpacity(
          1
        );


        /*
         * Теперь удаляем старый.
         */

        if (
          oldLayer &&
          oldLayer !==
            layer &&
          map.hasLayer(
            oldLayer
          )
        ) {

          map.removeLayer(
            oldLayer
          );
        }

      }
    );


    layer.addTo(
      map
    );


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

        .map(
          frame => {

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
          }
        )

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
     SHOW RAINRADAR
     ======================================================= */

  async function showRainRadar() {

    if (
      loading
    ) {
      return;
    }


    const map =
      getMap();


    if (
      !map
    ) {

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


      if (
        !active
      ) {
        return;
      }


      currentIndex =
        timestamps.length - 1;


      updateTimeline();


      await setFrame(
        currentIndex
      );


      if (
        !active
      ) {
        return;
      }


      startRefresh();


      showMessage(
        `RainRadar загружен · накрутка ${rainRadarBoost}`
      );

    } catch (
      error
    ) {

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
     SET FRAME
     ======================================================= */

  async function setFrame(
    index
  ) {

    if (
      !timestamps.length ||
      !active
    ) {

      return false;
    }


    index =
      Math.max(
        0,
        Math.min(
          timestamps.length - 1,
          Number(index)
        )
      );


    currentIndex =
      index;


    updateTimeline();


    const timestamp =
      timestamps[
        currentIndex
      ];


    const layer =
      createLayer(
        timestamp
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


            resolve(
              Boolean(
                event?.ready
              )
            );
          };


        layer.once(
          "frameready",
          finish
        );


        if (
          layer._frameReady
        ) {

          finish({
            ready:
              layer._failedTiles.size ===
              0
          });
        }

      }
    );
  }


  /* =======================================================
     TIMELINE
     ======================================================= */

  function updateTimeline() {

    const range =
      document.querySelector(
        ".timeline input[type='range']"
      );


    if (
      !range
    ) {
      return;
    }


    suppressTimelineInput =
      true;


    range.min =
      "0";


    range.max =
      String(
        Math.max(
          0,
          timestamps.length - 1
        )
      );


    range.step =
      "1";


    range.value =
      String(
        Math.max(
          0,
          currentIndex
        )
      );


    range.disabled =
      timestamps.length <= 1;


    suppressTimelineInput =
      false;
  }


  /* =======================================================
     PLAY BUTTON
     ======================================================= */

  function findPlayButton() {

    const timeline =
      document.querySelector(
        ".timeline"
      );


    if (
      !timeline
    ) {
      return null;
    }


    return timeline.querySelector(
      [
        "button",
        ".play",
        "[data-action='play']",
        "[aria-label*='play' i]"
      ].join(",")
    );
  }


  function updatePlayButton() {

    const button =
      findPlayButton();


    if (
      !button
    ) {
      return;
    }


    button.classList.toggle(
      "active",
      playback
    );


    button.setAttribute(
      "aria-pressed",
      playback
        ? "true"
        : "false"
    );
  }


  /* =======================================================
     STOP PLAYBACK
     ======================================================= */

  function stopPlayback() {

    playback =
      false;

    playbackBusy =
      false;


    if (
      playbackTimer
    ) {

      clearInterval(
        playbackTimer
      );
    }


    playbackTimer =
      null;


    updatePlayButton();
  }


  /* =======================================================
     START PLAYBACK
     ======================================================= */

  function startPlayback() {

    if (
      timestamps.length < 2 ||
      !active
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
      setInterval(
        async () => {

          if (
            !active
          ) {

            stopPlayback();

            return;
          }


          if (
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

            await setFrame(
              next
            );

          } finally {

            playbackBusy =
              false;
          }

        },
        700
      );
  }


  /* =======================================================
     TOGGLE PLAYBACK
     ======================================================= */

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
     TIMELINE HOOK
     ======================================================= */

  function hookTimeline() {

    const range =
      document.querySelector(
        ".timeline input[type='range']"
      );


    if (
      range &&
      !range.dataset.rainRadarHooked
    ) {

      range.dataset.rainRadarHooked =
        "1";


      range.addEventListener(
        "input",
        () => {

          if (
            !active ||
            suppressTimelineInput
          ) {
            return;
          }


          stopPlayback();


          setFrame(
            Number(
              range.value
            )
          );

        }
      );
    }


    const timeline =
      document.querySelector(
        ".timeline"
      );


    if (
      timeline &&
      !timeline.dataset.rainRadarPlayHooked
    ) {

      const buttons =
        timeline.querySelectorAll(
          [
            "button",
            ".play",
            "[data-action='play']",
            "[aria-label*='play' i]"
          ].join(",")
        );


      if (
        buttons.length
      ) {

        buttons[0].addEventListener(
          "click",
          event => {

            if (
              !active
            ) {
              return;
            }


            event.preventDefault();

            event.stopPropagation();


            togglePlayback();

          }
        );


        timeline.dataset.rainRadarPlayHooked =
          "1";
      }
    }


    updateTimeline();
  }


  /* =======================================================
     RAINRADAR SETTINGS
     ======================================================= */

  function findSettingsContainer() {

    return $(
      "settings"
    );
  }


  function createRainRadarSettings() {

    const settings =
      findSettingsContainer();


    if (
      !settings
    ) {
      return;
    }


    let existing =
      settings.querySelector(
        "#cloradRainRadarSetting"
      );


    if (
      existing
    ) {

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


    head.innerHTML =
      `
        <span>Накрутка RainRadar</span>

        <span
          class="settingArrow"
          id="cloradRainRadarArrow"
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


  /* =======================================================
     SYNC BOOST SETTINGS UI
     ======================================================= */

  function syncBoostUI() {

    const range =
      document.getElementById(
        "cloradRainRadarBoostRange"
      );


    const value =
      document.getElementById(
        "cloradRainRadarBoostValue"
      );


    if (
      range
    ) {

      range.value =
        String(
          selectedBoost
        );
    }


    if (
      value
    ) {

      value.textContent =
        String(
          selectedBoost
        );
    }
  }


  /* =======================================================
     APPLY BOOST
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


    coloredCache.clear();


    refreshCurrentFrameInstant();


    showMessage(
      `Накрутка RainRadar применена: ${rainRadarBoost}`
    );
  }


  /* =======================================================
     INSTANT CURRENT FRAME REFRESH
     ======================================================= */

  function refreshCurrentFrameInstant() {

    if (
      !active ||
      currentIndex < 0 ||
      !timestamps.length
    ) {
      return;
    }


    const timestamp =
      timestamps[
        currentIndex
      ];


    const layer =
      rainRadarLayer;


    if (
      !layer ||
      !layer._tiles
    ) {

      setFrame(
        currentIndex
      );

      return;
    }


    const tiles =
      Object.values(
        layer._tiles
      );


    if (
      !tiles.length
    ) {

      setFrame(
        currentIndex
      );

      return;
    }


    layer.setOpacity(
      0
    );


    let pending =
      tiles.length;


    let failed =
      false;


    for (
      const item of
      tiles
    ) {

      const tile =
        item.el;


      const coords =
        item.coords;


      if (
        !tile ||
        !coords
      ) {

        pending--;

        continue;
      }


      buildColoredTile(
        timestamp,
        coords
      )
        .then(
          canvas => {

            if (
              !active
            ) {
              return;
            }


            const ctx =
              tile.getContext(
                "2d"
              );


            if (
              !ctx
            ) {

              failed =
                true;

              pending--;

              return;
            }


            ctx.imageSmoothingEnabled =
              false;


            ctx.clearRect(
              0,
              0,
              256,
              256
            );


            ctx.drawImage(
              canvas,
              0,
              0
            );


            pending--;


            if (
              pending <= 0
            ) {

              layer.setOpacity(
                failed
                  ? 0
                  : 1
              );
            }

          }
        )
        .catch(
          error => {

            console.warn(
              "RainRadar boost:",
              error
            );


            failed =
              true;


            pending--;


            if (
              pending <= 0
            ) {

              layer.setOpacity(
                0
              );
            }
          }
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


            if (
              !active
            ) {
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


              if (
                wasPlaying
              ) {

                stopPlayback();
              }


              currentIndex =
                timestamps.length - 1;


              updateTimeline();


              await setFrame(
                currentIndex
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

          } catch (
            error
          ) {

            console.warn(
              "RainRadar refresh:",
              error
            );
          }

        },
        REFRESH_TIME
      );
  }


  /* =======================================================
     STOP REFRESH
     ======================================================= */

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

    /*
     * Полностью выключаем RainRadar.
     */

    active =
      false;


    loading =
      false;


    stopPlayback();


    stopRefresh();


    ++requestId;


    const map =
      getMap();


    /*
     * Удаляем текущий слой.
     */

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


    /*
     * На всякий случай удаляем
     * все оставшиеся RainRadar layers.
     */

    if (
      map
    ) {

      const toRemove =
        [];


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
        const layer of
        toRemove
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


    /*
     * Сбрасываем активный пункт
     * RainRadar.
     */

    if (
      rainRadarNav
    ) {

      rainRadarNav.classList.remove(
        "active"
      );
    }


    /*
     * ГЛАВНОЕ:
     *
     * RainRadar → О
     *
     * другой слой → ОЯ
     */

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


    createNav();


    hookTimeline();


    hookOtherLayers();


    createRainRadarSettings();


    setTimeout(
      () => {

        createNav();

        hookTimeline();

        hookOtherLayers();

        createRainRadarSettings();

      },
      300
    );


    setTimeout(
      () => {

        createNav();

        hookTimeline();

        hookOtherLayers();

        createRainRadarSettings();

      },
      800
    );


    setTimeout(
      () => {

        createNav();

        hookTimeline();

        hookOtherLayers();

        createRainRadarSettings();

      },
      1500
    );


    setTimeout(
      () => {

        createNav();

        hookTimeline();

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
        once:
          true
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
