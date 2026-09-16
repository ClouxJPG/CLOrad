/* =========================================================
   CLOrad — iDarkMeteo
   ========================================================= */

(function () {
  "use strict";

  const API = "/api/idarkmeteo?path=";

  const map = window.map;

  if (!map) {
    console.error(
      "[CLOrad] Leaflet map was not found"
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
      button: "Спутниковые осадки",
      mosaic: "coarse",
      title: "Спутниковые осадки",
      units: "мм/ч"
    }
  };

  let currentProduct = null;
  let currentData = null;

  let overlay = null;
  let overlayUrl = null;

  let loading = false;
  let refreshTimer = null;

  function api(path) {
    return API + encodeURIComponent(path);
  }

  function msg(text) {
    if (typeof window.msg === "function") {
      window.msg(text);
    }
  }

  function getButton(product) {
    const p = PRODUCTS[product];

    if (!p) return null;

    return Array.from(
      document.querySelectorAll(".n")
    ).find(el =>
      el.textContent.trim() === p.button
    );
  }

  function setActive(product) {
    const target = getButton(product);

    document
      .querySelectorAll(".n")
      .forEach(el => {
        el.classList.remove("active");
      });

    if (target) {
      target.classList.add("active");
    }
  }

  function makeBounds(box) {
    if (
      !Array.isArray(box) ||
      box.length < 4
    ) {
      throw new Error(
        "Invalid EPSG:3857 box"
      );
    }

    const unproject = (x, y) =>
      L.Projection.SphericalMercator.unproject(
        L.point(x, y)
      );

    const southWest = unproject(
      box[0],
      box[1]
    );

    const northEast = unproject(
      box[2],
      box[3]
    );

    return L.latLngBounds(
      southWest,
      northEast
    );
  }

  async function getJSON(path) {
    const r = await fetch(api(path), {
      cache: "no-store"
    });

    if (!r.ok) {
      throw new Error(
        "HTTP " + r.status
      );
    }

    return await r.json();
  }

  function updateTimeline() {
    const range = document.getElementById("range");
    const times = document.getElementById("times");
    const label = document.getElementById("timeLabel");

    if (!range || !times || !currentData) {
      return;
    }

    const frames = currentData.frames || [];

    range.min = "0";
    range.max = String(
      Math.max(0, frames.length - 1)
    );

    if (
      range.value === "" ||
      Number(range.value) >= frames.length
    ) {
      range.value = "0";
    }

    times.innerHTML = "";

    frames.forEach((frame, i) => {
      const d = document.createElement("span");

      d.textContent = formatTime(
        frame.t
      );

      if (
        i === Number(range.value)
      ) {
        d.classList.add("active");
      }

      times.appendChild(d);
    });

    const index = Number(range.value) || 0;

    if (frames[index] && label) {
      label.textContent =
        formatFullTime(frames[index].t);
    }
  }

  function formatTime(t) {
    if (!t) return "--:--";

    const d = new Date(t);

    if (Number.isNaN(d.getTime())) {
      return "--:--";
    }

    return d.toLocaleTimeString(
      "ru-RU",
      {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    );
  }

  function formatFullTime(t) {
    if (!t) return "Радар";

    const d = new Date(t);

    if (Number.isNaN(d.getTime())) {
      return "Радар";
    }

    return d.toLocaleString(
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

  function removeOverlay() {
    if (overlay) {
      try {
        map.removeLayer(overlay);
      } catch (_) {}

      overlay = null;
    }

    if (overlayUrl) {
      try {
        URL.revokeObjectURL(
          overlayUrl
        );
      } catch (_) {}

      overlayUrl = null;
    }
  }

  async function showFrame(index) {
    if (
      !currentData ||
      !currentProduct ||
      !window.CLOIdarkRaster
    ) {
      return;
    }

    const frames =
      currentData.frames || [];

    if (!frames.length) {
      throw new Error(
        "No radar frames"
      );
    }

    index = Math.max(
      0,
      Math.min(
        frames.length - 1,
        Number(index) || 0
      )
    );

    const frame = frames[index];

    if (!frame || !frame.path) {
      throw new Error(
        "Frame path missing"
      );
    }

    loading = true;

    try {
      const url =
        await window.CLOIdarkRaster.frameToImageUrl(
          frame.path,
          currentProduct,
          currentData.width,
          currentData.height
        );

      if (
        currentData !==
        window.__CLOCurrentDarkData
      ) {
        URL.revokeObjectURL(url);
        return;
      }

      const bounds =
        currentData.bounds;

      const newOverlay =
        L.imageOverlay(
          url,
          bounds,
          {
            opacity: 1,
            interactive: false,
            zIndex: 35,
            crossOrigin: true
          }
        );

      removeOverlay();

      overlay = newOverlay;
      overlayUrl = url;

      overlay.addTo(map);

      rangeSet(index);

      updateTimeline();

      console.log(
        "[CLOrad] Frame displayed:",
        frame.t
      );
    } finally {
      loading = false;
    }
  }

  function rangeSet(index) {
    const range =
      document.getElementById("range");

    if (range) {
      range.value = String(index);
    }
  }

  async function loadProduct(
    product,
    options
  ) {
    if (!PRODUCTS[product]) {
      return;
    }

    options =
      options || {};

    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    currentProduct = product;

    setActive(product);

    msg(
      "Загрузка " +
      PRODUCTS[product].title +
      "…"
    );

    try {
      const p =
        PRODUCTS[product];

      const path =
        "frames/" +
        product +
        "/" +
        p.mosaic +
        ".json";

      const data =
        await getJSON(path);

      if (
        !data ||
        !Array.isArray(data.frames)
      ) {
        throw new Error(
          "Invalid frames response"
        );
      }

      if (
        !Array.isArray(data.box) ||
        data.box.length < 4
      ) {
        throw new Error(
          "Radar box missing"
        );
      }

      data.bounds =
        makeBounds(data.box);

      /*
        API отдаёт frames от newest к oldest
        в нормальном случае.

        На всякий случай сортируем по времени
        и показываем самый новый.
      */
      data.frames =
        data.frames
          .filter(f =>
            f &&
            f.path &&
            f.t
          )
          .sort(
            (a, b) =>
              new Date(b.t) -
              new Date(a.t)
          );

      if (!data.frames.length) {
        throw new Error(
          "No valid frames"
        );
      }

      currentData = data;

      window.__CLOCurrentDarkData =
        data;

      updateTimeline();

      const initialIndex =
        options.index != null
          ? options.index
          : 0;

      await showFrame(
        initialIndex
      );

      msg(
        PRODUCTS[product].title +
        " подключены"
      );

      scheduleRefresh();
    } catch (e) {
      console.error(
        "[CLOrad] iDarkMeteo error:",
        e
      );

      removeOverlay();

      const label =
        document.getElementById(
          "timeLabel"
        );

      if (label) {
        label.textContent =
          "Ошибка загрузки радара";
      }

      msg(
        "Ошибка загрузки радара"
      );
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    /*
      API обновляет радар каждые 10 минут.
      Проверяем немного чаще, чтобы новый кадр
      подхватывался автоматически.
    */
    refreshTimer =
      setTimeout(
        async () => {
          if (!currentProduct) {
            return;
          }

          const product =
            currentProduct;

          try {
            const p =
              PRODUCTS[product];

            const path =
              "frames/" +
              product +
              "/" +
              p.mosaic +
              ".json";

            const data =
              await getJSON(path);

            if (
              !data ||
              !Array.isArray(
                data.frames
              )
            ) {
              throw new Error(
                "Invalid refresh data"
              );
            }

            data.bounds =
              makeBounds(data.box);

            data.frames =
              data.frames
                .filter(f =>
                  f &&
                  f.path &&
                  f.t
                )
                .sort(
                  (a, b) =>
                    new Date(b.t) -
                    new Date(a.t)
                );

            const oldLatest =
              currentData &&
              currentData.frames &&
              currentData.frames[0] &&
              currentData.frames[0].t;

            const newLatest =
              data.frames[0] &&
              data.frames[0].t;

            currentData = data;

            window.__CLOCurrentDarkData =
              data;

            updateTimeline();

            if (
              newLatest &&
              newLatest !== oldLatest
            ) {
              await showFrame(0);
            }

          } catch (e) {
            console.warn(
              "[CLOrad] Refresh failed:",
              e
            );
          }

          scheduleRefresh();
        },
        90 * 1000
      );
  }

  /*
    Timeline
  */

  const range =
    document.getElementById("range");

  if (range) {
    range.addEventListener(
      "input",
      async () => {
        if (
          !currentData ||
          loading
        ) {
          return;
        }

        try {
          await showFrame(
            Number(range.value)
          );
        } catch (e) {
          console.error(e);
        }
      }
    );
  }

  /*
    Навигация
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

      if (!product) return;

      button.addEventListener(
        "click",
        e => {
          e.preventDefault();

          loadProduct(
            product
          );
        }
      );
    });

  /*
    Play
  */

  const play =
    document.getElementById("play");

  let playing = false;
  let playTimer = null;

  if (play) {
    play.addEventListener(
      "click",
      () => {
        if (
          !currentData ||
          !currentData.frames ||
          !currentData.frames.length
        ) {
          return;
        }

        playing = !playing;

        play.textContent =
          playing
            ? "❚❚"
            : "▶";

        if (playing) {
          playStep();
        } else {
          if (playTimer) {
            clearTimeout(
              playTimer
            );
          }
        }
      }
    );
  }

  async function playStep() {
    if (
      !playing ||
      !currentData
    ) {
      return;
    }

    const range =
      document.getElementById(
        "range"
      );

    if (!range) {
      return;
    }

    let index =
      Number(range.value) || 0;

    index++;

    if (
      index >=
      currentData.frames.length
    ) {
      index = 0;
    }

    try {
      await showFrame(index);
    } catch (e) {
      console.error(e);
    }

    if (playing) {
      playTimer =
        setTimeout(
          playStep,
          500
        );
    }
  }

  /*
    Экспортируем API для отладки
  */

  window.CLOIdarkMeteo = {
    loadProduct,
    showFrame,
    getData: () =>
      currentData
  };

  /*
    ВАЖНО:
    Ничего автоматически не грузим.
    Пользователь сам нажимает:
    "Осадки-мм/ч"
  */

})();
