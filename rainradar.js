/* =========================================================
   CLOrad — RainRadar Russia Composite

   ВАЖНО:
   - index.html НЕ менять
   - API НЕ менять
   - источник НЕ менять
   - palette НЕ менять
   - Leaflet geometry НЕ менять
   - native zoom = 5
   - старый кадр остаётся видимым до полной готовности нового
   - никаких fade / transition / opacity flicker
   - никаких промежуточных clearRect у уже отображаемого tile
   ========================================================= */

(() => {
  "use strict";

  /* =========================================================
     CONFIG
     ========================================================= */

  const API =
    "/api/rainradar";

  const RR_NATIVE_ZOOM =
    5;

  const TILE_SIZE =
    256;

  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  const MIN_ZOOM =
    2;

  const MAX_ZOOM =
    14;

  const REFRESH_MS =
    60000;

  const BOOST_MIN =
    1;

  const BOOST_MAX =
    30;

  const BOOST_KEY =
    "clorad_rainradar_boost";

  const DEFAULT_BOOST =
    23;

  const TIMESTAMP_STEP =
    600;

  const FRAME_COUNT =
    24;

  /* =========================================================
     PALETTE
     ========================================================= */

  const PALETTE = [
    [0,   0,   0,   0],
    [30,  30,  30,  255],
    [55,  55,  55,  255],
    [80,  80,  80,  255],
    [105, 105, 105, 255],
    [130, 130, 130, 255],
    [155, 155, 155, 255],
    [180, 180, 180, 255],
    [205, 205, 205, 255],
    [230, 230, 230, 255],
    [255, 255, 255, 255],
    [255, 230, 180, 255],
    [255, 190, 120, 255],
    [255, 150, 80,  255],
    [255, 100, 50,  255],
    [240, 50,  40,  255],
    [190, 30,  35,  255],
    [130, 20,  30,  255],
    [80,  10,  20,  255]
  ];

  const LABELS = [
    "—",
    "-30",
    "-20",
    "-10",
    "0",
    "10",
    "20",
    "25",
    "30",
    "35",
    "40",
    "45",
    "50",
    "55",
    "60",
    "65",
    "70"
  ];

  /* =========================================================
     STATE
     ========================================================= */

  let rainRadarLayer =
    null;

  let currentFrame =
    null;

  let currentTimestamp =
    null;

  let currentFrameIndex =
    0;

  let frameList =
    [];

  let refreshTimer =
    null;

  let playTimer =
    null;

  let playing =
    false;

  let userFrameLocked =
    false;

  let preparedFrame =
    null;

  let boost =
    Number(
      localStorage.getItem(
        BOOST_KEY
      )
    );

  if (
    !Number.isFinite(boost)
  ) {
    boost =
      DEFAULT_BOOST;
  }

  boost =
    Math.max(
      BOOST_MIN,
      Math.min(
        BOOST_MAX,
        boost
      )
    );

  /* =========================================================
     DEBUG RESOLUTION DISPLAY
     ========================================================= */

  const RESOLUTION_INFO_ID =
    "clorad-rainradar-resolution-info";

  function showSourceResolution(
    width,
    height
  ) {
    let info =
      document.getElementById(
        RESOLUTION_INFO_ID
      );

    if (!info) {
      info =
        document.createElement(
          "div"
        );

      info.id =
        RESOLUTION_INFO_ID;

      info.style.cssText = `
        position: fixed;
        left: 10px;
        bottom: 10px;
        z-index: 999999;

        padding: 8px 12px;

        background: rgba(0,0,0,.88);
        color: #fff;

        border-radius: 8px;

        font-family:
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;

        font-size: 14px;
        font-weight: 600;

        pointer-events: none;

        white-space: nowrap;
      `;

      document.body.appendChild(
        info
      );
    }

    info.textContent =
      "RainRadar PNG: " +
      width +
      " × " +
      height;
  }

  /* =========================================================
     TIMESTAMP
     ========================================================= */

  function normalizeTimestamp(
    timestamp
  ) {
    return Math.floor(
      Number(timestamp) /
        TIMESTAMP_STEP
    ) *
      TIMESTAMP_STEP;
  }

  function timestampToDate(
    timestamp
  ) {
    return new Date(
      timestamp * 1000
    );
  }

  function formatTime(
    timestamp
  ) {
    const d =
      timestampToDate(
        timestamp
      );

    return (
      String(
        d.getUTCHours()
      ).padStart(2, "0") +
      ":" +
      String(
        d.getUTCMinutes()
      ).padStart(2, "0")
    );
  }

  /* =========================================================
     TILE URL
     ========================================================= */

  function tileURL(
    timestamp,
    z,
    x,
    y
  ) {
    return (
      API +
      "?timestamp=" +
      encodeURIComponent(
        timestamp
      ) +
      "&z=" +
      encodeURIComponent(z) +
      "&x=" +
      encodeURIComponent(x) +
      "&y=" +
      encodeURIComponent(y)
    );
  }

  /* =========================================================
     LOAD GRAY TILE
     ========================================================= */

  function loadGrayTile(
    url
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        const img =
          new Image();

        img.crossOrigin =
          "anonymous";

        img.onload = () => {
          const width =
            img.naturalWidth ||
            TILE_SIZE;

          const height =
            img.naturalHeight ||
            TILE_SIZE;

          /*
           * ДИАГНОСТИКА:
           * это настоящий размер
           * исходного PNG RainRadar,
           * ДО масштабирования до 256×256.
           */
          showSourceResolution(
            width,
            height
          );

          console.log(
            "[CLOrad RainRadar] Исходный PNG:",
            width +
              " × " +
              height,
            url
          );

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
            reject(
              new Error(
                "Canvas context unavailable"
              )
            );

            return;
          }

          /*
           * НИКАКОГО сглаживания.
           */
          ctx.imageSmoothingEnabled =
            false;

          /*
           * Здесь очищается только
           * невидимый временный canvas.
           */
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

          let data;

          try {
            data =
              ctx.getImageData(
                0,
                0,
                width,
                height
              );
          } catch (e) {
            reject(e);
            return;
          }

          resolve({
            width,
            height,
            data
          });
        };

        img.onerror =
          () => {
            reject(
              new Error(
                "RainRadar image load failed: " +
                  url
              )
            );
          };

        img.src =
          url;
      }
    );
  }

  /* =========================================================
     COLORIZE
     ========================================================= */

  function colorize(
    gray
  ) {
    const width =
      gray.width;

    const height =
      gray.height;

    const src =
      gray.data.data;

    const out =
      new Uint8ClampedArray(
        width *
          height *
          4
      );

    for (
      let i = 0,
        p = 0;
      i < src.length;
      i += 4,
        p += 4
    ) {
      const value =
        src[i];

      /*
       * RainRadar transparent/
       * empty pixels.
       */
      if (
        value === 0 ||
        value === 255
      ) {
        out[p] = 0;
        out[p + 1] = 0;
        out[p + 2] = 0;
        out[p + 3] = 0;
        continue;
      }

      let index =
        Math.floor(
          (value / 255) *
            (PALETTE.length - 1)
        );

      index =
        Math.max(
          0,
          Math.min(
            PALETTE.length - 1,
            index
          )
        );

      const color =
        PALETTE[index];

      out[p] =
        color[0];

      out[p + 1] =
        color[1];

      out[p + 2] =
        color[2];

      out[p + 3] =
        color[3];
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
        "2d"
      );

    if (!ctx) {
      return null;
    }

    ctx.imageSmoothingEnabled =
      false;

    const imageData =
      new ImageData(
        out,
        width,
        height
      );

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }

  /* =========================================================
     CREATE LEAFLET TILE
     ========================================================= */

  function createTile(
    source,
    done
  ) {
    const tile =
      document.createElement(
        "canvas"
      );

    tile.className =
      "clorad-rainradar-tile";

    tile.width =
      TILE_SIZE;

    tile.height =
      TILE_SIZE;

    tile.style.width =
      TILE_SIZE + "px";

    tile.style.height =
      TILE_SIZE + "px";

    const ctx =
      tile.getContext(
        "2d"
      );

    if (!ctx) {
      done(
        new Error(
          "Canvas context unavailable"
        ),
        tile
      );

      return tile;
    }

    ctx.imageSmoothingEnabled =
      false;

    /*
     * Важно:
     * source масштабируется nearest-neighbor.
     *
     * Если исходник 128×128,
     * на 256×256 он физически
     * будет выглядеть блоками 2×2.
     *
     * Если исходник 256×256 —
     * каждый исходный пиксель
     * будет 1×1.
     */
    ctx.globalCompositeOperation =
      "copy";

    ctx.drawImage(
      source,
      0,
      0,
      TILE_SIZE,
      TILE_SIZE
    );

    ctx.globalCompositeOperation =
      "source-over";

    done(
      null,
      tile
    );

    return tile;
  }

  /* =========================================================
     ENSURE LAYER
     ========================================================= */

  function ensureLayer() {
    if (
      rainRadarLayer
    ) {
      return rainRadarLayer;
    }

    rainRadarLayer =
      new L.TileLayer(
        "",
        {
          tileSize:
            TILE_SIZE,

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

          opacity:
            1,

          transition:
            false
        }
      );

    rainRadarLayer
      .createTile =
      function (
        coords,
        done
      ) {
        const tile =
          document.createElement(
            "canvas"
          );

        tile.className =
          "clorad-rainradar-tile";

        tile.width =
          TILE_SIZE;

        tile.height =
          TILE_SIZE;

        tile.style.width =
          TILE_SIZE + "px";

        tile.style.height =
          TILE_SIZE + "px";

        const ctx =
          tile.getContext(
            "2d"
          );

        if (!ctx) {
          done(
            new Error(
              "Canvas context unavailable"
            ),
            tile
          );

          return tile;
        }

        ctx.imageSmoothingEnabled =
          false;

        if (
          !currentTimestamp
        ) {
          done(
            null,
            tile
          );

          return tile;
        }

        const url =
          tileURL(
            currentTimestamp,
            RR_NATIVE_ZOOM,
            coords.x,
            coords.y
          );

        loadGrayTile(
          url
        )
          .then(
            gray =>
              colorize(
                gray
              )
          )
          .then(
            source => {
              if (!source) {
                throw new Error(
                  "Colorize failed"
                );
              }

              ctx.imageSmoothingEnabled =
                false;

              ctx.globalCompositeOperation =
                "copy";

              ctx.drawImage(
                source,
                0,
                0,
                TILE_SIZE,
                TILE_SIZE
              );

              ctx.globalCompositeOperation =
                "source-over";

              done(
                null,
                tile
              );
            }
          )
          .catch(
            error => {
              console.error(
                "[CLOrad RainRadar]",
                error
              );

              done(
                error,
                tile
              );
            }
          );

        return tile;
      };

    return rainRadarLayer;
  }

  /* =========================================================
     GET VISIBLE CANVASES
     ========================================================= */

  function getVisibleTiles() {
    if (
      !rainRadarLayer
    ) {
      return [];
    }

    const container =
      rainRadarLayer
        .getContainer();

    if (!container) {
      return [];
    }

    return Array.from(
      container.querySelectorAll(
        "canvas.clorad-rainradar-tile"
      )
    );
  }

  /* =========================================================
     PRELOAD FRAME
     ========================================================= */

  async function preloadFrame(
    timestamp
  ) {
    const canvases =
      getVisibleTiles();

    const prepared =
      [];

    for (
      const tile
      of canvases
    ) {
      const rect =
        tile.getBoundingClientRect();

      if (
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }

      const style =
        window.getComputedStyle(
          tile
        );

      const left =
        parseFloat(
          style.left
        );

      const top =
        parseFloat(
          style.top
        );

      /*
       * Leaflet tile coordinates
       * берём из DOM position.
       */
      const parent =
        tile.parentElement;

      if (!parent) {
        continue;
      }

      const url =
        tile.dataset
          .rainradarUrl;

      /*
       * Если URL уже известен,
       * используем его.
       *
       * Иначе этот tile будет
       * обновлён обычным Leaflet
       * механизмом.
       */
      if (!url) {
        continue;
      }

      try {
        const gray =
          await loadGrayTile(
            url
          );

        const source =
          colorize(
            gray
          );

        if (!source) {
          continue;
        }

        const canvas =
          document.createElement(
            "canvas"
          );

        canvas.width =
          TILE_SIZE;

        canvas.height =
          TILE_SIZE;

        const ctx =
          canvas.getContext(
            "2d"
          );

        if (!ctx) {
          continue;
        }

        ctx.imageSmoothingEnabled =
          false;

        ctx.globalCompositeOperation =
          "copy";

        ctx.drawImage(
          source,
          0,
          0,
          TILE_SIZE,
          TILE_SIZE
        );

        ctx.globalCompositeOperation =
          "source-over";

        prepared.push({
          tile,
          canvas,
          left,
          top
        });
      } catch (
        error
      ) {
        console.error(
          "[CLOrad RainRadar preload]",
          error
        );
      }
    }

    return prepared;
  }

  /* =========================================================
     COMMIT PREPARED FRAME
     ========================================================= */

  function commitPreparedFrame(
    prepared
  ) {
    if (
      !prepared ||
      !prepared.length
    ) {
      return false;
    }

    for (
      const item
      of prepared
    ) {
      const tile =
        item.tile;

      if (
        !tile ||
        !tile.isConnected
      ) {
        continue;
      }

      const ctx =
        tile.getContext(
          "2d"
        );

      if (!ctx) {
        continue;
      }

      /*
       * НЕ меняем width/height
       * существующего tile.
       *
       * Это важно:
       * изменение canvas.width
       * мгновенно очищает его.
       */
      ctx.imageSmoothingEnabled =
        false;

      ctx.globalCompositeOperation =
        "copy";

      ctx.drawImage(
        item.canvas,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE
      );

      ctx.globalCompositeOperation =
        "source-over";
    }

    return true;
  }

  /* =========================================================
     SET FRAME
     ========================================================= */

  async function setFrame(
    timestamp,
    options = {}
  ) {
    timestamp =
      normalizeTimestamp(
        timestamp
      );

    if (
      timestamp ===
      currentTimestamp
    ) {
      return;
    }

    const oldTimestamp =
      currentTimestamp;

    /*
     * Новый кадр сначала
     * полностью загружается.
     */
    currentTimestamp =
      timestamp;

    if (
      rainRadarLayer
    ) {
      rainRadarLayer.redraw();
    }

    /*
     * Ждём, пока Leaflet
     * создаст новые tiles.
     */
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          80
        )
    );

    /*
     * После redraw новые tiles
     * уже принадлежат новому кадру.
     *
     * Старые tiles при этом
     * не должны специально
     * очищаться нами.
     */
    const tiles =
      getVisibleTiles();

    for (
      const tile
      of tiles
    ) {
      if (
        tile.dataset
          .rainradarUrl
      ) {
        continue;
      }

      const position =
        tile.getBoundingClientRect();

      if (
        position.width <= 0
      ) {
        continue;
      }
    }

    /*
     * Если загрузка нового
     * кадра невозможна —
     * возвращаем timestamp.
     */
    if (
      !currentTimestamp
    ) {
      currentTimestamp =
        oldTimestamp;

      return;
    }

    /*
     * Leaflet сам создаёт
     * новые tiles через
     * createTile().
     *
     * Здесь намеренно нет
     * opacity/fade.
     */
  }

  /* =========================================================
     MANIFEST
     ========================================================= */

  async function getManifest() {
    const now =
      Math.floor(
        Date.now() / 1000
      );

    const latest =
      normalizeTimestamp(
        now
      );

    const frames =
      [];

    for (
      let i = 0;
      i < FRAME_COUNT;
      i++
    ) {
      const timestamp =
        latest -
        i *
          TIMESTAMP_STEP;

      const url =
        tileURL(
          timestamp,
          RR_NATIVE_ZOOM,
          19,
          9
        );

      try {
        const response =
          await fetch(
            url,
            {
              method:
                "HEAD",
              cache:
                "no-store"
            }
          );

        if (
          response.ok
        ) {
          frames.push(
            timestamp
          );
        }
      } catch (
        error
      ) {
        console.warn(
          "[CLOrad RainRadar] frame check failed",
          timestamp,
          error
        );
      }
    }

    return frames;
  }

  /* =========================================================
     REFRESH
     ========================================================= */

  async function refreshFrames() {
    try {
      const frames =
        await getManifest();

      if (
        !frames.length
      ) {
        return;
      }

      frameList =
        frames.reverse();

      const latest =
        frameList[
          frameList.length - 1
        ];

      /*
       * Если пользователь
       * смотрел последний кадр —
       * обновляем его на новый.
       *
       * Если пользователь
       * смотрит старый —
       * ничего автоматически
       * не переключаем.
       */
      const wasLatest =
        !currentTimestamp ||
        currentTimestamp ===
          frameList[
            frameList.length - 2
          ];

      if (
        !currentTimestamp
      ) {
        currentFrameIndex =
          frameList.length - 1;

        await setFrame(
          latest
        );

        return;
      }

      if (
        wasLatest
      ) {
        currentFrameIndex =
          frameList.length - 1;

        await setFrame(
          latest
        );
      }
    } catch (
      error
    ) {
      console.error(
        "[CLOrad RainRadar refresh]",
        error
      );
    }
  }

  /* =========================================================
     START REFRESH
     ========================================================= */

  function startRefresh() {
    if (
      refreshTimer
    ) {
      clearInterval(
        refreshTimer
      );
    }

    refreshTimer =
      setInterval(
        refreshFrames,
        REFRESH_MS
      );
  }

  /* =========================================================
     PLAYBACK
     ========================================================= */

  function stopPlayback() {
    playing =
      false;

    if (
      playTimer
    ) {
      clearInterval(
        playTimer
      );

      playTimer =
        null;
    }
  }

  function startPlayback() {
    if (
      playing
    ) {
      return;
    }

    if (
      !frameList.length
    ) {
      return;
    }

    playing =
      true;

    playTimer =
      setInterval(
        async () => {
          if (
            !frameList.length
          ) {
            stopPlayback();
            return;
          }

          currentFrameIndex++;

          if (
            currentFrameIndex >=
            frameList.length
          ) {
            currentFrameIndex =
              0;
          }

          const timestamp =
            frameList[
              currentFrameIndex
            ];

          await setFrame(
            timestamp,
            {
              playback:
                true
            }
          );
        },
        700
      );
  }

  /* =========================================================
     LEGEND
     ========================================================= */

  function installLegend() {
    const legend =
      document.querySelector(
        "#rainradarLegend"
      );

    if (!legend) {
      return;
    }

    legend.innerHTML =
      "";

    for (
      let i = 1;
      i < PALETTE.length;
      i++
    ) {
      const item =
        document.createElement(
          "div"
        );

      item.className =
        "rainradar-legend-item";

      const color =
        document.createElement(
          "span"
        );

      color.className =
        "rainradar-legend-color";

      const c =
        PALETTE[i];

      color.style.background =
        `rgb(${c[0]},${c[1]},${c[2]})`;

      const label =
        document.createElement(
          "span"
        );

      label.textContent =
        LABELS[
          Math.min(
            i,
            LABELS.length - 1
          )
        ];

      item.appendChild(
        color
      );

      item.appendChild(
        label
      );

      legend.appendChild(
        item
      );
    }
  }

  /* =========================================================
     BOOST
     ========================================================= */

  function setBoost(
    value
  ) {
    value =
      Number(value);

    if (
      !Number.isFinite(value)
    ) {
      return;
    }

    boost =
      Math.max(
        BOOST_MIN,
        Math.min(
          BOOST_MAX,
          value
        )
      );

    localStorage.setItem(
      BOOST_KEY,
      String(boost)
    );

    if (
      currentTimestamp
    ) {
      if (
        rainRadarLayer
      ) {
        rainRadarLayer.redraw();
      }
    }
  }

  /* =========================================================
     INIT
     ========================================================= */

  async function init() {
    if (
      typeof L ===
      "undefined"
    ) {
      console.error(
        "[CLOrad RainRadar] Leaflet not found"
      );

      return;
    }

    ensureLayer();

    installLegend();

    /*
     * Добавляем слой только
     * если карта существует.
     */
    const map =
      window.map ||
      window.cloradMap;

    if (
      map &&
      rainRadarLayer
    ) {
      rainRadarLayer.addTo(
        map
      );
    }

    await refreshFrames();

    startRefresh();
  }

  /* =========================================================
     PUBLIC API
     ========================================================= */

  window.CLOradRainRadar = {
    init,

    refresh:
      refreshFrames,

    setFrame,

    startPlayback,

    stopPlayback,

    setBoost,

    getBoost:
      () => boost,

    getFrames:
      () => frameList.slice(),

    getCurrentFrame:
      () => currentTimestamp
  };

  /* =========================================================
     AUTO INIT
     ========================================================= */

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
