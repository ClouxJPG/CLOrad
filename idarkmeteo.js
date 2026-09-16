/* =========================================================
   CLOrad — iDarkMeteo
   DIRECT PNG MODE
   ========================================================= */

(function () {
  "use strict";

  const API = "/api/idarkmeteo?path=";
  const map = window.map;

  if (!map) {
    console.error("[CLOrad] Map not found");
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
      button: "Спутниковые осадки",
      mosaic: "coarse",
      title: "Спутниковые осадки",
      units: "мм/ч"
    }
  };

  let currentProduct = null;
  let currentData = null;
  let overlay = null;

  let refreshTimer = null;
  let loading = false;

  function api(path) {
    return API + encodeURIComponent(path);
  }

  function msg(text) {
    if (typeof window.msg === "function") {
      window.msg(text);
    }
  }

  function findButton(product) {
    const text = PRODUCTS[product].button;

    return Array.from(
      document.querySelectorAll(".n")
    ).find(
      el => el.textContent.trim() === text
    );
  }

  function activateButton(product) {
    document
      .querySelectorAll(".n")
      .forEach(el =>
        el.classList.remove("active")
      );

    const button = findButton(product);

    if (button) {
      button.classList.add("active");
    }
  }

  function makeBounds(box) {
    const unproject = (x, y) =>
      L.Projection.SphericalMercator.unproject(
        L.point(x, y)
      );

    return L.latLngBounds(
      unproject(box[0], box[1]),
      unproject(box[2], box[3])
    );
  }

  async function getJSON(path) {
    const response = await fetch(
      api(path),
      {
        method: "GET",
        cache: "default"
      }
    );

    if (!response.ok) {
      throw new Error(
        "HTTP " + response.status
      );
    }

    return await response.json();
  }

  function removeOverlay() {
    if (overlay) {
      map.removeLayer(overlay);
      overlay = null;
    }
  }

  function updateTimeLabel(time) {
    const label =
      document.getElementById(
        "timeLabel"
      );

    if (!label) return;

    if (!time) {
      label.textContent =
        "Радар подключён";
      return;
    }

    const date = new Date(time);

    if (Number.isNaN(date.getTime())) {
      label.textContent =
        "Радар подключён";
      return;
    }

    label.textContent =
      date.toLocaleString(
        "ru-RU",
        {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }
      );
  }

  function updateTimeline(data) {
    const range =
      document.getElementById(
        "range"
      );

    const times =
      document.getElementById(
        "times"
      );

    if (!range || !times) {
      return;
    }

    const frames =
      Array.isArray(data.frames)
        ? data.frames
        : [];

    range.min = "0";
    range.max = String(
      Math.max(0, frames.length - 1)
    );
    range.value = "0";

    times.innerHTML = "";

    frames.forEach(
      (frame, index) => {
        const item =
          document.createElement(
            "span"
          );

        const date =
          new Date(frame.t);

        item.textContent =
          Number.isNaN(date.getTime())
            ? "--:--"
            : date.toLocaleTimeString(
                "ru-RU",
                {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false
                }
              );

        if (index === 0) {
          item.classList.add(
            "active"
          );
        }

        times.appendChild(item);
      }
    );
  }

  /*
    ========================================================
    ГЛАВНОЕ:
    Показываем ГОТОВЫЙ PNG.

    Никаких .rdr.
    Никаких TIFF.
    Никаких GeoTIFF.js.
    Никаких palettes.json.

    latest/...png уже является готовым изображением.
    ========================================================
  */

  async function showProduct(product) {
    if (!PRODUCTS[product]) {
      return;
    }

    if (loading) {
      return;
    }

    loading = true;

    currentProduct = product;

    activateButton(product);

    msg(
      "Загрузка " +
      PRODUCTS[product].title +
      "…"
    );

    try {
      const p =
        PRODUCTS[product];

      /*
        Получаем только metadata.
      */

      const metadata =
        await getJSON(
          "frames/" +
          product +
          "/" +
          p.mosaic +
          ".json"
        );

      if (
        !metadata ||
        !Array.isArray(metadata.box)
      ) {
        throw new Error(
          "Invalid radar metadata"
        );
      }

      currentData =
        metadata;

      const bounds =
        makeBounds(
          metadata.box
        );

      /*
        Для rain используем latest PNG.
        Это готовый цветной кадр.
      */

      const pngPath =
        "latest/" +
        product +
        "/" +
        p.mosaic +
        ".png";

      const imageUrl =
        api(pngPath);

      /*
        Создаём новый overlay.
      */

      const newOverlay =
        L.imageOverlay(
          imageUrl,
          bounds,
          {
            opacity: 1,
            interactive: false,
            zIndex: 35
          }
        );

      /*
        Ждём фактической загрузки изображения.
        Так ошибка картинки не будет маскироваться.
      */

      await new Promise(
        (resolve, reject) => {
          const img =
            new Image();

          img.onload = () => {
            resolve();
          };

          img.onerror = () => {
            reject(
              new Error(
                "PNG failed to load"
              )
            );
          };

          img.src = imageUrl;
        }
      );

      /*
        Только после успешной загрузки
        заменяем старый слой.
      */

      removeOverlay();

      overlay =
        newOverlay;

      overlay.addTo(map);

      /*
        Показываем metadata времени,
        если сервер его передал.
      */

      updateTimeLabel(
        metadata.latest ||
        metadata.generated
      );

      updateTimeline(
        metadata
      );

      msg(
        PRODUCTS[product].title +
        " подключены"
      );

      console.log(
        "[CLOrad] PNG displayed:",
        imageUrl
      );

      /*
        Обновление примерно раз в 10 минут.
        Не 90 секунд — чтобы не ловить 429.
      */

      scheduleRefresh();

    } catch (error) {
      console.error(
        "[CLOrad] iDarkMeteo:",
        error
      );

      msg(
        "Ошибка загрузки радара"
      );

      const label =
        document.getElementById(
          "timeLabel"
        );

      if (label) {
        label.textContent =
          "Ошибка загрузки радара";
      }

    } finally {
      loading = false;
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      clearTimeout(
        refreshTimer
      );
    }

    refreshTimer =
      setTimeout(
        async () => {

          if (!currentProduct) {
            return;
          }

          /*
            При обновлении НЕ перезагружаем
            старые кадры и НЕ трогаем .rdr.

            Просто снова показываем latest PNG.
          */

          const product =
            currentProduct;

          try {
            const p =
              PRODUCTS[product];

            const metadata =
              await getJSON(
                "frames/" +
                product +
                "/" +
                p.mosaic +
                ".json"
              );

            if (
              !metadata ||
              !Array.isArray(
                metadata.box
              )
            ) {
              throw new Error(
                "Invalid refresh metadata"
              );
            }

            currentData =
              metadata;

            const bounds =
              makeBounds(
                metadata.box
              );

            const pngPath =
              "latest/" +
              product +
              "/" +
              p.mosaic +
              ".png";

            const imageUrl =
              api(pngPath);

            const test =
              new Image();

            await new Promise(
              (resolve, reject) => {
                test.onload =
                  resolve;

                test.onerror =
                  reject;

                test.src =
                  imageUrl;
              }
            );

            const newOverlay =
              L.imageOverlay(
                imageUrl,
                bounds,
                {
                  opacity: 1,
                  interactive: false,
                  zIndex: 35
                }
              );

            removeOverlay();

            overlay =
              newOverlay;

            overlay.addTo(map);

            updateTimeLabel(
              metadata.latest ||
              metadata.generated
            );

            updateTimeline(
              metadata
            );

            console.log(
              "[CLOrad] Radar refreshed"
            );

          } catch (e) {
            console.warn(
              "[CLOrad] Refresh failed:",
              e
            );
          }

          scheduleRefresh();

        },
        10 * 60 * 1000
      );
  }

  /*
    ========================================================
    Кнопки продуктов
    ========================================================
  */

  document
    .querySelectorAll(".n")
    .forEach(button => {

      const text =
        button.textContent.trim();

      const product =
        Object.keys(PRODUCTS)
          .find(
            key =>
              PRODUCTS[key].button ===
              text
          );

      if (!product) {
        return;
      }

      button.addEventListener(
        "click",
        event => {
          event.preventDefault();

          showProduct(
            product
          );
        }
      );
    });

  /*
    ========================================================
    Timeline
    ========================================================
  */

  const range =
    document.getElementById(
      "range"
    );

  if (range) {
    range.addEventListener(
      "input",
      () => {
        /*
          latest PNG — это текущий готовый кадр.
          Старые .rdr специально не трогаем,
          чтобы не получить 429.
        */
      }
    );
  }

  /*
    ========================================================
    Экспорт
    ========================================================
  */

  window.CLOIdarkMeteo = {
    loadProduct:
      showProduct,

    getData:
      () => currentData
  };

  /*
    Осадки НЕ загружаются автоматически.
    Только после нажатия кнопки.
  */

})();
