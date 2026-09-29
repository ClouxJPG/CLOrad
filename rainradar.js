/* =========================================================
   CLOrad — RainRadar
   Источник:
   https://rainradar.ru/composite/

   Формат:
   /composite/{timestamp}/{z}/{x}_{y}.png

   Возможности:
   - RainRadar через собственный API
   - пиксельная отрисовка
   - прозрачный чёрный фон
   - RGMC / Nowcast-style reflectivity palette
   - легенда О / Отражаемость
   - 19 уровней dBZ
   - атомарная загрузка кадров
   - timeline
   - play
   - автообновление
   - усиление 1–30
   - полное отключение при выборе другого слоя

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

  const RAINRADAR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  const MIN_ZOOM = 3;
  const MAX_ZOOM = 14;

  const NATIVE_MIN_ZOOM = 3;
  const NATIVE_MAX_ZOOM = 5;

  const REFRESH_INTERVAL = 60 * 1000;

  const DEFAULT_BOOST = 15;

  const BOOST_MIN = 1;
  const BOOST_MAX = 30;

  const CACHE_LIMIT = 80;

  const $ = id =>
    document.getElementById(id);


  /* =======================================================
     REFLECTIVITY PALETTE
     
     По предоставленной пользователем легенде.
     
     Индексы:
       0  = empty
       1  = -30 dBZ
       2  = -10 dBZ
       3  = -5 dBZ
       4  = 0 dBZ
       5  = 5 dBZ
       6  = 10 dBZ
       7  = 15 dBZ
       8  = 20 dBZ
       9  = 25 dBZ
       10 = 30 dBZ
       11 = 35 dBZ
       12 = 40 dBZ
       13 = 45 dBZ
       14 = 50 dBZ
       15 = 55 dBZ
       16 = 60 dBZ
       17 = 65 dBZ
       18 = 70 dBZ
     ======================================================= */

  const REFLECTIVITY_PALETTE = [
    "#d7d7d7", // empty
    "#e5e5e5", // -30
    "#bfbfbf", // -10
    "#b9d8f1", // -5
    "#ccffad", // 0
    "#72ff52", // 5
    "#3bb9ed", // 10
    "#3c75e8", // 15
    "#4c3bd6", // 20
    "#4e4aa5", // 25
    "#fff82d", // 30
    "#ffa143", // 35
    "#ff7376", // 40
    "#ff303b", // 45
    "#76df4e", // 50
    "#4ac353", // 55
    "#f53cf2", // 60
    "#b442f2", // 65
    "#a64d4d"  // 70
  ];

  const REFLECTIVITY_LABELS = [
    "нет данных",
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


  /* =======================================================
     STATE
     ======================================================= */

  let active = false;

  let gifTimestamp = null;

  let currentFrame = 0;

  let frameList = [];

  let refreshTimer = null;

  let playbackTimer = null;

  let playbackRunning = false;

  let playbackBusy = false;

  let requestId = 0;

  let boostValue = DEFAULT_BOOST;

  let currentLayer = null;

  const rainRadarLayers =
    new Set();

  const grayscaleCache =
    new Map();

  const coloredCache =
    new Map();


  /* =======================================================
     LOAD SAVED BOOST
     ======================================================= */

  try {
    const saved =
      Number(
        localStorage.getItem(
          "clorad-rainradar-boost"
        )
      );

    if (
      Number.isFinite(saved) &&
      saved >= BOOST_MIN &&
      saved <= BOOST_MAX
    ) {
      boostValue = saved;
    }
  } catch {}


  /* =======================================================
     HELPERS
     ======================================================= */

  function clamp(
    value,
    min,
    max
  ) {
    return Math.max(
      min,
      Math.min(
        max,
        value
      )
    );
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

    const x =
      document.createElement(
        "div"
      );

    x.textContent = text;

    x.style =
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
      x
    );

    setTimeout(
      () => x.remove(),
      1800
    );
  }


  function hexToRgb(
    hex
  ) {
    const value =
      hex.replace(
        "#",
        ""
      );

    return {
      r: parseInt(
        value.slice(0, 2),
        16
      ),
      g: parseInt(
        value.slice(2, 4),
        16
      ),
      b: parseInt(
        value.slice(4, 6),
        16
      )
    };
  }


  const paletteRGB =
    REFLECTIVITY_PALETTE.map(
      hexToRgb
    );


  /* =======================================================
     GRAYSCALE → REFLECTIVITY
     
     RainRadar gives grayscale imagery.
     
     We convert the grayscale level into one of the
     19 reflectivity classes.
     ======================================================= */

  function grayscaleToPaletteIndex(
    value
  ) {
    if (
      value <= 0
    ) {
      return 0;
    }

    const normalized =
      value / 255;

    /*
      Boost:
      1  = almost original
      15 = default
      30 = maximum enhancement
    */

    const boost =
      clamp(
        boostValue,
        BOOST_MIN,
        BOOST_MAX
      );

    /*
      Higher boost moves weak echoes
      into more visible reflectivity
      colors.
    */

    const strength =
      0.72 -
      (
        (boost - 1) /
        (BOOST_MAX - 1)
      ) * 0.48;

    const corrected =
      Math.pow(
        normalized,
        strength
      );

    /*
      Keep zero transparent.
    */

    if (
      corrected <= 0.01
    ) {
      return 0;
    }

    let index =
      Math.floor(
        corrected *
        (REFLECTIVITY_PALETTE.length - 1)
      ) + 1;

    index =
      clamp(
        index,
        1,
        REFLECTIVITY_PALETTE.length - 1
      );

    return index;
  }


  /* =======================================================
     TILE COLORIZATION
     ======================================================= */

  function colorizeImage(
    image
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      image.naturalWidth ||
      image.width;

    canvas.height =
      image.naturalHeight ||
      image.height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );

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
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      const gray =
        data[i];

      const alpha =
        data[i + 3];

      /*
        Black / empty pixels become transparent.
      */

      if (
        alpha === 0 ||
        gray <= 1
      ) {
        data[i + 3] = 0;
        continue;
      }

      const index =
        grayscaleToPaletteIndex(
          gray
        );

      if (
        index <= 0
      ) {
        data[i + 3] = 0;
        continue;
      }

      const color =
        paletteRGB[index];

      data[i] =
        color.r;

      data[i + 1] =
        color.g;

      data[i + 2] =
        color.b;

      data[i + 3] =
        255;
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }


  /* =======================================================
     CACHE
     ======================================================= */

  function cacheSet(
    cache,
    key,
    value
  ) {
    cache.set(
      key,
      value
    );

    while (
      cache.size >
      CACHE_LIMIT
    ) {
      const first =
        cache.keys().next().value;

      cache.delete(
        first
      );
    }
  }


  function clearColorCache() {
    coloredCache.clear();
  }


  /* =======================================================
     API
     ======================================================= */

  async function getManifest() {
    const response =
      await fetch(
        `${API}?manifest=1`,
        {
          cache: "no-store"
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `RainRadar manifest: ${response.status}`
      );
    }

    const data =
      await response.json();

    if (
      !data ||
      !data.ok ||
      !Array.isArray(
        data.frames
      )
    ) {
      throw new Error(
        "RainRadar: некорректный manifest"
      );
    }

    return data;
  }


  function getTileUrl(
    timestamp,
    z,
    x,
    y
  ) {
    return (
      `${API}` +
      `?timestamp=${encodeURIComponent(timestamp)}` +
      `&z=${z}` +
      `&x=${x}` +
      `&y=${y}`
    );
  }


  /* =======================================================
     IMAGE LOADER
     ======================================================= */

  async function loadTileImage(
    url
  ) {
    if (
      grayscaleCache.has(url)
    ) {
      return grayscaleCache.get(
        url
      );
    }

    const promise =
      new Promise(
        (
          resolve,
          reject
        ) => {
          const image =
            new Image();

          image.decoding =
            "async";

          image.crossOrigin =
            "anonymous";

          image.onload =
            () => resolve(
              image
            );

          image.onerror =
            () => reject(
              new Error(
                "Tile load failed"
              )
            );

          image.src =
            url;
        }
      );

    cacheSet(
      grayscaleCache,
      url,
      promise
    );

    return promise;
  }


  async function getColoredTile(
    url
  ) {
    const cacheKey =
      `${url}|boost:${boostValue}`;

    if (
      coloredCache.has(
        cacheKey
      )
    ) {
      return coloredCache.get(
        cacheKey
      );
    }

    const image =
      await loadTileImage(
        url
      );

    const canvas =
      colorizeImage(
        image
      );

    cacheSet(
      coloredCache,
      cacheKey,
      canvas
    );

    return canvas;
  }


  /* =======================================================
     CUSTOM GRID LAYER
     ======================================================= */

  const RainRadarGridLayer =
    L.GridLayer.extend({

      initialize:
        function (
          timestamp,
          options
        ) {
          L.GridLayer.prototype.initialize.call(
            this,
            {
              tileSize: 256,
              noWrap: true,
              bounds:
                L.latLngBounds(
                  RAINRADAR_BOUNDS
                ),
              updateWhenZooming: false,
              updateWhenIdle: true,
              keepBuffer: 1,
              ...options
            }
          );

          this.timestamp =
            timestamp;

          this._pendingTiles =
            new Set();

          this._failedTiles =
            new Set();

          this._ready =
            false;

          this._frameToken =
            requestId;
        },


      createTile:
        function (
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

          tile.style.imageRendering =
            "pixelated";

          tile.style.msInterpolationMode =
            "nearest-neighbor";

          const ctx =
            tile.getContext(
              "2d"
            );

          ctx.imageSmoothingEnabled =
            false;

          const key =
            `${coords.z}/${coords.x}/${coords.y}`;

          this._pendingTiles.add(
            key
          );

          const url =
            getTileUrl(
              this.timestamp,
              coords.z,
              coords.x,
              coords.y
            );

          getColoredTile(
            url
          )
            .then(
              canvas => {

                /*
                  If RainRadar was stopped while
                  this tile was loading, don't put
                  anything back on the map.
                */

                if (
                  !active ||
                  this._frameToken !==
                    requestId
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
                  256,
                  256
                );

                ctx.imageSmoothingEnabled =
                  false;

                ctx.drawImage(
                  canvas,
                  0,
                  0,
                  256,
                  256
                );

                this._pendingTiles.delete(
                  key
                );

                this._checkReady();

                done(
                  null,
                  tile
                );
              }
            )
            .catch(
              error => {

                this._failedTiles.add(
                  key
                );

                this._pendingTiles.delete(
                  key
                );

                this._checkReady();

                done(
                  error,
                  tile
                );
              }
            );

          return tile;
        },


      _checkReady:
        function () {

          if (
            !this._pendingTiles.size &&
            !this._ready
          ) {
            this._ready =
              true;

            this.fire(
              "frameready"
            );
          }
        }

    });


  /* =======================================================
     REMOVE ALL RAINRADAR LAYERS
     ======================================================= */

  function removeAllRainRadarLayers() {

    if (
      !window.map
    ) {
      rainRadarLayers.clear();
      currentLayer = null;
      return;
    }

    for (
      const layer of
      rainRadarLayers
    ) {
      try {
        if (
          window.map.hasLayer(
            layer
          )
        ) {
          window.map.removeLayer(
            layer
          );
        }
      } catch {}
    }

    rainRadarLayers.clear();

    currentLayer =
      null;
  }


  /* =======================================================
     STOP PLAYBACK
     ======================================================= */

  function stopPlayback() {

    playbackRunning =
      false;

    playbackBusy =
      false;

    if (
      playbackTimer
    ) {
      clearTimeout(
        playbackTimer
      );

      playbackTimer =
        null;
    }

    const button =
      document.querySelector(
        ".timeline .play"
      ) ||
      document.querySelector(
        ".timeline button"
      );

    if (
      button
    ) {
      button.classList.remove(
        "active"
      );
    }
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

      refreshTimer =
        null;
    }
  }


  /* =======================================================
     STOP RAINRADAR
     ======================================================= */

  function stop() {

    active =
      false;

    requestId++;

    stopPlayback();

    stopRefresh();

    removeAllRainRadarLayers();

    restoreOriginalLegend();

    updateRainRadarNavState(
      false
    );
  }


  /* =======================================================
     PUBLIC STOP API
     ======================================================= */

  window.CLOradStopRainRadar =
    stop;

  window.CLOradDeactivateRainRadar =
    stop;


  /* =======================================================
     CREATE FRAME LAYER
     ======================================================= */

  function createLayer(
    timestamp,
    token
  ) {
    return new Promise(
      resolve => {

        const layer =
          new RainRadarGridLayer(
            timestamp
          );

        rainRadarLayers.add(
          layer
        );

        let resolved =
          false;

        const finish =
          () => {

            if (
              resolved
            ) {
              return;
            }

            resolved =
              true;

            resolve(
              layer
            );
          };

        layer.once(
          "frameready",
          () => {

            /*
              Atomic frame protection.
              If user switched layer while
              tiles were loading, remove this
              frame immediately.
            */

            if (
              !active ||
              token !==
                requestId
            ) {
              try {
                window.map.removeLayer(
                  layer
                );
              } catch {}

              rainRadarLayers.delete(
                layer
              );

              finish();

              return;
            }

            finish();
          }
        );

        layer.once(
          "tileerror",
          () => {
            /*
              Individual tile errors do not
              immediately kill the whole frame.
            */
          }
        );

        layer.addTo(
          window.map
        );

        /*
          If there are no tiles at the current
          viewport, consider the layer ready.
        */

        setTimeout(
          () => {

            if (
              !layer._ready &&
              !layer._pendingTiles.size
            ) {
              layer._ready =
                true;

              layer.fire(
                "frameready"
              );
            }

          },
          120
        );
      }
    );
  }


  /* =======================================================
     SET FRAME
     ======================================================= */

  async function setFrame(
    index,
    options = {}
  ) {
    if (
      !active
    ) {
      return;
    }

    if (
      !window.map
    ) {
      return;
    }

    if (
      !frameList.length
    ) {
      return;
    }

    const token =
      requestId;

    index =
      ((index %
        frameList.length) +
        frameList.length) %
      frameList.length;

    const timestamp =
      frameList[index];

    const newLayer =
      await createLayer(
        timestamp,
        token
      );

    if (
      !active ||
      token !==
        requestId
    ) {
      try {
        window.map.removeLayer(
          newLayer
        );
      } catch {}

      rainRadarLayers.delete(
        newLayer
      );

      return;
    }

    /*
      New frame is completely ready.
      Only now remove old frame.
    */

    const oldLayer =
      currentLayer;

    currentLayer =
      newLayer;

    currentFrame =
      index;

    if (
      oldLayer &&
      oldLayer !==
        newLayer
    ) {
      try {
        window.map.removeLayer(
          oldLayer
        );
      } catch {}

      rainRadarLayers.delete(
        oldLayer
      );
    }

    updateTimeline(
      index
    );
  }


  /* =======================================================
     TIMELINE
     ======================================================= */

  function getTimelineInput() {
    return document.querySelector(
      ".timeline input[type='range']"
    );
  }


  function updateTimeline(
    index
  ) {
    const input =
      getTimelineInput();

    if (
      !input
    ) {
      return;
    }

    input.min =
      "0";

    input.max =
      String(
        Math.max(
          0,
          frameList.length - 1
        )
      );

    input.step =
      "1";

    input.value =
      String(
        index
      );
  }


  function setupTimeline() {

    const input =
      getTimelineInput();

    if (
      !input
    ) {
      return;
    }

    if (
      input.dataset.rainradarBound ===
      "1"
    ) {
      return;
    }

    input.dataset.rainradarBound =
      "1";

    input.addEventListener(
      "input",
      async () => {

        if (
          !active
        ) {
          return;
        }

        const index =
          Number(
            input.value
          );

        await setFrame(
          index
        );
      }
    );
  }


  /* =======================================================
     PLAYBACK
     ======================================================= */

  async function playbackLoop() {

    if (
      !playbackRunning ||
      !active
    ) {
      return;
    }

    if (
      playbackBusy
    ) {
      playbackTimer =
        setTimeout(
          playbackLoop,
          150
        );

      return;
    }

    playbackBusy =
      true;

    try {

      let next =
        currentFrame + 1;

      if (
        next >=
        frameList.length
      ) {
        next = 0;
      }

      await setFrame(
        next
      );

    } catch {}

    playbackBusy =
      false;

    if (
      playbackRunning &&
      active
    ) {
      playbackTimer =
        setTimeout(
          playbackLoop,
          700
        );
    }
  }


  function togglePlayback() {

    if (
      !active ||
      frameList.length < 2
    ) {
      return;
    }

    if (
      playbackRunning
    ) {
      stopPlayback();
      return;
    }

    playbackRunning =
      true;

    const button =
      document.querySelector(
        ".timeline .play"
      ) ||
      document.querySelector(
        ".timeline button"
      );

    if (
      button
    ) {
      button.classList.add(
        "active"
      );
    }

    playbackLoop();
  }


  function setupPlayButton() {

    const button =
      document.querySelector(
        ".timeline .play"
      ) ||
      document.querySelector(
        ".timeline button"
      );

    if (
      !button
    ) {
      return;
    }

    if (
      button.dataset.rainradarBound ===
      "1"
    ) {
      return;
    }

    button.dataset.rainradarBound =
      "1";

    button.addEventListener(
      "click",
      event => {

        if (
          !active
        ) {
          return;
        }

        event.stopPropagation();

        togglePlayback();
      },
      true
    );
  }


  /* =======================================================
     REFRESH
     ======================================================= */

  async function refreshCurrentFrame() {

    if (
      !active
    ) {
      return;
    }

    const token =
      requestId;

    try {

      const manifest =
        await getManifest();

      if (
        !active ||
        token !==
          requestId
      ) {
        return;
      }

      const frames =
        manifest.frames
          .map(
            frame =>
              Number(
                frame.timestamp
              )
          )
          .filter(
            Number.isFinite
          );

      if (
        !frames.length
      ) {
        return;
      }

      frameList =
        frames;

      const latest =
        frames[
          frames.length - 1
        ];

      if (
        latest !==
        gifTimestamp
      ) {
        gifTimestamp =
          latest;

        clearColorCache();

        await setFrame(
          frames.length - 1
        );
      }

    } catch (
      error
    ) {
      console.warn(
        "CLOrad RainRadar refresh:",
        error
      );
    }
  }


  function startRefresh() {

    stopRefresh();

    refreshTimer =
      setInterval(
        refreshCurrentFrame,
        REFRESH_INTERVAL
      );
  }


  /* =======================================================
     RAINRADAR NAV BUTTON
     ======================================================= */

  function createNavButton() {

    let button =
      $("rainRadarNav");

    const rainButton =
      $("rainProduct");

    const nav =
      $("nav");

    if (
      button
    ) {
      return button;
    }

    if (
      !nav
    ) {
      return null;
    }

    button =
      document.createElement(
        "button"
      );

    button.className =
      "n";

    button.id =
      "rainRadarNav";

    button.innerHTML =
      `
      <svg viewBox="0 0 24 24">
        <path d="M5 20V11M12 20V6M19 20V3"/>
      </svg>
      RainRadar
      `;

    if (
      rainButton &&
      rainButton.parentNode ===
        nav
    ) {
      rainButton.insertAdjacentElement(
        "afterend",
        button
      );
    } else {
      nav.appendChild(
        button
      );
    }

    button.addEventListener(
      "click",
      event => {

        event.stopPropagation();

        activate();
      }
    );

    return button;
  }


  function updateRainRadarNavState(
    state
  ) {
    const button =
      $("rainRadarNav");

    if (
      !button
    ) {
      return;
    }

    button.classList.toggle(
      "active",
      Boolean(state)
    );
  }


  /* =======================================================
     NAVIGATION MONITOR
     
     If another layer is selected,
     RainRadar disappears immediately.
     ======================================================= */

  function setupNavigationMonitor() {

    const nav =
      $("nav");

    if (
      !nav
    ) {
      return;
    }

    if (
      nav.dataset.rainradarMonitor ===
      "1"
    ) {
      return;
    }

    nav.dataset.rainradarMonitor =
      "1";

    /*
      Capture phase:
      stop RainRadar BEFORE other navigation
      handlers start loading another layer.
    */

    nav.addEventListener(
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
          "rainRadarNav"
        ) {
          return;
        }

        stop();
      },
      true
    );


    /*
      Also monitor programmatic changes
      to .active.
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
     LEGEND
     
     Existing index.html legend is reused.
     No changes to index.html.
     ======================================================= */

  const originalLegendState =
    new Map();

  let legendWasSaved =
    false;


  function getLegendElements() {

    const result = [];

    for (
      let i = 1;
      i <= 19;
      i++
    ) {

      const elements =
        document.querySelectorAll(
          `.l${i}`
        );

      for (
        const element of
        elements
      ) {
        result.push({
          element,
          index: i - 1
        });
      }
    }

    return result;
  }


  function saveOriginalLegend() {

    if (
      legendWasSaved
    ) {
      return;
    }

    const elements =
      getLegendElements();

    if (
      !elements.length
    ) {
      return;
    }

    for (
      const item of
      elements
    ) {

      const element =
        item.element;

      originalLegendState.set(
        element,
        {
          text:
            element.textContent,
          html:
            element.innerHTML,
          style:
            element.getAttribute(
              "style"
            ),
          className:
            element.className
        }
      );
    }

    /*
      Also save possible title/header
      elements in the legend.
    */

    const candidates =
      document.querySelectorAll(
        ".legend-title," +
        ".legend-header," +
        ".legend h3," +
        ".legend h4," +
        "#legendTitle," +
        "#legendHeader"
      );

    for (
      const element of
      candidates
    ) {

      originalLegendState.set(
        element,
        {
          text:
            element.textContent,
          html:
            element.innerHTML,
          style:
            element.getAttribute(
              "style"
            ),
          className:
            element.className
        }
      );
    }

    legendWasSaved =
      true;
  }


  function findLegendTitle() {

    const selectors = [
      ".legend-title",
      ".legend-header",
      ".legend h3",
      ".legend h4",
      "#legendTitle",
      "#legendHeader"
    ];

    for (
      const selector of
      selectors
    ) {

      const element =
        document.querySelector(
          selector
        );

      if (
        element
      ) {
        return element;
      }
    }

    return null;
  }


  function activateReflectivityLegend() {

    saveOriginalLegend();

    const elements =
      getLegendElements();

    /*
      Change the existing 19 color blocks
      and their text.
    */

    for (
      const item of
      elements
    ) {

      const element =
        item.element;

      const index =
        item.index;

      if (
        index >=
        REFLECTIVITY_PALETTE.length
      ) {
        continue;
      }

      /*
        Preserve layout/classes.
        Only change the visual color.
      */

      element.style.background =
        REFLECTIVITY_PALETTE[index];

      element.style.backgroundColor =
        REFLECTIVITY_PALETTE[index];

      element.style.backgroundImage =
        "none";

      element.style.color =
        index === 0 ||
        index === 1 ||
        index === 2
          ? "#111"
          : "#fff";

      /*
        If the element itself contains
        the label, replace it.
      */

      const text =
        element.querySelector(
          ".legend-label"
        );

      if (
        text
      ) {
        text.textContent =
          REFLECTIVITY_LABELS[
            index
          ];
      }
    }


    /*
      Some existing legends have the
      text outside .l1–.l19.
      Replace text nodes conservatively.
    */

    const legendRows =
      document.querySelectorAll(
        ".legend-item," +
        ".legend-row," +
        ".legend-line"
      );

    for (
      const row of
      legendRows
    ) {

      const children =
        Array.from(
          row.children
        );

      const colorElement =
        children.find(
          child =>
            child.classList.contains(
              "l1"
            ) ||
            child.classList.contains(
              "l2"
            ) ||
            child.classList.contains(
              "l3"
            ) ||
            child.classList.contains(
              "l4"
            ) ||
            child.classList.contains(
              "l5"
            ) ||
            child.classList.contains(
              "l6"
            ) ||
            child.classList.contains(
              "l7"
            ) ||
            child.classList.contains(
              "l8"
            ) ||
            child.classList.contains(
              "l9"
            ) ||
            child.classList.contains(
              "l10"
            ) ||
            child.classList.contains(
              "l11"
            ) ||
            child.classList.contains(
              "l12"
            ) ||
            child.classList.contains(
              "l13"
            ) ||
            child.classList.contains(
              "l14"
            ) ||
            child.classList.contains(
              "l15"
            ) ||
            child.classList.contains(
              "l16"
            ) ||
            child.classList.contains(
              "l17"
            ) ||
            child.classList.contains(
              "l18"
            ) ||
            child.classList.contains(
              "l19"
            )
        );

      if (
        !colorElement
      ) {
        continue;
      }

      const className =
        Array.from(
          colorElement.classList
        ).find(
          name =>
            /^l\d+$/.test(
              name
            )
        );

      if (
        !className
      ) {
        continue;
      }

      const index =
        Number(
          className.slice(1)
        ) - 1;

      const label =
        children.find(
          child =>
            child !==
            colorElement
        );

      if (
        label &&
        Number.isInteger(index) &&
        REFLECTIVITY_LABELS[
          index
        ]
      ) {
        label.textContent =
          REFLECTIVITY_LABELS[
            index
          ];
      }
    }


    /*
      Header:
      О
      Отражаемость (dBZ)
    */

    const title =
      findLegendTitle();

    if (
      title
    ) {
      title.innerHTML =
        `
        <span style="font-weight:700">О</span>
        <span style="opacity:.85">
          Отражаемость (dBZ)
        </span>
        `;
    }


    /*
      Generic legend text replacement.
      This catches simple text-based
      OЯ / ОЯ: structures without touching
      unrelated map elements.
    */

    const allTextElements =
      document.querySelectorAll(
        ".legend, #legend, .legend-panel, .legend-drawer"
      );

    for (
      const container of
      allTextElements
    ) {

      const text =
        container.textContent || "";

      if (
        /ОЯ/.test(text)
      ) {

        const walker =
          document.createTreeWalker(
            container,
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
            /ОЯ/.test(
              textNode.nodeValue
            )
          ) {
            textNode.nodeValue =
              textNode.nodeValue.replace(
                /ОЯ/g,
                "О"
              );
          }
        }
      }
    }
  }


  function restoreOriginalLegend() {

    if (
      !legendWasSaved
    ) {
      return;
    }

    for (
      const [
        element,
        state
      ] of
      originalLegendState
    ) {

      element.innerHTML =
        state.html;

      if (
        state.style ===
        null
      ) {
        element.removeAttribute(
          "style"
        );
      } else {
        element.setAttribute(
          "style",
          state.style
        );
      }

      element.className =
        state.className;
    }
  }


  /* =======================================================
     SETTINGS
     ======================================================= */

  function findSettingsContainer() {

    return (
      $("settings") ||
      document.querySelector(
        "#settings"
      )
    );
  }


  function createBoostSettings() {

    const settings =
      findSettingsContainer();

    if (
      !settings
    ) {
      return;
    }

    let block =
      $("rainRadarBoostSetting");

    if (
      block
    ) {
      updateBoostUI();
      return;
    }

    block =
      document.createElement(
        "div"
      );

    block.id =
      "rainRadarBoostSetting";

    block.innerHTML =
      `
      <div
        style="
          margin-top:12px;
          padding-top:12px;
          border-top:1px solid rgba(255,255,255,.08);
        "
      >

        <div
          style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:10px;
            margin-bottom:8px;
          "
        >

          <span>
            Усиление RainRadar
          </span>

          <b
            id="rainRadarBoostValue"
            style="
              min-width:28px;
              text-align:right;
            "
          >
            ${boostValue}
          </b>

        </div>

        <input
          id="rainRadarBoostRange"
          type="range"
          min="${BOOST_MIN}"
          max="${BOOST_MAX}"
          step="1"
          value="${boostValue}"
          style="
            width:100%;
          "
        >

        <button
          id="rainRadarBoostApply"
          type="button"
          style="
            margin-top:8px;
            width:100%;
          "
        >
          Применить
        </button>

      </div>
      `;

    settings.appendChild(
      block
    );

    const range =
      $("rainRadarBoostRange");

    const value =
      $("rainRadarBoostValue");

    const apply =
      $("rainRadarBoostApply");

    if (
      range
    ) {
      range.addEventListener(
        "input",
        () => {

          if (
            value
          ) {
            value.textContent =
              range.value;
          }
        }
      );
    }

    if (
      apply
    ) {

      apply.addEventListener(
        "click",
        async () => {

          const newValue =
            clamp(
              Number(
                range?.value
              ),
              BOOST_MIN,
              BOOST_MAX
            );

          boostValue =
            newValue;

          try {
            localStorage.setItem(
              "clorad-rainradar-boost",
              String(
                boostValue
              )
            );
          } catch {}

          clearColorCache();

          if (
            active
          ) {

            const oldIndex =
              currentFrame;

            /*
              Completely rebuild the current
              frame using the new palette.
            */

            requestId++;

            const token =
              requestId;

            const oldLayer =
              currentLayer;

            currentLayer =
              null;

            try {

              const newLayer =
                await createLayer(
                  frameList[
                    oldIndex
                  ],
                  token
                );

              if (
                active &&
                token ===
                  requestId
              ) {

                currentLayer =
                  newLayer;

                currentFrame =
                  oldIndex;

                if (
                  oldLayer
                ) {
                  try {
                    window.map.removeLayer(
                      oldLayer
                    );
                  } catch {}

                  rainRadarLayers.delete(
                    oldLayer
                  );
                }

                showMessage(
                  `Усиление: ${boostValue}`
                );
              }

            } catch {
              currentLayer =
                oldLayer;
            }
          } else {
            showMessage(
              `Усиление: ${boostValue}`
            );
          }
        }
      );
    }
  }


  function updateBoostUI() {

    const range =
      $("rainRadarBoostRange");

    const value =
      $("rainRadarBoostValue");

    if (
      range
    ) {
      range.value =
        String(
          boostValue
        );
    }

    if (
      value
    ) {
      value.textContent =
        String(
          boostValue
        );
    }
  }


  /* =======================================================
     ACTIVATE
     ======================================================= */

  async function activate() {

    /*
      Stop any other radar layers.
    */

    if (
      typeof window.CLOradStopRadar ===
      "function"
    ) {
      window.CLOradStopRadar();
    }

    if (
      typeof window.CLOradDeactivateGIF ===
      "function"
    ) {
      window.CLOradDeactivateGIF();
    }

    active =
      true;

    requestId++;

    const token =
      requestId;

    updateRainRadarNavState(
      true
    );

    activateReflectivityLegend();

    createBoostSettings();

    setupTimeline();

    setupPlayButton();

    try {

      const manifest =
        await getManifest();

      if (
        !active ||
        token !==
          requestId
      ) {
        return;
      }

      frameList =
        manifest.frames
          .map(
            frame =>
              Number(
                frame.timestamp
              )
          )
          .filter(
            Number.isFinite
          );

      if (
        !frameList.length
      ) {
        throw new Error(
          "Нет кадров RainRadar"
        );
      }

      gifTimestamp =
        frameList[
          frameList.length - 1
        ];

      clearColorCache();

      await setFrame(
        frameList.length - 1
      );

      if (
        !active ||
        token !==
          requestId
      ) {
        return;
      }

      startRefresh();

      updateTimeline(
        currentFrame
      );

    } catch (
      error
    ) {

      console.error(
        "CLOrad RainRadar:",
        error
      );

      if (
        active &&
        token ===
          requestId
      ) {

        showMessage(
          "RainRadar: ошибка загрузки"
        );

        stop();
      }
    }
  }


  /* =======================================================
     INITIALIZATION
     ======================================================= */

  function init() {

    createNavButton();

    createBoostSettings();

    setupTimeline();

    setupPlayButton();

    setupNavigationMonitor();

    /*
      Watch nav because gif-radar.js and
      other modules may create buttons later.
    */

    if (
      typeof MutationObserver !==
      "undefined"
    ) {

      const nav =
        $("nav");

      if (
        nav
      ) {

        const observer =
          new MutationObserver(
            () => {

              const button =
                $("rainRadarNav");

              if (
                button &&
                button.dataset.rainradarClick !==
                  "1"
              ) {

                button.dataset.rainradarClick =
                  "1";

                button.addEventListener(
                  "click",
                  event => {

                    event.stopPropagation();

                    activate();
                  }
                );
              }

              setupTimeline();

              setupPlayButton();
            }
          );

        observer.observe(
          nav,
          {
            childList: true,
            subtree: true
          }
        );
      }
    }
  }


  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRainRadar = {

    activate,

    stop,

    refresh:
      refreshCurrentFrame,

    setBoost:
      value => {

        boostValue =
          clamp(
            Number(value),
            BOOST_MIN,
            BOOST_MAX
          );

        clearColorCache();

        updateBoostUI();
      },

    getBoost:
      () =>
        boostValue,

    isActive:
      () =>
        active,

    getFrames:
      () =>
        frameList.slice(),

    getCurrentFrame:
      () =>
        currentFrame
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
        once: true
      }
    );
  } else {
    init();
  }

})();
