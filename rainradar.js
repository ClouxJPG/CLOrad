/* =========================================================
   CLOrad — RainRadar Russia Composite

   RainRadar:
   - grayscale source
   - reflectivity palette
   - black = transparent
   - nearest-neighbor / pixelated rendering
   - square pixels
   - ATOMIC FRAME SWITCHING
   - frame timeline
   - playback
   - automatic refresh
   - отключение при открытии другого слоя

   Настройки:
   - Накрутка RainRadar: 1..30
   - По умолчанию: 23
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
    REFLECTIVITY_PALETTE.map(
      hex => ({

        r:
          parseInt(
            hex.slice(1, 3),
            16
          ),

        g:
          parseInt(
            hex.slice(3, 5),
            16
          ),

        b:
          parseInt(
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


  /*
   * ВАЖНО:
   *
   * displayedLayer =
   * реально видимый текущий кадр.
   *
   * pendingLayer =
   * кадр, который сейчас загружается.
   *
   * Они НИКОГДА не должны быть одной
   * переменной до момента успешной загрузки.
   */

  let displayedLayer =
    null;

  let pendingLayer =
    null;


  /*
   * Все RainRadar-слои, созданные
   * этим скриптом.
   *
   * Используется для гарантированного
   * удаления старых/отменённых слоёв.
   */

  const rainRadarLayers =
    new Set();


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
   * Последний запрошенный индекс.
   *
   * currentIndex меняется только после
   * успешной полной загрузки кадра.
   */

  let requestedIndex =
    -1;


  /*
   * Последний timestamp, для которого
   * выполняется загрузка.
   */

  let pendingTimestamp =
    null;


  /* =======================================================
     CACHE
     ======================================================= */

  const grayscaleCache =
    new Map();


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
     SHARP RENDERING
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
     BOOST
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


    const elements =
      row.querySelectorAll(
        "span,div,label,p,b,strong"
      );


    for (
      const element of
      elements
    ) {

      if (
        /^l\d+$/.test(
          [...element.classList].find(
            cls =>
              /^l\d+$/.test(cls)
          ) || ""
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

      if (
        node.nodeValue.trim()
      ) {

        nodes.push(
          node
        );
      }
    }


    if (
      nodes.length
    ) {

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


    if (
      !legend
    ) {
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


      if (
        !swatch
      ) {
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


      if (
        swatch.textContent.trim() &&
        swatch.children.length === 0
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

      if (
        title.textContent.trim() ===
        "ОЯ"
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

    ++requestId;


    active =
      true;


    stopPlayback();


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
  }


  /* =======================================================
     OTHER NAV LAYERS
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


        if (
          button.id ===
          "rainRadarNav"
        ) {
          return;
        }


        if (
          active ||
          displayedLayer ||
          pendingLayer
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
            options.layerRequestId ||
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
                 * Кадр уже отменён.
                 *
                 * Ничего не рисуем.
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


          /*
           * Новый кадр ВСЕГДА невидимый
           * до полного завершения.
           */

          this.setOpacity(
            0
          );
        },


      /* ---------------------------------------------------
         CHECK READY
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


          this._frameReady =
            true;


          if (
            this._failedTiles.size
          ) {

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
     REMOVE LAYER SAFELY
     ======================================================= */

  function removeRainRadarLayer(
    layer
  ) {

    if (
      !layer
    ) {
      return;
    }


    const map =
      getMap();


    if (
      map &&
      map.hasLayer(layer)
    ) {

      try {

        map.removeLayer(
          layer
        );

      } catch {}
    }


    rainRadarLayers.delete(
      layer
    );
  }


  /* =======================================================
     REMOVE ALL NON-DISPLAYED LAYERS
     ======================================================= */

  function removeCancelledLayers(
    exceptLayer = null
  ) {

    const map =
      getMap();


    if (
      !map
    ) {
      return;
    }


    for (
      const layer of
      [...rainRadarLayers]
    ) {

      if (
        layer ===
        exceptLayer
      ) {
        continue;
      }


      /*
       * displayedLayer специально
       * не удаляем здесь.
       */

      if (
        layer ===
        displayedLayer
      ) {
        continue;
      }


      removeRainRadarLayer(
        layer
      );
    }
  }


  /* =======================================================
     CREATE PENDING FRAME
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


    const layerRequestId =
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
          timestamp,

        layerRequestId:
          layerRequestId

      });


    layer.setOpacity(
      0
    );


    pendingLayer =
      layer;


    pendingTimestamp =
      timestamp;


    rainRadarLayers.add(
      layer
    );


    layer.once(
      "frameready",
      event => {

        /*
         * Этот кадр уже не является
         * актуальным.
         */

        if (
          layerRequestId !==
            requestId ||
          !active ||
          pendingLayer !==
            layer
        ) {

          removeRainRadarLayer(
            layer
          );

          return;
        }


        /*
         * Неполный кадр.
         *
         * Старый отображаемый кадр
         * остаётся нетронутым.
         */

        if (
          !event.ready
        ) {

          removeRainRadarLayer(
            layer
          );


          if (
            pendingLayer ===
            layer
          ) {

            pendingLayer =
              null;

            pendingTimestamp =
              null;
          }


          showMessage(
            "Кадр RainRadar загружен не полностью"
          );


          return;
        }


        /*
         * =================================================
         * АТОМАРНЫЙ SWITCH
         * =================================================
         *
         * Новый слой уже полностью готов.
         *
         * Сначала делаем его видимым.
         * Затем убираем старый.
         *
         * Поэтому карта никогда не остаётся
         * без кадра.
         */

        layer.setOpacity(
          1
        );


        const oldDisplayed =
          displayedLayer;


        displayedLayer =
          layer;


        pendingLayer =
          null;


        pendingTimestamp =
          null;


        currentIndex =
          requestedIndex;


        updateTimeline();


        /*
         * Теперь старый кадр больше не нужен.
         */

        if (
          oldDisplayed &&
          oldDisplayed !==
            layer
        ) {

          removeRainRadarLayer(
            oldDisplayed
          );
        }


        /*
         * Удаляем любые старые
         * отменённые pending-слои.
         */

        removeCancelledLayers(
          layer
        );
      }
    );


    layer.addTo(
      map
    );


    return {
      layer,
      requestId:
        layerRequestId
    };
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


      requestedIndex =
        timestamps.length - 1;


      updateTimeline();


      await setFrame(
        requestedIndex
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
     ATOMIC SET FRAME
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


    requestedIndex =
      index;


    updateTimeline();


    const timestamp =
      timestamps[
        index
      ];


    /*
     * Новый запрос автоматически
     * отменяет предыдущий pending-кадр.
     *
     * ВАЖНО:
     * displayedLayer при этом НЕ трогаем.
     */

    ++requestId;


    const map =
      getMap();


    if (
      !map
    ) {
      return false;
    }


    /*
     * Удаляем только старый pending.
     * Видимый displayedLayer сохраняем.
     */

    if (
      pendingLayer
    ) {

      removeRainRadarLayer(
        pendingLayer
      );

      pendingLayer =
        null;

      pendingTimestamp =
        null;
    }


    /*
     * Удаляем другие случайные
     * старые pending-слои.
     */

    removeCancelledLayers(
      displayedLayer
    );


    const result =
      createLayer(
        timestamp
      );


    const layer =
      result.layer;


    const layerRequestId =
      result.requestId;


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


            if (
              layerRequestId !==
                requestId ||
              !active
            ) {

              resolve(
                false
              );

              return;
            }


            if (
              !event?.ready
            ) {

              resolve(
                false
              );

              return;
            }


            resolve(
              true
            );
          };


        layer.once(
          "frameready",
          finish
        );


        /*
         * Теоретически слой может завершиться
         * ещё до установки listener.
         */

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


    const visibleIndex =
      requestedIndex >= 0
        ? requestedIndex
        : currentIndex;


    range.value =
      String(
        Math.max(
          0,
          visibleIndex
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

        /*
         * Интервал больше не отвечает
         * за скорость кадров.
         *
         * Он просто запускает следующий
         * переход, а setFrame ждёт полной
         * готовности.
         */

        150
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


          const index =
            Number(
              range.value
            );


          /*
           * Старый кадр остаётся видимым.
           *
           * Новый появится только после
           * полной загрузки.
           */

          setFrame(
            index
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
     SETTINGS
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
     BOOST UI
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


    /*
     * Перерисовываем текущий кадр
     * атомарно.
     *
     * Старый остаётся видимым,
     * пока новый вариант не готов.
     */

    if (
      active &&
      currentIndex >= 0
    ) {

      setFrame(
        currentIndex
      );
    }


    showMessage(
      `Накрутка RainRadar применена: ${rainRadarBoost}`
    );
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


              requestedIndex =
                timestamps.length - 1;


              updateTimeline();


              await setFrame(
                requestedIndex
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
     * Сначала инвалидируем ВСЕ
     * асинхронные загрузки.
     */

    ++requestId;


    active =
      false;


    loading =
      false;


    stopPlayback();


    stopRefresh();


    const map =
      getMap();


    /*
     * Удаляем абсолютно все
     * RainRadar layers.
     */

    if (
      map
    ) {

      for (
        const layer of
        [...rainRadarLayers]
      ) {

        try {

          if (
            map.hasLayer(layer)
          ) {

            map.removeLayer(
              layer
            );
          }

        } catch {}
      }


      /*
       * Дополнительная страховка:
       * если какой-то слой каким-либо
       * образом не попал в Set.
       */

      const extraLayers =
        [];


      map.eachLayer(
        layer => {

          if (
            layer instanceof
            RainRadarLayer
          ) {

            extraLayers.push(
              layer
            );
          }
        }
      );


      for (
        const layer of
        extraLayers
      ) {

        try {

          map.removeLayer(
            layer
          );

        } catch {}
      }
    }


    rainRadarLayers.clear();


    displayedLayer =
      null;


    pendingLayer =
      null;


    pendingTimestamp =
      null;


    requestedIndex =
      currentIndex;


    /*
     * RainRadar button.
     */

    if (
      rainRadarNav
    ) {

      rainRadarNav.classList.remove(
        "active"
      );
    }


    /*
     * О → ОЯ
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


    stop:
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
