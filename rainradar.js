/* =========================================================
   CLOrad — RainRadar
   ---------------------------------------------------------
   Осадки-мм/ч
   ДМРЛ композит
   RainRadar
   Слои

   Источник:
   RainRadar composite

   API:
   /api/rainradar
   ========================================================= */

(() => {

  "use strict";

  const API = "/api/rainradar";

  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  const MIN_ZOOM = 3;
  const MAX_NATIVE_ZOOM = 5;
  const MAX_ZOOM = 14;

  const REFRESH_MS = 60 * 1000;
  const PLAY_MS = 700;

  let timestamps = [];
  let currentIndex = 0;

  let layer = null;

  let playing = false;
  let playTimer = null;
  let refreshTimer = null;

  let initialized = false;
  let loading = false;
  let visible = false;

  /* =======================================================
     ОЯ PALETTE
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

  /* =======================================================
     STYLE
     ======================================================= */

  const style =
    document.createElement("style");

  style.textContent = `

    .clorad-rainradar,
    .clorad-rainradar img {
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      -webkit-image-rendering: pixelated;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
    }

    .clorad-rainradar img {
      image-rendering: pixelated;
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
    }

    #rainRadarNav.active {
      color: #fff;
    }

  `;

  document.head.appendChild(style);

  /* =======================================================
     MAP
     ======================================================= */

  function getMap() {

    if (
      typeof window.map !== "undefined" &&
      window.map
    ) {
      return window.map;
    }

    if (
      typeof map !== "undefined" &&
      map
    ) {
      return map;
    }

    return null;
  }

  /* =======================================================
     NAV BUTTON
     ======================================================= */

  function createNavButton() {

    const nav =
      document.getElementById("nav");

    const rainProduct =
      document.getElementById("rainProduct");

    const gifRadarNav =
      document.getElementById("gifRadarNav");

    if (!nav) {
      return null;
    }

    let button =
      document.getElementById("rainRadarNav");

    if (button) {
      return button;
    }

    button =
      document.createElement("button");

    button.id =
      "rainRadarNav";

    button.className =
      "n";

    button.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M5 19h14M7 15h10M9 11h6M11 7h2"/>
      </svg>
      RainRadar
    `;

    if (
      gifRadarNav &&
      gifRadarNav.parentNode === nav
    ) {

      gifRadarNav.insertAdjacentElement(
        "afterend",
        button
      );

    } else if (
      rainProduct &&
      rainProduct.parentNode === nav
    ) {

      rainProduct.insertAdjacentElement(
        "afterend",
        button
      );

    } else {

      nav.appendChild(button);
    }

    button.addEventListener(
      "click",
      () => {

        console.log(
          "CLOrad RainRadar: button clicked"
        );

        setActiveButton();

        showRainRadar();
      }
    );

    return button;
  }

  /* =======================================================
     ACTIVE BUTTON
     ======================================================= */

  function setActiveButton() {

    const button =
      document.getElementById(
        "rainRadarNav"
      );

    if (!button) {
      return;
    }

    document
      .querySelectorAll(".nav .n")
      .forEach(el => {

        el.classList.remove(
          "active"
        );

      });

    button.classList.add(
      "active"
    );
  }

  /* =======================================================
     TILE URL
     ======================================================= */

  function tileUrl(timestamp) {

    return (
      API +
      "?timestamp=" +
      encodeURIComponent(timestamp) +
      "&z={z}" +
      "&x={x}" +
      "&y={y}"
    );
  }

  /* =======================================================
     MANIFEST NORMALIZATION
     ======================================================= */

  function normalizeManifest(data) {

    let result = [];

    if (
      Array.isArray(data)
    ) {

      result =
        data
          .map(item => {

            if (
              typeof item === "string" ||
              typeof item === "number"
            ) {
              return String(item);
            }

            if (
              item &&
              typeof item === "object"
            ) {

              return String(
                item.timestamp ??
                item.time ??
                item.ts ??
                item.datetime ??
                item.id ??
                ""
              );
            }

            return "";
          })
          .filter(Boolean);
    }

    else if (
      data &&
      typeof data === "object"
    ) {

      const arrays = [

        data.frames,
        data.times,
        data.timestamps,
        data.images,
        data.data,
        data.items

      ];

      for (
        const arr of arrays
      ) {

        if (
          Array.isArray(arr) &&
          arr.length
        ) {

          result =
            arr
              .map(item => {

                if (
                  typeof item === "string" ||
                  typeof item === "number"
                ) {
                  return String(item);
                }

                if (
                  item &&
                  typeof item === "object"
                ) {

                  return String(
                    item.timestamp ??
                    item.time ??
                    item.ts ??
                    item.datetime ??
                    item.id ??
                    ""
                  );
                }

                return "";
              })
              .filter(Boolean);

          if (
            result.length
          ) {
            break;
          }
        }
      }

      if (
        !result.length
      ) {

        const value =
          data.timestamp ??
          data.time ??
          data.latest ??
          data.current;

        if (
          value != null
        ) {

          result = [
            String(value)
          ];
        }
      }
    }

    return [
      ...new Set(result)
    ];
  }

  /* =======================================================
     LOAD MANIFEST
     ======================================================= */

  async function loadManifest() {

    console.log(
      "CLOrad RainRadar: loading manifest"
    );

    const response =
      await fetch(
        API + "?manifest=1&_=" +
        Date.now(),
        {
          method: "GET",
          cache: "no-store",
          headers: {
            "Accept":
              "application/json"
          }
        }
      );

    console.log(
      "CLOrad RainRadar: manifest HTTP",
      response.status
    );

    if (
      !response.ok
    ) {

      throw new Error(
        "Manifest HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    console.log(
      "CLOrad RainRadar: manifest",
      data
    );

    const next =
      normalizeManifest(data);

    console.log(
      "CLOrad RainRadar: frames",
      next
    );

    if (
      !next.length
    ) {

      throw new Error(
        "Manifest contains no frames"
      );
    }

    timestamps =
      next;

    currentIndex =
      timestamps.length - 1;

    updateTimeline();

    return timestamps;
  }

  /* =======================================================
     CREATE LAYER
     ======================================================= */

  function createLayer(timestamp) {

    const map =
      getMap();

    if (!map) {

      throw new Error(
        "Leaflet map is not available"
      );
    }

    console.log(
      "CLOrad RainRadar: creating layer",
      timestamp
    );

    if (layer) {

      try {
        map.removeLayer(layer);
      } catch (_) {}

      layer = null;
    }

    layer =
      L.tileLayer(
        tileUrl(timestamp),
        {

          minZoom:
            MIN_ZOOM,

          minNativeZoom:
            MIN_ZOOM,

          maxNativeZoom:
            MAX_NATIVE_ZOOM,

          maxZoom:
            MAX_ZOOM,

          tileSize:
            256,

          opacity:
            1,

          zIndex:
            620,

          noWrap:
            true,

          bounds:
            RR_BOUNDS,

          updateWhenZooming:
            true,

          updateWhenIdle:
            true,

          keepBuffer:
            2,

          detectRetina:
            false,

          crossOrigin:
            false,

          className:
            "clorad-rainradar"

        }
      );

    layer.addTo(map);

    visible =
      true;

    updateTimeLabel();

    console.log(
      "CLOrad RainRadar: layer added"
    );
  }

  /* =======================================================
     SHOW
     ======================================================= */

  async function showRainRadar() {

    const map =
      getMap();

    if (!map) {

      console.error(
        "CLOrad RainRadar: map not found"
      );

      return;
    }

    visible =
      true;

    if (loading) {
      return;
    }

    loading =
      true;

    try {

      /*
       * СНАЧАЛА всегда получаем
       * актуальный manifest.
       */

      await loadManifest();

      /*
       * Теперь timestamp точно существует.
       */

      if (
        timestamps.length &&
        currentIndex >= 0
      ) {

        createLayer(
          timestamps[currentIndex]
        );
      }

      updateTimeline();

    } catch (error) {

      console.error(
        "CLOrad RainRadar ERROR:",
        error
      );

      /*
       * Не оставляем пользователя
       * с молчаливым "ничего".
       */

      if (
        typeof window !== "undefined"
      ) {

        window.CLOradRainRadarError =
          String(
            error?.message ||
            error
          );
      }

    } finally {

      loading =
        false;
    }
  }

  /* =======================================================
     HIDE
     ======================================================= */

  function hideRainRadar() {

    const map =
      getMap();

    visible =
      false;

    if (
      map &&
      layer
    ) {

      try {
        map.removeLayer(layer);
      } catch (_) {}

      layer =
        null;
    }
  }

  /* =======================================================
     FRAME
     ======================================================= */

  function setFrame(index) {

    if (
      !timestamps.length
    ) {
      return;
    }

    index =
      Math.max(
        0,
        Math.min(
          timestamps.length - 1,
          index
        )
      );

    currentIndex =
      index;

    const map =
      getMap();

    if (!map) {
      return;
    }

    if (layer) {

      layer.setUrl(
        tileUrl(
          timestamps[
            currentIndex
          ]
        )
      );

    } else {

      createLayer(
        timestamps[
          currentIndex
        ]
      );
    }

    updateTimeline();
  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function updateTimeline() {

    const range =
      document.getElementById(
        "range"
      );

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

      range.value =
        String(
          currentIndex
        );
    }

    updateTimeLabel();
  }

  function updateTimeLabel() {

    const label =
      document.getElementById(
        "timeLabel"
      );

    if (
      !label ||
      !timestamps.length
    ) {
      return;
    }

    const value =
      timestamps[
        currentIndex
      ];

    const date =
      new Date(value);

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {

      label.textContent =
        date.toLocaleString(
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

    } else {

      label.textContent =
        String(value);
    }
  }

  /* =======================================================
     RANGE
     ======================================================= */

  function hookRange() {

    const range =
      document.getElementById(
        "range"
      );

    if (!range) {
      return;
    }

    if (
      range.dataset.rrHooked
    ) {
      return;
    }

    range.dataset.rrHooked =
      "1";

    range.addEventListener(
      "input",
      () => {

        setFrame(
          Number(
            range.value
          )
        );
      }
    );
  }

  /* =======================================================
     PLAY
     ======================================================= */

  function stopPlay() {

    playing =
      false;

    if (playTimer) {

      clearInterval(
        playTimer
      );

      playTimer =
        null;
    }
  }

  function startPlay() {

    if (
      playing ||
      !timestamps.length
    ) {
      return;
    }

    playing =
      true;

    playTimer =
      setInterval(
        () => {

          let next =
            currentIndex + 1;

          if (
            next >=
            timestamps.length
          ) {
            next = 0;
          }

          setFrame(next);

        },
        PLAY_MS
      );
  }

  function hookPlay() {

    const play =
      document.getElementById(
        "play"
      );

    if (!play) {
      return;
    }

    if (
      play.dataset.rrHooked
    ) {
      return;
    }

    play.dataset.rrHooked =
      "1";

    play.addEventListener(
      "click",
      () => {

        if (playing) {
          stopPlay();
        } else {
          startPlay();
        }

      }
    );
  }

  /* =======================================================
     OLD SIDEBAR CONTROL
     ======================================================= */

  function removeOldSidebarControl() {

    const selectors = [

      "#rainRadarLayer",
      "#rainradarLayer",
      "#rainRadar",
      ".rainradar-layer",
      ".rainradar-control"

    ];

    selectors.forEach(
      selector => {

        document
          .querySelectorAll(
            selector
          )
          .forEach(el => {

            if (
              el.id !==
              "rainRadarNav"
            ) {

              el.remove();
            }

          });

      }
    );
  }

  /* =======================================================
     REFRESH
     ======================================================= */

  async function refresh() {

    if (loading) {
      return;
    }

    try {

      const oldLatest =
        timestamps[
          timestamps.length - 1
        ];

      await loadManifest();

      const newLatest =
        timestamps[
          timestamps.length - 1
        ];

      if (
        newLatest &&
        newLatest !== oldLatest
      ) {

        currentIndex =
          timestamps.length - 1;

        if (
          layer &&
          visible
        ) {

          layer.setUrl(
            tileUrl(
              timestamps[
                currentIndex
              ]
            )
          );

          updateTimeline();
        }
      }

    } catch (error) {

      console.error(
        "CLOrad RainRadar refresh:",
        error
      );
    }
  }

  /* =======================================================
     INIT
     ======================================================= */

  function init() {

    if (initialized) {
      return;
    }

    let tries =
      0;

    const wait =
      setInterval(
        () => {

          tries++;

          const map =
            getMap();

          const nav =
            document.getElementById(
              "nav"
            );

          if (
            map &&
            nav
          ) {

            clearInterval(
              wait
            );

            initialized =
              true;

            console.log(
              "CLOrad RainRadar: initialized"
            );

            createNavButton();

            hookRange();

            hookPlay();

            removeOldSidebarControl();

            /*
             * Manifest здесь НЕ грузим.
             *
             * Он грузится именно при
             * нажатии RainRadar.
             */

            refreshTimer =
              setInterval(
                refresh,
                REFRESH_MS
              );

            return;
          }

          if (
            tries > 100
          ) {

            clearInterval(
              wait
            );

            console.error(
              "CLOrad RainRadar: initialization timeout"
            );
          }

        },
        100
      );
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRainRadar = {

    show:
      showRainRadar,

    hide:
      hideRainRadar,

    refresh:
      refresh,

    setFrame:
      setFrame,

    getFrames:
      () =>
        timestamps.slice(),

    getCurrentFrame:
      () =>
        timestamps[
          currentIndex
        ] || null,

    getLayer:
      () =>
        layer,

    getError:
      () =>
        window.CLOradRainRadarError ||
        null
  };

  init();

})();
