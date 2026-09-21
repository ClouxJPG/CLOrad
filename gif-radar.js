/* =========================================================
   CLOrad — GIF Radar
   Независимый GIF-слой для phenomena.gif
   Не вмешивается в RDR / iDarkMeteo
   ========================================================= */

(() => {
  "use strict";

  const API = "/api/radar-gif";

  let gifEnabled = false;
  let gifLayer = null;
  let gifFrames = [];
  let gifFrameIndex = 0;
  let gifTimer = null;
  let gifRequest = 0;

  let map = null;

  /* =========================================================
     Поиск карты
     ========================================================= */

  function findMap() {
    if (window.map && typeof window.map.addLayer === "function") {
      return window.map;
    }

    for (const key of Object.keys(window)) {
      try {
        const value = window[key];

        if (
          value &&
          typeof value.addLayer === "function" &&
          typeof value.removeLayer === "function" &&
          typeof value.getBounds === "function"
        ) {
          return value;
        }
      } catch (_) {}
    }

    return null;
  }

  /* =========================================================
     Кнопка GIF
     ========================================================= */

  function createButton() {
    if (document.getElementById("cloradGifButton")) {
      return;
    }

    /*
      Ищем верхнюю панель.
      Используем существующие элементы CLOrad,
      чтобы кнопка визуально была частью текущего интерфейса.
    */

    const candidates = [
      ".topbar",
      ".top-panel",
      ".topbar-actions",
      ".header-tools",
      ".header-actions",
      ".tools",
      "header"
    ];

    let container = null;

    for (const selector of candidates) {
      const el = document.querySelector(selector);

      if (el) {
        container = el;
        break;
      }
    }

    if (!container) {
      console.warn("CLOrad GIF: верхняя панель не найдена.");
      return;
    }

    const button = document.createElement("button");

    button.id = "cloradGifButton";
    button.type = "button";
    button.title = "Радарная GIF-анимация";
    button.setAttribute("aria-label", "GIF");

    button.innerHTML = `
      <span class="clorad-gif-icon"></span>
      <span class="clorad-gif-text">GIF</span>
    `;

    button.addEventListener("click", toggleGIF);

    container.appendChild(button);

    addButtonStyles();
  }

  /* =========================================================
     Стили кнопки
     ========================================================= */

  function addButtonStyles() {
    if (document.getElementById("cloradGifStyles")) {
      return;
    }

    const style = document.createElement("style");

    style.id = "cloradGifStyles";

    style.textContent = `
      #cloradGifButton {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;

        height: 38px;
        min-width: 66px;

        padding: 0 11px;

        border: 1px solid rgba(255,255,255,.10);
        border-radius: 10px;

        background: rgba(255,255,255,.055);
        color: rgba(255,255,255,.78);

        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .3px;

        cursor: pointer;
        user-select: none;

        transition:
          background .18s ease,
          border-color .18s ease,
          color .18s ease,
          transform .12s ease;
      }

      #cloradGifButton:hover {
        background: rgba(255,255,255,.09);
        color: #fff;
      }

      #cloradGifButton:active {
        transform: scale(.96);
      }

      #cloradGifButton.active {
        background: rgba(74, 222, 128, .13);
        border-color: rgba(74, 222, 128, .38);
        color: #63e88b;
      }

      .clorad-gif-icon {
        width: 13px;
        height: 13px;

        box-sizing: border-box;

        display: inline-block;

        border: 2px solid currentColor;
        border-radius: 2px;

        opacity: .9;
      }

      .clorad-gif-text {
        line-height: 1;
      }

      @media (max-width: 600px) {
        #cloradGifButton {
          min-width: 42px;
          width: 42px;
          padding: 0;
          gap: 0;
        }

        #cloradGifButton .clorad-gif-text {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* =========================================================
     GIF bounds
     
     ВАЖНО:
     Эти координаты специально вынесены отдельно.
     Их можно заменить после точного определения географии
     исходной карты Meteoinfo.
     ========================================================= */

  const GIF_BOUNDS = [
    [35.0, 20.0],
    [75.0, 180.0]
  ];

  /* =========================================================
     Установка кадра
     ========================================================= */

  async function showFrame(index, requestId) {
    if (!gifEnabled) {
      return;
    }

    if (requestId !== gifRequest) {
      return;
    }

    if (!gifFrames.length) {
      return;
    }

    map = findMap();

    if (!map) {
      console.warn("CLOrad GIF: Leaflet map не найдена.");
      return;
    }

    const frame = gifFrames[index];

    if (!frame) {
      return;
    }

    const url =
      `${API}?frame=${encodeURIComponent(index)}` +
      `&v=${encodeURIComponent(gifFrames.version || "")}`;

    try {
      const response = await fetch(url, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();

      if (requestId !== gifRequest || !gifEnabled) {
        return;
      }

      const objectUrl = URL.createObjectURL(blob);

      const newLayer = L.imageOverlay(
        objectUrl,
        GIF_BOUNDS,
        {
          opacity: 1,
          interactive: false,
          crossOrigin: true,
          zIndex: 250
        }
      );

      newLayer.addTo(map);

      const oldLayer = gifLayer;

      gifLayer = newLayer;
      gifFrameIndex = index;

      if (oldLayer) {
        try {
          map.removeLayer(oldLayer);

          if (oldLayer._url && oldLayer._url.startsWith("blob:")) {
            URL.revokeObjectURL(oldLayer._url);
          }
        } catch (_) {}
      }

      updateGIFTimeline(frame);

    } catch (error) {
      console.error("CLOrad GIF: ошибка загрузки кадра:", error);
    }
  }

  /* =========================================================
     Информация о времени
     ========================================================= */

  function updateGIFTimeline(frame) {
    if (!frame) {
      return;
    }

    const label = document.getElementById("timeLabel");

    if (label && frame.time) {
      label.textContent = frame.time;
    }
  }

  /* =========================================================
     Получение списка кадров
     ========================================================= */

  async function loadGIF() {
    const requestId = ++gifRequest;

    try {
      const response = await fetch(API, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (requestId !== gifRequest || !gifEnabled) {
        return;
      }

      if (!Array.isArray(data.frames) || !data.frames.length) {
        throw new Error("Сервер не вернул кадры GIF.");
      }

      gifFrames = data.frames;

      /*
        Сохраняем версию отдельно.
        Она нужна только для того, чтобы браузер
        не подставлял старый PNG из своего cache.
      */

      gifFrames.version = data.version || Date.now();

      gifFrameIndex = 0;

      setupGIFTimeline(data);

      await showFrame(0, requestId);

      startGIFAnimation();

    } catch (error) {
      console.error("CLOrad GIF:", error);

      disableGIF();

      alert(
        "Не удалось загрузить GIF-радар.\n\n" +
        "Проверь /api/radar-gif и источник Meteoinfo."
      );
    }
  }

  /* =========================================================
     Подключение к существующему таймлайну
     ========================================================= */

  function setupGIFTimeline(data) {
    const range = document.getElementById("range");

    if (!range) {
      return;
    }

    /*
      GIF использует существующий range,
      но не меняет количество кадров RDR постоянно.
      При выключении GIF исходные значения можно
      вернуть через сохранённое состояние.
    */

    if (!range.dataset.gifOriginalMax) {
      range.dataset.gifOriginalMax = range.max || "0";
    }

    range.max = String(Math.max(0, data.frames.length - 1));
    range.value = "0";

    range.dataset.gifMode = "1";

    if (!range.dataset.gifListener) {
      range.addEventListener("input", onGIFRange);

      range.dataset.gifListener = "1";
    }

    const times = document.getElementById("times");

    if (times) {
      times.innerHTML = "";

      data.frames.forEach((frame, index) => {
        const item = document.createElement("span");

        item.textContent =
          frame.time ||
          frame.t ||
          `${index + 1}`;

        item.style.cursor = "pointer";

        item.addEventListener("click", () => {
          range.value = String(index);
          showFrame(index, gifRequest);
        });

        times.appendChild(item);
      });
    }
  }

  /* =========================================================
     Range GIF
     ========================================================= */

  function onGIFRange(event) {
    if (!gifEnabled) {
      return;
    }

    const index = Number(event.target.value);

    stopGIFAnimation();

    showFrame(index, gifRequest);
  }

  /* =========================================================
     Автовоспроизведение GIF
     ========================================================= */

  function startGIFAnimation() {
    stopGIFAnimation();

    if (!gifEnabled || gifFrames.length < 2) {
      return;
    }

    gifTimer = setInterval(() => {
      if (!gifEnabled || !gifFrames.length) {
        stopGIFAnimation();
        return;
      }

      let next = gifFrameIndex + 1;

      if (next >= gifFrames.length) {
        next = 0;
      }

      const range = document.getElementById("range");

      if (range) {
        range.value = String(next);
      }

      showFrame(next, gifRequest);

    }, 900);
  }

  function stopGIFAnimation() {
    if (gifTimer) {
      clearInterval(gifTimer);
      gifTimer = null;
    }
  }

  /* =========================================================
     Удаление GIF
     ========================================================= */

  function removeGIFLayer() {
    stopGIFAnimation();

    if (gifLayer && map) {
      try {
        map.removeLayer(gifLayer);
      } catch (_) {}

      try {
        if (
          gifLayer._url &&
          gifLayer._url.startsWith("blob:")
        ) {
          URL.revokeObjectURL(gifLayer._url);
        }
      } catch (_) {}
    }

    gifLayer = null;
  }

  /* =========================================================
     Выключение
     ========================================================= */

  function disableGIF() {
    gifEnabled = false;

    gifRequest++;

    removeGIFLayer();

    const button = document.getElementById("cloradGifButton");

    if (button) {
      button.classList.remove("active");
    }

    const range = document.getElementById("range");

    if (range) {
      range.dataset.gifMode = "0";

      if (range.dataset.gifOriginalMax) {
        range.max = range.dataset.gifOriginalMax;
      }
    }

    gifFrames = [];
    gifFrameIndex = 0;
  }

  /* =========================================================
     Переключатель GIF
     ========================================================= */

  function toggleGIF() {
    map = findMap();

    if (!map) {
      console.warn("CLOrad GIF: карта ещё не готова.");
      return;
    }

    gifEnabled = !gifEnabled;

    const button = document.getElementById("cloradGifButton");

    if (gifEnabled) {
      if (button) {
        button.classList.add("active");
      }

      loadGIF();

    } else {
      disableGIF();
    }
  }

  /* =========================================================
     Инициализация
     ========================================================= */

  function init() {
    createButton();

    /*
      Иногда index.html создаёт Leaflet-карту
      немного позже загрузки этого файла.
    */

    if (!findMap()) {
      setTimeout(init, 300);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* =========================================================
     Публичное API
     ========================================================= */

  window.CLOradGIF = {
    enable: () => {
      if (!gifEnabled) {
        toggleGIF();
      }
    },

    disable: () => {
      if (gifEnabled) {
        toggleGIF();
      }
    },

    toggle: toggleGIF,

    isEnabled: () => gifEnabled
  };

})();
