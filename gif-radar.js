/* =========================================================
   CLOrad — Meteoinfo radar GIF
   Server-side GIF -> PNG frames
   No UI redesign
   ========================================================= */

(() => {
  "use strict";

  const API = "/api/radar-gif";

  /*
    Географическая привязка исходной карты Meteoinfo.
    Это именно изображение готовой радарной карты,
    поэтому координаты являются привязкой изображения,
    а не настоящей проекцией радарных данных.
  */
  const GIF_BOUNDS = [
    [40, 20],
    [70, 70]
  ];

  let gifActive = false;
  let gifFrames = [];
  let gifMeta = null;
  let gifLayer = null;

  let gifFrameIndex = -1;
  let gifFrameRequest = 0;
  let gifPlayTimer = null;

  const imageCache = new Map();

  /* =========================================================
     Helpers
     ========================================================= */

  function getMap() {
    return window.map || window.CLOradMap || null;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function getFrameDelay(frame) {
    if (!frame) return 500;

    let delay =
      Number(frame.delay) ||
      Number(frame.duration) ||
      Number(frame.delayMs) ||
      500;

    /*
      Некоторые GIF metadata отдают секунды.
    */
    if (delay > 0 && delay < 20) {
      delay *= 1000;
    }

    /*
      Не позволяем таймеру стать слишком быстрым.
    */
    return Math.max(120, delay);
  }

  function formatTime(value) {
    if (value == null) return "";

    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    return String(value);
  }

  function updateFrameUI(frame, index) {
    if (!frame) return;

    /*
      Используем существующие элементы интерфейса.
      Новая разметка не создаётся.
    */

    if (frame.t != null) {
      setText("timeLabel", formatTime(frame.t));
    }

    /*
      Не меняем структуру UI.
      Если в текущем интерфейсе есть поле продукта —
      показываем название радара.
    */

    const possibleNames = [
      "productName",
      "radarName",
      "layerName",
      "dataName"
    ];

    for (const id of possibleNames) {
      const el = $(id);
      if (el) {
        el.textContent = "Радар";
        break;
      }
    }

    const range = $("range");

    if (range && gifFrames.length) {
      range.min = "0";
      range.max = String(gifFrames.length - 1);
      range.step = "1";

      /*
        Не вызываем input/change повторно.
      */
      if (Number(range.value) !== index) {
        range.value = String(index);
      }
    }
  }

  function stopPlayback() {
    if (gifPlayTimer) {
      clearTimeout(gifPlayTimer);
      gifPlayTimer = null;
    }
  }

  /* =========================================================
     Image preload
     ========================================================= */

  function loadImage(url) {
    if (!url) {
      return Promise.reject(new Error("Пустой URL изображения"));
    }

    if (imageCache.has(url)) {
      return imageCache.get(url);
    }

    const promise = new Promise((resolve, reject) => {
      const img = new Image();

      img.decoding = "async";
      img.loading = "eager";

      img.onload = () => {
        resolve(img);
      };

      img.onerror = () => {
        imageCache.delete(url);
        reject(new Error("Не удалось загрузить radar frame"));
      };

      img.src = url;
    });

    imageCache.set(url, promise);

    return promise;
  }

  /* =========================================================
     Custom Leaflet image layer
     ========================================================= */

  const GIFImageLayer = L.Layer.extend({

    initialize: function (url, bounds, options) {
      L.setOptions(this, options);

      this._url = url;
      this._bounds = bounds;

      this._front = null;
      this._back = null;

      /*
        КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ.
        Без этого ++undefined даёт NaN,
        а NaN !== NaN всегда true.
      */
      this._generation = 0;

      this._map = null;
      this._container = null;
    },

    onAdd: function (map) {
      this._map = map;

      this._container = L.DomUtil.create(
        "div",
        "clorad-gif-radar-container"
      );

      this._container.style.position = "absolute";
      this._container.style.left = "0";
      this._container.style.top = "0";
      this._container.style.width = "0";
      this._container.style.height = "0";
      this._container.style.pointerEvents = "none";
      this._container.style.overflow = "visible";
      this._container.style.zIndex = "5";

      map.getPanes().overlayPane.appendChild(this._container);

      this._createImages();

      this._reset();

      this._loadInto(
        this._front,
        this._url,
        true
      );

      map.on("zoomend", this._reset, this);
      map.on("viewreset", this._reset, this);
      map.on("moveend", this._reset, this);
    },

    onRemove: function (map) {
      map.off("zoomend", this._reset, this);
      map.off("viewreset", this._reset, this);
      map.off("moveend", this._reset, this);

      if (this._front) {
        this._front.onload = null;
        this._front.onerror = null;
      }

      if (this._back) {
        this._back.onload = null;
        this._back.onerror = null;
      }

      if (this._container) {
        this._container.remove();
      }

      this._front = null;
      this._back = null;
      this._container = null;
      this._map = null;
    },

    _createImages: function () {
      const create = () => {
        const img = document.createElement("img");

        img.className = "clorad-gif-radar-image";

        img.alt = "";

        img.draggable = false;

        img.style.position = "absolute";
        img.style.display = "block";
        img.style.pointerEvents = "none";
        img.style.userSelect = "none";
        img.style.webkitUserDrag = "none";

        /*
          Максимально сохраняем исходные пиксели.
        */
        img.style.imageRendering = "pixelated";

        img.style.transform = "none";
        img.style.backfaceVisibility = "hidden";
        img.style.webkitBackfaceVisibility = "hidden";

        img.style.opacity = "0";

        return img;
      };

      this._front = create();
      this._back = create();

      this._container.appendChild(this._front);
      this._container.appendChild(this._back);
    },

    _loadInto: function (img, url, makeVisible) {
      if (!img || !url) return;

      const generation = ++this._generation;

      img.onload = () => {
        /*
          Игнорируем старый запрос,
          если за это время был выбран другой кадр.
        */
        if (generation !== this._generation) {
          return;
        }

        if (!this._map) {
          return;
        }

        if (makeVisible) {
          img.style.opacity = "1";
        }

        this._reset();
      };

      img.onerror = () => {
        if (generation !== this._generation) {
          return;
        }

        img.style.opacity = "0";
      };

      img.style.opacity = "0";
      img.src = url;
    },

    setUrl: function (url) {
      if (!url || !this._map) return;

      this._url = url;

      const oldFront = this._front;
      const oldBack = this._back;

      /*
        Используем скрытый буфер.
        Старый кадр остаётся видимым до полной загрузки нового.
      */
      let target;
      let oldVisible;

      if (
        oldFront &&
        getComputedStyle(oldFront).opacity !== "0"
      ) {
        target = oldBack;
        oldVisible = oldFront;
      } else {
        target = oldFront;
        oldVisible = oldBack;
      }

      if (!target) return;

      const generation = ++this._generation;

      target.onload = () => {
        if (generation !== this._generation) {
          return;
        }

        if (!this._map) {
          return;
        }

        target.style.opacity = "1";

        if (oldVisible && oldVisible !== target) {
          oldVisible.style.opacity = "0";
        }

        this._reset();
      };

      target.onerror = () => {
        if (generation !== this._generation) {
          return;
        }

        /*
          При ошибке оставляем старый кадр.
        */
        target.style.opacity = "0";
      };

      target.style.opacity = "0";
      target.src = url;
    },

    _reset: function () {
      if (!this._map || !this._container) {
        return;
      }

      const sw = this._map.latLngToLayerPoint(
        this._bounds.getSouthWest()
      );

      const ne = this._map.latLngToLayerPoint(
        this._bounds.getNorthEast()
      );

      const minX = Math.min(sw.x, ne.x);
      const minY = Math.min(sw.y, ne.y);

      const width = Math.abs(ne.x - sw.x);
      const height = Math.abs(sw.y - ne.y);

      const panePos = L.DomUtil.getPosition(
        this._map.getPanes().overlayPane
      );

      const left = minX - panePos.x;
      const top = minY - panePos.y;

      this._container.style.left = `${left}px`;
      this._container.style.top = `${top}px`;
      this._container.style.width = `${width}px`;
      this._container.style.height = `${height}px`;

      const images = [
        this._front,
        this._back
      ];

      for (const img of images) {
        if (!img) continue;

        img.style.left = "0";
        img.style.top = "0";
        img.style.width = `${width}px`;
        img.style.height = `${height}px`;
      }
    }
  });

  /* =========================================================
     CSS
     ========================================================= */

  function installStyles() {
    if (document.getElementById("clorad-gif-radar-style")) {
      return;
    }

    const style = document.createElement("style");

    style.id = "clorad-gif-radar-style";

    style.textContent = `
      .clorad-gif-radar-container {
        pointer-events: none !important;
        overflow: visible !important;
      }

      .clorad-gif-radar-image {
        position: absolute !important;
        display: block !important;
        pointer-events: none !important;
        user-select: none !important;
        -webkit-user-drag: none !important;

        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;

        transform: none !important;
        backface-visibility: hidden !important;
        -webkit-backface-visibility: hidden !important;

        max-width: none !important;
        max-height: none !important;

        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
      }
    `;

    document.head.appendChild(style);
  }

  /* =========================================================
     API
     ========================================================= */

  async function getMetadata() {
    const response = await fetch(
      `${API}?meta=1`,
      {
        method: "GET",
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        `Radar GIF metadata: HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.frames)) {
      throw new Error("Сервер не вернул frames");
    }

    return data;
  }

  function getFrameUrl(frame) {
    if (!frame) return null;

    if (frame.url) {
      return frame.url;
    }

    if (frame.path) {
      return frame.path;
    }

    if (frame.src) {
      return frame.src;
    }

    if (frame.index != null) {
      return `${API}?frame=${encodeURIComponent(
        frame.index
      )}`;
    }

    return null;
  }

  /* =========================================================
     Show frame
     ========================================================= */

  async function showGIFFrame(index) {
    if (!gifActive) return;

    const map = getMap();

    if (!map) {
      console.error("CLOrad: Leaflet map не найден");
      return;
    }

    if (!gifFrames.length) {
      return;
    }

    index = Math.max(
      0,
      Math.min(
        gifFrames.length - 1,
        Number(index) || 0
      )
    );

    const frame = gifFrames[index];

    const url = getFrameUrl(frame);

    if (!url) {
      console.error(
        "CLOrad: у GIF кадра отсутствует URL",
        frame
      );
      return;
    }

    const request = ++gifFrameRequest;

    try {
      /*
        Предзагрузка на телефоне только изображения,
        само извлечение GIF выполняется сервером.
      */
      await loadImage(url);

      if (!gifActive) return;
      if (request !== gifFrameRequest) return;

      if (!gifLayer) {
        const bounds = L.latLngBounds(
          GIF_BOUNDS
        );

        gifLayer = new GIFImageLayer(
          url,
          bounds,
          {
            interactive: false,
            zIndex: 5
          }
        );

        gifLayer.addTo(map);
      } else {
        gifLayer.setUrl(url);
      }

      gifFrameIndex = index;

      updateFrameUI(
        frame,
        index
      );

    } catch (error) {
      if (request !== gifFrameRequest) {
        return;
      }

      console.error(
        "CLOrad GIF frame error:",
        error
      );
    }
  }

  /* =========================================================
     Play
     ========================================================= */

  function playGIF() {
    if (!gifActive) return;
    if (!gifFrames.length) return;

    stopPlayback();

    const next = () => {
      if (!gifActive) {
        stopPlayback();
        return;
      }

      let nextIndex = gifFrameIndex + 1;

      if (
        nextIndex >= gifFrames.length
      ) {
        nextIndex = 0;
      }

      const frame = gifFrames[nextIndex];

      showGIFFrame(nextIndex);

      gifPlayTimer = setTimeout(
        next,
        getFrameDelay(frame)
      );
    };

    next();
  }

  /* =========================================================
     Activate
     ========================================================= */

  async function activateGIF() {
    const map = getMap();

    if (!map) {
      console.error("CLOrad: map не найден");
      return;
    }

    /*
      Останавливаем обычный iDarkMeteo radar.
      Это предотвращает наложение слоёв.
    */
    if (typeof window.CLOradStopRadar === "function") {
      window.CLOradStopRadar();
    }

    gifActive = true;

    stopPlayback();

    gifFrameRequest++;

    try {
      gifMeta = await getMetadata();

      if (!gifActive) return;

      gifFrames = gifMeta.frames || [];

      if (!gifFrames.length) {
        throw new Error(
          "Meteoinfo GIF не содержит кадров"
        );
      }

      /*
        Обычно последний кадр — самый свежий.
      */
      const newest =
        gifFrames.length - 1;

      await showGIFFrame(newest);

    } catch (error) {
      console.error(
        "CLOrad: не удалось загрузить Meteoinfo radar GIF:",
        error
      );

      gifActive = false;
      gifFrames = [];
      gifMeta = null;
    }
  }

  /* =========================================================
     Deactivate
     ========================================================= */

  function deactivateGIF() {
    gifActive = false;

    gifFrameRequest++;

    stopPlayback();

    gifFrameIndex = -1;

    if (gifLayer) {
      const map = getMap();

      if (
        map &&
        map.hasLayer(gifLayer)
      ) {
        map.removeLayer(gifLayer);
      }

      gifLayer = null;
    }

    /*
      Не держим старые Image объекты бесконечно.
    */
    imageCache.clear();

    gifFrames = [];
    gifMeta = null;
  }

  /* =========================================================
     Dynamic radar button
     ========================================================= */

  function createRadarButton() {
    /*
      Если кнопка уже есть — ничего не создаём.
    */
    if ($("meteoinfoRadar")) {
      return;
    }

    const rainButton = $("rainProduct");

    if (!rainButton) {
      return;
    }

    const button =
      rainButton.cloneNode(true);

    button.id = "meteoinfoRadar";

    /*
      Меняем только текст существующей
      кнопки-клона. Стили остаются теми же.
    */
    button.textContent =
      "Радар";

    rainButton.parentNode.insertBefore(
      button,
      rainButton.nextSibling
    );

    button.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        /*
          Обычный iDarkMeteo слой выключается
          перед включением GIF.
        */
        if (
          typeof window.CLOradStopRadar ===
          "function"
        ) {
          window.CLOradStopRadar();
        }

        /*
          Снимаем active с существующих кнопок,
          если функция есть.
        */
        if (
          typeof window.setActiveNav ===
          "function"
        ) {
          window.setActiveNav(button);
        } else {
          document
            .querySelectorAll(".n")
            .forEach(el =>
              el.classList.remove("active")
            );

          button.classList.add("active");
        }

        activateGIF();
      }
    );
  }

  /* =========================================================
     Timeline interception
     ========================================================= */

  function installTimelineHandler() {
    const range = $("range");

    if (!range) {
      return;
    }

    /*
      Capture phase нужен, чтобы существующий
      обработчик CLOrad не попытался загрузить
      iDarkMeteo кадр поверх GIF.
    */
    range.addEventListener(
      "input",
      event => {
        if (!gifActive) {
          return;
        }

        event.stopImmediatePropagation();

        const index =
          Number(range.value) || 0;

        showGIFFrame(index);
      },
      true
    );

    range.addEventListener(
      "change",
      event => {
        if (!gifActive) {
          return;
        }

        event.stopImmediatePropagation();

        const index =
          Number(range.value) || 0;

        showGIFFrame(index);
      },
      true
    );
  }

  /* =========================================================
     Play button interception
     ========================================================= */

  function installPlayHandler() {
    /*
      Ищем существующую кнопку play,
      не создаём новую.
    */

    const candidates = [
      "play",
      "playBtn",
      "playButton",
      "radarPlay"
    ];

    let button = null;

    for (const id of candidates) {
      const el = $(id);

      if (el) {
        button = el;
        break;
      }
    }

    if (!button) {
      return;
    }

    button.addEventListener(
      "click",
      event => {
        if (!gifActive) {
          return;
        }

        event.stopImmediatePropagation();

        if (gifPlayTimer) {
          stopPlayback();
        } else {
          playGIF();
        }
      },
      true
    );
  }

  /* =========================================================
     Navigation protection
     ========================================================= */

  function installNavigationProtection() {
    document.addEventListener(
      "click",
      event => {
        if (!gifActive) {
          return;
        }

        const button =
          event.target.closest(".n");

        if (!button) {
          return;
        }

        /*
          Радар-кнопка сама обрабатывает активацию.
        */
        if (
          button.id === "meteoinfoRadar"
        ) {
          return;
        }

        /*
          Слои не должны выключать GIF,
          если это только открытие панели.
        */
        if (
          button.id === "layersNav"
        ) {
          return;
        }

        /*
          Любой другой раздел выключает GIF.
        */
        deactivateGIF();

      },
      true
    );
  }

  /* =========================================================
     Rain button protection
     ========================================================= */

  function installRainProtection() {
    const rain =
      $("rainProduct");

    if (!rain) {
      return;
    }

    rain.addEventListener(
      "click",
      () => {
        if (!gifActive) {
          return;
        }

        deactivateGIF();

      },
      true
    );
  }

  /* =========================================================
     Public API
     ========================================================= */

  window.CLOradDeactivateGIF =
    deactivateGIF;

  window.CLOradActivateGIF =
    activateGIF;

  window.CLOradShowGIFFrame =
    showGIFFrame;

  window.CLOradPlayGIF =
    playGIF;

  window.CLOradGIFActive =
    () => gifActive;

  window.CLOradGIFFrames =
    () => gifFrames;

  /* =========================================================
     Init
     ========================================================= */

  function init() {
    installStyles();

    createRadarButton();

    installTimelineHandler();

    installPlayHandler();

    installNavigationProtection();

    installRainProtection();

    console.log(
      "CLOrad: Meteoinfo radar GIF module loaded"
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }

})();
