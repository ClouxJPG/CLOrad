/* =========================================================
   CLOrad — IDARKMETEO
   Загрузка кадров и отображение на Leaflet.
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

  /*
     Размер raster.
     Берём из frames JSON.
  */

  let rasterWidth = 0;
  let rasterHeight = 0;

  /* -------------------------------------------------------
     API
  ------------------------------------------------------- */

  function api(path) {
    return (
      API +
      encodeURIComponent(path)
    );
  }

  /* -------------------------------------------------------
     EPSG:3857 → Leaflet bounds
  ------------------------------------------------------- */

  function makeBounds(box) {
    if (
      !Array.isArray(box) ||
      box.length !== 4
    ) {
      throw new Error(
        "Некорректный box"
      );
    }

    const back =
      (x, y) =>
        L.Projection
          .SphericalMercator
          .unproject(
            L.point(
              x,
              y
            )
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

  /* -------------------------------------------------------
     Поиск кнопки продукта
  ------------------------------------------------------- */

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
      .forEach(
        element => {
          element.classList.toggle(
            "active",
            element ===
              getButton(product)
          );
        }
      );
  }

  /* -------------------------------------------------------
     Таймлайн
  ------------------------------------------------------- */

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

  function formatTime(value) {
    if (!value) {
      return "";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return value;
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

  /* -------------------------------------------------------
     Отображение кадра
  ------------------------------------------------------- */

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

      /*
         Передаём размер raster
         в декодер .rdr.
      */

      const imageUrl =
        await window
          .CLOIdarkRaster
          .frameToImageUrl(
            frame.path,
            activeProduct,
            rasterWidth,
            rasterHeight
          );

      /*
         Удаляем старый кадр.
      */

      if (activeLayer) {
        map.removeLayer(
          activeLayer
        );

        activeLayer =
          null;
      }

      /*
         Новый кадр.
      */

      activeLayer =
        L.imageOverlay(
          imageUrl,
          bounds,
          {
            opacity: 1,
            interactive: false,
            zIndex: 35
          }
        );

      activeLayer.addTo(
        map
      );

      frameIndex =
        index;

      setTimeline();

      setTimeLabel(
        `${PRODUCTS[activeProduct].title} • ${formatTime(frame.t)}`
      );

    } catch (error) {
      console.error(
        "CLOrad IDARKMETEO frame error:",
        error
      );

      setTimeLabel(
        "Ошибка загрузки радара"
      );

    } finally {
      loading = false;
    }
  }

  /* -------------------------------------------------------
     Загрузка продукта
  ------------------------------------------------------- */

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
          "frames JSON HTTP " +
          response.status
        );
      }

      const data =
        await response.json();

      /*
         Сохраняем размеры
         именно этого raster.
      */

      rasterWidth =
        Number(
          data.width
        ) || 0;

      rasterHeight =
        Number(
          data.height
        ) || 0;

      if (
        !rasterWidth ||
        !rasterHeight
      ) {
        throw new Error(
          "В frames JSON отсутствуют width/height"
        );
      }

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

      if (
        frames.length
      ) {
        await showFrame(
          frameIndex
        );
      } else {
        setTimeLabel(
          "Данных нет"
        );
      }

      /*
         Обновление списка
         каждые 10 минут.
      */

      refreshTimer =
        setTimeout(
          () => {
            loadProduct(
              product
            );
          },
          10 * 60 * 1000
        );

    } catch (error) {
      console.error(
        "CLOrad IDARKMETEO error:",
        error
      );

      setTimeLabel(
        "Данные радара недоступны"
      );
    }
  }

  /* -------------------------------------------------------
     Кнопки продуктов
  ------------------------------------------------------- */

  function bindButtons() {
    Object.entries(
      PRODUCTS
    ).forEach(
      ([product, cfg]) => {
        const button =
          getButton(
            product
          );

        if (!button) {
          return;
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
    );
  }

  /* -------------------------------------------------------
     Таймлайн
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     Публичный API
  ------------------------------------------------------- */

  window.CLOIdarkMeteo = {
    loadProduct,
    showFrame
  };

  /* -------------------------------------------------------
     Запуск
  ------------------------------------------------------- */

  bindButtons();

  bindTimeline();

  loadProduct(
    "rain"
  );
})();
