(function () {
  "use strict";

  const API = "/api/radar-gif";
  const nav = document.getElementById("nav");

  if (!nav) return;

  const btn = document.createElement("button");

  btn.className = "n";
  btn.id = "gifRadarBtn";
  btn.type = "button";

  btn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1.5"></rect>
    </svg>
    <span>GIF</span>
  `;

  const rain = document.getElementById("rainProduct");

  if (rain) {
    rain.insertAdjacentElement("afterend", btn);
  } else {
    nav.appendChild(btn);
  }

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

  let enabled = false;

  function showError(text) {
    msg("GIF: " + text);
  }

  async function enable() {
    enabled = true;

    document
      .querySelectorAll(".n")
      .forEach(function (el) {
        el.classList.remove("active");
      });

    btn.classList.add("active");

    if (typeof window.stopRadar === "function") {
      window.stopRadar();
    }

    msg("GIF: проверяем API...");

    try {
      const response = await fetch(
        API + "?t=" + Date.now(),
        {
          method: "GET",
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw new Error(
          "HTTP " + response.status
        );
      }

      const type =
        response.headers.get("content-type") || "";

      if (!type.includes("gif")) {
        const text = await response.text();

        throw new Error(
          "API вернул не GIF (" +
          type +
          "). Ответ: " +
          text.slice(0, 120)
        );
      }

      const blob = await response.blob();

      if (!blob.size) {
        throw new Error(
          "API вернул пустой файл"
        );
      }

      msg(
        "GIF API работает: " +
        Math.round(blob.size / 1024) +
        " КБ"
      );

    } catch (error) {

      enabled = false;

      btn.classList.remove("active");

      showError(
        error?.message ||
        String(error)
      );
    }
  }

  function disable() {
    enabled = false;
    btn.classList.remove("active");
    msg("GIF выключен");
  }

  btn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();

    if (enabled) {
      disable();
    } else {
      enable();
    }
  });

  nav.addEventListener(
    "click",
    function (e) {
      const other = e.target.closest(".n");

      if (!other || other === btn) return;

      if (enabled) {
        disable();
      }
    },
    true
  );

})();
