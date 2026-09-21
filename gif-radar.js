// ============================================================
// CLOrad — Meteoinfo GIF Radar
// Кадры GIF + ручное переключение
// ============================================================

(function () {
  "use strict";

  const API = "/api/radar-gif";

  const nav = document.getElementById("nav");
  const range = document.getElementById("range");
  const timeLabel = document.getElementById("timeLabel");
  const framesInfo = document.getElementById("framesInfo");

  if (!nav) {
    console.error("CLOrad GIF: nav не найден");
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

  const rainButton =
    document.getElementById("rainProduct");

  if (rainButton) {
    rainButton.insertAdjacentElement(
      "afterend",
      btn
    );
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
  // СОСТОЯНИЕ
  // ============================================================

  let enabled = false;
  let frames = [];
  let currentFrame = -1;
  let decoderLoaded = false;

  // ============================================================
  // ЗАГРУЗКА GIF-DECODER
  // ============================================================

  function loadDecoder() {
    return new Promise(function (resolve, reject) {

      if (
        window.gifuct &&
        window.gifuct.parseGIF &&
        window.gifuct.decompressFrames
      ) {
        decoderLoaded = true;
        resolve();
        return;
      }

      const old =
        document.getElementById(
          "clorad-gifuct"
        );

      if (old) {
        old.addEventListener(
          "load",
          function () {
            decoderLoaded = true;
            resolve();
          }
        );

        old.addEventListener(
          "error",
          reject
        );

        return;
      }

      const script =
        document.createElement("script");

      script.id =
        "clorad-gifuct";

      script.src =
        "https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/dist/gifuct.min.js";

      script.onload = function () {

        if (
          window.gifuct &&
          window.gifuct.parseGIF &&
          window.gifuct.decompressFrames
        ) {
          decoderLoaded = true;
          resolve();
        } else {
          reject(
            new Error(
              "gifuct-js загрузился, но decoder не найден"
            )
          );
        }
      };

      script.onerror = function () {
        reject(
          new Error(
            "Не удалось загрузить GIF decoder"
          )
        );
      };

      document.head.appendChild(script);
    });
  }

  // ============================================================
  // CANVAS → DATA URL
  // ============================================================

  function canvasFrameToURL(
    frame,
    gifWidth,
    gifHeight
  ) {

    const canvas =
      document.createElement("canvas");

    canvas.width = gifWidth;
    canvas.height = gifHeight;

    const ctx =
      canvas.getContext("2d");

    const imageData =
      ctx.createImageData(
        frame.dims.width,
        frame.dims.height
      );

    imageData.data.set(
      frame.patch
    );

    ctx.putImageData(
      imageData,
      frame.dims.left,
      frame.dims.top
    );

    return canvas.toDataURL(
      "image/png"
    );
  }

  // ============================================================
  // ЗАГРУЗКА И РАЗБОР GIF
  // ============================================================

  async function loadFrames() {

    msg("Загрузка кадров Meteoinfo...");

    await loadDecoder();

    const response =
      await fetch(
        API + "?t=" + Date.now(),
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        "API HTTP " +
        response.status
      );
    }

    const buffer =
      await response.arrayBuffer();

    if (!buffer.byteLength) {
      throw new Error(
        "GIF пустой"
      );
    }

    const gif =
      window.gifuct.parseGIF(
        buffer
      );

    const decoded =
      window.gifuct.decompressFrames(
        gif,
        true
      );

    if (!decoded.length) {
      throw new Error(
        "В GIF нет кадров"
      );
    }

    const width =
      gif.lsd.width;

    const height =
      gif.lsd.height;

    frames = [];

    for (
      let i = 0;
      i < decoded.length;
      i++
    ) {

      const frame =
        decoded[i];

      const url =
        canvasFrameToURL(
          frame,
          width,
          height
        );

      frames.push({
        url: url,
        width: width,
        height: height,
        delay:
          frame.delay || 0
      });
    }

    if (!frames.length) {
      throw new Error(
        "Кадры не были созданы"
      );
    }

    msg(
      "Meteoinfo: " +
      frames.length +
      " кадров"
    );
  }

  // ============================================================
  // ПОКАЗ КАДРА
  // ============================================================

  function showFrame(index) {

    if (!frames.length) {
      return;
    }

    index = Math.max(
      0,
      Math.min(
        frames.length - 1,
        Number(index)
      )
    );

    currentFrame = index;

    const frame =
      frames[index];

    /*
      Пока не задаём bounds.
      Здесь проверяем именно получение
      и переключение кадров.
    */

    if (framesInfo) {
      framesInfo.textContent =
        "GIF • кадр " +
        (index + 1) +
        " / " +
        frames.length;
    }

    if (timeLabel) {
      timeLabel.textContent =
        "Кадр " +
        (index + 1) +
        " / " +
        frames.length;
    }

    console.log(
      "CLOrad GIF frame:",
      index,
      frame
    );
  }

  // ============================================================
  // ПОДКЛЮЧЕНИЕ К TIMELINE
  // ============================================================

  function setupTimeline() {

    if (!range) return;

    range.min = "0";

    range.max =
      String(
        Math.max(
          0,
          frames.length - 1
        )
      );

    range.step = "1";

    range.value =
      String(
        frames.length - 1
      );

    range.oninput =
      function () {

        showFrame(
          Number(
            range.value
          )
        );
      };

    showFrame(
      frames.length - 1
    );
  }

  // ============================================================
  // ОЧИСТКА
  // ============================================================

  function clearGIF() {

    frames = [];
    currentFrame = -1;

    if (range) {
      range.oninput = null;
    }

    if (framesInfo) {
      framesInfo.textContent = "";
    }

    if (timeLabel) {
      timeLabel.textContent = "";
    }
  }

  // ============================================================
  // ВКЛЮЧЕНИЕ
  // ============================================================

  async function enable() {

    if (enabled) return;

    enabled = true;

    document
      .querySelectorAll(".n")
      .forEach(function (item) {
        item.classList.remove(
          "active"
        );
      });

    btn.classList.add("active");

    // Выключаем обычный радар.
    if (
      typeof window.stopRadar ===
      "function"
    ) {
      window.stopRadar();
    }

    try {

      if (!decoderLoaded || !frames.length) {
        await loadFrames();
      }

      if (!enabled) return;

      setupTimeline();

      msg(
        "Meteoinfo GIF включён"
      );

    } catch (error) {

      console.error(
        "CLOrad GIF:",
        error
      );

      enabled = false;

      btn.classList.remove(
        "active"
      );

      clearGIF();

      msg(
        "GIF: " +
        (
          error?.message ||
          String(error)
        )
      );
    }
  }

  // ============================================================
  // ВЫКЛЮЧЕНИЕ
  // ============================================================

  function disable() {

    enabled = false;

    clearGIF();

    btn.classList.remove(
      "active"
    );

    msg(
      "Meteoinfo GIF выключен"
    );
  }

  // ============================================================
  // КНОПКА
  // ============================================================

  btn.addEventListener(
    "click",
    function (event) {

      event.preventDefault();
      event.stopPropagation();

      if (enabled) {
        disable();
      } else {
        enable();
      }
    }
  );

  // ============================================================
  // ДРУГИЕ СЛОИ → GIF OFF
  // ============================================================

  nav.addEventListener(
    "click",
    function (event) {

      const other =
        event.target.closest(
          ".n"
        );

      if (!other) return;

      if (other === btn) return;

      if (enabled) {
        disable();
      }
    },
    true
  );

  // ============================================================
  // GLOBAL
  // ============================================================

  window.CLOradGIF = {
    enable: enable,
    disable: disable,
    showFrame: showFrame
  };

})();
