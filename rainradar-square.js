/* =========================================================
   CLOrad — RainRadar SQUARE + PIXELATED RENDERER
   Файл: rainradar-square.js

   ГЛАВНОЕ:
   - квадратный raster 256x256
   - pixelated rendering
   - crisp-edges
   - imageSmoothingEnabled = false
   - никакого bilinear / linear smoothing
   - никакого blur при масштабировании
   - никакого transition / animation
   - исходный rainradar.js НЕ ИЗМЕНЯЕТСЯ
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

  const RR_NATIVE_ZOOM = 5;

  const MIN_ZOOM = 2;
  const MAX_ZOOM = 14;

  const TILE_SIZE = 256;
  const SQUARE_SIZE = 256;

  const REFRESH_TIME = 60000;

  const BOOST_MIN = 1;
  const BOOST_MAX = 30;
  const BOOST_DEFAULT = 23;

  const BOOST_STORAGE_KEY =
    "clorad_rainradar_boost";

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

  const RGB = PALETTE.map(hex => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  }));

  /* =======================================================
     STATE
     ======================================================= */

  let boost = loadBoost();

  let layer = null;
  let timestamps = [];
  let currentTimestamp = null;
  let currentFrameIndex = -1;

  let refreshTimer = null;
  let playbackTimer = null;

  let playing = false;
  let loading = false;

  let requestId = 0;

  const grayCache = new Map();
  const colorCache = new Map();

  const MAX_CACHE = 600;

  /* =======================================================
     PIXELATED CSS
     ======================================================= */

  function installPixelCSS() {
    if (
      document.getElementById(
        "clorad-rainradar-square-pixel-css"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "clorad-rainradar-square-pixel-css";

    style.textContent = `
      /*
       * RainRadar pixel renderer
       */

      .clorad-rainradar-square-layer,
      .clorad-rainradar-square-layer *,
      .clorad-rainradar-square-layer
        .leaflet-tile-container,
      .clorad-rainradar-square-layer
        .leaflet-tile {

        transition: none !important;
        animation: none !important;

        /*
         * Главная настройка резкости.
         */
        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;
      }

      .clorad-rainradar-square-layer {
        opacity: 1 !important;
      }

      canvas.clorad-rainradar-tile {

        display: block !important;

        width: 256px !important;
        height: 256px !important;

        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;

        /*
         * Pixelated renderer.
         */
        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;

        /*
         * Запрещаем визуальные переходы.
         */
        transition: none !important;
        animation: none !important;

        /*
         * Не даём браузеру применять
         * дополнительные эффекты.
         */
        filter: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  /* =======================================================
     BOOST
     ======================================================= */

  function loadBoost() {
    try {
      const value =
        Number(
          localStorage.getItem(
            BOOST_STORAGE_KEY
          )
        );

      if (
        Number.isFinite(value) &&
        value >= BOOST_MIN &&
        value <= BOOST_MAX
      ) {
        return value;
      }
    } catch (_) {}

    return BOOST_DEFAULT;
  }

  function saveBoost(value) {
    try {
      localStorage.setItem(
        BOOST_STORAGE_KEY,
        String(value)
      );
    } catch (_) {}
  }

  function setBoost(value) {
    boost = Math.max(
      BOOST_MIN,
      Math.min(
        BOOST_MAX,
        Number(value) || BOOST_DEFAULT
      )
    );

    saveBoost(boost);

    colorCache.clear();

    if (layer) {
      layer.redraw();
    }
  }

  /* =======================================================
     CACHE
     ======================================================= */

  function trimCache(cache) {
    while (
      cache.size > MAX_CACHE
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
     TILE URL
     ======================================================= */

  function tileURL(
    timestamp,
    coords
  ) {
    const params =
      new URLSearchParams({
        timestamp: String(timestamp),
        z: String(RR_NATIVE_ZOOM),
        x: String(coords.x),
        y: String(coords.y)
      });

    return (
      API +
      "?" +
      params.toString()
    );
  }

  /* =======================================================
     IMAGE LOADER
     ======================================================= */

  function loadImage(url) {
    return new Promise(
      (resolve, reject) => {
        const img =
          new Image();

        img.crossOrigin =
          "anonymous";

        img.decoding =
          "async";

        img.onload = () => {
          resolve(img);
        };

        img.onerror = () => {
          reject(
            new Error(
              "RainRadar tile load error: " +
              url
            )
          );
        };

        img.src = url;
      }
    );
  }

  /* =======================================================
     LOAD RAW TILE
     ======================================================= */

  async function loadGrayTile(
    timestamp,
    coords
  ) {
    const key =
      [
        timestamp,
        RR_NATIVE_ZOOM,
        coords.x,
        coords.y
      ].join("/");

    if (
      grayCache.has(key)
    ) {
      return grayCache.get(key);
    }

    const img =
      await loadImage(
        tileURL(
          timestamp,
          coords
        )
      );

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
        "Некорректный размер RainRadar tile"
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
          willReadFrequently: true
        }
      );

    if (!ctx) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    /*
     * ВАЖНО:
     * отключаем сглаживание ещё до drawImage.
     */
    ctx.imageSmoothingEnabled =
      false;

    ctx.imageSmoothingQuality =
      "low";

    ctx.drawImage(
      img,
      0,
      0,
      width,
      height
    );

    const imageData =
      ctx.getImageData(
        0,
        0,
        width,
        height
      );

    const result = {
      width,
      height,
      imageData
    };

    grayCache.set(
      key,
      result
    );

    trimCache(
      grayCache
    );

    return result;
  }

  /* =======================================================
     COLORIZE
     ======================================================= */

  function colorize(source) {
    const {
      width,
      height,
      imageData
    } = source;

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
        "2d"
      );

    if (!ctx) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    ctx.imageSmoothingEnabled =
      false;

    ctx.imageSmoothingQuality =
      "low";

    const src =
      imageData.data;

    const dst =
      ctx.createImageData(
        width,
        height
      );

    const out =
      dst.data;

    for (
      let i = 0;
      i < src.length;
      i += 4
    ) {
      const value =
        src[i];

      if (
        value <= 0
      ) {
        out[i] =
          0;

        out[i + 1] =
          0;

        out[i + 2] =
          0;

        out[i + 3] =
          0;

        continue;
      }

      let index =
        Math.floor(
          (
            value /
            255
          ) *
          boost *
          (
            RGB.length - 1
          )
        );

      index =
        Math.max(
          0,
          Math.min(
            RGB.length - 1,
            index
          )
        );

      const color =
        RGB[index];

      out[i] =
        color.r;

      out[i + 1] =
        color.g;

      out[i + 2] =
        color.b;

      out[i + 3] =
        255;
    }

    ctx.putImageData(
      dst,
      0,
      0
    );

    return canvas;
  }

  /* =======================================================
     MAKE SQUARE + PIXELATED RASTER
     ======================================================= */

  function makeSquareRaster(
    source
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      SQUARE_SIZE;

    canvas.height =
      SQUARE_SIZE;

    canvas.className =
      "clorad-rainradar-tile";

    const ctx =
      canvas.getContext(
        "2d"
      );

    if (!ctx) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    /*
     * КРИТИЧЕСКИ ВАЖНО:
     *
     * браузер НЕ должен интерполировать
     * соседние radar pixels.
     */
    ctx.imageSmoothingEnabled =
      false;

    ctx.imageSmoothingQuality =
      "low";

    /*
     * Сброс transform.
     */
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
      SQUARE_SIZE,
      SQUARE_SIZE
    );

    /*
     * Переносим raster без сглаживания.
     */
    ctx.drawImage(
      source,
      0,
      0,
      source.width,
      source.height,
      0,
      0,
      SQUARE_SIZE,
      SQUARE_SIZE
    );

    return canvas;
  }

  /* =======================================================
     GET COLORED SQUARE TILE
     ======================================================= */

  async function getColoredTile(
    timestamp,
    coords
  ) {
    const key =
      [
        timestamp,
        RR_NATIVE_ZOOM,
        coords.x,
        coords.y,
        boost
      ].join("/");

    if (
      colorCache.has(key)
    ) {
      return colorCache.get(key);
    }

    const raw =
      await loadGrayTile(
        timestamp,
        coords
      );

    const colored =
      colorize(raw);

    /*
     * Здесь получаем квадратный
     * pixelated raster.
     */
    const square =
      makeSquareRaster(
        colored
      );

    colorCache.set(
      key,
      square
    );

    trimCache(
      colorCache
    );

    return square;
  }

  /* =======================================================
     LEAFLET LAYER
     ======================================================= */

  const RainRadarSquareLayer =
    L.TileLayer.extend({

      initialize(options) {
        options =
          options || {};

        L.TileLayer.prototype.initialize.call(
          this,
          "",
          {
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

            updateWhenZooming:
              false,

            updateInterval:
              100,

            className:
              "clorad-rainradar-square-layer",

            ...options
          }
        );

        this._timestamp =
          options.timestamp ||
          null;
      },

      setTimestamp(timestamp) {
        this._timestamp =
          timestamp;

        this.redraw();

        return this;
      },

      createTile(
        coords,
        done
      ) {
        /*
         * Canvas сразу квадратный.
         */
        const tile =
          document.createElement(
            "canvas"
          );

        tile.width =
          SQUARE_SIZE;

        tile.height =
          SQUARE_SIZE;

        tile.className =
          "clorad-rainradar-tile";

        tile.style.width =
          "256px";

        tile.style.height =
          "256px";

        /*
         * Дополнительная страховка:
         * CSS pixelated задаём прямо
         * на конкретном canvas.
         */
        tile.style.imageRendering =
          "pixelated";

        const ctx =
          tile.getContext(
            "2d"
          );

        if (!ctx) {
          done(
            new Error(
              "Canvas 2D недоступен"
            ),
            tile
          );

          return tile;
        }

        /*
         * Отключаем сглаживание.
         */
        ctx.imageSmoothingEnabled =
          false;

        ctx.imageSmoothingQuality =
          "low";

        const timestamp =
          this._timestamp;

        if (
          timestamp === null ||
          timestamp === undefined
        ) {
          done(
            null,
            tile
          );

          return tile;
        }

        getColoredTile(
          timestamp,
          coords
        )
          .then(
            source => {
              /*
               * Если за время загрузки
               * timestamp уже поменялся —
               * этот tile не используем.
               */
              if (
                this._timestamp !==
                timestamp
              ) {
                done(
                  null,
                  tile
                );

                return;
              }

              ctx.clearRect(
                0,
                0,
                SQUARE_SIZE,
                SQUARE_SIZE
              );

              /*
               * Ещё раз отключаем smoothing
               * непосредственно перед drawImage.
               */
              ctx.imageSmoothingEnabled =
                false;

              ctx.imageSmoothingQuality =
                "low";

              ctx.drawImage(
                source,
                0,
                0,
                SQUARE_SIZE,
                SQUARE_SIZE
              );

              done(
                null,
                tile
              );
            }
          )
          .catch(
            error => {
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
     MANIFEST
     ======================================================= */

  async function loadManifest() {
    const response =
      await fetch(
        API,
        {
          cache:
            "no-store"
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        "RainRadar HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    let list = [];

    if (
      Array.isArray(data)
    ) {
      list =
        data;
    } else if (
      Array.isArray(
        data.timestamps
      )
    ) {
      list =
        data.timestamps;
    } else if (
      Array.isArray(
        data.frames
      )
    ) {
      list =
        data.frames.map(
          frame =>
            frame.timestamp ??
            frame.time ??
            frame
        );
    }

    list =
      list
        .map(
          value =>
            String(value)
        )
        .filter(
          Boolean
        );

    list =
      [...new Set(list)];

    list.sort(
      (a, b) =>
        Number(a) -
        Number(b)
    );

    return list;
  }

  /* =======================================================
     SET FRAME
     ======================================================= */

  async function setFrame(
    index
  ) {
    if (
      index < 0 ||
      index >= timestamps.length
    ) {
      return;
    }

    const timestamp =
      timestamps[index];

    currentFrameIndex =
      index;

    currentTimestamp =
      timestamp;

    if (!layer) {
      layer =
        new RainRadarSquareLayer({
          timestamp
        });

      layer.addTo(
        window.map
      );

      return;
    }

    layer.setTimestamp(
      timestamp
    );
  }

  /* =======================================================
     REFRESH
     ======================================================= */

  async function refresh() {
    if (
      loading
    ) {
      return;
    }

    loading =
      true;

    const id =
      ++requestId;

    try {
      const oldTimestamp =
        currentTimestamp;

      const oldList =
        timestamps.slice();

      const wasLatest =
        oldTimestamp !== null &&
        oldList.length > 0 &&
        oldTimestamp ===
          oldList[
            oldList.length - 1
          ];

      const next =
        await loadManifest();

      if (
        id !== requestId
      ) {
        return;
      }

      if (
        !next.length
      ) {
        return;
      }

      timestamps =
        next;

      let index =
        timestamps.indexOf(
          oldTimestamp
        );

      if (
        wasLatest
      ) {
        index =
          timestamps.length - 1;
      }

      if (
        index < 0
      ) {
        index =
          Math.min(
            currentFrameIndex,
            timestamps.length - 1
          );
      }

      if (
        index < 0
      ) {
        index =
          timestamps.length - 1;
      }

      await setFrame(
        index
      );

      updateTimeline();

    } catch (error) {
      console.error(
        "[CLOrad RainRadar Square]",
        error
      );
    } finally {
      loading =
        false;
    }
  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function updateTimeline() {
    const slider =
      document.querySelector(
        ".timeline input[type='range']"
      );

    if (
      !slider ||
      !timestamps.length
    ) {
      return;
    }

    slider.min =
      "0";

    slider.max =
      String(
        timestamps.length - 1
      );

    slider.step =
      "1";

    slider.value =
      String(
        Math.max(
          0,
          currentFrameIndex
        )
      );
  }

  function connectTimeline() {
    const slider =
      document.querySelector(
        ".timeline input[type='range']"
      );

    if (
      !slider
    ) {
      return;
    }

    if (
      slider.dataset
        .rainradarSquarePixelated ===
      "1"
    ) {
      return;
    }

    slider.dataset
      .rainradarSquarePixelated =
      "1";

    slider.addEventListener(
      "input",
      () => {
        const index =
          Number(
            slider.value
          );

        if (
          Number.isFinite(index)
        ) {
          setFrame(
            index
          );
        }
      }
    );

    updateTimeline();
  }

  /* =======================================================
     PLAYBACK
     ======================================================= */

  function stopPlayback() {
    playing =
      false;

    if (
      playbackTimer
    ) {
      clearInterval(
        playbackTimer
      );

      playbackTimer =
        null;
    }
  }

  function startPlayback() {
    if (
      timestamps.length < 2
    ) {
      return;
    }

    stopPlayback();

    playing =
      true;

    playbackTimer =
      setInterval(
        () => {
          let next =
            currentFrameIndex + 1;

          if (
            next >=
            timestamps.length
          ) {
            next = 0;
          }

          setFrame(
            next
          );
        },
        1000
      );
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  const RainRadarSquare = {

    activate() {
      if (
        !window.map
      ) {
        console.error(
          "[CLOrad] map не найден"
        );

        return;
      }

      installPixelCSS();

      connectTimeline();

      refresh();

      if (
        refreshTimer
      ) {
        clearInterval(
          refreshTimer
        );
      }

      refreshTimer =
        setInterval(
          refresh,
          REFRESH_TIME
        );
    },

    deactivate() {
      stopPlayback();

      if (
        refreshTimer
      ) {
        clearInterval(
          refreshTimer
        );

        refreshTimer =
          null;
      }

      if (
        layer
      ) {
        layer.remove();

        layer =
          null;
      }

      currentTimestamp =
        null;

      currentFrameIndex =
        -1;
    },

    refresh,

    setFrame,

    setBoost,

    play() {
      startPlayback();
    },

    pause() {
      stopPlayback();
    },

    clearCache() {
      grayCache.clear();
      colorCache.clear();

      if (layer) {
        layer.redraw();
      }
    },

    getCurrentTimestamp() {
      return currentTimestamp;
    },

    getCurrentIndex() {
      return currentFrameIndex;
    },

    getTimestamps() {
      return timestamps.slice();
    }
  };

  /* =======================================================
     EXPORT
     ======================================================= */

  window.CLOrad =
    window.CLOrad || {};

  window.CLOrad.RainRadarSquare =
    RainRadarSquare;

  window.RainRadarSquare =
    RainRadarSquare;

  /* =======================================================
     INIT
     ======================================================= */

  function boot() {
    installPixelCSS();

    connectTimeline();
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      boot,
      {
        once: true
      }
    );
  } else {
    boot();
  }

})();
