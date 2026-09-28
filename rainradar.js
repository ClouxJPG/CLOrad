/* =========================================================
   CLOrad — RainRadar
   ---------------------------------------------------------
   RainRadar используется как отдельный верхний продукт.

   Положение:
   Осадки-мм/ч
   ДМРЛ композит
   RainRadar
   Слои

   Источник:
   RainRadar composite

   Цвета перекрашиваются сервером через:
   /api/rainradar
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

  const MIN_ZOOM = 3;
  const MAX_NATIVE_ZOOM = 5;
  const MAX_ZOOM = 14;

  const REFRESH_MS = 60 * 1000;
  const PLAY_MS = 700;

  /* =======================================================
     STATE
     ======================================================= */

  let manifest = null;
  let timestamps = [];
  let currentIndex = 0;

  let layer = null;

  let playing = false;
  let playTimer = null;

  let refreshTimer = null;

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

  const style =
    document.createElement("style");

  style.textContent = `

    /* -----------------------------------------------
       RainRadar tiles
       ----------------------------------------------- */

    .clorad-rainradar,
    .clorad-rainradar img {

      image-rendering: pixelated;
      image-rendering: crisp-edges;

      -webkit-image-rendering: pixelated;

      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
    }

    /*
       Не даём браузеру добавлять визуальное сглаживание
       самому Leaflet-тайлу.
    */

    .clorad-rainradar img {

      image-rendering: pixelated;

      transform: translateZ(0);
      -webkit-transform: translateZ(0);
    }

    /* -----------------------------------------------
       RainRadar legend
       ----------------------------------------------- */

    .rr-legend {

      position: absolute;

      left: 50%;
      bottom: 94px;

      transform: translateX(-50%);

      z-index: 1000;

      display: none;

      padding: 8px 10px;

      background:
        rgba(10, 15, 20, .92);

      border:
        1px solid rgba(255,255,255,.12);

      border-radius: 10px;

      box-shadow:
        0 4px 18px rgba(0,0,0,.35);

      color: #fff;

      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

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

    /* -----------------------------------------------
       Active top button
       ----------------------------------------------- */

    #rainRadarNav.active {

      color: #fff;
    }

  `;

  document.head.appendChild(style);

  /* =======================================================
     FIND MAP
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
     CREATE TOP NAV BUTTON
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

    /*
      Приоритет:
      1. после ДМРЛ композита
      2. иначе после Осадки-мм/ч
    */

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

        setActiveButton();

        showRainRadar();

      }
    );

    return button;
  }

  /* =======================================================
     ACTIVE NAV
     ======================================================= */

  function setActiveButton() {

    const button =
      document.getElementById("rainRadarNav");

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
     BUILD TILE URL
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
     NORMALIZE TIMESTAMPS
     ======================================================= */

  function normalizeManifest(data) {

    let result = [];

    if (Array.isArray(data)) {

      result =
        data.map(item => {

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
              item.id ??
              ""
            );
          }

          return "";
        });

    } else if (
      data &&
      typeof data === "object"
    ) {

      const arrays = [
        data.frames,
        data.times,
        data.timestamps,
        data.images
      ];

      for (
        const arr of arrays
      ) {

        if (
          Array.isArray(arr) &&
          arr.length
        ) {

          result =
            arr.map(item => {

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
                  item.id ??
                  ""
                );
              }

              return "";
            });

          if (result.length) {
            break;
          }
        }
      }

      if (!result.length) {

        const value =
          data.timestamp ??
          data.time ??
          data.latest ??
          data.current;

        if (value != null) {
          result = [String(value)];
        }
      }
    }

    result =
      result.filter(Boolean);

    /*
      Убираем дубликаты, сохраняя порядок.
    */

    return [
      ...new Set(result)
    ];
  }

  /* =======================================================
     LOAD MANIFEST
     ======================================================= */

  async function loadManifest() {

    const response =
      await fetch(
        API + "?manifest=1",
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {

      throw new Error(
        "RainRadar manifest HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    const next =
      normalizeManifest(data);

    if (!next.length) {

      throw new Error(
        "RainRadar manifest contains no frames"
      );
    }

    manifest = data;
    timestamps = next;

    /*
      Новейший кадр.
    */

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
      return;
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
          minZoom: MIN_ZOOM,

          minNativeZoom:
            MIN_ZOOM,

          maxNativeZoom:
            MAX_NATIVE_ZOOM,

          maxZoom:
            MAX_ZOOM,

          tileSize: 256,

          opacity: 1,

          zIndex: 620,

          noWrap: true,

          bounds:
            RR_BOUNDS,

          updateWhenZooming: true,

          updateWhenIdle: true,

          keepBuffer: 2,

          detectRetina: false,

          crossOrigin: false,

          className:
            "clorad-rainradar"
        }
      );

    layer.addTo(map);

    /*
      Предзагрузка не делается.
      Поэтому при переключении кадра не создаём
      лишнюю нагрузку на сайт.
    */

    updateTimeLabel();
  }

  /* =======================================================
     SHOW
     ======================================================= */

  async function showRainRadar() {

    const map =
      getMap();

    if (!map) {
      return;
    }

    try {

      if (!timestamps.length) {
        await loadManifest();
      }

      createLayer(
        timestamps[currentIndex]
      );

      updateTimeline();

    } catch (error) {

      console.error(
        "CLOrad RainRadar:",
        error
      );
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

      map.removeLayer(layer);
      layer = null;
    }
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
          index
        )
      );

    currentIndex = index;

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
      document.getElementById("range");

    if (range) {

      range.min = "0";

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

  /* =======================================================
     TIME LABEL
     ======================================================= */

  function updateTimeLabel() {

    const label =
      document.getElementById("timeLabel");

    if (
      !label ||
      !timestamps.length
    ) {
      return;
    }

    const value =
      timestamps[currentIndex];

    /*
      Если timestamp ISO — показываем
      читабельную дату.
    */

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
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          }
        );

    } else {

      label.textContent =
        String(value);
    }
  }

  /* =======================================================
     RANGE HOOK
     ======================================================= */

  function hookRange() {

    const range =
      document.getElementById("range");

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

    playing = false;

    if (playTimer) {

      clearInterval(
        playTimer
      );

      playTimer = null;
    }
  }

  function startPlay() {

    if (
      playing ||
      !timestamps.length
    ) {
      return;
    }

    playing = true;

    playTimer =
      setInterval(
        () => {

          let next =
            currentIndex + 1;

          if (
            next >= timestamps.length
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
      document.getElementById("play");

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
     REMOVE OLD SIDEBAR RAINRADAR CONTROL
     ======================================================= */

  function removeOldSidebarControl() {

    const selectors = [
      "#rainRadarLayer",
      "#rainradarLayer",
      "#rainRadar",
      ".rainradar-layer",
      ".rainradar-control"
    ];

    selectors.forEach(selector => {

      document
        .querySelectorAll(selector)
        .forEach(el => {

          /*
            Не удаляем сам верхний nav.
          */

          if (
            el.id !== "rainRadarNav"
          ) {
            el.remove();
          }

        });
    });
  }

  /* =======================================================
     REFRESH
     ======================================================= */

  async function refresh() {

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

      /*
        Новый кадр появился.
        Показываем именно его.
      */

      if (
        newLatest &&
        newLatest !== oldLatest
      ) {

        currentIndex =
          timestamps.length - 1;

        if (layer) {

          layer.setUrl(
            tileUrl(
              timestamps[currentIndex]
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

    /*
      Ждём Leaflet/map и существующий интерфейс.
    */

    let tries = 0;

    const wait =
      setInterval(
        async () => {

          tries++;

          const map =
            getMap();

          const nav =
            document.getElementById("nav");

          if (
            map &&
            nav
          ) {

            clearInterval(wait);

            createNavButton();

            hookRange();

            hookPlay();

            removeOldSidebarControl();

            try {
              await loadManifest();
            } catch (error) {

              console.error(
                "CLOrad RainRadar init:",
                error
              );
            }

            /*
              По умолчанию слой НЕ включаем.
              Пользователь включает его через верхнюю кнопку.
            */

            refreshTimer =
              setInterval(
                refresh,
                REFRESH_MS
              );

            return;
          }

          /*
            Не крутимся бесконечно,
            если карта не загрузилась.
          */

          if (tries > 100) {
            clearInterval(wait);
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
        timestamps[currentIndex] || null
  };

  /* =======================================================
     START
     ======================================================= */

  init();

})();
