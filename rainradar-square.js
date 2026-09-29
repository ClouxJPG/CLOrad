/* =========================================================
   CLOrad — RainRadar SQUARE / PIXELATED
   Файл: rainradar-square.js

   Назначение:
   - отдельный квадратный renderer RainRadar
   - визуально резкие радарные ячейки
   - без bilinear interpolation
   - без blur
   - без плавного сглаживания
   - квадратные блоки данных
   - pixelated rendering
   - crisp-edges
   - исходный rainradar.js не изменяется
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

  /*
   * Итоговый размер Leaflet tile.
   */
  const SQUARE_SIZE = 256;

  /*
   * Размер визуальной квадратной ячейки.

   * 1 = исходные пиксели
   * 2 = 2x2
   * 3 = 3x3
   * 4 = 4x4
   * 6 = 6x6
   * 8 = 8x8

   * 4 даёт выраженный "радарный"
   * пиксельный вид без сильной потери
   * детализации.
   */
  const DATA_BLOCK_SIZE = 4;

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

  const RGB =
    PALETTE.map(hex => ({
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
    }));

  /* =======================================================
     STATE
     ======================================================= */

  let boost =
    loadBoost();

  let layer =
    null;

  let timestamps =
    [];

  let currentTimestamp =
    null;

  let currentFrameIndex =
    -1;

  let refreshTimer =
    null;

  let playbackTimer =
    null;

  let playing =
    false;

  let loading =
    false;

  let requestId =
    0;

  /*
   * Исходные grayscale данные.
   */
  const grayCache =
    new Map();

  /*
   * Уже обработанные квадратные raster tiles.
   */
  const colorCache =
    new Map();

  const MAX_CACHE =
    600;

  /* =======================================================
     PIXEL / SHARPNESS CSS
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
      document.createElement(
        "style"
      );

    style.id =
      "clorad-rainradar-square-pixel-css";

    style.textContent = `
      /*
       * Полностью отключаем анимации
       * и переходы.
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
         * Никакого сглаживания
         * при масштабировании.
         */
        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;
        image-rendering: -moz-crisp-edges !important;
      }

      /*
       * Сам радарный canvas.
       */
      canvas.clorad-rainradar-tile {

        display: block !important;

        width: 256px !important;
        height: 256px !important;

        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;

        /*
         * Главная настройка резкости.
         */
        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;
        image-rendering: -moz-crisp-edges !important;

        /*
         * Никаких фильтров.
         */
        filter: none !important;

        /*
         * Никаких плавных переходов.
         */
        transition: none !important;
        animation: none !important;

        /*
         * Не позволяем браузеру
         * менять прозрачность.
         */
        opacity: 1 !important;
      }

      .clorad-rainradar-square-layer {
        opacity: 1 !important;
        filter: none !important;
      }
    `;

    document.head.appendChild(
      style
    );
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
    boost =
      Math.max(
        BOOST_MIN,
        Math.min(
          BOOST_MAX,
          Number(value) ||
            BOOST_DEFAULT
        )
      );

    saveBoost(
      boost
    );

    colorCache.clear();

    if (
      layer
    ) {
      layer.redraw();
    }
  }

  /* =======================================================
     CACHE
     ======================================================= */

  function trimCache(cache) {
    while (
      cache.size >
      MAX_CACHE
    ) {
      const first =
        cache.keys()
          .next()
          .value;

      if (
        first ===
        undefined
      ) {
        break;
      }

      cache.delete(
        first
      );
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
        timestamp:
          String(timestamp),

        z:
          String(
            RR_NATIVE_ZOOM
          ),

        x:
          String(coords.x),

        y:
          String(coords.y)
      });

    return (
      API +
      "?" +
      params.toString()
    );
  }

  /* =======================================================
     LOAD IMAGE
     ======================================================= */

  function loadImage(
    url
  ) {
    return new Promise(
      (resolve, reject) => {
        const img =
          new Image();

        img.crossOrigin =
          "anonymous";

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
            reject(
              new Error(
                "RainRadar tile load error: " +
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
     LOAD RAW RASTER
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
      grayCache.has(
        key
      )
    ) {
      return grayCache.get(
        key
      );
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

    /*
     * Никогда не сглаживаем
     * исходные данные.
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

  function colorize(
    source
  ) {
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

    if (
      !ctx
    ) {
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

      /*
       * Пустой радар.
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
     SQUARE PIXEL BLOCK RENDERER
     ======================================================= */

  function makeSquareRaster(
    source
  ) {
    const sourceWidth =
      source.width;

    const sourceHeight =
      source.height;

    /*
     * Если исходный raster уже
     * маленький — всё равно делаем
     * квадратный output.
     */
    const output =
      document.createElement(
        "canvas"
      );

    output.width =
      SQUARE_SIZE;

    output.height =
      SQUARE_SIZE;

    output.className =
      "clorad-rainradar-tile";

    output.style.imageRendering =
      "pixelated";

    const ctx =
      output.getContext(
        "2d",
        {
          alpha: true,
          desynchronized: true
        }
      );

    if (
      !ctx
    ) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    /*
     * КРИТИЧЕСКОЕ:
     * полностью отключаем interpolation.
     */
    ctx.imageSmoothingEnabled =
      false;

    ctx.imageSmoothingQuality =
      "low";

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
     * -----------------------------------------------------
     * ВАРИАНТ С КВАДРАТНЫМИ БЛОКАМИ
     * -----------------------------------------------------
     *
     * Сначала вычисляем, сколько исходных
     * пикселей приходится на одну видимую
     * квадратную ячейку.
     */

    const block =
      Math.max(
        1,
        DATA_BLOCK_SIZE
      );

    /*
     * Если исходное изображение
     * имеет пропорции, отличные от 1:1,
     * масштабируем его в квадратный
     * рабочий raster nearest-neighbor.
     */
    const scaled =
      document.createElement(
        "canvas"
      );

    scaled.width =
      SQUARE_SIZE;

    scaled.height =
      SQUARE_SIZE;

    const sctx =
      scaled.getContext(
        "2d"
      );

    if (
      !sctx
    ) {
      throw new Error(
        "Canvas 2D недоступен"
      );
    }

    sctx.imageSmoothingEnabled =
      false;

    sctx.imageSmoothingQuality =
      "low";

    /*
     * Самое важное:
     *
     * исходный raster масштабируется
     * только nearest-neighbor.
     */
    sctx.drawImage(
      source,
      0,
      0,
      sourceWidth,
      sourceHeight,
      0,
      0,
      SQUARE_SIZE,
      SQUARE_SIZE
    );

    /*
     * Получаем уже масштабированные
     * пиксели.
     */
    const data =
      sctx.getImageData(
        0,
        0,
        SQUARE_SIZE,
        SQUARE_SIZE
      );

    /*
     * Новый canvas.
     */
    const finalImage =
      ctx.createImageData(
        SQUARE_SIZE,
        SQUARE_SIZE
      );

    const src =
      data.data;

    const dst =
      finalImage.data;

    /*
     * Превращаем соседние пиксели
     * в одинаковые квадратные блоки.
     *
     * Это создаёт именно тот
     * "пиксельный" вид, который нужен.
     */
    for (
      let y = 0;
      y < SQUARE_SIZE;
      y += block
    ) {
      for (
        let x = 0;
        x < SQUARE_SIZE;
        x += block
      ) {
        const sourceIndex =
          (
            y *
            SQUARE_SIZE +
            x
          ) *
          4;

        const r =
          src[sourceIndex];

        const g =
          src[
            sourceIndex + 1
          ];

        const b =
          src[
            sourceIndex + 2
          ];

        const a =
          src[
            sourceIndex + 3
          ];

        /*
         * Заполняем квадратный блок
         * одним и тем же значением.
         */
        const endY =
          Math.min(
            y + block,
            SQUARE_SIZE
          );

        const endX =
          Math.min(
            x + block,
            SQUARE_SIZE
          );

        for (
          let yy = y;
          yy < endY;
          yy++
        ) {
          for (
            let xx = x;
            xx < endX;
            xx++
          ) {
            const index =
              (
                yy *
                SQUARE_SIZE +
                xx
              ) *
              4;

            dst[index] =
              r;

            dst[index + 1] =
              g;

            dst[index + 2] =
              b;

            dst[index + 3] =
              a;
          }
        }
      }
    }

    ctx.putImageData(
      finalImage,
      0,
      0
    );

    /*
     * Ещё раз фиксируем pixelated.
     */
    ctx.imageSmoothingEnabled =
      false;

    return output;
  }

  /* =======================================================
     FINAL COLORED TILE
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
        boost,
        DATA_BLOCK_SIZE
      ].join("/");

    if (
      colorCache.has(
        key
      )
    ) {
      return colorCache.get(
        key
      );
    }

    const raw =
      await loadGrayTile(
        timestamp,
        coords
      );

    const colored =
      colorize(
        raw
      );

    /*
     * Здесь формируем квадратные
     * визуальные радарные ячейки.
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

      initialize(
        options
      ) {
        options =
          options ||
          {};

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
         * Всегда квадратный canvas.
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

        tile.style.imageRendering =
          "pixelated";

        const ctx =
          tile.getContext(
            "2d"
          );

        if (
          !ctx
        ) {
          done(
            new Error(
              "Canvas 2D недоступен"
            ),
            tile
          );

          return tile;
        }

        /*
         * Никакого сглаживания.
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
               * Если пользователь уже
               * переключил кадр —
               * старый tile не вставляем.
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
               * Перед каждым drawImage
               * снова отключаем smoothing.
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

              /*
               * Финальная страховка.
               */
              tile.style.imageRendering =
                "pixelated";

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

    let list =
      [];

    if (
      Array.isArray(
        data
      )
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
      [
        ...new Set(
          list
        )
      ];

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
      index >=
        timestamps.length
    ) {
      return;
    }

    const timestamp =
      timestamps[index];

    currentFrameIndex =
      index;

    currentTimestamp =
      timestamp;

    if (
      !layer
    ) {
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
        id !==
        requestId
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

      /*
       * Если пользователь был
       * на последнем кадре —
       * переходим на новый последний.
       */
      if (
        wasLatest
      ) {
        index =
          timestamps.length - 1;
      }

      /*
       * Иначе сохраняем выбранный
       * пользователем кадр.
       */
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
          Number.isFinite(
            index
          )
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
            currentFrameIndex +
            1;

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
          "[CLOrad] Leaflet map не найден"
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

      if (
        layer
      ) {
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
    window.CLOrad ||
    {};

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
