// ============================================================
// CLOrad — Meteoinfo GIF Radar
// GIF разбирается НА VERCEL.
// Браузер получает уже готовые PNG-кадры.
// ============================================================

(() => {

  const API =
    "/api/radar-gif";


  // ВРЕМЕННАЯ геопривязка.
  // Её отдельно откалибруем после проверки картинки.

  const GIF_BOUNDS = [
    [40, 20],
    [70, 70]
  ];


  let gifFrames = [];
  let gifDelays = [];
  let gifFrameIndex = 0;

  let gifLayer = null;

  let gifLoaded = false;
  let gifLoading = false;


  // ==========================================================
  // КНОПКА
  // ==========================================================

  const rainButton =
    document.getElementById(
      "rainProduct"
    );


  const nav =
    document.getElementById(
      "nav"
    );


  if (!rainButton || !nav) {

    console.error(
      "CLOrad GIF: навигация не найдена"
    );

    return;
  }


  const gifButton =
    document.createElement(
      "button"
    );


  gifButton.className =
    "n";


  gifButton.id =
    "gifRadar";


  gifButton.title =
    "Радар Meteoinfo";


  gifButton.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="3" y="5" width="18" height="14" rx="3"/>' +
      '<path d="M7 9h2M11 9h2M15 9h2"/>' +
      '<path d="M7 13h2M11 13h2M15 13h2"/>' +
      '<path d="M7 17h10"/>' +
    '</svg>' +
    '<span>GIF радар</span>';


  rainButton.parentNode.insertBefore(
    gifButton,
    rainButton.nextSibling
  );


  // ==========================================================
  // ВЫКЛЮЧЕНИЕ GIF
  // ==========================================================

  function deactivateGIF() {

    gifButton.classList.remove(
      "active"
    );


    if (
      gifLayer &&
      window.map
    ) {

      try {

        window.map.removeLayer(
          gifLayer
        );

      } catch {}

    }


    gifLayer =
      null;
  }


  // ==========================================================
  // ДРУГИЕ КНОПКИ
  // ==========================================================

  nav.addEventListener(
    "click",
    event => {

      const button =
        event.target.closest(
          ".n"
        );


      if (
        !button ||
        button === gifButton
      ) {
        return;
      }


      deactivateGIF();

    },
    true
  );


  // ==========================================================
  // АКТИВАЦИЯ GIF
  // ==========================================================

  function activateGIF() {

    if (
      typeof window.stopRadar ===
      "function"
    ) {

      try {

        window.stopRadar();

      } catch {}

    }


    document
      .querySelectorAll(
        ".n"
      )
      .forEach(
        button =>
          button.classList.remove(
            "active"
          )
      );


    gifButton.classList.add(
      "active"
    );

  }


  // ==========================================================
  // МЕТАДАННЫЕ
  // ==========================================================

  async function loadGIFMeta() {

    const response =
      await fetch(
        API +
        "?mode=meta",
        {
          cache: "no-store"
        }
      );


    if (!response.ok) {

      throw new Error(
        "GIF API HTTP " +
        response.status
      );

    }


    const data =
      await response.json();


    if (
      !data.ok ||
      !Number.isInteger(
        data.frames
      ) ||
      data.frames < 1
    ) {

      throw new Error(
        "Vercel не вернул кадры GIF"
      );

    }


    gifFrames =
      Array.from(
        {
          length:
            data.frames
        },
        (_, index) => ({
          index
        })
      );


    gifDelays =
      Array.isArray(
        data.delays
      )
        ? data.delays
        : [];


    return data;

  }


  // ==========================================================
  // ПОКАЗ КАДРА
  // ==========================================================

  async function showGIFFrame(
    index
  ) {

    if (
      !gifFrames.length ||
      !window.map
    ) {
      return;
    }


    index =
      Math.max(
        0,
        Math.min(
          gifFrames.length - 1,
          Number(index) || 0
        )
      );


    gifFrameIndex =
      index;


    const imageUrl =
      API +
      "?frame=" +
      encodeURIComponent(
        index
      );


    if (gifLayer) {

      gifLayer.setUrl(
        imageUrl
      );

    } else {

      gifLayer =
        L.imageOverlay(
          imageUrl,
          GIF_BOUNDS,
          {
            opacity: 0.84,
            interactive: false,
            crossOrigin: true,
            zIndex: 500
          }
        );


      gifLayer.addTo(
        window.map
      );

    }


    const range =
      document.getElementById(
        "range"
      );


    if (range) {

      range.max =
        Math.max(
          0,
          gifFrames.length - 1
        );


      range.value =
        index;

    }


    const timeLabel =
      document.getElementById(
        "timeLabel"
      );


    if (timeLabel) {

      timeLabel.textContent =
        "GIF радар • кадр " +
        (index + 1) +
        "/" +
        gifFrames.length;

    }


    const framesInfo =
      document.getElementById(
        "framesInfo"
      );


    if (framesInfo) {

      framesInfo.textContent =
        "GIF Meteoinfo: " +
        gifFrames.length +
        " кадров";

    }


    const times =
      document.getElementById(
        "times"
      );


    if (times) {

      times.innerHTML =
        "<span>−3 часа</span>" +
        "<span>сейчас</span>";

    }


    const intensity =
      document.getElementById(
        "intensityValue"
      );


    if (intensity) {

      intensity.textContent =
        "радар Meteoinfo";

    }

  }


  // ==========================================================
  // ТАЙМЛАЙН
  // ==========================================================

  const range =
    document.getElementById(
      "range"
    );


  if (range) {

    range.addEventListener(
      "input",
      event => {

        if (
          !gifButton.classList.contains(
            "active"
          )
        ) {
          return;
        }


        showGIFFrame(
          Number(
            event.target.value
          )
        );

      }
    );

  }


  // ==========================================================
  // КНОПКА GIF
  // ==========================================================

  gifButton.addEventListener(
    "click",
    async event => {

      event.preventDefault();
      event.stopPropagation();


      activateGIF();


      if (gifLoading) {
        return;
      }


      try {

        if (!gifLoaded) {

          gifLoading =
            true;


          if (
            typeof msg ===
            "function"
          ) {

            msg(
              "Загрузка GIF радара…"
            );

          }


          await loadGIFMeta();


          gifLoaded =
            true;

        }


        gifFrameIndex =
          gifFrames.length - 1;


        await showGIFFrame(
          gifFrameIndex
        );


        if (
          typeof msg ===
          "function"
        ) {

          msg(
            "GIF радар загружен"
          );

        }


      } catch (error) {

        console.error(
          "CLOrad GIF:",
          error
        );


        deactivateGIF();


        if (
          typeof msg ===
          "function"
        ) {

          msg(
            "Ошибка GIF: " +
            (
              error?.message ||
              error
            )
          );

        }


      } finally {

        gifLoading =
          false;

      }

    }
  );


  // ==========================================================
  // API CLOrad
  // ==========================================================

  window.CLOradGIF = {

    isActive() {

      return gifButton.classList.contains(
        "active"
      );

    },


    getFrameCount() {

      return gifFrames.length;

    },


    getCurrentFrame() {

      return gifFrameIndex;

    },


    showFrame(index) {

      if (
        !gifButton.classList.contains(
          "active"
        )
      ) {

        return;

      }


      return showGIFFrame(
        index
      );

    },


    deactivate() {

      deactivateGIF();

    }

  };

})();
