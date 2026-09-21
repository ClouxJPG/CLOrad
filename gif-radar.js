// ============================================================
// CLOrad — Meteoinfo GIF Radar
// Отдельные кадры + существующий таймлайн CLOrad
// Без автоматического проигрывания GIF
// ============================================================

(function () {
  "use strict";

  const API = "/api/radar-gif";

  let gifEnabled = false;
  let gifFrames = [];
  let gifLayer = null;
  let gifDecoded = false;

  const nav = document.getElementById("nav");
  const range = document.getElementById("range");
  const timeLabel = document.getElementById("timeLabel");
  const framesInfo = document.getElementById("framesInfo");

  if (!nav || !range) {
    console.error("CLOrad GIF: элементы интерфейса не найдены");
    return;
  }

  // ------------------------------------------------------------
  // КНОПКА
  // ------------------------------------------------------------

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
    nav.insertBefore(btn, nav.firstChild);
  }

  // ------------------------------------------------------------
  // СТИЛЬ
  // ------------------------------------------------------------

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
    `;

    document.head.appendChild(style);
  }

  // ------------------------------------------------------------
  // СОХРАНЯЕМ СТАНДАРТНЫЙ TIMELINE
  // ------------------------------------------------------------

  const originalRangeInput = range.oninput;

  // ------------------------------------------------------------
  // ПРЕОБРАЗОВАНИЕ RGBA → PNG
  // ------------------------------------------------------------

  function rgbaToDataURL(rgba, width, height) {
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");

    const imageData = ctx.createImageData(width, height);

    imageData.data.set(rgba);

    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL("image/png");
  }

  // ------------------------------------------------------------
  // ЗАГРУЗКА GIF
  // ------------------------------------------------------------

  async function loadGIF() {
    if (gifDecoded) return;

    msg("Загрузка радара Meteoinfo...");

    const response = await fetch(API + "?t=" + Date.now(), {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "GIF API HTTP " + response.status
      );
    }

    const buffer = await response.arrayBuffer();

    // Загружаем декодер только когда GIF действительно нужен.
    const gifuct = await import(
      "https://cdn.jsdelivr.net/npm/gifuct-js/+esm"
    );

    const parseGIF = gifuct.parseGIF;
    const decompressFrames = gifuct.decompressFrames;

    const gif = parseGIF(buffer);

    const frames = decompressFrames(gif, true);

    if (!frames || !frames.length) {
      throw new Error("GIF не содержит кадров");
    }

    gifFrames = [];

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];

      if (!frame.patch) continue;

      const width =
        frame.dims?.width ||
        gif.lsd?.width ||
        1;

      const height =
        frame.dims?.height ||
        gif.lsd?.height ||
        1;

      const fullWidth =
        gif.lsd?.width ||
        width;

      const fullHeight =
        gif.lsd?.height ||
        height;

      const canvas = document.createElement("canvas");

      canvas.width = fullWidth;
      canvas.height = fullHeight;

      const ctx = canvas.getContext("2d");

      const imageData = ctx.createImageData(
        width,
        height
      );

      imageData.data.set(frame.patch);

      ctx.putImageData(
        imageData,
        frame.dims?.left || 0,
        frame.dims?.top || 0
      );

      gifFrames.push({
        url: canvas.toDataURL("image/png"),
        width: fullWidth,
        height: fullHeight,
        delay: frame.delay || 0
      });
    }

    if (!gifFrames.length) {
      throw new Error("Не удалось декодировать кадры GIF");
    }

    gifDecoded = true;

    msg(
      "Радар Meteoinfo: " +
      gifFrames.length +
      " кадров"
    );
  }

  // ------------------------------------------------------------
  // УДАЛЕНИЕ GIF С КАРТЫ
  // ------------------------------------------------------------

  function removeGIFLayer() {
    if (
      gifLayer &&
      window.map &&
      window.map.hasLayer(gifLayer)
    ) {
      window.map.removeLayer(gifLayer);
    }

    gifLayer = null;
  }

  // ------------------------------------------------------------
  // ПОКАЗ КАДРА
  // ------------------------------------------------------------

  function showFrame(index) {
    if (!gifFrames.length) return;

    index = Math.max(
      0,
      Math.min(
        gifFrames.length - 1,
        index
      )
    );

    const frame = gifFrames[index];

    /*
      ВАЖНО:
      Здесь специально НЕ используется выдуманный
      geographic bounds.

      Пока координаты карты Meteoinfo не заданы,
      кадр нельзя безопасно позиционировать на Leaflet.
    */

    if (!window.map) {
      console.error("CLOrad GIF: map не найден");
      return;
    }

    removeGIFLayer();

    /*
      Временное отображение изображения поверх карты
      будет включено после задания реальных bounds.
    */

    if (framesInfo) {
      framesInfo.textContent =
        "GIF: " +
        (index + 1) +
        " / " +
        gifFrames.length;
    }

    if (timeLabel) {
      timeLabel.textContent =
        "Кадр " +
        (index + 1) +
        " / " +
        gifFrames.length;
    }
  }

  // ------------------------------------------------------------
  // TIMELINE ДЛЯ GIF
  // ------------------------------------------------------------

  function installGIFTimeline() {
    range.min = "0";
    range.max = String(
      Math.max(0, gifFrames.length - 1)
    );
    range.step = "1";
    range.value = String(
      Math.max(0, gifFrames.length - 1)
    );

    range.oninput = function () {
      const index =
        Number(range.value) || 0;

      showFrame(index);
    };

    showFrame(
      gifFrames.length - 1
    );
  }

  // ------------------------------------------------------------
  // ВОЗВРАТ ОБЫЧНОГО TIMELINE
  // ------------------------------------------------------------

  function restoreTimeline() {
    range.oninput = originalRangeInput;
  }

  // ------------------------------------------------------------
  // ВКЛЮЧЕНИЕ GIF
  // ------------------------------------------------------------

  async function enableGIF() {
    if (gifEnabled) return;

    gifEnabled = true;

    // Выключаем обычный радарный продукт.
    if (
      typeof window.stopRadar === "function"
    ) {
      window.stopRadar();
    }

    // Обычный CLOrad active-state.
    document
      .querySelectorAll(".n")
      .forEach(function (item) {
        item.classList.remove("active");
      });

    btn.classList.add("active");

    try {
      await loadGIF();

      if (!gifEnabled) return;

      installGIFTimeline();

      msg(
        "Meteoinfo GIF включён"
      );

    } catch (error) {
      console.error(
        "CLOrad GIF error:",
        error
      );

      gifEnabled = false;

      btn.classList.remove("active");

      restoreTimeline();

      msg(
        "Ошибка загрузки Meteoinfo GIF"
      );
    }
  }

  // ------------------------------------------------------------
  // ВЫКЛЮЧЕНИЕ GIF
  // ------------------------------------------------------------

  function disableGIF() {
    if (!gifEnabled) return;

    gifEnabled = false;

    removeGIFLayer();

    restoreTimeline();

    gifFrames = [];

    gifDecoded = false;

    if (framesInfo) {
      framesInfo.textContent = "";
    }

    btn.classList.remove("active");
  }

  // ------------------------------------------------------------
  // КЛИК ПО GIF
  // ------------------------------------------------------------

  btn.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();

    if (gifEnabled) {
      disableGIF();
      return;
    }

    enableGIF();
  });

  // ------------------------------------------------------------
  // ЕСЛИ НАЖАЛИ ДРУГОЙ .n —
  // GIF ДОЛЖЕН ВЫКЛЮЧИТЬСЯ
  // ------------------------------------------------------------

  nav.addEventListener(
    "click",
    function (event) {
      const otherButton =
        event.target.closest(".n");

      if (!otherButton) return;

      if (
        otherButton === btn
      ) {
        return;
      }

      if (gifEnabled) {
        disableGIF();
      }
    },
    true
  );

  // ------------------------------------------------------------
  // ПУБЛИЧНОЕ API
  // ------------------------------------------------------------

  window.CLOradGIF = {
    enable: enableGIF,
    disable: disableGIF,
    showFrame: showFrame
  };

})();
