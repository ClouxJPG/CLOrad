/* =========================================================
   CLOrad — RainRadar Square Renderer
   Файл: rainradar-square.js

   НАЗНАЧЕНИЕ:
   - отдельный renderer для квадратных радарных пикселей
   - существующий rainradar.js НЕ ИЗМЕНЯЕТ
   - index.html НЕ ИЗМЕНЯЕТ
   - API RainRadar НЕ ИЗМЕНЯЕТ
   - исходные радарные данные сначала загружаются
   - затем raster переводится в квадратный canvas
   - итоговый raster всегда 256x256
   - nearest-neighbor
   - без сглаживания
   - без blur
   - без CSS transition
   - без fade
   - без изменения положения карты

   ВАЖНО:
   Этот файл рассчитан на подключение вместо обычного
   renderer-а RainRadar. Сам по себе он не должен создавать
   второй независимый слой поверх существующего RainRadar.
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

  const RR_NATIVE_ZOOM =
    5;

  const MIN_ZOOM =
    2;

  const MAX_ZOOM =
    14;

  const TILE_SIZE =
    256;

  /*
   * Итоговый размер каждого Leaflet tile.
   */
  const SQUARE_SIZE =
    TILE_SIZE;

  /*
   * Коэффициент усиления.
   * Совместим с текущим RainRadar.
   */
  const BOOST_MIN =
    1;

  const BOOST_MAX =
    30;

  const BOOST_DEFAULT =
    23;

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

  const RGB =
    PALETTE.map(hex => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    }));

  /* =======================================================
     STATE
     ======================================================= */

  let boost =
    loadBoost();

  let layer =
    null;

  let currentTimestamp =
    null;

  let currentFrameIndex =
    -1;

  let timestamps =
    [];

  let refreshTimer =
    null;

  let playbackTimer =
    null;

  let playing =
    false;

  let active =
    false;

  let requestCounter =
    0;

  /*
   * Кэш исходных grayscale tiles.
   */
  const grayCache =
    new Map();

  /*
   * Кэш уже окрашенных квадратных tiles.
   */
  const colorCache =
    new Map();

  const MAX_CACHE =
    600;

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
        Number.isFinite(value)
        && value >= BOOST_MIN
        && value <= BOOST_MAX
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

  function clampBoost(value) {
    return Math.max(
      BOOST_MIN,
      Math.min(
        BOOST_MAX,
        Number(value) || BOOST_DEFAULT
      )
    );
  }

  function setBoost(value) {
    boost =
      clampBoost(value);

    saveBoost(boost);

    clearColorCache();

    if (
      currentTimestamp !== null
    ) {
      refreshVisibleTiles();
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

  function clearColorCache() {
    colorCache.clear();
  }

  function clearAllCache() {
    grayCache.clear();
    colorCache.clear();
  }

  /* =======================================================
     API URL
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

        img.decoding =
          "async";

        img.crossOrigin =
          "anonymous";

        img.onload = () => {
          resolve(img);
        };

        img.onerror = () => {
          reject(
            new Error(
              "Не удалось загрузить RainRadar tile: " +
              url
            )
          );
        };

        img.src =
          url;
      }
    );
  }

  /* =======================================================
     GRAYSCALE TILE
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

    const url =
      tileURL(
        timestamp,
        coords
      );

    const img =
      await loadImage(url);

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
        "RainRadar tile имеет некорректный размер"
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

    ctx.imageSmoothingEnabled =
      false;

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

  function colorize(
    source
  ) {
    const {
      width,
      height,
      imageData
    } = source;

    const output =
      document.createElement(
        "canvas"
      );

    output.width =
      width;

    output.height =
      height;

    output.className =
      "clorad-rainradar-square-source";

    const ctx =
      output.getContext(
        "2d"
      );

    if (!ctx) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    ctx.imageSmoothingEnabled =
      false;

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
      let i = 0, p = 0;
      i < src.length;
      i += 4, p++
    ) {
      const value =
        src[i];

      /*
       * Прозрачный / пустой radar pixel.
       */
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

      /*
       * Усиление.
       */
      let index =
        Math.floor(
          (value / 255) *
          boost *
          (RGB.length - 1)
        );

      if (
        index < 0
      ) {
        index = 0;
      }

      if (
        index >= RGB.length
      ) {
        index =
          RGB.length - 1;
      }

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

    return output;
  }

  /* =======================================================
     SQUARE RASTER
     ======================================================= */

  /*
   * Главная функция этого файла.
   *
   * Она превращает исходный radar raster
   * в квадратный 256x256 raster.
   *
   * Никакого сглаживания:
   *
   * imageSmoothingEnabled = false
   *
   * и CSS:
   *
   * image-rendering: pixelated
   *
   * Благодаря этому соседние значения
   * не смешиваются между собой.
   */

  function makeSquareRaster(
    source
  ) {
    const square =
      document.createElement(
        "canvas"
      );

    square.width =
      SQUARE_SIZE;

    square.height =
      SQUARE_SIZE;

    square.className =
      "clorad-rainradar-tile";

    const ctx =
      square.getContext(
        "2d"
      );

    if (!ctx) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    /*
     * Жёстко отключаем interpolation.
     */
    ctx.imageSmoothingEnabled =
      false;

    ctx.imageSmoothingQuality =
      "low";

    /*
     * Сбрасываем transform.
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
     * Исходный raster переносится
     * в квадратный canvas.
     *
     * Важно:
     * здесь НЕ используется smoothing.
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

    return square;
  }

  /* =======================================================
     COLORED TILE
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

    const gray =
      await loadGrayTile(
        timestamp,
        coords
      );

    const colored =
      colorize(gray);

    /*
     * Именно здесь raster становится
     * квадратным.
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
     CSS
     ======================================================= */

  function installCSS() {
    if (
      document.getElementById(
        "clorad-rainradar-square-css"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "clorad-rainradar-square-css";

    style.textContent = `
      .clorad-rainradar-square-layer,
      .clorad-rainradar-square-layer *,
      .clorad-rainradar-square-layer
        .leaflet-tile-container,
      .clorad-rainradar-square-layer
        .leaflet-layer {
        transition: none !important;
        animation: none !important;
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
         * Квадратные резкие radar pixels.
         */
        image-rendering: pixelated !important;

        transition: none !important;
        animation: none !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     LEAFLET LAYER
     ======================================================= */

  const RainRadarSquareLayer =
    L.TileLayer.extend({

      initialize(
        options
      ) {
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

      setTimestamp(
        timestamp
      ) {
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
         * Canvas всегда квадратный.
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
          SQUARE_SIZE + "px";

        tile.style.height =
          SQUARE_SIZE + "px";

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

        ctx.imageSmoothingEnabled =
          false;

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
               * Проверяем, что tile всё ещё
               * относится к этому слою.
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

              ctx.imageSmoothingEnabled =
                false;

              /*
               * source уже 256x256.
               */
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
     LAYER CREATION
     ======================================================= */

  function createLayer(
    timestamp
  ) {
    if (
      layer
    ) {
      layer.remove();
      layer =
        null;
    }

    layer =
      new RainRadarSquareLayer({
        timestamp
      });

    layer.addTo(
      window.map
    );

    return layer;
  }

  /* =======================================================
     REFRESH VISIBLE TILES
     ======================================================= */

  function refreshVisibleTiles() {
    if (
      !layer
    ) {
      return;
    }

    layer.redraw();
  }

  /* =======================================================
     TIMESTAMP
     ======================================================= */

  function normalizeTimestamp(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return null;
    }

    return String(
      value
    );
  }

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
        "RainRadar manifest HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    let list =
      [];

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
          normalizeTimestamp
        )
        .filter(
          value =>
            value !== null
        );

    /*
     * Убираем дубли.
     */
    list =
      [...new Set(list)];

    /*
     * Сортировка по времени.
     */
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
    index,
    force = false
  ) {
    if (
      index < 0 ||
      index >= timestamps.length
    ) {
      return;
    }

    const timestamp =
      timestamps[index];

    if (
      !force &&
      currentFrameIndex === index &&
      currentTimestamp === timestamp
    ) {
      return;
    }

    const myRequest =
      ++frameRequestId;

    currentFrameIndex =
      index;

    /*
     * Не создаём новый слой каждый раз.
     */
    if (
      !layer
    ) {
      createLayer(
        timestamp
      );

      currentTimestamp =
        timestamp;

      return;
    }

    /*
     * Новый timestamp передаём
     * существующему Leaflet layer.
     */
    layer.setTimestamp(
      timestamp
    );

    currentTimestamp =
      timestamp;

    /*
     * Защита от устаревшего запроса.
     */
    if (
      myRequest !==
      frameRequestId
    ) {
      return;
    }
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
          if (
            playbackBusy
          ) {
            return;
          }

          playbackBusy =
            true;

          let next =
            currentFrameIndex + 1;

          if (
            next >=
            timestamps.length
          ) {
            next = 0;
          }

          Promise.resolve(
            setFrame(
              next
            )
          ).finally(
            () => {
              playbackBusy =
                false;
            }
          );
        },
        1000
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

    const myRequest =
      ++requestCounter;

    try {
      const oldTimestamps =
        timestamps.slice();

      const oldCurrent =
        currentTimestamp;

      const wasLatest =
        oldCurrent !== null &&
        oldTimestamps.length > 0 &&
        oldCurrent ===
          oldTimestamps[
            oldTimestamps.length - 1
          ];

      const newTimestamps =
        await loadManifest();

      if (
        myRequest !==
        requestCounter
      ) {
        return;
      }

      if (
        !newTimestamps.length
      ) {
        return;
      }

      timestamps =
        newTimestamps;

      let targetIndex =
        timestamps.indexOf(
          oldCurrent
        );

      /*
       * Если пользователь был на последнем
       * кадре, после обновления остаёмся
       * на новом последнем кадре.
       */
      if (
        wasLatest
      ) {
        targetIndex =
          timestamps.length - 1;
      }

      /*
       * Если выбранного кадра больше нет,
       * берём ближайший доступный.
       */
      if (
        targetIndex < 0
      ) {
        targetIndex =
          Math.min(
            currentFrameIndex,
            timestamps.length - 1
          );

        if (
          targetIndex < 0
        ) {
          targetIndex =
            timestamps.length - 1;
        }
      }

      await setFrame(
        targetIndex
      );

      updateTimelineUI();

    } catch (
      error
    ) {
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
     TIMELINE UI
     ======================================================= */

  function updateTimelineUI() {
    /*
     * Ищем стандартный slider CLOrad.
     *
     * Если его нет — просто ничего не делаем.
     */
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
        .rainradarSquareConnected ===
      "1"
    ) {
      return;
    }

    slider.dataset
      .rainradarSquareConnected =
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

    updateTimelineUI();
  }

  /* =======================================================
     BOOST UI
     ======================================================= */

  function connectBoostUI() {
    /*
     * Поддерживаем существующие элементы
     * настроек CLOrad.
     */

    const inputs =
      document.querySelectorAll(
        "[data-rainradar-boost]"
      );

    inputs.forEach(
      input => {
        if (
          input.dataset
            .rainradarSquareConnected ===
          "1"
        ) {
          return;
        }

        input.dataset
          .rainradarSquareConnected =
          "1";

        if (
          input.value !==
          String(boost)
        ) {
          input.value =
            String(boost);
        }

        input.addEventListener(
          "input",
          () => {
            setBoost(
              input.value
            );
          }
        );

        input.addEventListener(
          "change",
          () => {
            setBoost(
              input.value
            );
          }
        );
      }
    );
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  const RainRadarSquare =
    {
      activate() {
        if (
          !window.map
        ) {
          console.error(
            "[CLOrad] Leaflet map не найден"
          );

          return;
        }

        installCSS();

        active =
          true;

        clearAllCache();

        stopPlayback();

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

        connectTimeline();

        connectBoostUI();

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
            60000
          );
      },

      deactivate() {
        active =
          false;

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

        clearAllCache();
      },

      refresh,

      setFrame,

      setBoost,

      getBoost() {
        return boost;
      },

      getTimestamps() {
        return timestamps.slice();
      },

      getCurrentIndex() {
        return currentFrameIndex;
      },

      getCurrentTimestamp() {
        return currentTimestamp;
      },

      play() {
        startPlayback();
      },

      pause() {
        stopPlayback();
      },

      isPlaying() {
        return playing;
      },

      clearCache() {
        clearAllCache();

        refreshVisibleTiles();
      }
    };

  /* =======================================================
     EXPORT
     ======================================================= */

  window.CLOrad =
    window.CLOrad ||
    {};

  window.CLOrad.RainRadarSquare =
    RainRadarSquare;

  /*
   * Дополнительный короткий alias.
   */
  window.RainRadarSquare =
    RainRadarSquare;

  /* =======================================================
     AUTO START
     ======================================================= */

  function boot() {
    if (
      !window.L
    ) {
      setTimeout(
        boot,
        100
      );

      return;
    }

    if (
      !window.map
    ) {
      setTimeout(
        boot,
        100
      );

      return;
    }

    /*
     * Не запускаем автоматически,
     * если основной CLOrad ещё не готов.
     *
     * Файл только регистрирует renderer.
     */
    connectTimeline();
    connectBoostUI();
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
