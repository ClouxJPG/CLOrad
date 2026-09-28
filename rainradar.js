/* =========================================================
   CLOrad — RainRadar

   RainRadar:
   - отдельная кнопка в верхнем меню
   - реальный таймлайн
   - play / pause
   - переключение кадров
   - manifest через Vercel API
   - обычные Leaflet PNG tiles
   - РГМЦ palette
   - index.html НЕ изменяется
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const RR_API =
    "/api/rainradar";

  const RR_MANIFEST =
    RR_API +
    "?manifest=1";

  const RR_MIN_ZOOM = 3;

  const RR_MAX_NATIVE_ZOOM = 5;

  const RR_BOUNDS = [
    [35, 15],
    [72, 180]
  ];

  const REFRESH_MS =
    60000;

  const PLAY_INTERVAL_MS =
    700;

  /* =======================================================
     STATE
     ======================================================= */

  let rainRadarButton = null;
  let rainRadarLayer = null;

  let rainRadarEnabled =
    false;

  let rainRadarLoading =
    false;

  let rainRadarTimestamp =
    null;

  let rainRadarFrames =
    [];

  let rainRadarIndex =
    -1;

  let refreshTimer =
    null;

  let playTimer =
    null;

  let playing =
    false;

  let originalRangeOnInput =
    null;

  /* =======================================================
     HELPERS
     ======================================================= */

  function getMap() {
    return window.map || null;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function message(text) {
    if (
      typeof window.msg ===
      "function"
    ) {
      window.msg(text);
      return;
    }
  }

  /* =======================================================
     FORMAT TIME
     ======================================================= */

  function formatTime(
    timestamp
  ) {
    const date =
      new Date(
        timestamp * 1000
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
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",

        timeZone:
          "Europe/Moscow"
      }
    );
  }

  /* =======================================================
     OLD SIDEBAR CONTROL
     ======================================================= */

  function removeOldLayersButton() {
    const oldLayer =
      $(
        "rainradarLayerControl"
      );

    if (oldLayer) {
      oldLayer.remove();
    }

    const oldSwitch =
      $(
        "rainradarSwitch"
      );

    if (oldSwitch) {
      const parent =
        oldSwitch.closest(
          ".layer"
        );

      if (parent) {
        parent.remove();
      } else {
        oldSwitch.remove();
      }
    }
  }

  /* =======================================================
     NAV BUTTON
     ======================================================= */

  function createRainRadarButton() {
    const existing =
      $(
        "rainRadarNav"
      );

    if (existing) {
      rainRadarButton =
        existing;

      return existing;
    }

    const nav =
      document.querySelector(
        ".nav"
      );

    if (!nav) {
      return null;
    }

    const button =
      document.createElement(
        "button"
      );

    button.className =
      "n";

    button.id =
      "rainRadarNav";

    button.type =
      "button";

    button.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M5 19V11"/>
        <path d="M12 19V7"/>
        <path d="M19 19V4"/>
      </svg>
      RainRadar
    `;

    const gifButton =
      $(
        "gifRadarNav"
      );

    const rainButton =
      $(
        "rainProduct"
      );

    if (gifButton) {
      gifButton.after(
        button
      );
    } else if (
      rainButton
    ) {
      rainButton.after(
        button
      );
    } else {
      nav.appendChild(
        button
      );
    }

    rainRadarButton =
      button;

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleRainRadar();
      }
    );

    return button;
  }

  /* =======================================================
     NAV STATE
     ======================================================= */

  function setActiveNav(
    button
  ) {
    document
      .querySelectorAll(
        ".n"
      )
      .forEach(item => {
        item.classList.remove(
          "active"
        );
      });

    if (button) {
      button.classList.add(
        "active"
      );
    }
  }

  /* =======================================================
     MANIFEST
     ======================================================= */

  async function loadManifest() {
    const response =
      await fetch(
        RR_MANIFEST,
        {
          method: "GET",
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

    if (
      !data ||
      !Array.isArray(
        data.frames
      )
    ) {
      throw new Error(
        "RainRadar: нет кадров"
      );
    }

    return data.frames;
  }

  /* =======================================================
     TILE URL
     ======================================================= */

  function getTileUrl(
    timestamp
  ) {
    return (
      RR_API +
      "?timestamp=" +
      encodeURIComponent(
        timestamp
      ) +
      "&z={z}" +
      "&x={x}" +
      "&y={y}"
    );
  }

  /* =======================================================
     REMOVE LAYER
     ======================================================= */

  function removeRainRadarLayer() {
    const map =
      getMap();

    if (
      map &&
      rainRadarLayer &&
      map.hasLayer(
        rainRadarLayer
      )
    ) {
      map.removeLayer(
        rainRadarLayer
      );
    }

    rainRadarLayer =
      null;

    rainRadarTimestamp =
      null;
  }

  /* =======================================================
     CREATE LAYER
     ======================================================= */

  function createRainRadarLayer(
    timestamp
  ) {
    const map =
      getMap();

    if (!map) {
      throw new Error(
        "Карта CLOrad ещё не готова"
      );
    }

    removeRainRadarLayer();

    rainRadarLayer =
      L.tileLayer(
        getTileUrl(
          timestamp
        ),
        {
          minZoom:
            RR_MIN_ZOOM,

          minNativeZoom:
            RR_MIN_ZOOM,

          maxNativeZoom:
            RR_MAX_NATIVE_ZOOM,

          maxZoom:
            14,

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

          className:
            "clorad-rainradar"
        }
      );

    rainRadarLayer.on(
      "tileerror",
      event => {
        console.error(
          "RainRadar tile error:",
          event
        );
      }
    );

    rainRadarLayer.addTo(
      map
    );

    rainRadarLayer.bringToFront();

    rainRadarTimestamp =
      timestamp;
  }

  /* =======================================================
     TIMELINE
     ======================================================= */

  function setupTimeline() {
    const range =
      $("range");

    if (!range) {
      return;
    }

    if (
      originalRangeOnInput ===
      null
    ) {
      originalRangeOnInput =
        range.oninput;
    }

    range.oninput =
      () => {
        if (
          !rainRadarEnabled
        ) {
          if (
            typeof originalRangeOnInput ===
            "function"
          ) {
            originalRangeOnInput
              .call(range);
          }

          return;
        }

        const index =
          Number(
            range.value
          );

        selectFrame(
          index
        );
      };
  }

  function updateTimeline() {
    const range =
      $("range");

    const label =
      $("timeLabel");

    const times =
      $("times");

    if (
      !range ||
      !label ||
      !times
    ) {
      return;
    }

    const count =
      rainRadarFrames.length;

    range.min = "0";

    range.max =
      String(
        Math.max(
          0,
          count - 1
        )
      );

    range.step = "1";

    range.value =
      String(
        Math.max(
          0,
          rainRadarIndex
        )
      );

    if (!count) {
      label.textContent =
        "RainRadar: нет кадров";

      times.innerHTML =
        "";

      return;
    }

    const first =
      rainRadarFrames[0];

    const last =
      rainRadarFrames[
        count - 1
      ];

    const current =
      rainRadarFrames[
        Math.max(
          0,
          rainRadarIndex
        )
      ];

    label.textContent =
      current
        ? "RainRadar · " +
          formatTime(
            current.timestamp
          )
        : "RainRadar";

    times.innerHTML =
      `
        <span>
          ${formatTime(first.timestamp)}
        </span>
        <span>
          ${formatTime(last.timestamp)}
        </span>
      `;
  }

  /* =======================================================
     FRAME
     ======================================================= */

  function selectFrame(
    index
  ) {
    if (
      !rainRadarEnabled
    ) {
      return;
    }

    if (
      !rainRadarFrames.length
    ) {
      return;
    }

    index =
      Math.max(
        0,
        Math.min(
          rainRadarFrames.length - 1,
          Number(index)
        )
      );

    const frame =
      rainRadarFrames[
        index
      ];

    if (!frame) {
      return;
    }

    rainRadarIndex =
      index;

    const range =
      $("range");

    if (range) {
      range.value =
        String(index);
    }

    createRainRadarLayer(
      frame.timestamp
    );

    updateTimeline();
  }

  /* =======================================================
     PLAY
     ======================================================= */

  function updatePlayIcon() {
    const play =
      $("play");

    if (!play) {
      return;
    }

    play.innerHTML =
      playing
        ? `
          <svg viewBox="0 0 24 24">
            <path d="M7 5h4v14H7z"/>
            <path d="M13 5h4v14h-4z"/>
          </svg>
        `
        : `
          <svg viewBox="0 0 24 24">
            <path d="M7 4l13 8-13 8z"/>
          </svg>
        `;
  }

  function stopPlayback() {
    playing =
      false;

    if (playTimer) {
      clearInterval(
        playTimer
      );

      playTimer =
        null;
    }

    updatePlayIcon();
  }

  function startPlayback() {
    if (
      !rainRadarEnabled ||
      rainRadarFrames.length < 2
    ) {
      return;
    }

    if (playing) {
      return;
    }

    playing =
      true;

    updatePlayIcon();

    playTimer =
      setInterval(
        () => {
          if (
            !rainRadarEnabled
          ) {
            stopPlayback();
            return;
          }

          let next =
            rainRadarIndex + 1;

          if (
            next >=
            rainRadarFrames.length
          ) {
            next = 0;
          }

          selectFrame(
            next
          );
        },
        PLAY_INTERVAL_MS
      );
  }

  function setupPlayButton() {
    const play =
      $("play");

    if (!play) {
      return;
    }

    play.onclick =
      () => {
        if (
          !rainRadarEnabled
        ) {
          return;
        }

        if (playing) {
          stopPlayback();
        } else {
          startPlayback();
        }
      };
  }

  /* =======================================================
     ENABLE
     ======================================================= */

  async function enableRainRadar() {
    if (
      rainRadarLoading
    ) {
      return;
    }

    /*
     * ВАЖНО:
     * кнопка активируется сразу.
     */

    rainRadarEnabled =
      true;

    if (rainRadarButton) {
      rainRadarButton.classList.add(
        "active"
      );
    }

    setActiveNav(
      rainRadarButton
    );

    setupTimeline();
    setupPlayButton();

    rainRadarLoading =
      true;

    try {
      message(
        "Загрузка RainRadar…"
      );

      const frames =
        await loadManifest();

      rainRadarFrames =
        frames;

      if (
        !rainRadarFrames.length
      ) {
        throw new Error(
          "RainRadar не вернул кадры"
        );
      }

      /*
       * Берём самый новый кадр.
       */

      rainRadarIndex =
        rainRadarFrames.length - 1;

      updateTimeline();

      selectFrame(
        rainRadarIndex
      );

      message(
        "RainRadar загружен"
      );

    } catch (error) {
      console.error(
        "CLOrad RainRadar:",
        error
      );

      /*
       * При ошибке RainRadar
       * основная карта НЕ удаляется.
       */

      rainRadarEnabled =
        false;

      stopPlayback();

      removeRainRadarLayer();

      if (rainRadarButton) {
        rainRadarButton.classList.remove(
          "active"
        );
      }

      const label =
        $("timeLabel");

      if (label) {
        label.textContent =
          "RainRadar: ошибка загрузки";
      }

      message(
        error?.message ||
        "RainRadar не загрузился"
      );

    } finally {
      rainRadarLoading =
        false;
    }
  }

  /* =======================================================
     DISABLE
     ======================================================= */

  function disableRainRadar() {
    rainRadarEnabled =
      false;

    stopPlayback();

    removeRainRadarLayer();

    if (rainRadarButton) {
      rainRadarButton.classList.remove(
        "active"
      );
    }

    const label =
      $("timeLabel");

    if (label) {
      label.textContent =
        "Радар не подключён";
    }

    const times =
      $("times");

    if (times) {
      times.innerHTML =
        "";
    }

    message(
      "RainRadar выключен"
    );
  }

  /* =======================================================
     TOGGLE
     ======================================================= */

  function toggleRainRadar() {
    if (
      rainRadarEnabled
    ) {
      disableRainRadar();
    } else {
      enableRainRadar();
    }
  }

  /* =======================================================
     REFRESH
     ======================================================= */

  async function refreshRainRadar() {
    if (
      !rainRadarEnabled ||
      rainRadarLoading
    ) {
      return;
    }

    try {
      const frames =
        await loadManifest();

      if (
        !frames.length
      ) {
        return;
      }

      const oldLatest =
        rainRadarFrames.length
          ? rainRadarFrames[
              rainRadarFrames.length - 1
            ].timestamp
          : null;

      const newLatest =
        frames[
          frames.length - 1
        ].timestamp;

      rainRadarFrames =
        frames;

      /*
       * Если появился новый кадр —
       * автоматически переключаемся
       * на него.
       */

      if (
        newLatest !==
        oldLatest
      ) {
        rainRadarIndex =
          frames.length - 1;

        updateTimeline();

        selectFrame(
          rainRadarIndex
        );
      }

    } catch (error) {
      console.error(
        "RainRadar refresh:",
        error
      );
    }
  }

  /* =======================================================
     NAVIGATION
     ======================================================= */

  function setupNavigation() {
    const nav =
      document.querySelector(
        ".nav"
      );

    if (!nav) {
      return;
    }

    nav.addEventListener(
      "click",
      event => {
        const button =
          event.target.closest(
            ".n"
          );

        if (!button) {
          return;
        }

        if (
          button.id ===
          "rainRadarNav"
        ) {
          return;
        }

        if (
          rainRadarEnabled
        ) {
          disableRainRadar();
        }
      },
      true
    );
  }

  /* =======================================================
     INIT
     ======================================================= */

  function init() {
    try {
      removeOldLayersButton();

      createRainRadarButton();

      setupTimeline();

      setupPlayButton();

      setupNavigation();

      if (refreshTimer) {
        clearInterval(
          refreshTimer
        );
      }

      refreshTimer =
        setInterval(
          refreshRainRadar,
          REFRESH_MS
        );

    } catch (error) {
      console.error(
        "CLOrad RainRadar init:",
        error
      );
    }
  }

  /* =======================================================
     PUBLIC API
     ======================================================= */

  window.CLOradRainRadar = {
    enable:
      enableRainRadar,

    disable:
      disableRainRadar,

    toggle:
      toggleRainRadar,

    refresh:
      refreshRainRadar,

    getLayer:
      () =>
        rainRadarLayer,

    getTimestamp:
      () =>
        rainRadarTimestamp,

    isEnabled:
      () =>
        rainRadarEnabled,

    getFrames:
      () =>
        rainRadarFrames,

    getIndex:
      () =>
        rainRadarIndex,

    palette:
      "rgmc"
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
