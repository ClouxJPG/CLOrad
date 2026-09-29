/* =========================================================
   CLOrad — RainRadar Russia Composite
   Стабильный кадровый renderer

   ГЛАВНОЕ:
   - index.html НЕ ИЗМЕНЯЕТСЯ
   - API НЕ ИЗМЕНЯЕТСЯ
   - источник: rainradar.ru/composite
   - нативные тайлы: Z=5
   - RainRadarLayer создаётся ОДИН РАЗ
   - при смене кадра слой НЕ удаляется
   - map.setView НЕ вызывается
   - map.setZoom НЕ вызывается
   - fitBounds НЕ вызывается
   - invalidateSize НЕ вызывается
   - opacity НЕ используется для переключения кадров
   - никаких fade / transition
   - тайлы остаются строго в Leaflet-сетке
   - следующий кадр сначала загружается в память
   - затем содержимое существующих canvas
     заменяется атомарно
   - старые RainRadar layers не накапливаются
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

  const RR_NATIVE_ZOOM = 5;

  const MIN_ZOOM = 2;
  const MAX_ZOOM = 14;

  const REFRESH_TIME =
    60000;

  const BOOST_MIN = 1;
  const BOOST_MAX = 30;
  const BOOST_DEFAULT = 23;

  const BOOST_STORAGE_KEY =
    "clorad_rainradar_boost";

  const TILE_SIZE =
    256;

  /* =======================================================
     PALETTE
     ======================================================= */

  const PALETTE = [
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

  const LABELS = [
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

  const RGB =
    PALETTE.map(
      color => ({
        r: parseInt(
          color.slice(1, 3),
          16
        ),
        g: parseInt(
          color.slice(3, 5),
          16
        ),
        b: parseInt(
          color.slice(5, 7),
          16
        )
      })
    );

  /* =======================================================
     STATE
     ======================================================= */

  let boost =
    loadBoost();

  let selectedBoost =
    boost;

  let nav =
    null;

  let layer =
    null;

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

  let playing =
    false;

  let playbackBusy =
    false;

  let requestId =
    0;

  let frameRequestId =
    0;

  let savedRangeOnInput =
    null;

  let savedPlayOnClick =
    null;

  let timelineSaved =
    false;

  let originalLegend =
    null;

  let legendSaved =
    false;

  const grayCache =
    new Map();

  const colorCache =
    new Map();

  const MAX_CACHE =
    600;

  let displayedTimestamp =
    null;

  /* =======================================================
     DOM
     ======================================================= */

  const $ =
    id =>
      document.getElementById(
        id
      );

  function getMap() {
    return window.map || null;
  }

  /* =======================================================
     BOOST
     ======================================================= */

  function loadBoost() {
    try {
      const n =
        Number(
          localStorage.getItem(
            BOOST_STORAGE_KEY
          )
        );

      if (
        Number.isFinite(n)
      ) {
        return Math.max(
          BOOST_MIN,
          Math.min(
            BOOST_MAX,
            Math.round(n)
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
     MESSAGE
     ======================================================= */

  function msg(
    text
  ) {
    if (
      typeof window.msg ===
      "function"
    ) {
      window.msg(text);
      return;
    }

    const e =
      document.createElement(
        "div"
      );

    e.textContent =
      text;

    e.style.cssText =
      "position:fixed;" +
      "z-index:2147483646;" +
      "left:50%;" +
      "bottom:125px;" +
      "transform:translateX(-50%);" +
      "background:#202930;" +
      "color:#fff;" +
      "padding:9px 14px;" +
      "border-radius:8px;" +
      "border:1px solid #3d4850;" +
      "white-space:nowrap;" +
      "max-width:calc(100% - 30px);" +
      "overflow:hidden;" +
      "text-overflow:ellipsis;";

    document.body.appendChild(
      e
    );

    setTimeout(
      () => e.remove(),
      2200
    );
  }

  /* =======================================================
     CACHE
     ======================================================= */

  function trimCache(
    cache
  ) {
    while (
      cache.size >
      MAX_CACHE
    ) {
      const key =
        cache.keys().next().value;

      if (
        key === undefined
      ) {
        break;
      }

      cache.delete(
        key
      );
    }
  }

  /* =======================================================
     CSS
     ======================================================= */

  function installCSS() {
    if (
      $("cloradRainRadarCSS")
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "cloradRainRadarCSS";

    style.textContent = `
      /*
       * RainRadar не имеет собственных
       * переходов между кадрами.
       *
       * Zoom-трансформацию Leaflet
       * НЕ переопределяем.
       */
      .clorad-rainradar-layer,
      .clorad-rainradar-layer *,
      .clorad-rainradar-layer .leaflet-tile-container,
      .clorad-rainradar-layer .leaflet-layer {
        transition: none !important;
        animation: none !important;
      }

      .clorad-rainradar-layer {
        opacity: 1 !important;
      }

      /*
       * Leaflet полностью управляет:
       * - width
       * - height
       * - position
       * - transform
       * - zoom scaling
       *
       * Никаких ручных геометрических
       * переопределений здесь нет.
       */
      canvas.clorad-rainradar-tile {
        display: block !important;

        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;

        /*
         * Плавная интерполяция при zoom.
         */
        image-rendering: auto !important;

        transition: none !important;
        animation: none !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     COLOR
     ======================================================= */

  function gammaValue() {
    return Math.max(
      0.22,
      1.02 -
        boost * 0.033
    );
  }

  function boostedValue(
    value
  ) {
    if (
      value <= 0
    ) {
      return 0;
    }

    const result =
      Math.pow(
        value / 255,
        gammaValue()
      ) * 255;

    return Math.max(
      0,
      Math.min(
        255,
        Math.round(
          result
        )
      )
    );
  }

  function paletteIndex(
    value
  ) {
    if (
      value <= 0
    ) {
      return -1;
    }

    return Math.max(
      0,
      Math.min(
        PALETTE.length - 1,
        Math.floor(
          value *
            PALETTE.length /
            256
        )
      )
    );
  }

  function colorize(
    imageData
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      imageData.width;

    canvas.height =
      imageData.height;

    canvas.className =
      "clorad-rainradar-tile";

    const ctx =
      canvas.getContext(
        "2d"
      );

    if (!ctx) {
      throw Error(
        "Canvas 2D недоступен"
      );
    }

    ctx.imageSmoothingEnabled =
      false;

    const output =
      new ImageData(
        imageData.width,
        imageData.height
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
      const raw =
        src[i];

      if (
        raw <= 0
      ) {
        dst[i] = 0;
        dst[i + 1] = 0;
        dst[i + 2] = 0;
        dst[i + 3] = 0;

        continue;
      }

      const index =
        paletteIndex(
          boostedValue(
            raw
          )
        );

      const color =
        RGB[index];

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

  function tileURL(
    timestamp,
    coords
  ) {
    /*
     * Для RainRadar источник остаётся
     * нативным Z=5.
     *
     * coords.z здесь нормализуется
     * на уровне слоя, поэтому API
     * получает именно исходный Z=5.
     */
    return (
      API +
      "?timestamp=" +
      encodeURIComponent(
        timestamp
      ) +
      "&z=" +
      RR_NATIVE_ZOOM +
      "&x=" +
      coords.x +
      "&y=" +
      coords.y
    );
  }

  /* =======================================================
     LOAD GRAY TILE
     ======================================================= */

  function loadGrayTile(
    timestamp,
    coords
  ) {
    const key =
      `${timestamp}/${RR_NATIVE_ZOOM}/${coords.x}/${coords.y}`;

    if (
      grayCache.has(
        key
      )
    ) {
      return Promise.resolve(
        grayCache.get(
          key
        )
      );
    }

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const img =
          new Image();

        img.crossOrigin =
          "anonymous";

        img.decoding =
          "async";

        img.onload =
          () => {
            try {
              const width =
                img.naturalWidth ||
                TILE_SIZE;

              const height =
                img.naturalHeight ||
                TILE_SIZE;

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
                throw Error(
                  "Canvas 2D недоступен"
                );
              }

              ctx.imageSmoothingEnabled =
                false;

              ctx.drawImage(
                img,
                0,
                0
              );

              const data =
                ctx.getImageData(
                  0,
                  0,
                  width,
                  height
                );

              grayCache.set(
                key,
                data
              );

              trimCache(
                grayCache
              );

              resolve(
                data
              );

            } catch (
              error
            ) {
              reject(
                error
              );
            }
          };

        img.onerror =
          () => {
            reject(
              Error(
                "RainRadar tile unavailable"
              )
            );
          };

        img.src =
          tileURL(
            timestamp,
            coords
          );
      }
    );
  }

  /* =======================================================
     COLORED TILE
     ======================================================= */

  async function getColoredTile(
    timestamp,
    coords
  ) {
    const key =
      `${timestamp}/${RR_NATIVE_ZOOM}/${coords.x}/${coords.y}/${boost}`;

    if (
      colorCache.has(
        key
      )
    ) {
      return colorCache.get(
        key
      );
    }

    const source =
      await loadGrayTile(
        timestamp,
        coords
      );

    const canvas =
      colorize(
        source
      );

    colorCache.set(
      key,
      canvas
    );

    trimCache(
      colorCache
    );

    return canvas;
  }

  /* =======================================================
     LEGEND
     ======================================================= */

  function findLegend() {
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

    let parent =
      first.parentElement;

    for (
      let i = 0;
      i < 10 &&
      parent;
      i++
    ) {
      if (
        parent.contains(
          last
        )
      ) {
        return parent;
      }

      parent =
        parent.parentElement;
    }

    return null;
  }

  function saveLegend() {
    if (
      legendSaved
    ) {
      return;
    }

    const legend =
      findLegend();

    if (!legend) {
      return;
    }

    originalLegend = {
      element:
        legend,
      html:
        legend.innerHTML
    };

    legendSaved =
      true;
  }

  function replaceText(
    root,
    from,
    to
  ) {
    if (!root) {
      return;
    }

    const walker =
      document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );

    const nodes =
      [];

    let node;

    while (
      (
        node =
          walker.nextNode()
      )
    ) {
      nodes.push(
        node
      );
    }

    nodes.forEach(
      n => {
        if (
          n.nodeValue.includes(
            from
          )
        ) {
          n.nodeValue =
            n.nodeValue.replaceAll(
              from,
              to
            );
        }
      }
    );
  }

  function applyLegend() {
    saveLegend();

    const legend =
      findLegend();

    if (!legend) {
      return;
    }

    replaceText(
      legend,
      "ОЯ",
      "О"
    );

    for (
      let i = 1;
      i <= 19;
      i++
    ) {
      const item =
        legend.querySelector(
          `.l${i}`
        );

      if (!item) {
        continue;
      }

      const color =
        PALETTE[i - 1];

      item.style.background =
        color;

      item.style.backgroundColor =
        color;

      item.style.backgroundImage =
        "none";

      item.textContent =
        LABELS[i - 1];

      item.style.color =
        "#111";
    }

    replaceText(
      legend,
      "ОЯ",
      "О"
    );
  }

  function restoreLegend() {
    if (
      !legendSaved ||
      !originalLegend
    ) {
      return;
    }

    if (
      originalLegend.element
    ) {
      originalLegend.element.innerHTML =
        originalLegend.html;
    }
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
      nav =
        existing;

      if (
        existing.dataset.rrHook !==
        "1"
      ) {
        existing.dataset.rrHook =
          "1";

        existing.onclick =
          event => {
            event.stopPropagation();

            activate();

            show();
          };
      }

      return;
    }

    const rainButton =
      $("rainProduct");

    if (!rainButton) {
      return;
    }

    nav =
      document.createElement(
        "button"
      );

    nav.id =
      "rainRadarNav";

    nav.type =
      "button";

    nav.className =
      "n";

    nav.innerHTML =
      `
        <svg viewBox="0 0 24 24">
          <path d="M4 17h16M4 12h16M4 7h16"/>
        </svg>
        RainRadar
      `;

    rainButton.insertAdjacentElement(
      "afterend",
      nav
    );

    nav.dataset.rrHook =
      "1";

    nav.onclick =
      event => {
        event.stopPropagation();

        activate();

        show();
      };
  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function rangeElement() {
    return $("range");
  }

  function playElement() {
    return $("play");
  }

  function formatTime(
    timestamp
  ) {
    const date =
      new Date(
        Number(
          timestamp
        ) * 1000
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
        day:
          "2-digit",
        month:
          "2-digit",
        hour:
          "2-digit",
        minute:
          "2-digit"
      }
    );
  }

  function saveTimelineHandlers() {
    if (
      timelineSaved
    ) {
      return true;
    }

    const range =
      rangeElement();

    const play =
      playElement();

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

    timelineSaved =
      true;

    return true;
  }

  function restoreTimelineHandlers() {
    if (
      !timelineSaved
    ) {
      return;
    }

    const range =
      rangeElement();

    const play =
      playElement();

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

    timelineSaved =
      false;
  }

  function updateTimeline() {
    const range =
      rangeElement();

    if (range) {
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

      if (
        currentIndex >= 0
      ) {
        range.value =
          String(
            currentIndex
          );
      }
    }

    const times =
      $("times");

    if (times) {
      times.innerHTML =
        "";

      times.style.display =
        "none";
    }

    const framesInfo =
      $("framesInfo");

    if (framesInfo) {
      framesInfo.textContent =
        timestamps.length
          ? `${timestamps.length} кадров`
          : "";
    }

    const label =
      $("timeLabel");

    if (
      label &&
      currentIndex >= 0 &&
      timestamps[
        currentIndex
      ]
    ) {
      label.textContent =
        formatTime(
          timestamps[
            currentIndex
          ]
        );
    }
  }

  function updatePlayButton() {
    const play =
      playElement();

    if (!play) {
      return;
    }

    if (
      playing
    ) {
      play.innerHTML =
        `
        <svg viewBox="0 0 24 24">
          <path d="M7 5h4v14H7zM13 5h4v14h-4z"/>
        </svg>
        `;
    } else {
      play.innerHTML =
        `
        <svg viewBox="0 0 24 24">
          <path d="M7 4l13 8-13 8z"/>
        </svg>
        `;
    }
  }

  function hookTimeline() {
    if (
      !active
    ) {
      return;
    }

    const range =
      rangeElement();

    const play =
      playElement();

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

    range.oninput =
      () => {
        if (
          !active
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

        setFrame(
          index
        );
      };

    play.onclick =
      event => {
        event.preventDefault();
        event.stopPropagation();

        if (
          active
        ) {
          togglePlayback();
          return;
        }

        if (
          typeof savedPlayOnClick ===
          "function"
        ) {
          savedPlayOnClick.call(
            play,
            event
          );
        }
      };

    updateTimeline();
    updatePlayButton();
  }

  /* =======================================================
     RAINRADAR GRID LAYER
     ======================================================= */

  const RainRadarLayer =
    L.GridLayer.extend({

      initialize(
        options
      ) {
        L.GridLayer.prototype.initialize.call(
          this,
          options
        );

        this._timestamp =
          options.timestamp ||
          null;

        this._ready =
          false;

        this._failed =
          false;

        this._loadVersion =
          0;
      },

      onAdd(
        map
      ) {
        this._map =
          map;

        this._ready =
          false;

        this._failed =
          false;

        L.GridLayer.prototype.onAdd.call(
          this,
          map
        );

        this.setOpacity(
          1
        );

        const container =
          this.getContainer();

        if (container) {
          container.classList.add(
            "clorad-rainradar-layer"
          );

          container.style.transition =
            "none";

          container.style.animation =
            "none";

          container.style.opacity =
            "1";
        }

        this.once(
          "load",
          () => {
            this._ready =
              true;

            this.fire(
              "frameready",
              {
                ready:
                  !this._failed
              }
            );
          }
        );

        this.on(
          "tileerror",
          () => {
            this._failed =
              true;
          }
        );
      },

      /*
       * Leaflet полностью управляет
       * геометрией canvas.
       */
      createTile(
        coords,
        done
      ) {
        const tile =
          document.createElement(
            "canvas"
          );

        /*
         * Только bitmap-размер.
         *
         * CSS width/height НЕ задаём:
         * Leaflet сам установит
         * правильную геометрию тайла.
         */
        tile.width =
          TILE_SIZE;

        tile.height =
          TILE_SIZE;

        tile.className =
          "clorad-rainradar-tile";

        tile.style.display =
          "block";

        tile.style.padding =
          "0";

        tile.style.margin =
          "0";

        tile.style.border =
          "0";

        const ctx =
          tile.getContext(
            "2d"
          );

        if (!ctx) {
          done(
            Error(
              "Canvas 2D недоступен"
            ),
            tile
          );

          return tile;
        }

        /*
         * Это относится только к
         * отрисовке bitmap внутри
         * самого canvas.
         *
         * При map zoom масштабируется
         * сам canvas браузером.
         */
        ctx.imageSmoothingEnabled =
          false;

        const timestamp =
          this._timestamp;

        /*
         * Leaflet при minNativeZoom =
         * maxNativeZoom = 5 держит
         * исходную тайловую сетку на Z=5.
         *
         * Поэтому запрос к API остаётся
         * строго Z=5.
         */
        const sourceCoords = {
          z:
            this._tileZoom ??
            RR_NATIVE_ZOOM,

          x:
            coords.x,

          y:
            coords.y
        };

        /*
         * В API всё равно передаём
         * нативный Z=5.
         */
        sourceCoords.z =
          RR_NATIVE_ZOOM;

        getColoredTile(
          timestamp,
          sourceCoords
        )
          .then(
            source => {

              ctx.imageSmoothingEnabled =
                false;

              ctx.setTransform(
                1,
                0,
                0,
                1,
                0,
                0
              );

              ctx.clearRect(
                0,
                0,
                TILE_SIZE,
                TILE_SIZE
              );

              ctx.drawImage(
                source,
                0,
                0,
                TILE_SIZE,
                TILE_SIZE
              );

              done(
                null,
                tile
              );
            }
          )
          .catch(
            error => {
              console.error(
                "RainRadar tile:",
                error
              );

              this._failed =
                true;

              done(
                error,
                tile
              );
            }
          );

        return tile;
      }
    });

  /* =======================================================
     CREATE SINGLE LAYER
     ======================================================= */

  function ensureLayer(
    timestamp
  ) {
    const map =
      getMap();

    if (!map) {
      throw Error(
        "Leaflet map не найден"
      );
    }

    if (
      layer
    ) {
      return layer;
    }

    layer =
      new RainRadarLayer({
        tileSize:
          TILE_SIZE,

        bounds:
          RR_BOUNDS,

        minZoom:
          MIN_ZOOM,

        maxZoom:
          MAX_ZOOM,

        minNativeZoom:
          RR_NATIVE_ZOOM,

        maxNativeZoom:
          RR_NATIVE_ZOOM,

        noWrap:
          true,

        zIndex:
          620,

        keepBuffer:
          1,

        updateWhenIdle:
          true,

        /*
         * Leaflet во время zoom
         * масштабирует существующую
         * tile-сетку плавно.
         *
         * После окончания zoom
         * обновляется реальная сетка.
         */
        updateWhenZooming:
          false,

        updateInterval:
          100,

        timestamp:
          timestamp
      });

    rainRadarLayers.clear();

    rainRadarLayers.add(
      layer
    );

    layer.addTo(
      map
    );

    return layer;
  }

  /* =======================================================
     GET EXISTING TILE CANVASES
     ======================================================= */

  function getVisibleTiles() {
    if (
      !layer
    ) {
      return [];
    }

    const result =
      [];

    const tiles =
      layer._tiles;

    if (!tiles) {
      return result;
    }

    Object.keys(
      tiles
    ).forEach(
      key => {
        const entry =
          tiles[key];

        if (
          !entry ||
          !entry.el ||
          !entry.coords
        ) {
          return;
        }

        if (
          !(entry.el instanceof
            HTMLCanvasElement)
        ) {
          return;
        }

        result.push({
          key,
          canvas:
            entry.el,
          coords:
            {
              x:
                entry.coords.x,

              y:
                entry.coords.y,

              /*
               * ВАЖНО:
               * сохраняем реальный z
               * из Leaflet.
               */
              z:
                entry.coords.z
            }
        });
      }
    );

    return result;
  }

  /* =======================================================
     LOAD FRAME INTO MEMORY
     ======================================================= */

  async function preloadFrame(
    timestamp,
    token
  ) {
    let visible =
      getVisibleTiles();

    if (
      !visible.length
    ) {
      await waitForLayerLoad();

      if (
        token !==
        frameRequestId
      ) {
        return null;
      }

      visible =
        getVisibleTiles();
    }

    if (
      !visible.length
    ) {
      return [];
    }

    /*
     * Запоминаем tileZoom.
     *
     * Если пользователь успел изменить
     * zoom во время загрузки кадра,
     * подготовленный набор нельзя
     * применять к новой сетке.
     */
    const capturedTileZoom =
      layer
        ? layer._tileZoom
        : null;

    const prepared =
      new Array(
        visible.length
      );

    await Promise.all(
      visible.map(
        async (
          item,
          index
        ) => {

          if (
            token !==
            frameRequestId
          ) {
            return;
          }

          const source =
            await getColoredTile(
              timestamp,
              {
                /*
                 * API всегда получает
                 * исходную сетку Z=5.
                 */
                z:
                  RR_NATIVE_ZOOM,

                x:
                  item.coords.x,

                y:
                  item.coords.y
              }
            );

          if (
            token !==
            frameRequestId
          ) {
            return;
          }

          const preparedCanvas =
            document.createElement(
              "canvas"
            );

          preparedCanvas.width =
            TILE_SIZE;

          preparedCanvas.height =
            TILE_SIZE;

          const ctx =
            preparedCanvas.getContext(
              "2d"
            );

          if (!ctx) {
            throw Error(
              "Canvas 2D недоступен"
            );
          }

          ctx.imageSmoothingEnabled =
            false;

          ctx.drawImage(
            source,
            0,
            0,
            TILE_SIZE,
            TILE_SIZE
          );

          prepared[index] = {
            key:
              item.key,

            canvas:
              item.canvas,

            coords:
              item.coords,

            source:
              preparedCanvas
          };
        }
      )
    );

    if (
      token !==
      frameRequestId
    ) {
      return null;
    }

    if (
      prepared.some(
        item =>
          !item
      )
    ) {
      return null;
    }

    /*
     * Критическая проверка:
     * пока грузились изображения,
     * Leaflet мог перестроить сетку.
     */
    if (
      layer &&
      layer._tileZoom !==
        capturedTileZoom
    ) {
      return null;
    }

    return prepared;
  }

  /* =======================================================
     CHECK TILE IS STILL CURRENT
     ======================================================= */

  function tileIsStillCurrent(
    item
  ) {
    if (
      !layer ||
      !layer._tiles ||
      !item
    ) {
      return false;
    }

    const current =
      layer._tiles[
        item.key
      ];

    if (
      !current ||
      current.el !==
        item.canvas
    ) {
      return false;
    }

    if (
      !current.coords
    ) {
      return false;
    }

    /*
     * Проверяем настоящие
     * Leaflet coordinates.
     *
     * Это предотвращает запись
     * подготовленного старого тайла
     * в другой tile после zoom/pan.
     */
    return (
      current.coords.x ===
        item.coords.x &&
      current.coords.y ===
        item.coords.y &&
      current.coords.z ===
        item.coords.z
    );
  }

  /* =======================================================
     ATOMIC FRAME SWAP
     ======================================================= */

  function commitPreparedFrame(
    prepared,
    timestamp,
    token
  ) {
    if (
      token !==
      frameRequestId
    ) {
      return false;
    }

    if (
      !prepared ||
      !prepared.length
    ) {
      return false;
    }

    /*
     * Сначала проверяем ВСЮ сетку.
     *
     * Если хотя бы один canvas
     * уже заменён Leaflet,
     * ничего не записываем.
     */
    for (
      const item of
      prepared
    ) {
      if (
        !tileIsStillCurrent(
          item
        )
      ) {
        return false;
      }
    }

    /*
     * Один JS execution task.
     *
     * DOM-элементы canvas не меняются.
     * Меняется только их bitmap.
     */
    for (
      const item of
      prepared
    ) {
      if (
        token !==
        frameRequestId
      ) {
        return false;
      }

      const canvas =
        item.canvas;

      const ctx =
        canvas.getContext(
          "2d"
        );

      if (!ctx) {
        continue;
      }

      ctx.imageSmoothingEnabled =
        false;

      ctx.setTransform(
        1,
        0,
        0,
        1,
        0,
        0
      );

      ctx.clearRect(
        0,
        0,
        TILE_SIZE,
        TILE_SIZE
      );

      ctx.drawImage(
        item.source,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE
      );
    }

    /*
     * Теперь новые tile, которые
     * Leaflet создаст после pan/zoom,
     * будут брать уже новый timestamp.
     */
    if (
      layer
    ) {
      layer._timestamp =
        timestamp;
    }

    displayedTimestamp =
      timestamp;

    return true;
  }

  /* =======================================================
     WAIT FOR INITIAL LAYER
     ======================================================= */

  function waitForLayerLoad() {
    if (
      !layer
    ) {
      return Promise.resolve();
    }

    if (
      layer._ready
    ) {
      return Promise.resolve();
    }

    return new Promise(
      resolve => {
        layer.once(
          "load",
          () => {
            resolve();
          }
        );
      }
    );
  }

  /* =======================================================
     SET FRAME
     ======================================================= */

  async function setFrame(
    index
  ) {
    if (
      !active ||
      !timestamps.length
    ) {
      return false;
    }

    const target =
      Math.max(
        0,
        Math.min(
          timestamps.length - 1,
          Number(
            index
          )
        )
      );

    if (
      !Number.isFinite(
        target
      )
    ) {
      return false;
    }

    const timestamp =
      timestamps[
        target
      ];

    if (
      currentIndex ===
        target &&
      displayedTimestamp ===
        timestamp
    ) {
      updateTimeline();

      return true;
    }

    const token =
      ++frameRequestId;

    ensureLayer(
      displayedTimestamp ||
      timestamp
    );

    /*
     * ПЕРВЫЙ КАДР
     */
    if (
      !displayedTimestamp
    ) {
      try {
        await waitForLayerLoad();
      } catch {
        return false;
      }

      if (
        token !==
        frameRequestId
      ) {
        return false;
      }

      if (
        layer &&
        layer._failed
      ) {
        return false;
      }

      /*
       * Первый слой уже показывает
       * нужный timestamp.
       */
      if (
        layer
      ) {
        layer._timestamp =
          timestamp;
      }

      displayedTimestamp =
        timestamp;

      currentIndex =
        target;

      updateTimeline();

      return true;
    }

    /*
     * ПОСЛЕДУЮЩИЕ КАДРЫ
     */
    let prepared;

    try {
      prepared =
        await preloadFrame(
          timestamp,
          token
        );
    } catch (
      error
    ) {
      console.error(
        "RainRadar frame preload:",
        error
      );

      return false;
    }

    if (
      token !==
      frameRequestId
    ) {
      return false;
    }

    if (
      !prepared ||
      !prepared.length
    ) {
      return false;
    }

    /*
     * Только теперь меняем
     * существующие canvas.
     */
    const ok =
      commitPreparedFrame(
        prepared,
        timestamp,
        token
      );

    if (
      !ok
    ) {
      return false;
    }

    currentIndex =
      target;

    updateTimeline();

    return true;
  }

  /* =======================================================
     REMOVE LAYER ONLY WHEN RADAR IS STOPPED
     ======================================================= */

  function removeAllRainRadarLayers(
    map
  ) {
    if (!map) {
      return;
    }

    for (
      const rrLayer of
      Array.from(
        rainRadarLayers
      )
    ) {
      try {
        if (
          map.hasLayer(
            rrLayer
          )
        ) {
          map.removeLayer(
            rrLayer
          );
        }
      } catch {}

      rainRadarLayers.delete(
        rrLayer
      );
    }

    const leftovers =
      [];

    map.eachLayer(
      candidate => {
        if (
          candidate instanceof
          RainRadarLayer
        ) {
          leftovers.push(
            candidate
          );
        }
      }
    );

    leftovers.forEach(
      rrLayer => {
        try {
          map.removeLayer(
            rrLayer
          );
        } catch {}
      }
    );

    rainRadarLayers.clear();

    layer =
      null;

    displayedTimestamp =
      null;
  }

  /* =======================================================
     MANIFEST
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
      throw Error(
        `RainRadar API вернул HTTP ${response.status}`
      );
    }

    if (
      !response.ok ||
      !data ||
      data.ok === false
    ) {
      throw Error(
        data?.error ||
        `RainRadar API HTTP ${response.status}`
      );
    }

    timestamps =
      (
        Array.isArray(
          data.frames
        )
          ? data.frames
          : []
      )
        .map(
          frame =>
            typeof frame ===
            "object"
              ? Number(
                  frame.timestamp
                )
              : Number(
                  frame
                )
        )
        .filter(
          Number.isFinite
        )
        .sort(
          (a, b) =>
            a - b
        );

    if (
      !timestamps.length
    ) {
      throw Error(
        "RainRadar не вернул кадры"
      );
    }

    return timestamps;
  }

  /* =======================================================
     PLAYBACK
     ======================================================= */

  function stopPlayback() {
    playing =
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
      !playing ||
      playbackBusy
    ) {
      return;
    }

    playbackBusy =
      true;

    const nextIndex =
      currentIndex >=
        timestamps.length - 1
        ? 0
        : currentIndex + 1;

    let ok =
      false;

    try {
      ok =
        await setFrame(
          nextIndex
        );
    } finally {
      playbackBusy =
        false;
    }

    if (
      ok &&
      active &&
      playing
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
      timestamps.length <
        2
    ) {
      return;
    }

    stopPlayback();

    playing =
      true;

    updatePlayButton();

    playbackTimer =
      setTimeout(
        playbackStep,
        0
      );
  }

  function togglePlayback() {
    if (
      playing
    ) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  /* =======================================================
     ACTIVATE
     ======================================================= */

  function activate() {
    ++requestId;
    ++frameRequestId;

    active =
      true;

    stopPlayback();

    removeAllRainRadarLayers(
      getMap()
    );

    document
      .querySelectorAll(
        ".nav .n"
      )
      .forEach(
        button =>
          button.classList.remove(
            "active"
          )
      );

    if (nav) {
      nav.classList.add(
        "active"
      );
    }

    applyLegend();

    try {
      window.CLOradStopRadar?.();
    } catch {}

    try {
      window.CLOradDeactivateGIF?.();
    } catch {}

    hookTimeline();
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

    ++requestId;
    ++frameRequestId;

    restoreTimelineHandlers();

    removeAllRainRadarLayers(
      getMap()
    );

    timestamps =
      [];

    currentIndex =
      -1;

    displayedTimestamp =
      null;

    if (nav) {
      nav.classList.remove(
        "active"
      );
    }

    restoreLegend();

    updateTimeline();
  }

  /* =======================================================
     OTHER NAV
     ======================================================= */

  function hookOtherNav() {
    const navigation =
      document.querySelector(
        ".nav"
      );

    if (
      !navigation ||
      navigation.dataset.rrOtherHook
    ) {
      return;
    }

    navigation.dataset.rrOtherHook =
      "1";

    navigation.addEventListener(
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
          rainRadarLayers.size
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

            const current =
              navigation.querySelector(
                ".n.active"
              );

            if (
              current &&
              current.id !==
                "rainRadarNav"
            ) {
              stop();
            }
          }
        );

      observer.observe(
        navigation,
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
     SHOW
     ======================================================= */

  async function show() {
    if (
      loading
    ) {
      return;
    }

    const map =
      getMap();

    if (!map) {
      msg(
        "Карта ещё не готова"
      );

      return;
    }

    loading =
      true;

    stopPlayback();

    msg(
      "Загрузка RainRadar..."
    );

    try {
      await loadFrames();

      if (
        !active
      ) {
        return;
      }

      const ok =
        await setFrame(
          timestamps.length - 1
        );

      if (
        !ok
      ) {
        throw Error(
          "Не удалось загрузить кадр RainRadar"
        );
      }

      if (
        !active
      ) {
        return;
      }

      startRefresh();

      msg(
        `RainRadar загружен · накрутка ${boost}`
      );

    } catch (
      error
    ) {
      console.error(
        "RainRadar:",
        error
      );

      msg(
        error?.message ||
        "Ошибка загрузки RainRadar"
      );

    } finally {
      loading =
        false;
    }
  }

  /* =======================================================
     REFRESH
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

            const oldIndex =
              currentIndex;

            const oldLength =
              timestamps.length;

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
              newLatest ===
              oldLatest
            ) {
              return;
            }

            const wasLatest =
              oldIndex ===
              oldLength - 1;

            if (
              wasLatest
            ) {
              await setFrame(
                timestamps.length - 1
              );
            }

            msg(
              "RainRadar: новые кадры"
            );

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
     SETTINGS
     ======================================================= */

  function settingsContainer() {
    return $("settings");
  }

  function syncBoostUI() {
    const range =
      $("cloradRainRadarBoostRange");

    const value =
      $("cloradRainRadarBoostValue");

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

  function applyBoost() {
    if (
      selectedBoost ===
      boost
    ) {
      msg(
        `Накрутка RainRadar: ${boost}`
      );

      return;
    }

    boost =
      selectedBoost;

    saveBoost(
      boost
    );

    colorCache.clear();

    if (
      active &&
      currentIndex >= 0
    ) {
      const index =
        currentIndex;

      displayedTimestamp =
        null;

      setFrame(
        index
      );
    }
  }

  function createSettings() {
    const settings =
      settingsContainer();

    if (!settings) {
      return;
    }

    const existing =
      settings.querySelector(
        "#cloradRainRadarSetting"
      );

    if (
      existing
    ) {
      syncBoostUI();
      return;
    }

    const box =
      document.createElement(
        "div"
      );

    box.className =
      "setting";

    box.id =
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
        <span class="settingArrow">›</span>
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

    info.style.cssText =
      "margin-bottom:9px;font-size:12px;opacity:.75";

    info.textContent =
      "Усиление интенсивности данных";

    const row =
      document.createElement(
        "div"
      );

    row.style.cssText =
      "display:flex;" +
      "align-items:center;" +
      "justify-content:space-between;" +
      "margin-bottom:8px;" +
      "font-size:13px";

    const label =
      document.createElement(
        "span"
      );

    label.textContent =
      "Выбрано:";

    const value =
      document.createElement(
        "strong"
      );

    value.id =
      "cloradRainRadarBoostValue";

    value.style.cssText =
      "font-size:16px;" +
      "font-variant-numeric:tabular-nums;" +
      "min-width:28px;" +
      "text-align:right;" +
      "color:#53e39b";

    row.append(
      label,
      value
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
      "width:100%;" +
      "display:block;" +
      "margin:3px 0 4px;" +
      "accent-color:#53e39b";

    const scale =
      document.createElement(
        "div"
      );

    scale.style.cssText =
      "display:flex;" +
      "justify-content:space-between;" +
      "font-size:10px;" +
      "color:#858e95;" +
      "margin-bottom:10px";

    scale.innerHTML =
      "<span>1</span><span>30</span>";

    const apply =
      document.createElement(
        "button"
      );

    apply.type =
      "button";

    apply.textContent =
      "Применить";

    apply.style.cssText =
      "width:100%;" +
      "height:40px;" +
      "border:1px solid #3d8e6a;" +
      "border-radius:8px;" +
      "background:#194c38;" +
      "color:#eafff5;" +
      "font-size:14px;" +
      "font-weight:600;";

    body.append(
      info,
      row,
      range,
      scale,
      apply
    );

    box.append(
      head,
      body
    );

    const frames =
      settings.querySelector(
        "#framesSetting"
      );

    if (
      frames &&
      frames.parentElement ===
        settings
    ) {
      frames.insertAdjacentElement(
        "afterend",
        box
      );
    } else {
      settings.appendChild(
        box
      );
    }

    head.onclick =
      event => {
        event.preventDefault();
        event.stopPropagation();

        box.classList.toggle(
          "open"
        );
      };

    range.oninput =
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

        value.textContent =
          String(
            selectedBoost
          );
      };

    apply.onclick =
      event => {
        event.preventDefault();
        event.stopPropagation();

        applyBoost();
      };

    syncBoostUI();
  }

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    installCSS();

    createNav();

    hookOtherNav();

    createSettings();

    [
      300,
      800,
      1500,
      3000
    ].forEach(
      delay => {
        setTimeout(
          () => {
            installCSS();
            createNav();
            hookOtherNav();
            createSettings();
          },
          delay
        );
      }
    );
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradStopRainRadar =
    stop;

  window.CLOradDeactivateRainRadar =
    stop;

  window.CLOradRainRadar = {
    show:
      show,

    stop:
      stop,

    reload:
      show,

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
        ] ||
        null,

    getBoost:
      () =>
        boost,

    setBoost:
      value => {
        selectedBoost =
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

        syncBoostUI();

        applyBoost();
      }
  };

  /* =======================================================
     START
     ======================================================= */

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

})();
