// ============================================================
// CLOrad — Meteoinfo GIF Radar
// Fast server-side frames
// Stable Leaflet positioning
// Exact source colors
// Timeline integration
// ============================================================

(() => {

  const API = "/api/radar-gif";

  const nav = document.getElementById("nav");
  const rainButton = document.getElementById("rainProduct");
  const range = document.getElementById("range");

  const timeLabel = document.getElementById("timeLabel");
  const times = document.getElementById("times");
  const framesInfo = document.getElementById("framesInfo");
  const intensityValue = document.getElementById("intensityValue");

  if (!nav || !rainButton || !range || !window.map) {
    console.error("CLOrad GIF: DOM/map not found");
    return;
  }


  // ==========================================================
  // ГЕОПРИВЯЗКА
  // ==========================================================
  //
  // ВАЖНО:
  // НЕ используем CSS rotate().
  //
  // CSS-поворот ImageOverlay заставляет изображение
  // визуально смещаться при zoom/move.
  //
  // Сначала держим географическую привязку стабильной.
  // ==========================================================

  window.CLOradGIFBounds = [
    [40.000000, 20.000000],
    [70.000000, 80.000000]
  ];


  // ==========================================================
  // СОСТОЯНИЕ
  // ==========================================================

  let gifLayer = null;

  let gifActive = false;

  let frameCount = 0;

  let currentFrame = -1;

  let requestSerial = 0;

  let currentObjectURL = null;

  let gifMeta = null;

  let sourceTime = Date.now();


  // ==========================================================
  // КНОПКА GIF
  // ==========================================================

  const gifButton = document.createElement("button");

  gifButton.className = "n";
  gifButton.id = "gifRadarNav";
  gifButton.type = "button";

  gifButton.innerHTML = `
    <span style="
      display:inline-flex;
      width:22px;
      height:22px;
      align-items:center;
      justify-content:center;
      margin-right:6px;
      flex:none;
    ">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="8.5"></circle>
        <path d="M10 8.5L16 12L10 15.5V8.5Z"></path>
      </svg>
    </span>
    <span>GIF радар</span>
  `;

  rainButton.insertAdjacentElement(
    "afterend",
    gifButton
  );


  // ==========================================================
  // ФОРМАТ ВРЕМЕНИ
  // ==========================================================

  function formatTime(date) {

    if (!(date instanceof Date)) {
      date = new Date(date);
    }

    return date.toLocaleString(
      "ru-RU",
      {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }
    );

  }


  // ==========================================================
  // ВРЕМЯ КАДРА
  // ==========================================================

  function getFrameTime(frame) {

    /*
     * Последний кадр считается самым свежим.
     *
     * delays содержит длительность кадров в миллисекундах.
     */

    const delays =
      Array.isArray(gifMeta?.delays)
        ? gifMeta.delays
        : [];

    let elapsed = 0;

    for (
      let i = frame + 1;
      i < delays.length;
      i++
    ) {

      elapsed += Number(
        delays[i] || 0
      );

    }

    return new Date(
      sourceTime - elapsed
    );

  }


  // ==========================================================
  // TIMELINE
  // ==========================================================

  function updateTimeline(frame) {

    if (!gifActive) {
      return;
    }

    const date =
      getFrameTime(frame);


    if (timeLabel) {

      timeLabel.textContent =
        "GIF радар • " +
        formatTime(date);

    }


    if (times) {

      const newest =
        getFrameTime(
          Math.max(
            0,
            frameCount - 1
          )
        );

      const oldest =
        getFrameTime(0);


      times.textContent =
        formatTime(oldest) +
        " — " +
        formatTime(newest);

    }


    if (framesInfo) {

      framesInfo.textContent =
        "GIF радар · " +
        frameCount +
        " кадров";

    }


    if (intensityValue) {

      intensityValue.textContent =
        "—";

    }

  }


  // ==========================================================
  // ОЧИСТКА GIF
  // ==========================================================

  function removeGIF() {

    gifActive = false;

    requestSerial++;


    if (gifLayer) {

      try {
        window.map.removeLayer(
          gifLayer
        );
      } catch (_) {}

      gifLayer = null;

    }


    if (currentObjectURL) {

      try {
        URL.revokeObjectURL(
          currentObjectURL
        );
      } catch (_) {}

      currentObjectURL = null;

    }


    currentFrame = -1;

    gifButton.classList.remove(
      "active"
    );

  }


  // ==========================================================
  // ОСТАНОВКА iDARKMETEO
  // ==========================================================

  function stopNormalRadar() {

    if (
      typeof window.CLOradStopRadar ===
      "function"
    ) {

      window.CLOradStopRadar();

    }

  }


  // ==========================================================
  // АКТИВАЦИЯ GIF
  // ==========================================================

  async function activateGIF() {

    /*
     * Новый generation.
     * Любой старый iDark request становится неактуальным.
     */

    stopNormalRadar();


    gifActive = true;


    requestSerial++;


    // Удаляем предыдущий GIF
    if (gifLayer) {

      try {
        window.map.removeLayer(
          gifLayer
        );
      } catch (_) {}

      gifLayer = null;

    }


    // ========================================================
    // ACTIVE BUTTONS
    // ========================================================

    document
      .querySelectorAll("#nav .n")
      .forEach(button => {
        button.classList.remove("active");
      });

    gifButton.classList.add("active");


    // ========================================================
    // META
    // ========================================================

    try {

      const response =
        await fetch(
          API + "?mode=meta"
        );


      if (!response.ok) {

        throw new Error(
          "GIF meta HTTP " +
          response.status
        );

      }


      const meta =
        await response.json();


      if (!meta.ok) {

        throw new Error(
          meta.message ||
          "GIF metadata error"
        );

      }


      gifMeta = meta;

      frameCount =
        Math.max(
          1,
          Number(
            meta.frames || 1
          )
        );


      sourceTime =
        Date.now();


      // ======================================================
      // TIMELINE
      // ======================================================

      range.min = 0;

      range.max =
        frameCount - 1;

      range.step = 1;


      let frame =
        Number(
          range.value
        );


      if (
        !Number.isFinite(frame) ||
        frame < 0 ||
        frame >= frameCount
      ) {

        frame =
          frameCount - 1;

      }


      range.value =
        frame;


      updateTimeline(frame);


      await showFrame(frame);


    } catch (error) {

      console.error(
        "CLOrad GIF activation:",
        error
      );


      removeGIF();


      if (
        typeof window.msg ===
        "function"
      ) {

        window.msg(
          "Ошибка загрузки GIF радара"
        );

      }

    }

  }


  // ==========================================================
  // ПОКАЗ КАДРА
  // ==========================================================

  async function showFrame(frame) {

    if (!gifActive) {
      return;
    }


    frame =
      Math.max(
        0,
        Math.min(
          Number(frame) || 0,
          frameCount - 1
        )
      );


    const serial =
      ++requestSerial;


    try {

      const response =
        await fetch(
          API +
          "?frame=" +
          encodeURIComponent(
            frame
          )
        );


      if (!response.ok) {

        throw new Error(
          "GIF frame HTTP " +
          response.status
        );

      }


      const blob =
        await response.blob();


      /*
       * Пока PNG скачивался, пользователь мог
       * переключить слой или другой кадр.
       */

      if (
        !gifActive ||
        serial !== requestSerial
      ) {

        return;

      }


      const url =
        URL.createObjectURL(
          blob
        );


      const bounds =
        window.CLOradGIFBounds;


      if (
        !Array.isArray(bounds) ||
        bounds.length !== 2
      ) {

        URL.revokeObjectURL(url);

        return;

      }


      // ======================================================
      // СОЗДАЁМ IMAGE OVERLAY
      // ======================================================

      const layer =
        L.imageOverlay(
          url,
          bounds,
          {
            opacity: 1,

            interactive: false,

            crossOrigin: true,

            zIndex: 300
          }
        );


      /*
       * ВАЖНО:
       *
       * НИКАКИХ transform:
       * rotate()
       * scale()
       * translate()
       *
       * Leaflet сам управляет географическим
       * положением изображения.
       */

      layer.once(
        "load",
        () => {

          const image =
            layer.getElement();

          if (!image) {
            return;
          }


          image.style.imageRendering =
            "pixelated";


          image.style.setProperty(
            "image-rendering",
            "pixelated"
          );


          image.style.webkitImageRendering =
            "pixelated";


          image.style.filter =
            "none";


          image.style.opacity =
            "1";

        }
      );


      layer.addTo(
        window.map
      );


      // ======================================================
      // ЕСЛИ ЗА ЭТО ВРЕМЯ ПОЯВИЛСЯ НОВЫЙ КАДР
      // ======================================================

      if (
        !gifActive ||
        serial !== requestSerial
      ) {

        try {
          window.map.removeLayer(
            layer
          );
        } catch (_) {}

        URL.revokeObjectURL(url);

        return;

      }


      // ======================================================
      // СТАРЫЙ КАДР УДАЛЯЕМ ТОЛЬКО ПОСЛЕ
      // ДОБАВЛЕНИЯ НОВОГО
      // ======================================================

      const oldLayer =
        gifLayer;


      const oldURL =
        currentObjectURL;


      gifLayer =
        layer;


      currentObjectURL =
        url;


      currentFrame =
        frame;


      if (oldLayer) {

        try {
          window.map.removeLayer(
            oldLayer
          );
        } catch (_) {}

      }


      if (oldURL) {

        try {
          URL.revokeObjectURL(
            oldURL
          );
        } catch (_) {}

      }


      // ======================================================
      // TIMELINE
      // ======================================================

      range.value =
        frame;


      updateTimeline(
        frame
      );


    } catch (error) {

      console.error(
        "CLOrad GIF frame:",
        error
      );

    }

  }


  // ==========================================================
  // TIMELINE INPUT
  // ==========================================================

  range.addEventListener(
    "input",
    () => {

      if (!gifActive) {
        return;
      }


      const frame =
        Number(
          range.value
        );


      /*
       * Сразу обновляем подпись,
       * даже пока PNG ещё грузится.
       */

      updateTimeline(
        frame
      );


      showFrame(
        frame
      );

    }
  );


  // ==========================================================
  // GIF BUTTON
  // ==========================================================

  gifButton.addEventListener(
    "click",
    event => {

      event.preventDefault();

      event.stopPropagation();

      activateGIF();

    }
  );


  // ==========================================================
  // ПЕРЕКЛЮЧЕНИЕ ОСНОВНЫХ СЛОЁВ
  // ==========================================================

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


      // ------------------------------------------------------
      // СЛОИ
      //
      // GIF НЕ выключается.
      // ------------------------------------------------------

      if (
        button.id ===
        "layersNav"
      ) {

        return;

      }


      // ------------------------------------------------------
      // GIF
      // ------------------------------------------------------

      if (
        button === gifButton
      ) {

        return;

      }


      // ------------------------------------------------------
      // ЛЮБОЙ ДРУГОЙ .n
      //
      // Сначала уничтожаем GIF.
      // Затем останавливаем старый iDark.
      //
      // Это происходит В CAPTURE-ФАЗЕ ДО того,
      // как основной обработчик кнопки запустит
      // новый loadProduct().
      // ------------------------------------------------------

      removeGIF();

      stopNormalRadar();

    },
    true
  );


  // ==========================================================
  // PUBLIC API
  // ==========================================================

  window.CLOradDisableGIF =
    removeGIF;


  window.CLOradGIFActive =
    () => gifActive;


  console.log(
    "CLOrad: Meteoinfo GIF Radar loaded"
  );

})();
