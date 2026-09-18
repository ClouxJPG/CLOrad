/* =========================================================
   CLOrad — IDARKMETEO CONTROLLER

   Управляет:
   - продуктами
   - кадрами
   - таймлайном
   - Leaflet overlay
   - воспроизведением

   RDR декодирует idarkmeteo-raster.js
========================================================= */

(function () {

  "use strict";


  /* =========================================================
     CHECK
  ========================================================= */

  if (!window.map) {

    console.error(
      "CLOrad IDARKMETEO: window.map не найден"
    );

    return;

  }

  if (!window.CLOIdarkRaster) {

    console.error(
      "CLOrad IDARKMETEO: idarkmeteo-raster.js не подключён"
    );

    return;

  }


  const map =
    window.map;

  const API =
    "/api/idarkmeteo?path=";


  /* =========================================================
     PRODUCTS
  ========================================================= */

  const PRODUCTS = {

    rain: {
      text: "Осадки-мм/ч",
      path: "frames/rain/wide.json",
      title: "Осадки",
      units: "мм/ч"
    },

    smoke: {
      text: "Дым/пепел",
      path: "frames/smoke/swath.json",
      title: "Дым / пепел",
      units: ""
    },

    satrain: {
      text: "Спутниковые осадки",
      path: "frames/satrain/coarse.json",
      title: "Спутниковые осадки",
      units: "мм/ч"
    },

    cloudphase: {
      text: "Фаза облака",
      path: "frames/cloudphase/swath.json",
      title: "Фаза облака",
      units: ""
    }

  };


  /* =========================================================
     STATE
  ========================================================= */

  let activeProduct = null;
  let activeFrames = [];
  let activeMetadata = null;

  let activeLayer = null;
  let activeBlobUrl = null;

  let frameIndex = 0;
  let frameCount = 24;

  let generation = 0;

  let frameAbort = null;
  let productAbort = null;

  let refreshTimer = null;
  let playTimer = null;

  let playing = false;
  let loading = false;

  let renderSerial = 0;


  /* =========================================================
     ELEMENT
  ========================================================= */

  const $ =
    id =>
      document.getElementById(id);


  /* =========================================================
     API
  ========================================================= */

  function proxyUrl(path) {

    return (
      API +
      encodeURIComponent(path)
    );

  }


  /* =========================================================
     ABORT CHECK
  ========================================================= */

  function throwIfAborted(signal) {

    if (signal?.aborted) {

      throw new DOMException(
        "Aborted",
        "AbortError"
      );

    }

  }


  /* =========================================================
     TIME
  ========================================================= */

  function formatTime(value) {

    if (!value) {

      return "—";

    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {

      return String(value);

    }

    return date.toLocaleTimeString(
      "ru-RU",
      {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow"
      }
    );

  }


  /* =========================================================
     BOUNDS
  ========================================================= */

  function makeBounds(box) {

    if (
      !Array.isArray(box) ||
      box.length < 4
    ) {

      throw new Error(
        "Некорректный box"
      );

    }

    const unproject =
      (x, y) =>
        L.Projection
          .SphericalMercator
          .unproject(
            L.point(
              Number(x),
              Number(y)
            )
          );

    return L.latLngBounds(
      unproject(
        box[0],
        box[1]
      ),
      unproject(
        box[2],
        box[3]
      )
    );

  }


  /* =========================================================
     UI
  ========================================================= */

  function setLoading(value) {

    loading =
      value;

    $("loadingFrames")
      ?.classList
      .toggle(
        "show",
        value
      );

  }


  function setTime(text) {

    if ($("timeLabel")) {

      $("timeLabel").textContent =
        text;

    }

  }


  function setFramesInfo(text) {

    if ($("framesInfo")) {

      $("framesInfo").textContent =
        text;

    }

  }


  function setIntensity() {

    if (!$("intensityValue")) {

      return;

    }

    $("intensityValue").textContent =
      activeProduct === "rain"
        ? "мм/ч"
        : "—";

  }


  /* =========================================================
     BUTTONS
  ========================================================= */

  function findButton(product) {

    const config =
      PRODUCTS[product];

    if (!config) {

      return null;

    }

    return [
      ...document.querySelectorAll(".n")
    ].find(
      button =>
        button.textContent.trim() ===
        config.text
    ) || null;

  }


  function setActiveButton(product) {

    const target =
      findButton(product);

    document
      .querySelectorAll(".n")
      .forEach(
        button => {

          button.classList.toggle(
            "active",
            button === target
          );

        }
      );

  }


  /* =========================================================
     REMOVE ALL IDARK LAYERS
  ========================================================= */

  function removeAllIdarkLayers() {

    if (activeLayer) {

      try {

        map.removeLayer(
          activeLayer
        );

      } catch {}

      activeLayer =
        null;

    }


    map.eachLayer(
      layer => {

        if (
          layer &&
          layer.__cloradIdark === true
        ) {

          try {

            map.removeLayer(
              layer
            );

          } catch {}

        }

      }
    );


    if (activeBlobUrl) {

      try {

        URL.revokeObjectURL(
          activeBlobUrl
        );

      } catch {}

      activeBlobUrl =
        null;

    }

  }


  /* =========================================================
     CANCEL
  ========================================================= */

  function cancelFrame() {

    if (frameAbort) {

      try {

        frameAbort.abort();

      } catch {}

      frameAbort =
        null;

    }

  }


  function cancelProduct() {

    if (productAbort) {

      try {

        productAbort.abort();

      } catch {}

      productAbort =
        null;

    }

  }


  /* =========================================================
     FETCH JSON
  ========================================================= */

  async function fetchJSON(
    url,
    signal
  ) {

    return fetch(
      url,
      {
        cache: "no-store",
        signal
      }
    );

  }


  /* =========================================================
     SHOW FRAME
  ========================================================= */

  async function showFrame(
    frame,
    myGeneration,
    index
  ) {

    if (!frame?.path) {

      throw new Error(
        "У кадра отсутствует path"
      );

    }


    cancelFrame();


    const controller =
      new AbortController();

    frameAbort =
      controller;

    const signal =
      controller.signal;


    const serial =
      ++renderSerial;


    setLoading(true);


    let result = null;
    let imageUrl = null;


    try {

      throwIfAborted(
        signal
      );


      /*
         Теперь signal реально
         передаётся в RDR-декодер.
      */

      result =
        await window
          .CLOIdarkRaster
          .frameToImageUrl(
            frame.path,
            activeProduct,
            signal
          );


      throwIfAborted(
        signal
      );


      /*
         Проверяем поколение.
      */

      if (
        myGeneration !== generation ||
        serial !== renderSerial
      ) {

        if (result?.url) {

          try {

            URL.revokeObjectURL(
              result.url
            );

          } catch {}

        }

        return;

      }


      imageUrl =
        typeof result === "string"
          ? result
          : result?.url;


      const header =
        typeof result === "object"
          ? result?.header
          : null;


      if (!imageUrl) {

        throw new Error(
          "RDR не вернул изображение"
        );

      }


      const box =
        activeMetadata?.box ||
        header?.box;


      if (!box) {

        URL.revokeObjectURL(
          imageUrl
        );

        imageUrl = null;

        throw new Error(
          "В RDR отсутствует box"
        );

      }


      const bounds =
        makeBounds(box);


      throwIfAborted(
        signal
      );


      /*
         Создаём новый слой.
      */

      const newLayer =
        L.imageOverlay(
          imageUrl,
          bounds,
          {
            opacity: 1,
            interactive: false,
            crossOrigin: true,
            zIndex: 35
          }
        );


      newLayer.__cloradIdark =
        true;


      /*
         Последняя проверка
         перед добавлением.
      */

      if (
        myGeneration !== generation ||
        serial !== renderSerial ||
        signal.aborted
      ) {

        try {

          URL.revokeObjectURL(
            imageUrl
          );

        } catch {}

        imageUrl = null;

        return;

      }


      /*
         Новый кадр готов.
         Добавляем его.
      */

      newLayer.addTo(
        map
      );


      /*
         Если во время addTo
         пришёл новый запрос —
         сразу убираем этот слой.
      */

      if (
        myGeneration !== generation ||
        serial !== renderSerial ||
        signal.aborted
      ) {

        try {

          map.removeLayer(
            newLayer
          );

        } catch {}

        try {

          URL.revokeObjectURL(
            imageUrl
          );

        } catch {}

        imageUrl = null;

        return;

      }


      /*
         Старый слой.
      */

      const oldLayer =
        activeLayer;

      const oldUrl =
        activeBlobUrl;


      activeLayer =
        newLayer;

      activeBlobUrl =
        imageUrl;

      imageUrl = null;


      /*
         Старый слой убираем.
      */

      if (oldLayer) {

        try {

          map.removeLayer(
            oldLayer
          );

        } catch {}

      }


      if (oldUrl) {

        try {

          URL.revokeObjectURL(
            oldUrl
          );

        } catch {}

      }


      /*
         Финальная зачистка
         всех старых IDARK overlay.
      */

      map.eachLayer(
        layer => {

          if (
            layer !== activeLayer &&
            layer?.__cloradIdark === true
          ) {

            try {

              map.removeLayer(
                layer
              );

            } catch {}

          }

        }
      );


      frameIndex =
        index;


      if ($("range")) {

        $("range").value =
          index;

      }


      if ($("times")) {

        $("times").innerHTML =
          "<span>" +
          formatTime(
            activeFrames[0]?.t
          ) +
          "</span>" +
          "<span>" +
          formatTime(
            activeFrames[
              activeFrames.length - 1
            ]?.t
          ) +
          "</span>";

      }


      setTime(
        `${PRODUCTS[activeProduct].title} • ${formatTime(frame.t)}`
      );

      setIntensity();

      setLoading(false);


    } catch (error) {

      /*
         Если этот кадр был отменён —
         ничего не показываем.
      */

      if (
        error?.name === "AbortError"
      ) {

        return;

      }

      throw error;


    } finally {

      if (
        frameAbort === controller
      ) {

        frameAbort =
          null;

      }

      /*
         На случай, если URL
         был создан, но не стал activeBlobUrl.
      */

      if (imageUrl) {

        try {

          URL.revokeObjectURL(
            imageUrl
          );

        } catch {}

      }

    }

  }


  /* =========================================================
     LOAD FRAME
  ========================================================= */

  async function loadSelectedFrame(
    index
  ) {

    if (
      !activeProduct ||
      !activeFrames.length
    ) {

      return;

    }

    const frame =
      activeFrames[index];

    if (!frame) {

      return;

    }


    const myGeneration =
      generation;


    try {

      await showFrame(
        frame,
        myGeneration,
        index
      );

    } catch (error) {

      if (
        myGeneration !== generation
      ) {

        return;

      }

      if (
        error?.name === "AbortError"
      ) {

        return;

      }

      console.error(
        "CLOrad IDARKMETEO:",
        error
      );

      setLoading(false);

      setTime(
        "Ошибка загрузки слоя"
      );

      if (typeof msg === "function") {

        msg(
          error?.message ||
          "Ошибка загрузки слоя"
        );

      }

    }

  }


  /* =========================================================
     LOAD PRODUCT
  ========================================================= */

  async function loadProduct(
    productName,
    keepFrame = false
  ) {

    const config =
      PRODUCTS[productName];

    if (!config) {

      return;

    }


    const myGeneration =
      ++generation;


    stopPlayback();


    if (refreshTimer) {

      clearTimeout(
        refreshTimer
      );

      refreshTimer =
        null;

    }


    cancelFrame();
    cancelProduct();

    removeAllIdarkLayers();


    productAbort =
      new AbortController();

    const signal =
      productAbort.signal;


    activeProduct =
      productName;

    activeFrames =
      [];

    activeMetadata =
      null;

    frameIndex =
      0;


    setActiveButton(
      productName
    );

    setLoading(true);

    setTime(
      "Подключение к радару…"
    );

    setFramesInfo(
      "Подключение к радару…"
    );


    try {

      const response =
        await fetchJSON(
          proxyUrl(
            config.path
          ),
          signal
        );


      if (
        myGeneration !== generation
      ) {

        return;

      }


      if (!response.ok) {

        throw new Error(
          "frames: HTTP " +
          response.status
        );

      }


      const metadata =
        await response.json();


      if (
        myGeneration !== generation
      ) {

        return;

      }


      if (
        !metadata ||
        !Array.isArray(
          metadata.frames
        )
      ) {

        throw new Error(
          "Некорректный ответ frames"
        );

      }


      activeMetadata =
        metadata;


      const frames =
        metadata.frames
          .filter(
            frame =>
              frame &&
              frame.path
          )
          .slice(
            0,
            frameCount
          )
          .reverse();


      if (!frames.length) {

        throw new Error(
          "Кадры отсутствуют"
        );

      }


      activeFrames =
        frames;


      const range =
        $("range");

      if (range) {

        range.min =
          0;

        range.max =
          frames.length - 1;

      }


      let selectedIndex =
        frames.length - 1;


      if (
        keepFrame &&
        range
      ) {

        selectedIndex =
          Math.min(
            Number(
              range.value || 0
            ),
            frames.length - 1
          );

      }


      frameIndex =
        selectedIndex;


      if (range) {

        range.value =
          selectedIndex;

      }


      setFramesInfo(
        "Загружено кадров: " +
        frames.length
      );


      if ($("times")) {

        $("times").innerHTML =
          "<span>" +
          formatTime(
            frames[0]?.t
          ) +
          "</span>" +
          "<span>" +
          formatTime(
            frames[
              frames.length - 1
            ]?.t
          ) +
          "</span>";

      }


      await loadSelectedFrame(
        selectedIndex
      );


      if (
        myGeneration !== generation
      ) {

        return;

      }


      setLoading(false);


      refreshTimer =
        setTimeout(
          () => {

            if (
              myGeneration === generation &&
              activeProduct === productName
            ) {

              loadProduct(
                productName,
                true
              );

            }

          },
          10 * 60 * 1000
        );


    } catch (error) {

      if (
        myGeneration !== generation
      ) {

        return;

      }

      if (
        error?.name === "AbortError"
      ) {

        return;

      }


      console.error(
        "CLOrad IDARKMETEO:",
        error
      );

      setLoading(false);

      removeAllIdarkLayers();

      setTime(
        "Ошибка подключения"
      );

      setFramesInfo(
        error?.message ||
        "Ошибка загрузки кадра"
      );


      if ($("intensityValue")) {

        $("intensityValue").textContent =
          "Нет данных";

      }


      if (typeof msg === "function") {

        msg(
          error?.message ||
          "Ошибка подключения"
        );

      }

    }

  }


  /* =========================================================
     STOP RADAR
  ========================================================= */

  function stopRadar() {

    ++generation;
    ++renderSerial;


    stopPlayback();


    if (refreshTimer) {

      clearTimeout(
        refreshTimer
      );

      refreshTimer =
        null;

    }


    cancelFrame();
    cancelProduct();


    activeProduct =
      null;

    activeFrames =
      [];

    activeMetadata =
      null;

    frameIndex =
      0;


    removeAllIdarkLayers();


    if ($("range")) {

      $("range").max =
        0;

      $("range").value =
        0;

    }


    if ($("times")) {

      $("times").textContent =
        "";

    }


    setTime(
      "Радар не подключён"
    );

    setFramesInfo(
      "Радар пока не подключён"
    );

    setLoading(false);


    if ($("intensityValue")) {

      $("intensityValue").textContent =
        "Нет данных";

    }

  }


  /* =========================================================
     FRAME COUNT
  ========================================================= */

  function reloadWithFrameCount() {

    if (activeProduct) {

      loadProduct(
        activeProduct,
        true
      );

    }

  }


  $("frameMinus")?.addEventListener(
    "click",
    event => {

      event.stopPropagation();

      frameCount =
        Math.max(
          1,
          frameCount - 1
        );

      $("frameInput").value =
        frameCount;

      reloadWithFrameCount();

    }
  );


  $("framePlus")?.addEventListener(
    "click",
    event => {

      event.stopPropagation();

      frameCount++;

      $("frameInput").value =
        frameCount;

      reloadWithFrameCount();

    }
  );


  $("frameInput")?.addEventListener(
    "change",
    event => {

      let value =
        parseInt(
          event.target.value,
          10
        );

      if (
        !Number.isFinite(value) ||
        value < 1
      ) {

        value =
          1;

      }

      frameCount =
        value;

      event.target.value =
        value;

      reloadWithFrameCount();

    }
  );


  /* =========================================================
     PRODUCT BUTTONS
  ========================================================= */

  function bindProductButton(
    productName
  ) {

    const button =
      findButton(
        productName
      );

    if (!button) {

      console.warn(
        "CLOrad: кнопка не найдена:",
        productName
      );

      return;

    }


    if (
      button.dataset.idarkBound === "1"
    ) {

      return;

    }


    button.dataset.idarkBound =
      "1";


    button.addEventListener(
      "click",
      event => {

        event.preventDefault();
        event.stopPropagation();

        loadProduct(
          productName
        );

      }
    );

  }


  bindProductButton("rain");
  bindProductButton("smoke");
  bindProductButton("satrain");
  bindProductButton("cloudphase");


  /* =========================================================
     MAP
  ========================================================= */

  const mapButton =
    [
      ...document.querySelectorAll(".n")
    ].find(
      button =>
        button.textContent.trim() ===
        "Карта"
    );


  if (mapButton) {

    mapButton.addEventListener(
      "click",
      event => {

        event.preventDefault();
        event.stopPropagation();

        setActiveButton(
          "__none__"
        );

        stopRadar();

      }
    );

  }


  /* =========================================================
     WARNING
  ========================================================= */

  const warningButton =
    [
      ...document.querySelectorAll(".n")
    ].find(
      button =>
        button.textContent.trim() ===
        "Предупр."
    );


  if (warningButton) {

    warningButton.addEventListener(
      "click",
      event => {

        event.preventDefault();
        event.stopPropagation();

        setActiveButton(
          "__none__"
        );

        stopRadar();

        if (typeof msg === "function") {

          msg(
            "Предупреждения"
          );

        }

      }
    );

  }


  /* =========================================================
     TIMELINE
  ========================================================= */

  let sliderTimer = null;


  $("range")?.addEventListener(
    "input",
    () => {

      if (
        !activeProduct ||
        !activeFrames.length
      ) {

        return;

      }


      const index =
        Number(
          $("range").value
        );


      if (
        !Number.isInteger(index) ||
        !activeFrames[index]
      ) {

        return;

      }


      frameIndex =
        index;


      setTime(
        `${PRODUCTS[activeProduct].title} • ${formatTime(activeFrames[index].t)}`
      );


      stopPlayback();


      /*
         Не запускаем десятки RDR
         при быстром движении ползунка.
      */

      clearTimeout(
        sliderTimer
      );


      sliderTimer =
        setTimeout(
          () => {

            loadSelectedFrame(
              index
            );

          },
          100
        );

    }
  );


  /* =========================================================
     PLAY
  ========================================================= */

  function stopPlayback() {

    playing =
      false;


    if (playTimer) {

      clearTimeout(
        playTimer
      );

      playTimer =
        null;

    }


    if ($("play")) {

      $("play").innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>';

    }

  }


  async function playNext() {

    if (
      !playing ||
      !activeProduct ||
      !activeFrames.length
    ) {

      return;

    }


    let next =
      frameIndex + 1;


    if (
      next >=
      activeFrames.length
    ) {

      next = 0;

    }


    await loadSelectedFrame(
      next
    );


    if (
      !playing ||
      !activeProduct
    ) {

      return;

    }


    playTimer =
      setTimeout(
        playNext,
        700
      );

  }


  $("play")?.addEventListener(
    "click",
    () => {

      if (
        !activeFrames.length
      ) {

        if (typeof msg === "function") {

          msg(
            "Радар пока не подключён"
          );

        }

        return;

      }


      if (playing) {

        stopPlayback();

        return;

      }


      playing =
        true;


      $("play").innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';


      playNext();

    }
  );


  /* =========================================================
     PUBLIC API
  ========================================================= */

  window.CLOIdarkMeteo = {

    loadProduct,

    stopRadar,

    getState: () => ({

      activeProduct,

      frameCount,

      frameIndex,

      frames:
        activeFrames.length,

      loading,

      playing

    })

  };


  /* =========================================================
     INITIAL
  ========================================================= */

  $("range").max =
    0;

  $("range").value =
    0;

  setTime(
    "Радар не подключён"
  );

  setFramesInfo(
    "Радар пока не подключён"
  );

  setLoading(false);


  loadProduct(
    "rain"
  );

})();
