/* =========================================================
   CLOrad — RainRadar Russia Composite

   RainRadar:
   - grayscale source
   - RGMC ОЯ palette
   - black = transparent
   - sharp square pixels
   - instant intensity amplification
   - frame atomic loading
   - timeline
   - playback
   - automatic refresh

   Настройка:
   "Накрутка RainRadar"
   1..30
   default = 15

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
     RAINRADAR AMPLIFICATION
     ======================================================= */

  const BOOST_MIN =
    1;

  const BOOST_MAX =
    30;

  const BOOST_DEFAULT =
    15;

  const BOOST_STORAGE_KEY =
    "clorad_rainradar_boost";

  let rainRadarBoost =
    loadBoost();

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
      ) {

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
     RGMC ОЯ PALETTE
     НЕ ИЗМЕНЯТЬ
     ======================================================= */

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

  const COLOR_LEVELS =
    RGMC_OY_PALETTE.length;

  const PALETTE_RGB =
    RGMC_OY_PALETTE.map(
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

  let requestId =
    0;

  let suppressTimelineInput =
    false;

  let settingsControl =
    null;

  /*
   * Глобальный кэш исходных grayscale-тайлов.

   * key:
   * timestamp/z/x/y

   * value:
   * ImageData
   */

  const grayscaleCache =
    new Map();

  /*
   * Кэш готовых цветных тайлов.

   * key:
   * timestamp/z/x/y/boost
   */

  const coloredCache =
    new Map();

  const MAX_CACHE_ITEMS =
    600;

  /* =======================================================
     BASIC HELPERS
     ======================================================= */

  function $(id) {
    return document.getElementById(id);
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
        cache.keys().next().value;

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

  /*
   * RainRadar отдаёт grayscale,
   * где большая часть значений находится
   * в нижней части диапазона.

   * Поэтому обычное линейное:
   *
   * value / 255
   *
   * сильно недооценивает картину.

   * Накрутка управляет экспонентой.
   *
   * boost 1:
   * почти исходная шкала.
   *
   * boost 15:
   * стандартная настройка.
   *
   * boost 30:
   * максимально растянутая слабая/средняя отражайка.
   */

  function getGamma(
    boost
  ) {

    /*
     * 1 -> примерно 1.00
     * 15 -> примерно 0.52
     * 30 -> примерно 0.25
     */

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
     VALUE -> PALETTE
     ======================================================= */

  function valueToPaletteIndex(
    value
  ) {

    if (
      value <= 0
    ) {

      return -1;

    }

    /*
     * После накрутки
     * получаем полноценный диапазон 0..255.
     */

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
     IMAGE DATA -> COLORED CANVAS
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
       * Чёрный RainRadar background.
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

      /*
       * Накрутка.
       */

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
     * В Canvas данные записываются
     * непосредственно пиксель-в-пиксель.
     */

    ctx.putImageData(
      output,
      0,
      0
    );

    /*
     * Запрещаем любое сглаживание.
     */

    ctx.imageSmoothingEnabled =
      false;

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

              const canvas =
                document.createElement(
                  "canvas"
                );

              /*
               * НИКОГДА не растягиваем
               * исходный raster.
               */

              const width =
                image.naturalWidth ||
                256;

              const height =
                image.naturalHeight ||
                256;

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
               * Критически важно:
               * отключаем интерполяцию
               * при чтении исходного тайла.
               */

              ctx.imageSmoothingEnabled =
                false;

              ctx.clearRect(
                0,
                0,
                width,
                height
              );

              ctx.drawImage(
                image,
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
     INVALIDATE COLORED CACHE
     ======================================================= */

  function invalidateColoredCache() {

    coloredCache.clear();

  }

  /* =======================================================
     NAVIGATION BUTTON
     ======================================================= */

  function createNav() {

    if (
      $("rainRadarNav")
    ) {

      rainRadarNav =
        $("rainRadarNav");

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

          /*
           * ФИЗИЧЕСКИЙ размер:
           * ровно 256×256.
           */

          tile.width =
            256;

          tile.height =
            256;

          /*
           * CSS размер:
           * тоже ровно 256×256.
           */

          tile.style.width =
            "256px";

          tile.style.height =
            "256px";

          /*
           * Никакого сглаживания.
           */

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
              "2d",
              {
                willReadFrequently:
                  true
              }
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

          buildColoredTile(
            timestamp,
            coords
          )
            .then(
              canvas => {

                /*
                 * На случай, если Canvas
                 * браузер попытается
                 * интерполировать.
                 */

                ctx.imageSmoothingEnabled =
                  false;

                ctx.clearRect(
                  0,
                  0,
                  256,
                  256
                );

                /*
                 * Размеры строго одинаковые:
                 * 256 → 256.
                 *
                 * Поэтому здесь нет
                 * масштабирования.
                 */

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
           * Слой существует,
           * но абсолютно прозрачен,
           * пока не готов весь кадр.
           */

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

          /*
           * Есть незагруженные тайлы.
           */

          if (
            this._pendingTiles.size !==
            0
          ) {

            return;

          }

          /*
           * Если были ошибки —
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

          /*
           * ВСЯ мозаика готова.
           */

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
     CREATE FRAME
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

    /*
     * Новый слой невидим.
     */

    layer.setOpacity(
      0
    );

    rainRadarLayer =
      layer;

    layer.once(
      "frameready",
      event => {

        /*
         * Этот кадр уже устарел.
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
         * Хотя бы один тайл
         * не загрузился.
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
         * ВСЕ тайлы готовы.
         *
         * Теперь новый кадр
         * становится видимым.
         */

        layer.setOpacity(
          1
        );

        /*
         * И только после этого
         * удаляем старый.
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
     SHOW
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

      currentIndex =
        timestamps.length - 1;

      updateTimeline();

      await setFrame(
        currentIndex
      );

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
              event.ready
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

          const next =
            currentIndex >=
            timestamps.length - 1
              ? 0
              : currentIndex + 1;

          await setFrame(
            next
          );

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

    /*
     * Сначала ищем распространённые ID/classes.
     */

    const direct =
      document.querySelector(
        [
          "#settings",
          "#settingsPanel",
          "#settingsPopup",
          ".settings",
          ".settings-panel",
          ".settings-popup",
          ".settings-content",
          "[data-settings]"
        ].join(",")
      );

    if (
      direct
    ) {

      return direct;

    }

    /*
     * Если конкретного класса нет,
     * ищем элемент, содержащий заголовок
     * "Настройки".
     */

    const all =
      document.querySelectorAll(
        "div,section,aside"
      );

    for (
      const element of all
    ) {

      const text =
        (
          element.textContent ||
          ""
        ).trim();

      if (
        text === "Настройки" ||
        text.startsWith(
          "Настройки"
        )
      ) {

        if (
          element.children.length
        ) {

          return element;

        }

      }

    }

    return null;
  }

  function createRainRadarSettings() {

    if (
      settingsControl
    ) {

      return;

    }

    const container =
      findSettingsContainer();

    if (
      !container
    ) {

      return;

    }

    /*
     * Не создаём второй блок.
     */

    if (
      container.querySelector(
        "#cloradRainRadarBoost"
      )
    ) {

      settingsControl =
        container.querySelector(
          "#cloradRainRadarBoost"
        );

      return;

    }

    const block =
      document.createElement(
        "div"
      );

    block.id =
      "cloradRainRadarBoost";

    block.style.cssText =
      [
        "margin-top:12px",
        "padding:12px",
        "border:1px solid rgba(255,255,255,.10)",
        "border-radius:10px",
        "background:rgba(255,255,255,.035)"
      ].join(";");

    const title =
      document.createElement(
        "div"
      );

    title.style.cssText =
      [
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "gap:10px",
        "font-size:14px",
        "font-weight:600",
        "margin-bottom:9px"
      ].join(";");

    const label =
      document.createElement(
        "span"
      );

    label.textContent =
      "Накрутка RainRadar";

    const value =
      document.createElement(
        "span"
      );

    value.id =
      "cloradRainRadarBoostValue";

    value.textContent =
      String(
        rainRadarBoost
      );

    value.style.cssText =
      [
        "min-width:30px",
        "text-align:center",
        "font-variant-numeric:tabular-nums"
      ].join(";");

    title.appendChild(
      label
    );

    title.appendChild(
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
        rainRadarBoost
      );

    range.style.cssText =
      [
        "width:100%",
        "display:block",
        "margin:0",
        "accent-color:#63eda5"
      ].join(";");

    const scale =
      document.createElement(
        "div"
      );

    scale.style.cssText =
      [
        "display:flex",
        "justify-content:space-between",
        "font-size:11px",
        "opacity:.55",
        "margin-top:5px"
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

    block.appendChild(
      title
    );

    block.appendChild(
      range
    );

    block.appendChild(
      scale
    );

    /*
     * Добавляем в конец панели настроек,
     * не изменяя существующий HTML.
     */

    container.appendChild(
      block
    );

    settingsControl =
      block;

    range.addEventListener(
      "input",
      () => {

        const value =
          Math.max(
            BOOST_MIN,
            Math.min(
              BOOST_MAX,
              Number(
                range.value
              )
            )
          );

        rainRadarBoost =
          value;

        value.textContent =
          String(
            rainRadarBoost
          );

        saveBoost(
          rainRadarBoost
        );

        /*
         * Старые цветные тайлы
         * больше не подходят.
         */

        invalidateColoredCache();

        /*
         * Мгновенно перекрашиваем
         * уже отображаемый кадр.
         */

        refreshCurrentFrameInstant();

      }
    );

  }

  /* =======================================================
     INSTANT BOOST UPDATE
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

    /*
     * Если текущий слой уже есть,
     * перекрашиваем только его видимые тайлы.
     *
     * Исходные grayscale ImageData
     * уже находятся в кэше.
     */

    if (
      rainRadarLayer &&
      rainRadarLayer._tiles
    ) {

      const layer =
        rainRadarLayer;

      const tiles =
        Object.values(
          layer._tiles
        );

      /*
       * Пока перекрашиваем,
       * слой временно скрываем.
       */

      layer.setOpacity(
        0
      );

      let pending =
        tiles.length;

      if (
        pending === 0
      ) {

        layer.setOpacity(
          1
        );

        return;

      }

      let failed =
        false;

      for (
        const item of tiles
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

              const ctx =
                tile.getContext(
                  "2d",
                  {
                    willReadFrequently:
                      true
                  }
                );

              if (
                !ctx
              ) {

                failed =
                  true;

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

                /*
                 * Все видимые тайлы
                 * одновременно возвращаем.
                 */

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
                  1
                );

              }

            }
          );

      }

      return;

    }

    /*
     * Если тайлы ещё не созданы —
     * обычное переключение кадра.
     */

    setFrame(
      currentIndex
    );

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

            await loadFrames();

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
                wasPlaying
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

    active =
      false;

    stopPlayback();

    stopRefresh();

    ++requestId;

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

    rainRadarLayer =
      null;

  }

  /* =======================================================
     INIT
     ======================================================= */

  function init() {

    createNav();

    hookTimeline();

    createRainRadarSettings();

    /*
     * Панель настроек может создаваться
     * другим скриптом позже.
     *
     * Поэтому проверяем несколько раз.
     */

    setTimeout(
      () => {

        hookTimeline();

        createRainRadarSettings();

      },
      300
    );

    setTimeout(
      () => {

        hookTimeline();

        createRainRadarSettings();

      },
      800
    );

    setTimeout(
      () => {

        hookTimeline();

        createRainRadarSettings();

      },
      1500
    );

    setTimeout(
      () => {

        hookTimeline();

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
      init
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

        rainRadarBoost =
          next;

        saveBoost(
          next
        );

        invalidateColoredCache();

        const range =
          document.getElementById(
            "cloradRainRadarBoostRange"
          );

        const output =
          document.getElementById(
            "cloradRainRadarBoostValue"
          );

        if (
          range
        ) {

          range.value =
            String(
              next
            );

        }

        if (
          output
        ) {

          output.textContent =
            String(
              next
            );

        }

        refreshCurrentFrameInstant();

      }

  };

})();
