/* =========================================================
   CLOrad — RainRadar
   ---------------------------------------------------------
   Отдельный верхний продукт:

   Осадки-мм/ч
   ДМРЛ композит
   RainRadar
   Слои

   Источник:
   https://rainradar.ru

   Сервер:
   /api/rainradar

   ВАЖНО:
   index.html НЕ изменяется.
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

  let loading = false;

  /* =======================================================
     PALETTE
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

  const style = document.createElement("style");

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

    .rr-status {
      position: fixed;
      z-index: 2147483646;
      left: 50%;
      bottom: 125px;
      transform: translateX(-50%);
      background: #202930;
      color: #fff;
      padding: 9px 14px;
      border-radius: 8px;
      border: 1px solid #3d4850;
      white-space: nowrap;
      max-width: calc(100% - 30px);
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      pointer-events: none;
    }

    .rr-legend {
      position: absolute;
      left: 50%;
      bottom: 94px;
      transform: translateX(-50%);
      z-index: 1000;
      display: none;
      padding: 8px 10px;
      background: rgba(10,15,20,.92);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 10px;
      box-shadow: 0 4px 18px rgba(0,0,0,.35);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 10px;
      pointer-events: none;
    }

    .rr-legend-row {
      display: flex;
      align-items: center;
      gap: 0;
    }

    .rr-color {
      width: 17px;
      height: 9px;
      display: block;
    }

    .rr-legend-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 9px;
      opacity: .82;
    }

  `;

  document.head.appendChild(style);

  /* =======================================================
     HELPERS
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

  function status(text) {

    const old = document.querySelector(".rr-status");

    if (old) {
      old.remove();
    }

    if (!text) {
      return;
    }

    const box = document.createElement("div");

    box.className = "rr-status";
    box.textContent = text;

    document.body.appendChild(box);

    setTimeout(() => {

      if (box.parentNode) {
        box.remove();
      }

    }, 2500);
  }

  function errorStatus(error) {

    console.error(
      "CLOrad RainRadar:",
      error
    );

    const message =
      error &&
      error.message
        ? error.message
        : String(error);

    status(
      "RainRadar: " + message
    );
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

    button.id = "rainRadarNav";
    button.className = "n";

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
      event => {

        event.preventDefault();
        event.stopPropagation();

        setActiveButton();

        showRainRadar();

      },
      false
    );

    return button;
  }

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
        el.classList.remove("active");
      });

    button.classList.add("active");
  }

  /* =======================================================
     DEACTIVATE OTHER RADARS
     ======================================================= */

  function stopOtherRadarLayers() {

    try {

      if (
        window.CLOradStopRadar &&
        typeof window.CLOradStopRadar === "function"
      ) {
        window.CLOradStopRadar();
      }

    } catch (_) {}

    try {

      if (
        window.CLOradDeactivateGIF &&
        typeof window.CLOradDeactivateGIF === "function"
      ) {
        window.CLOradDeactivateGIF();
      }

    } catch (_) {}

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
     MANIFEST
     ======================================================= */

  function normalizeManifest(data) {

    let result = [];

    function add(value) {

      if (
        typeof value === "string" ||
        typeof value === "number"
      ) {

        const s =
          String(value).trim();

        if (s) {
          result.push(s);
        }

        return;
      }

      if (
        value &&
        typeof value === "object"
      ) {

        const valueTimestamp =
          value.timestamp ??
          value.time ??
          value.ts ??
          value.datetime ??
          value.date ??
          value.id;

        if (
          typeof valueTimestamp === "string" ||
          typeof valueTimestamp === "number"
        ) {

          result.push(
            String(valueTimestamp)
          );

          return;
        }
      }
    }

    if (Array.isArray(data)) {

      data.forEach(add);

    } else if (
      data &&
      typeof data === "object"
    ) {

      const arrays = [

        data.frames,
        data.times,
        data.timestamps,
        data.images,
        data.items,
        data.data

      ];

      for (
        const arr of arrays
      ) {

        if (
          Array.isArray(arr) &&
          arr.length
        ) {

          arr.forEach(add);

        }

      }

      add(data.timestamp);
      add(data.time);
      add(data.latest);
      add(data.current);

    }

    result =
      result
        .map(x => String(x).trim())
        .filter(Boolean);

    result =
      [...new Set(result)];

    return result;
  }

  async function loadManifest() {

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        12000
      );

    try {

      const response =
        await fetch(
          API + "?manifest=1",
          {
            method: "GET",
            cache: "no-store",
            headers: {
              "Accept":
                "application/json"
            },
            signal:
              controller.signal
          }
        );

      if (!response.ok) {

        throw new Error(
          "manifest HTTP " +
          response.status
        );

      }

      const data =
        await response.json();

      const next =
        normalizeManifest(data);

      if (!next.length) {

        throw new Error(
          "manifest не содержит кадров"
        );

      }

      timestamps = next;

      /*
       * Сервер уже отдаёт кадры
       * в хронологическом порядке.
       *
       * На всякий случай сортируем
       * только если значения похожи
       * на Unix timestamps.
       */

      const numeric =
        timestamps.every(
          x =>
            /^\d+$/.test(x)
        );

      if (numeric) {

        timestamps.sort(
          (a, b) =>
            Number(a) - Number(b)
        );

      }

      currentIndex =
        timestamps.length - 1;

      updateTimeline();

      return timestamps;

    } finally {

      clearTimeout(timeout);

    }
  }

  /* =======================================================
     LEAFLET LAYER
     ======================================================= */

  function createLayer(timestamp) {

    const map =
      getMap();

    if (!map) {

      throw new Error(
        "Leaflet map не найден"
      );

    }

    if (!timestamp) {

      throw new Error(
        "RainRadar timestamp отсутствует"
      );

    }

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

    layer.on(
      "loading",
      () => {
        status(
          "Загрузка RainRadar..."
        );
      }
    );

    layer.on(
      "load",
      () => {
        status(
          "RainRadar загружен"
        );
      }
    );

    layer.on(
      "tileerror",
      event => {

        console.error(
          "RainRadar tile error:",
          event
        );

        status(
          "Ошибка загрузки RainRadar-тайла"
        );

      }
    );

    layer.addTo(map);

    updateTimeLabel();

    return layer;
  }

  /* =======================================================
     SHOW
     ======================================================= */

  async function showRainRadar() {

    if (loading) {
      return;
    }

    const map =
      getMap();

    if (!map) {

      errorStatus(
        new Error(
          "Карта ещё не готова"
        )
      );

      return;
    }

    loading = true;

    try {

      stopOtherRadarLayers();

      status(
        "Загрузка RainRadar..."
      );

      await loadManifest();

      if (!timestamps.length) {

        throw new Error(
          "Нет доступных кадров"
        );

      }

      currentIndex =
        timestamps.length - 1;

      createLayer(
        timestamps[currentIndex]
      );

      updateTimeline();

    } catch (error) {

      errorStatus(error);

    } finally {

      loading = false;

    }
  }

  /* =======================================================
     HIDE
     ======================================================= */

  function hideRainRadar() {

    const map =
      getMap();

    if (
      map &&
      layer
    ) {

      try {
        map.removeLayer(layer);
      } catch (_) {}

      layer = null;
    }

    stopPlay();
  }

  /* =======================================================
     FRAME
     ======================================================= */

  function setFrame(index) {

    if (!timestamps.length) {
      return;
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

    const map =
      getMap();

    if (!map) {
      return;
    }

    if (layer) {

      layer.setUrl(
        tileUrl(
          timestamps[currentIndex]
        )
      );

    } else {

      createLayer(
        timestamps[currentIndex]
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
        String(currentIndex);

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
      timestamps[currentIndex];

    const numeric =
      /^\d+$/.test(
        String(value)
      );

    let date;

    if (numeric) {

      const n =
        Number(value);

      date =
        new Date(
          n < 100000000000
            ? n * 1000
            : n
        );

    } else {

      date =
        new Date(value);

    }

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
          Number(range.value)
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
          .forEach(
            el => {

              if (
                el.id !==
                "rainRadarNav"
              ) {
                el.remove();
              }

            }
          );

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

        if (layer) {

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

  async function init() {

    let tries =
      0;

    const wait =
      setInterval(
        async () => {

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

            createNavButton();

            hookRange();

            hookPlay();

            removeOldSidebarControl();

            /*
             * Не грузим тайлы при старте.
             * Загружаем RainRadar только
             * после нажатия кнопки.
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
              "CLOrad RainRadar: init timeout"
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
        layer

  };

  init();

})();
