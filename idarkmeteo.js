/* =========================================================
   CLOrad — IDARKMETEO
   Загрузка кадров IDARKMETEO и вывод на Leaflet.
   Raster-слой .rdr обрабатывается через
   idarkmeteo-raster.js.
========================================================= */

(function () {
  "use strict";

  const API =
    "/api/idarkmeteo?path=";

  const map =
    window.map;

  if (!map) {
    console.error(
      "CLOrad: window.map не найден"
    );

    return;
  }

  const PRODUCTS = {
    rain: {
      button: "Осадки-мм/ч",
      mosaic: "wide",
      title: "Осадки",
      units: "мм/ч"
    },

    cloudphase: {
      button: "Фаза облака",
      mosaic: "swath",
      title: "Фаза облака",
      units: ""
    },

    smoke: {
      button: "Дым/пепел",
      mosaic: "swath",
      title: "Дым / пепел",
      units: ""
    },

    satrain: {
      button:
        "Спутниковые осадки",
      mosaic: "coarse",
      title:
        "Спутниковые осадки",
      units: "мм/ч"
    }
  };

  let activeProduct = null;

  let activeLayer = null;

  let frames = [];

  let bounds = null;

  let frameIndex = 0;

  let refreshTimer = null;

  let loading = false;

  function api(path) {
    return (
      API +
      encodeURIComponent(path)
    );
  }

  function makeBounds(box) {
    if (
      !Array.isArray(box) ||
      box.length !== 4
    ) {
      throw new Error(
        "Некорректный box"
      );
    }

    const back = (x, y) =>
      L.Projection
        .SphericalMercator
        .unproject(
          L.point(x, y)
        );

    return L.latLngBounds(
      back(
        box[0],
        box[1]
      ),
      back(
        box[2],
        box[3]
      )
    );
  }

  function getButton(product) {
    return [
      ...document.querySelectorAll(
        ".n"
      )
    ].find(
      element =>
        element.textContent.trim() ===
        PRODUCTS[product]?.button
    );
  }

  function setButtonState(product) {
    document
      .querySelectorAll(".n")
      .forEach(element => {
        element.classList.toggle(
          "active",
          element ===
            getButton(product)
        );
      });
  }

  function setTimeLabel(text) {
    const element =
      document.getElementById(
        "timeLabel"
      );

    if (element) {
      element.textContent =
        text;
    }
  }

  function setTimeline() {
    const range =
      document.getElementById(
        "range"
      );

    const times =
      document.getElementById(
        "times"
      );

    if (range) {
      range.min = 0;

      range.max =
        Math.max(
          0,
          frames.length - 1
        );

      range.value =
        frameIndex;
    }

    if (times) {
      times.textContent =
        frames.length
          ? `${frameIndex + 1} / ${frames.length}`
          : "";
    }
  }

  function formatTime(t) {
    if (!t) {
      return "";
    }

    const date =
      new Date(t);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return t;
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

  async function showFrame(index) {
    if (
      !frames[index] ||
      !bounds ||
      !activeProduct
    ) {
      return;
    }

    if (loading) {
      return;
    }

    loading = true;

    try {
      const frame =
        frames[index];

      const imageUrl =
        await window
          .CLOIdarkRaster
          .frameToImageUrl(
            frame.path,
            activeProduct
          );

      if (activeLayer) {
        map.removeLayer(
          activeLayer
        );

        activeLayer = null;
      }

      activeLayer =
        L.imageOverlay(
          imageUrl,
          bounds,
          {
            opacity: 1,
            interactive: false,
            zIndex: 35
          }
        ).addTo(map);

      frameIndex =
        index;

      setTimeline();

      setTimeLabel(
        `${PRODUCTS[activeProduct].title} • ${formatTime(frame.t)}`
      );

    } catch (error) {
      console.error(
        "IDARKMETEO frame:",
        error
      );

      setTimeLabel(
        "Ошибка загрузки радара"
      );

    } finally {
      loading = false;
    }
  }

  async function loadProduct(
    product
  ) {
    const cfg =
      PRODUCTS[product];

    if (!cfg) {
      return;
    }

    clearTimeout(
      refreshTimer
    );

    try {
      const response =
        await fetch(
          api(
            `frames/${product}/${cfg.mosaic}.json`
          ),
          {
            cache: "no-store"
          }
        );

      if (!response.ok) {
        throw new Error(
          "frames: HTTP " +
          response.status
        );
      }

      const data =
        await response.json();

      activeProduct =
        product;

      frames =
        Array.isArray(
          data.frames
        )
          ? data.frames
              .slice()
              .reverse()
          : [];

      bounds =
        makeBounds(
          data.box
        );

      frameIndex =
        Math.max(
          0,
          frames.length - 1
        );

      setButtonState(
        product
      );

      setTimeline();

      if (frames.length) {
        await showFrame(
          frameIndex
        );
      } else {
        setTimeLabel(
          "Данных нет"
        );
      }

      /*
         Обновляем список кадров
         примерно каждые 10 минут.
      */

      refreshTimer =
        setTimeout(
          () =>
            loadProduct(
              product
            ),
          10 * 60 * 1000
        );

    } catch (error) {
      console.error(
        "IDARKMETEO:",
        error
      );

      setTimeLabel(
        "Данные радара недоступны"
      );
    }
  }

  function bindButtons() {
    for (
      const [
        product,
        cfg
      ] of Object.entries(
        PRODUCTS
      )
    ) {
      const button =
        getButton(
          product
        );

      if (!button) {
        continue;
      }

      button.addEventListener(
        "click",
        event => {
          event.preventDefault();

          loadProduct(
            product
          );
        }
      );
    }
  }

  function bindTimeline() {
    const range =
      document.getElementById(
        "range"
      );

    const play =
      document.getElementById(
        "play"
      );

    if (range) {
      range.addEventListener(
        "input",
        () => {
          const index =
            Number(
              range.value
            );

          showFrame(
            index
          );
        }
      );
    }

    if (play) {
      let playing = false;

      let timer = null;

      play.addEventListener(
        "click",
        () => {
          playing =
            !playing;

          if (!playing) {
            clearInterval(
              timer
            );

            timer = null;

            return;
          }

          timer =
            setInterval(
              () => {
                if (
                  !frames.length
                ) {
                  return;
                }

                frameIndex =
                  frameIndex >=
                  frames.length - 1
                    ? 0
                    : frameIndex + 1;

                showFrame(
                  frameIndex
                );
              },
              700
            );
        }
      );
    }
  }

  window.CLOIdarkMeteo = {
    loadProduct
  };

  bindButtons();

  bindTimeline();

  /*
     Запуск по умолчанию:
     Осадки.
  */

  loadProduct(
    "rain"
  );
})();
