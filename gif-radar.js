// ============================================================
// CLOrad — Meteoinfo GIF Radar
// Тест API + вывод GIF без автоматического проигрывания
// ============================================================

(function () {
  "use strict";

  const API = "/api/radar-gif";

  const nav = document.getElementById("nav");

  if (!nav) {
    console.error("CLOrad GIF: #nav не найден");
    return;
  }

  // ============================================================
  // КНОПКА
  // ============================================================

  const btn = document.createElement("button");

  btn.className = "n";
  btn.id = "gifRadarBtn";
  btn.type = "button";
  btn.title = "Радар Meteoinfo";

  btn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1.5"></rect>
    </svg>
    <span>GIF</span>
  `;

  const rainButton = document.getElementById("rainProduct");

  if (rainButton) {
    rainButton.insertAdjacentElement("afterend", btn);
  } else {
    nav.appendChild(btn);
  }

  // ============================================================
  // СТИЛЬ
  // ============================================================

  const style = document.createElement("style");

  style.textContent = `
    #gifRadarBtn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
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

  // ============================================================
  // GIF
  // ============================================================

  let gifImage = null;
  let gifEnabled = false;

  function removeGIF() {
    if (
      gifImage &&
      window.map &&
      window.map.hasLayer(gifImage)
    ) {
      window.map.removeLayer(gifImage);
    }

    gifImage = null;
  }

  async function enableGIF() {
    if (gifEnabled) return;

    gifEnabled = true;

    // Отключаем обычные слои CLOrad
    document
      .querySelectorAll(".n")
      .forEach(function (item) {
        item.classList.remove("active");
      });

    btn.classList.add("active");

    // Если существует стандартная остановка радара
    if (typeof window.stopRadar === "function") {
      window.stopRadar();
    }

    msg("Загрузка Meteoinfo GIF...");

    try {
      const response = await fetch(
        API + "?t=" + Date.now(),
        {
          cache: "no-store"
        }
      );

      console.log(
        "CLOrad GIF API status:",
        response.status
      );

      console.log(
        "CLOrad GIF content-type:",
        response.headers.get("content-type")
      );

      if (!response.ok) {
        throw new Error(
          "API HTTP " + response.status
        );
      }

      const blob = await response.blob();

      console.log(
        "CLOrad GIF size:",
        blob.size
      );

      console.log(
        "CLOrad GIF type:",
        blob.type
      );

      if (!blob.size) {
        throw new Error(
          "API вернул пустой файл"
        );
      }

      const url = URL.createObjectURL(blob);

      /*
       * ВАЖНО:
       * Пока мы только проверяем получение настоящего GIF.
       * Он НЕ запускается как обычная картинка на странице.
       */

      gifImage = {
        url: url,
        blob: blob
      };

      msg(
        "Meteoinfo GIF загружен: " +
        Math.round(blob.size / 1024) +
        " КБ"
      );

      console.log(
        "CLOrad GIF успешно получен",
        gifImage
      );

    } catch (error) {

      console.error(
        "CLOrad GIF ERROR:",
        error
      );

      gifEnabled = false;

      btn.classList.remove("active");

      msg(
        "Ошибка загрузки Meteoinfo GIF"
      );
    }
  }

  function disableGIF() {
    gifEnabled = false;

    removeGIF();

    btn.classList.remove("active");

    msg("Meteoinfo GIF выключен");
  }

  // ============================================================
  // КНОПКА GIF
  // ============================================================

  btn.addEventListener(
    "click",
    function (event) {

      event.preventDefault();
      event.stopPropagation();

      if (gifEnabled) {
        disableGIF();
      } else {
        enableGIF();
      }
    }
  );

  // ============================================================
  // ДРУГОЙ .n → ВЫКЛЮЧАЕМ GIF
  // ============================================================

  nav.addEventListener(
    "click",
    function (event) {

      const other =
        event.target.closest(".n");

      if (!other) return;

      if (other === btn) return;

      if (gifEnabled) {
        disableGIF();
      }

    },
    true
  );

  // ============================================================
  // GLOBAL
  // ============================================================

  window.CLOradGIF = {
    enable: enableGIF,
    disable: disableGIF
  };

})();
