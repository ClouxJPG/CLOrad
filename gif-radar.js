// ============================================================
// CLOrad — GIF Radar button
// Независимая кнопка в нижней панели
// ============================================================

(function () {
  "use strict";

  let gifEnabled = false;

  function createGIFButton() {
    const nav = document.getElementById("nav");

    if (!nav) {
      console.error("CLOrad GIF: #nav не найден");
      return;
    }

    // Если кнопка уже существует — ничего не делаем
    if (document.getElementById("gifRadarBtn")) return;

    const btn = document.createElement("button");

    btn.className = "n";
    btn.id = "gifRadarBtn";
    btn.type = "button";
    btn.title = "GIF радар";
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" rx="1.5"></rect>
      </svg>
      <span>GIF</span>
    `;

    // ----------------------------------------------------------
    // Ставим кнопку сразу после "Осадки-мм/ч"
    // ----------------------------------------------------------

    const rainButton = document.getElementById("rainProduct");

    if (rainButton) {
      rainButton.insertAdjacentElement("afterend", btn);
    } else {
      // Если rainProduct почему-то отсутствует —
      // ставим в начало нижней панели
      nav.insertBefore(btn, nav.firstChild);
    }

    // ----------------------------------------------------------
    // Стиль именно для GIF-кнопки
    // ----------------------------------------------------------

    if (!document.getElementById("gifRadarStyle")) {
      const style = document.createElement("style");
      style.id = "gifRadarStyle";

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

        #gifRadarBtn.gif-active {
          background: #222b34;
          border-color: #35404a;
          color: #fff;
        }
      `;

      document.head.appendChild(style);
    }

    // ----------------------------------------------------------
    // GIF полностью независим от остальных слоёв
    // ----------------------------------------------------------

    btn.addEventListener("click", function () {
      gifEnabled = !gifEnabled;

      btn.classList.toggle("gif-active", gifEnabled);

      if (gifEnabled) {
        if (window.CLOradGIF && typeof window.CLOradGIF.enable === "function") {
          window.CLOradGIF.enable();
        }
      } else {
        if (window.CLOradGIF && typeof window.CLOradGIF.disable === "function") {
          window.CLOradGIF.disable();
        }
      }
    });
  }

  // Скрипт подключается внизу index.html,
  // поэтому DOM уже существует.
  createGIFButton();

})();
