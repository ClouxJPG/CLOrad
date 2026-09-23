// ============================================================
// CLOrad — Meteoinfo GIF Radar
// Server-side GIF decoding
// Fast frame loading
// Sharp pixels / no browser smoothing
// ============================================================

(() => {

  const API =
    "/api/radar-gif";


  // ==========================================================
  // ГЕОМЕТРИЯ GIF
  // ==========================================================

  /*
   * Географический охват исходной карты.
   *
   * Это отдельная настройка от поворота.
   */

  window.CLOradGIFBounds = [
    [40.000000, 20.000000],
    [70.000000, 80.000000]
  ];


  /*
   * Небольшая коррекция наклона.
   *
   * Положительное значение = по часовой стрелке.
   * Отрицательное = против часовой.
   *
   * Сейчас начальная калибровка:
   */

  const GIF_ROTATION = -1.15;


  // ==========================================================
  // СОСТОЯНИЕ
  // ==========================================================

  let gifLayer = null;

  let gifActive = false;

  let frameCount = 0;

  let currentFrame = -1;

  let loadingFrame = 0;

  let currentObjectURL = null;


  // ==========================================================
  // DOM
  // ==========================================================

  const nav =
    document.getElementById(
      "nav"
    );


  const rainButton =
    document.getElementById(
      "rainProduct"
    );


  const range =
    document.getElementById(
      "range"
    );


  if (
    !nav ||
    !rainButton ||
    !range ||
    !window.map
  ) {

    console.error(
      "CLOrad GIF: необходимые элементы не найдены"
    );

    return;

  }


  // ==========================================================
  // КНОПКА
  // ==========================================================

  const gifButton =
    document.createElement(
      "button"
    );


  gifButton.className =
    "n";


  gifButton.id =
    "gifRadarNav";


  gifButton.type =
    "button";


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
        <circle
          cx="12"
          cy="12"
          r="8.5"
        ></circle>

        <path
          d="M10 8.5L16 12L10 15.5V8.5Z"
        ></path>
      </svg>
    </span>

    <span>GIF радар</span>
  `;


  rainButton.insertAdjacentElement(
    "afterend",
    gifButton
  );


  // ==========================================================
  // ПРИМЕНЕНИЕ РЕЗКОСТИ
  // ==========================================================

  function makeImageSharp(
    image
  ) {

    if (!image) {
      return;
    }


    /*
     * Основное свойство.
     *
     * Браузер не должен сглаживать
     * исходные радарные пиксели.
     */

    image.style.imageRendering =
      "pixelated";


    /*
     * Safari / WebKit
     */

    image.style.webkitImageRendering =
      "pixelated";


    /*
     * Дополнительный вариант
     * для браузеров, поддерживающих crisp-edges.
     */

    image.style.setProperty(
      "image-rendering",
      "pixelated"
    );


    image.style.transformOrigin =
      "50% 50%";


    // Небольшой наклон GIF.
    image.style.transform =
      `rotate(${GIF_ROTATION}deg)`;

  }


  // ==========================================================
  // УДАЛЕНИЕ GIF
  // ==========================================================

  function removeGIF() {

    gifActive = false;

    currentFrame = -1;

    loadingFrame++;


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


    gifButton.classList.remove(
      "active"
    );

  }


  // ==========================================================
  // ОСТАНОВКА ОСНОВНОГО RADAR
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
  // АКТИВАЦИЯ
  // ==========================================================

  async function activateGIF() {

    gifActive = true;


    // Выключаем обычный radar
    stopNormalRadar();


    // Удаляем старый кадр
    if (gifLayer) {

      try {

        window.map.removeLayer(
          gifLayer
        );

      } catch (_) {}

      gifLayer = null;

    }


    // ========================================================
    // ACTIVE BUTTON
    // ========================================================

    document
      .querySelectorAll(
        "#nav .n"
      )
      .forEach(
        button => {
          button.classList.remove(
            "active"
          );
        }
      );


    gifButton.classList.add(
      "active"
    );


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


      frameCount =
        Number(
          meta.frames || 1
        );


      if (
        !Number.isFinite(
          frameCount
        ) ||
        frameCount < 1
      ) {

        frameCount = 1;

      }


      // ======================================================
      // TIMELINE
      // ======================================================

      range.min =
        0;


      range.max =
        frameCount - 1;


      range.step =
        1;


      let frame =
        Number(
          range.value
        );


      if (
        !Number.isFinite(
          frame
        ) ||
        frame < 0 ||
        frame >= frameCount
      ) {

        frame =
          frameCount - 1;

        range.value =
          frame;

      }


      await showFrame(
        frame
      );


    } catch (error) {

      console.error(
        "CLOrad GIF activation error:",
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
  // КАДР
  // ==========================================================

  async function showFrame(
    frame
  ) {

    if (!gifActive) {
      return;
    }


    frame =
      Math.max(
        0,
        Math.min(
          Number(frame) || 0,
          Math.max(
            0,
            frameCount - 1
          )
        )
      );


    const requestId =
      ++loadingFrame;


    try {

      /*
       * Браузер теперь МОЖЕТ использовать HTTP cache.
       *
       * Это намного быстрее no-store.
       */

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
       * Если пользователь уже ушёл
       * на другой слой — старый кадр
       * не устанавливаем.
       */

      if (
        !gifActive ||
        requestId !== loadingFrame
      ) {

        return;

      }


      const url =
        URL.createObjectURL(
          blob
        );


      // ======================================================
      // BOUNDS
      // ======================================================

      const bounds =
        window.CLOradGIFBounds;


      if (
        !Array.isArray(
          bounds
        ) ||
        bounds.length !== 2
      ) {

        URL.revokeObjectURL(
          url
        );

        console.error(
          "CLOrad GIF: bounds отсутствуют"
        );

        return;

      }


      // ======================================================
      // НОВЫЙ LAYER
      // ======================================================

      const newLayer =
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


      newLayer.addTo(
        window.map
      );


      // ======================================================
      // РЕЗКОСТЬ
      // ======================================================

      const image =
        newLayer.getElement();


      if (image) {

        makeImageSharp(
          image
        );

      }


      // ======================================================
      // СТАРЫЙ КАДР
      // ======================================================

      const oldURL =
        currentObjectURL;


      const oldLayer =
        gifLayer;


      gifLayer =
        newLayer;


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


    } catch (error) {

      console.error(
        "CLOrad GIF frame error:",
        error
      );

    }

  }


  // ==========================================================
  // TIMELINE
  // ==========================================================

  range.addEventListener(
    "input",
    () => {

      if (!gifActive) {
        return;
      }


      showFrame(
        Number(
          range.value
        )
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
  // SWITCHING
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
      // GIF НЕ выключаем.
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
        button ===
        gifButton
      ) {

        return;

      }


      // ------------------------------------------------------
      // ДРУГИЕ СЛОИ
      // ------------------------------------------------------

      if (gifActive) {

        removeGIF();

      }

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
