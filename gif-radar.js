// ============================================================
// CLOrad — GIF RADAR
// Meteoinfo radar observations
// Независимый радарный GIF
// ============================================================

(function () {
  "use strict";

  const GIF_URL = "/api/radar-gif";

  let gifEnabled = false;
  let gifLayer = null;
  let gifRequest = 0;

  // ------------------------------------------------------------
  // Географическая область GIF Meteoinfo
  // Европейская часть России + Беларусь + Украина и соседние
  // территории.
  // ------------------------------------------------------------

  const GIF_BOUNDS = [
    [39.0, 18.0],
    [71.0, 82.0]
  ];

  // ------------------------------------------------------------
  // Создание кнопки
  // ------------------------------------------------------------

  function createButton() {
    const nav = document.getElementById("nav");

    if (!nav) {
      console.error("CLOrad GIF: #nav не найден");
      return;
    }

    if (document.getElementById("gifRadarBtn")) {
      return;
    }

    const button = document.createElement("button");

    // Точно такой же класс, как у остальных кнопок
    button.className = "n";
    button.id = "gifRadarBtn";
    button.type = "button";
    button.title = "Радар GIF";

    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect
          x="5"
          y="5"
          width="14"
          height="14"
          rx="1.5">
        </rect>
      </svg>
      <span>GIF</span>
    `;

    // ----------------------------------------------------------
    // Ставим после "Осадки-мм/ч"
    // ----------------------------------------------------------

    const rainButton = document.getElementById("rainProduct");

    if (rainButton) {
      rainButton.insertAdjacentElement("afterend", button);
    } else {
      nav.appendChild(button);
    }

    // ----------------------------------------------------------
    // Только размер иконки.
    // Состояние active берём полностью от .n / .n.active
    // самого CLOrad.
    // ----------------------------------------------------------

    if (!document.getElementById("gifRadarStyle")) {
      const style = document.createElement("style");

      style.id = "gifRadarStyle";

      style.textContent = `
        #gifRadarBtn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        #gifRadarBtn svg {
          width: 19px;
          height: 19px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2;
        }
      `;

      document.head.appendChild(style);
    }

    // ----------------------------------------------------------
    // Клик
    // ----------------------------------------------------------

    button.addEventListener("click", function () {
      if (gifEnabled) {
        disableGIF();
      } else {
        enableGIF();
      }
    });

    // ----------------------------------------------------------
    // Следим за .active.
    //
    // В CLOrad setActiveNav() снимает .active со всех .n.
    // GIF независим, поэтому если пользователь включил GIF
    // и затем нажал другую кнопку, возвращаем .active GIF-кнопке.
    // ----------------------------------------------------------

    const observer = new MutationObserver(function () {
      if (!gifEnabled) return;

      const btn = document.getElementById("gifRadarBtn");

      if (btn && !btn.classList.contains("active")) {
        btn.classList.add("active");
      }
    });

    observer.observe(button, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  // ------------------------------------------------------------
  // Включение GIF
  // ------------------------------------------------------------

  function enableGIF() {
    const button = document.getElementById("gifRadarBtn");

    if (!window.map) {
      console.error("CLOrad GIF: карта не найдена");
      return;
    }

    gifEnabled = true;

    if (button) {
      button.classList.add("active");
    }

    loadGIF();
  }

  // ------------------------------------------------------------
  // Загрузка GIF
  // ------------------------------------------------------------

  function loadGIF() {
    const request = ++gifRequest;

    removeGIFLayer();

    const img = new Image();

    // Разрешаем браузеру загрузить GIF через наш API
    img.src = GIF_URL + "?t=" + Date.now();

    img.onload = function () {
      if (request !== gifRequest || !gifEnabled) {
        return;
      }

      // Leaflet будет использовать настоящий animated GIF.
      // Поэтому анимация проигрывается автоматически.
      gifLayer = L.imageOverlay(
        img.src,
        GIF_BOUNDS,
        {
          opacity: 1,
          interactive: false,
          crossOrigin: false,
          zIndex: 300
        }
      );

      gifLayer.addTo(window.map);
    };

    img.onerror = function (error) {
      console.error("CLOrad GIF: ошибка загрузки", error);

      if (typeof window.msg === "function") {
        window.msg("Не удалось загрузить GIF-радар");
      }
    };
  }

  // ------------------------------------------------------------
  // Выключение
  // ------------------------------------------------------------

  function disableGIF() {
    gifEnabled = false;

    gifRequest++;

    removeGIFLayer();

    const button = document.getElementById("gifRadarBtn");

    if (button) {
      button.classList.remove("active");
    }
  }

  // ------------------------------------------------------------
  // Удаление слоя
  // ------------------------------------------------------------

  function removeGIFLayer() {
    if (gifLayer && window.map) {
      try {
        window.map.removeLayer(gifLayer);
      } catch (e) {
        console.warn("CLOrad GIF: слой уже отсутствует");
      }
    }

    gifLayer = null;
  }

  // ------------------------------------------------------------
  // Публичное API
  // ------------------------------------------------------------

  window.CLOradGIF = {
    enable: enableGIF,

    disable: disableGIF,

    reload: function () {
      if (gifEnabled) {
        loadGIF();
      }
    },

    isEnabled: function () {
      return gifEnabled;
    }
  };

  // ------------------------------------------------------------
  // Запуск
  // ------------------------------------------------------------

  createButton();

})();
