/* =========================================================
   CLOrad — IDARKMETEO RASTER
   .rdr decoder + все продукты IDARKMETEO.

   Поддерживает:
   rain
   smoke
   satrain
   cloudphase

   Главная задача:
   - никогда не оставлять несколько raster-слоёв;
   - отменять старые запросы;
   - освобождать Blob URL;
   - не давать старым async-запросам вернуть слой на карту.

   Формат .rdr:
   IDMR + version + header + 3 compressed streams.
========================================================= */

(function () {
  "use strict";

  const API = "/api/idarkmeteo?path=";

  const PRODUCTS = {

    rain: {
      button: "Осадки-мм/ч",
      mosaic: "wide",
      title: "Осадки",
      units: "мм/ч"
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
    },

    cloudphase: {
      button: "Фаза облака",
      mosaic: "swath",
      title: "Фаза облака",
      units: ""
    }

  };


  /* =========================================================
     СОСТОЯНИЕ
  ========================================================= */

  let activeProduct = null;

  let frames = [];

  let bounds = null;

  let frameIndex = 0;

  let activeLayer = null;

  let activeObjectUrl = null;

  let frameController = null;

  let productController = null;

  let requestToken = 0;

  let refreshTimer = null;

  let playTimer = null;

  let playing = false;


  /* =========================================================
     API
  ========================================================= */

  function api(path) {

    return API + encodeURIComponent(path);

  }


  async function fetchWithTimeout(
    url,
    options = {},
    timeout = 20000
  ) {

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      timeout
    );

    try {

      return await fetch(
        url,
        {
          ...options,
          signal: controller.signal
        }
      );

    } finally {

      clearTimeout(timer);

    }

  }


  /* =========================================================
     КНОПКИ НАВИГАЦИИ
  ========================================================= */

  function getButton(product) {

    const name = PRODUCTS[product]?.button;

    if (!name) return null;

    return [...document.querySelectorAll(".n")]
      .find(
        el => el.textContent.trim() === name
      );

  }


  function setButtonState(product) {

    document.querySelectorAll(".n")
      .forEach(el => {

        const isActive =
          el === getButton(product);

        el.classList.toggle(
          "active",
          isActive
        );

      });

  }


  /* =========================================================
     TIMELINE
  ========================================================= */

  function setTimeline() {

    const range =
      document.getElementById("range");

    const times =
      document.getElementById("times");

    if (range) {

      range.min = "0";

      range.max =
        String(
          Math.max(
            0,
            frames.length - 1
          )
        );

      range.value =
        String(frameIndex);

    }

    if (times) {

      times.textContent =
        frames.length
          ? `${frameIndex + 1} / ${frames.length}`
          : "";

    }

  }


  function formatTime(time) {

    if (!time) return "";

    const date =
      new Date(time);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {

      return time;

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


  function setTimeLabel(text) {

    const el =
      document.getElementById(
        "timeLabel"
      );

    if (el) {

      el.textContent = text;

    }

  }


  /* =========================================================
     BOUNDS EPSG:3857 → LEAFLET
  ========================================================= */

  function makeBounds(box) {

    if (
      !Array.isArray(box) ||
      box.length !== 4
    ) {

      throw new Error(
        "Некорректный box IDARKMETEO"
      );

    }

    const back =
      (x, y) =>
        L.Projection
          .SphericalMercator
          .unproject(
            L.point(x, y)
          );

    return L.latLngBounds(
      back(box[0], box[1]),
      back(box[2], box[3])
    );

  }


  /* =========================================================
     DEFLATE
  ========================================================= */

  async function inflateDeflate(
    data
  ) {

    if (
      typeof DecompressionStream ===
      "undefined"
    ) {

      throw new Error(
        "Браузер не поддерживает DecompressionStream"
      );

    }

    const stream =
      new Blob([data])
        .stream()
        .pipeThrough(
          new DecompressionStream(
            "deflate"
          )
        );

    return new Uint8Array(
      await new Response(
        stream
      ).arrayBuffer()
    );

  }


  /* =========================================================
     RLE VARINT
  ========================================================= */

  function decodeRLE(
    bytes,
    pixelCount
  ) {

    const result =
      new Uint8Array(
        pixelCount
      );

    let position = 0;

    let value = 0;

    let shift = 0;

    for (
      let i = 0;
      i < bytes.length;
      i++
    ) {

      const byte =
        bytes[i];

      value |=
        (byte & 127) <<
        shift;

      if (
        byte & 128
      ) {

        shift += 7;

        continue;

      }

      const length =
        value;

      value = 0;

      shift = 0;

      if (
        position + length >
        pixelCount
      ) {

        throw new Error(
          "RLE выходит за размер изображения"
        );

      }

      result.fill(
        0,
        position,
        position + length
      );

      position += length;

    }

    if (
      position !== pixelCount
    ) {

      throw new Error(
        `RLE: ${position}/${pixelCount} пикселей`
      );

    }

    return result;

  }


  /* =========================================================
     ПРАВИЛЬНЫЙ RLE DECODER

     Значения идут отдельным потоком,
     длины серий — отдельным.

     Поэтому сначала получаем список значений,
     затем разворачиваем их в пиксели.
  ========================================================= */

  function expandValues(
    values,
    lengths,
    pixelCount
  ) {

    const output =
      new Uint8Array(
        pixelCount
      );

    let position = 0;

    const count =
      Math.min(
        values.length,
        lengths.length
      );

    for (
      let i = 0;
      i < count;
      i++
    ) {

      const length =
        lengths[i];

      if (
        position + length >
        pixelCount
      ) {

        throw new Error(
          "RLE превышает размер изображения"
        );

      }

      output.fill(
        values[i],
        position,
        position + length
      );

      position += length;

    }

    if (
      position !== pixelCount
    ) {

      throw new Error(
        `Неверный RLE: ${position}/${pixelCount}`
      );

    }

    return output;

  }


  /* =========================================================
     ПАЛИТРА

     palettes.json содержит диапазоны индексов.

     Для каждого кода выбираем соответствующий band.
  ========================================================= */

  let palettesPromise = null;


  async function loadPalettes() {

    if (!palettesPromise) {

      palettesPromise =
        fetchWithTimeout(
          api("palettes.json"),
          {
            cache: "force-cache"
          },
          15000
        )
        .then(
          response => {

            if (!response.ok) {

              throw new Error(
                "palettes.json HTTP " +
                response.status
              );

            }

            return response.json();

          }
        )
        .catch(
          error => {

            palettesPromise = null;

            throw error;

          }
        );

    }

    return palettesPromise;

  }


  function getPalette(
    all,
    product
  ) {

    return (
      all?.[product] ||
      all?.palettes?.[product] ||
      null
    );

  }


  function findBand(
    bands,
    index
  ) {

    for (
      const band of bands || []
    ) {

      const lo =
        Number(band.lo_i);

      const hi =
        Number(band.hi_i);

      if (
        Number.isFinite(lo) &&
        Number.isFinite(hi) &&
        index >= lo &&
        index <= hi
      ) {

        return band;

      }

    }

    return null;

  }


  /* =========================================================
     CANVAS

     ВАЖНО:
     code 0 = прибор не смотрел → полностью прозрачно.
  ========================================================= */

  function valuesToCanvas(
    values,
    width,
    height,
    palette
  ) {

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = width;

    canvas.height = height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          alpha: true
        }
      );

    if (!ctx) {

      throw new Error(
        "Canvas 2D недоступен"
      );

    }

    const imageData =
      ctx.createImageData(
        width,
        height
      );

    const output =
      imageData.data;

    const bands =
      palette?.bands || [];


    for (
      let i = 0, p = 0;
      i < values.length;
      i++, p += 4
    ) {

      const index =
        values[i];


      /* -----------------------------------------------------
         0 = неизвестно / прибор не смотрел
      ----------------------------------------------------- */

      if (
        index === 0
      ) {

        output[p + 3] = 0;

        continue;

      }


      const band =
        findBand(
          bands,
          index
        );


      if (
        !band ||
        !Array.isArray(
          band.rgb
        )
      ) {

        output[p + 3] = 0;

        continue;

      }


      output[p] =
        Number(
          band.rgb[0]
        ) || 0;

      output[p + 1] =
        Number(
          band.rgb[1]
        ) || 0;

      output[p + 2] =
        Number(
          band.rgb[2]
        ) || 0;

      output[p + 3] =
        Math.max(
          0,
          Math.min(
            255,
            Number(
              band.alpha ??
              255
            )
          )
        );

    }


    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;

  }


  /* =========================================================
     DECODE .RDR
  ========================================================= */

  async function decodeRDR(
    arrayBuffer,
    product
  ) {

    const bytes =
      new Uint8Array(
        arrayBuffer
      );


    /* -----------------------------------------------------
       SIGNATURE
    ----------------------------------------------------- */

    if (
      bytes.length < 9
    ) {

      throw new Error(
        "RDR слишком маленький"
      );

    }


    if (
      bytes[0] !== 73 ||
      bytes[1] !== 68 ||
      bytes[2] !== 77 ||
      bytes[3] !== 82
    ) {

      throw new Error(
        "Неверная сигнатура IDMR"
      );

    }


    /* -----------------------------------------------------
       VERSION
    ----------------------------------------------------- */

    if (
      bytes[4] !== 1
    ) {

      throw new Error(
        "Неподдерживаемая версия RDR: " +
        bytes[4]
      );

    }


    /* -----------------------------------------------------
       HEADER LENGTH
    ----------------------------------------------------- */

    const view =
      new DataView(
        arrayBuffer
      );

    const headerLength =
      view.getUint32(
        5,
        true
      );


    const headerStart =
      9;

    const headerEnd =
      headerStart +
      headerLength;


    if (
      headerEnd >
      bytes.length
    ) {

      throw new Error(
        "Повреждённая шапка RDR"
      );

    }


    /* -----------------------------------------------------
       HEADER JSON
    ----------------------------------------------------- */

    const decoder =
      new TextDecoder(
        "utf-8"
      );

    const headerText =
      decoder.decode(
        bytes.slice(
          headerStart,
          headerEnd
        )
      );

    const header =
      JSON.parse(
        headerText
      );


    const width =
      Number(
        header.ширина ??
        header.width
      );

    const height =
      Number(
        header.высота ??
        header.height
      );


    if (
      !width ||
      !height
    ) {

      throw new Error(
        "RDR не содержит размер изображения"
      );

    }


    const pixelCount =
      width * height;


    /* -----------------------------------------------------
       STREAMS
    ----------------------------------------------------- */

    const lengths =
      header?.тело
        ?.длины_потоков;


    if (
      !Array.isArray(lengths) ||
      lengths.length < 2
    ) {

      throw new Error(
        "В RDR нет длин потоков"
      );

    }


    const bodyStart =
      headerEnd;

    let offset =
      bodyStart;

    const streams = [];


    for (
      const length of lengths
    ) {

      const size =
        Number(length);

      if (
        !Number.isFinite(size) ||
        size < 0 ||
        offset + size >
        bytes.length
      ) {

        throw new Error(
          "Некорректные размеры потоков RDR"
        );

      }

      streams.push(
        bytes.slice(
          offset,
          offset + size
        )
      );

      offset += size;

    }


    /* -----------------------------------------------------
       COMPRESSION
    ----------------------------------------------------- */

    const compression =
      String(
        header?.тело?.жатьё ||
        "deflate"
      ).toLowerCase();


    if (
      compression !==
      "deflate"
    ) {

      throw new Error(
        "Этот RDR использует " +
        compression +
        ". Браузерный декодер CLOrad сейчас поддерживает deflate."
      );

    }


    /* -----------------------------------------------------
       STREAM 0 — VALUES
    ----------------------------------------------------- */

    const values =
      await inflateDeflate(
        streams[0]
      );


    /* -----------------------------------------------------
       STREAM 1 — RLE LENGTHS
    ----------------------------------------------------- */

    const rle =
      await inflateDeflate(
        streams[1]
      );


    const runLengths = [];


    let n = 0;

    let shift = 0;


    for (
      const byte of rle
    ) {

      n |=
        (byte & 127) <<
        shift;

      if (
        byte & 128
      ) {

        shift += 7;

      } else {

        runLengths.push(
          n
        );

        n = 0;

        shift = 0;

      }

    }


    const pixels =
      expandValues(
        values,
        runLengths,
        pixelCount
      );


    /* -----------------------------------------------------
       PALETTE
    ----------------------------------------------------- */

    const allPalettes =
      await loadPalettes();

    const palette =
      getPalette(
        allPalettes,
        product
      );


    if (!palette) {

      throw new Error(
        "Для продукта " +
        product +
        " нет палитры"
      );

    }


    /* -----------------------------------------------------
       CANVAS
    ----------------------------------------------------- */

    const canvas =
      valuesToCanvas(
        pixels,
        width,
        height,
        palette
      );


    return {
      canvas,
      header
    };

  }


  /* =========================================================
     BLOB URL
  ========================================================= */

  async function canvasToObjectUrl(
    canvas
  ) {

    const blob =
      await new Promise(
        resolve =>
          canvas.toBlob(
            resolve,
            "image/png"
          )
      );

    if (!blob) {

      throw new Error(
        "Не удалось создать PNG"
      );

    }

    return URL.createObjectURL(
      blob
    );

  }


  /* =========================================================
     ОЧИСТКА АКТИВНОГО СЛОЯ
  ========================================================= */

  function removeActiveLayer() {

    if (
      activeLayer
    ) {

      try {

        map.removeLayer(
          activeLayer
        );

      } catch (e) {}

      activeLayer = null;

    }


    if (
      activeObjectUrl
    ) {

      try {

        URL.revokeObjectURL(
          activeObjectUrl
        );

      } catch (e) {}

      activeObjectUrl = null;

    }

  }


  /* =========================================================
     ОТМЕНА ТЕКУЩЕГО КАДРА
  ========================================================= */

  function abortFrameRequest() {

    if (
      frameController
    ) {

      try {

        frameController.abort();

      } catch (e) {}

      frameController = null;

    }

  }


  /* =========================================================
     ПОЛНАЯ ОЧИСТКА IDARKMETEO
  ========================================================= */

  function clearRaster() {

    requestToken++;

    abortFrameRequest();

    removeActiveLayer();

  }


  /* =========================================================
     ЗАГРУЗКА КАДРА
  ========================================================= */

  async function showFrame(
    index
  ) {

    if (
      !frames[index] ||
      !bounds ||
      !activeProduct
    ) {

      return;

    }


    const token =
      ++requestToken;


    /* Старый fetch больше не нужен */

    abortFrameRequest();


    /* Старый overlay удаляем ДО новой загрузки */

    removeActiveLayer();


    const frame =
      frames[index];


    frameController =
      new AbortController();


    try {

      setTimeLabel(
        "Загрузка…"
      );


      const response =
        await fetch(
          api(frame.path),
          {
            cache: "force-cache",
            signal:
              frameController.signal
          }
        );


      if (
        !response.ok
      ) {

        throw new Error(
          "RDR HTTP " +
          response.status
        );

      }


      const buffer =
        await response.arrayBuffer();


      /* Если пользователь уже выбрал другой кадр —
         этот результат больше никому не нужен. */

      if (
        token !==
        requestToken
      ) {

        return;

      }


      const decoded =
        await decodeRDR(
          buffer,
          activeProduct
        );


      if (
        token !==
        requestToken
      ) {

        return;

      }


      const objectUrl =
        await canvasToObjectUrl(
          decoded.canvas
        );


      if (
        token !==
        requestToken
      ) {

        URL.revokeObjectURL(
          objectUrl
        );

        return;

      }


      /* ---------------------------------------------------
         Последняя защита:
         удаляем всё, что каким-либо образом осталось.
      --------------------------------------------------- */

      removeActiveLayer();


      activeObjectUrl =
        objectUrl;


      activeLayer =
        L.imageOverlay(
          objectUrl,
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

      if (
        error?.name ===
        "AbortError"
      ) {

        return;

      }


      if (
        token !==
        requestToken
      ) {

        return;

      }


      console.error(
        "CLOrad IDARKMETEO:",
        error
      );


      setTimeLabel(
        "Ошибка загрузки слоя"
      );


    } finally {

      if (
        token ===
        requestToken
      ) {

        frameController =
          null;

      }

    }

  }


  /* =========================================================
     ЗАГРУЗКА ПРОДУКТА
  ========================================================= */

  async function loadProduct(
    product
  ) {

    const config =
      PRODUCTS[product];

    if (!config) return;


    clearTimeout(
      refreshTimer
    );


    /* Новый продукт отменяет всё старое */

    requestToken++;

    abortFrameRequest();

    removeActiveLayer();

    stopPlayback();


    if (
      productController
    ) {

      try {

        productController.abort();

      } catch (e) {}

    }


    productController =
      new AbortController();


    const productToken =
      requestToken;


    activeProduct =
      product;


    frames = [];

    bounds = null;

    frameIndex = 0;


    setTimeline();

    setButtonState(
      product
    );

    setTimeLabel(
      "Загрузка…"
    );


    try {

      const response =
        await fetch(
          api(
            `frames/${product}/${config.mosaic}.json`
          ),
          {
            cache: "no-store",
            signal:
              productController.signal
          }
        );


      if (
        !response.ok
      ) {

        throw new Error(
          "frames HTTP " +
          response.status
        );

      }


      const data =
        await response.json();


      if (
        productToken !==
        requestToken
      ) {

        return;

      }


      if (
        !Array.isArray(
          data.frames
        )
      ) {

        throw new Error(
          "frames.json не содержит frames"
        );

      }


      /* API отдаёт свежие → старые.
         Timeline CLOrad работает старые → свежие. */

      frames =
        data.frames
          .slice()
          .reverse();


      bounds =
        makeBounds(
          data.box
        );


      frameIndex =
        Math.max(
          0,
          frames.length - 1
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


      /* Обновление метаданных */

      if (
        productToken ===
        requestToken
      ) {

        refreshTimer =
          setTimeout(
            () => {

              if (
                activeProduct ===
                product
              ) {

                loadProduct(
                  product
                );

              }

            },
            10 * 60 * 1000
          );

      }


    } catch (error) {

      if (
        error?.name ===
        "AbortError"
      ) {

        return;

      }


      if (
        productToken !==
        requestToken
      ) {

        return;

      }


      console.error(
        "CLOrad IDARKMETEO:",
        error
      );


      setTimeLabel(
        "Данные слоя недоступны"
      );

    }

  }


  /* =========================================================
     PLAYBACK
  ========================================================= */

  function stopPlayback() {

    playing = false;


    if (
      playTimer
    ) {

      clearInterval(
        playTimer
      );

      playTimer = null;

    }


    const play =
      document.getElementById(
        "play"
      );


    if (play) {

      play.textContent =
        "▶";

    }

  }


  function startPlayback() {

    stopPlayback();


    if (
      frames.length < 2
    ) {

      return;

    }


    playing = true;


    const play =
      document.getElementById(
        "play"
      );


    if (play) {

      play.textContent =
        "Ⅱ";

    }


    playTimer =
      setInterval(
        async () => {

          if (
            !frames.length
          ) {

            stopPlayback();

            return;

          }


          let next =
            frameIndex + 1;


          if (
            next >=
            frames.length
          ) {

            next = 0;

          }


          await showFrame(
            next
          );

        },
        900
      );

  }


  /* =========================================================
     TIMELINE EVENTS
  ========================================================= */

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

      play.addEventListener(
        "click",
        () => {

          if (
            playing
          ) {

            stopPlayback();

          } else {

            startPlayback();

          }

        }
      );

    }

  }


  /* =========================================================
     КНОПКИ ПРОДУКТОВ
  ========================================================= */

  function bindButtons() {

    for (
      const product of
      Object.keys(PRODUCTS)
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


  /* =========================================================
     PUBLIC API
  ========================================================= */

  window.CLOIdarkMeteo = {

    loadProduct,

    clear: clearRaster,

    showFrame,

    getState: () => ({
      product:
        activeProduct,
      frameIndex,
      frameCount:
        frames.length
    })

  };


  /* =========================================================
     START
  ========================================================= */

  function init() {

    if (
      typeof L ===
      "undefined"
    ) {

      console.error(
        "CLOrad: Leaflet не найден"
      );

      return;

    }


    if (
      !window.map
    ) {

      console.error(
        "CLOrad: window.map не найден"
      );

      return;

    }


    bindButtons();

    bindTimeline();


    /* Начальный слой */

    loadProduct(
      "rain"
    );

  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init
    );

  } else {

    init();

  }

})();
