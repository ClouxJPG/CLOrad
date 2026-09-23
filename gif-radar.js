// ============================================================
// CLOrad — Meteoinfo GIF Radar
// Server-side GIF decoding
// ============================================================

(() => {

  const API = "/api/radar-gif";

  let gifLayer = null;
  let gifActive = false;
  let frameCount = 0;
  let currentFrame = -1;
  let loadingFrame = 0;

  const nav = document.getElementById("nav");
  const rainButton = document.getElementById("rainProduct");
  const range = document.getElementById("range");

  if (!nav || !rainButton || !range || !window.map) {
    console.error("CLOrad GIF: необходимые элементы не найдены");
    return;
  }


  // ==========================================================
  // ТОЧНАЯ ГЕОПРИВЯЗКА GIF
  //
  // ВАЖНО:
  // Здесь НЕ используются старые приблизительные bounds.
  //
  // После калибровки сюда будут внесены реальные координаты
  // изображения Meteoinfo.
  // ==========================================================

  window.CLOradGIFBounds = [
    [40.000000, 20.000000],
    [70.000000, 80.000000]
  ];


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
  // УДАЛЕНИЕ GIF
  // ==========================================================

  function removeGIF() {

    gifActive = false;
    currentFrame = -1;
    loadingFrame++;

    if (gifLayer) {
      try {
        window.map.removeLayer(gifLayer);
      } catch (_) {}

      gifLayer = null;
    }

    gifButton.classList.remove("active");
  }


  // ==========================================================
  // ОСТАНОВКА ОБЫЧНОГО RADAR
  // ==========================================================

  function stopNormalRadar() {

    if (
      typeof window.CLOradStopRadar === "function"
    ) {
      window.CLOradStopRadar();
    }

  }


  // ==========================================================
  // АКТИВАЦИЯ GIF
  // ==========================================================

  async function activateGIF() {

    gifActive = true;

    // Убираем обычный радар
    stopNormalRadar();

    // Убираем старый GIF
    if (gifLayer) {

      try {
        window.map.removeLayer(gifLayer);
      } catch (_) {}

      gifLayer = null;
    }

    // Только GIF становится active
    document
      .querySelectorAll("#nav .n")
      .forEach(button => {
        button.classList.remove("active");
      });

    gifButton.classList.add("active");


    try {

      const response = await fetch(
        API + "?mode=meta",
        {
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw new Error(
          "GIF meta HTTP " + response.status
        );
      }

      const meta = await response.json();

      if (!meta.ok) {
        throw new Error(
          meta.message || "GIF metadata error"
        );
      }

      frameCount = Number(
        meta.frames || 1
      );

      if (
        !Number.isFinite(frameCount) ||
        frameCount < 1
      ) {
        frameCount = 1;
      }


      // ======================================================
      // ПОДКЛЮЧАЕМ СУЩЕСТВУЮЩИЙ TIMELINE CLOrad
      // ======================================================

      range.min = 0;
      range.max = frameCount - 1;
      range.step = 1;

      let frame = Number(range.value);

      if (
        !Number.isFinite(frame) ||
        frame < 0 ||
        frame >= frameCount
      ) {
        frame = frameCount - 1;
        range.value = frame;
      }

      await showFrame(frame);

    } catch (error) {

      console.error(
        "CLOrad GIF activation error:",
        error
      );

      removeGIF();

      if (typeof window.msg === "function") {
        window.msg(
          "Ошибка загрузки GIF радара"
        );
      }

    }

  }


  // ==========================================================
  // ЗАГРУЗКА КАДРА
  // ==========================================================

  async function showFrame(frame) {

    if (!gifActive) {
      return;
    }

    frame = Math.max(
      0,
      Math.min(
        Number(frame) || 0,
        Math.max(0, frameCount - 1)
      )
    );


    const requestId = ++loadingFrame;


    try {

      const response = await fetch(
        API +
        "?frame=" +
        encodeURIComponent(frame),
        {
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw new Error(
          "GIF frame HTTP " +
          response.status
        );
      }


      const blob = await response.blob();


      // Пользователь уже переключил слой
      if (
        !gifActive ||
        requestId !== loadingFrame
      ) {
        return;
      }


      const url =
        URL.createObjectURL(blob);


      // ======================================================
      // ГЕОПРИВЯЗКА
      // ======================================================

      const bounds =
        window.CLOradGIFBounds;


      if (
        !Array.isArray(bounds) ||
        bounds.length !== 2
      ) {

        URL.revokeObjectURL(url);

        console.error(
          "CLOrad GIF: отсутствует геопривязка"
        );

        return;
      }


      // ======================================================
      // СОЗДАЁМ НОВЫЙ КАДР
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


      // Удаляем предыдущий кадр
      if (gifLayer) {

        try {
          window.map.removeLayer(
            gifLayer
          );
        } catch (_) {}

      }


      gifLayer = newLayer;
      currentFrame = frame;


      // Освобождаем blob URL
      setTimeout(() => {

        try {
          URL.revokeObjectURL(url);
        } catch (_) {}

      }, 5000);


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
        Number(range.value)
      );

    }
  );


  // ==========================================================
  // КНОПКА GIF
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
  // ПЕРЕКЛЮЧЕНИЕ СЛОЁВ
  //
  // GIF выключается:
  //   Осадки
  //   другие .n
  //
  // GIF НЕ выключается:
  //   Слои
  // ==========================================================

  nav.addEventListener(
    "click",
    event => {

      const button =
        event.target.closest(".n");

      if (!button) {
        return;
      }


      // -----------------------------------------------
      // "Слои" — GIF НЕ выключаем
      // -----------------------------------------------

      if (
        button.id === "layersNav"
      ) {
        return;
      }


      // -----------------------------------------------
      // Сам GIF
      // -----------------------------------------------

      if (
        button === gifButton
      ) {
        return;
      }


      // -----------------------------------------------
      // Любой другой radar/product
      // -----------------------------------------------

      if (gifActive) {
        removeGIF();
      }

    },
    true
  );


  // ==========================================================
  // ПУБЛИЧНЫЕ ФУНКЦИИ CLOrad
  // ==========================================================

  window.CLOradDisableGIF =
    removeGIF;


  window.CLOradGIFActive =
    () => gifActive;


  // ==========================================================
  // ГОТОВО
  // ==========================================================

  console.log(
    "CLOrad: Meteoinfo GIF Radar loaded"
  );

})();
