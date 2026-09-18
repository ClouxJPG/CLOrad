/* =========================================================
   CLOrad — IDARKMETEO RASTER
   .rdr decoder + stable frame loading
   Интерфейс не изменяется.
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

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [250, 700];

  let activeProduct = null;
  let activeLayer = null;
  let activeObjectUrl = null;

  let frames = [];
  let bounds = null;
  let frameIndex = 0;

  let refreshTimer = null;

  let frameController = null;
  let requestToken = 0;

  let playing = false;
  let playTimer = null;
  let playBusy = false;

  let paletteCache = null;


  /* =========================================================
     BASIC
  ========================================================= */

  function api(path) {
    return API + encodeURIComponent(path);
  }


  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const timer = setTimeout(() => {
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }

        resolve();
      }, ms);

      function onAbort() {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }


  async function fetchWithTimeout(
    url,
    options = {},
    timeout = 30000
  ) {
    const controller = new AbortController();

    const externalSignal = options.signal;

    let externalAbort = null;

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalAbort = () => controller.abort();
        externalSignal.addEventListener(
          "abort",
          externalAbort,
          { once: true }
        );
      }
    }

    const timer = setTimeout(
      () => controller.abort(),
      timeout
    );

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);

      if (externalSignal && externalAbort) {
        externalSignal.removeEventListener(
          "abort",
          externalAbort
        );
      }
    }
  }


  /* =========================================================
     LEAFLET BOUNDS
  ========================================================= */

  function makeBounds(box) {
    if (!Array.isArray(box) || box.length !== 4) {
      throw new Error("Некорректный box");
    }

    const back = (x, y) =>
      L.Projection.SphericalMercator.unproject(
        L.point(x, y)
      );

    return L.latLngBounds(
      back(box[0], box[1]),
      back(box[2], box[3])
    );
  }


  /* =========================================================
     UI HELPERS
  ========================================================= */

  function getButton(product) {
    return [...document.querySelectorAll(".n")]
      .find(
        el =>
          el.textContent.trim() ===
          PRODUCTS[product]?.button
      );
  }


  function setButtonState(product) {
    document.querySelectorAll(".n").forEach(el => {
      el.classList.toggle(
        "active",
        el === getButton(product)
      );
    });
  }


  function setTimeLabel(text) {
    const el =
      document.getElementById("timeLabel");

    if (el) {
      el.textContent = text;
    }
  }


  function setTimeline() {
    const range =
      document.getElementById("range");

    const times =
      document.getElementById("times");

    if (range) {
      range.min = 0;

      range.max =
        Math.max(
          0,
          frames.length - 1
        );

      range.value =
        Math.max(
          0,
          Math.min(
            frameIndex,
            Math.max(0, frames.length - 1)
          )
        );
    }

    if (times) {
      times.textContent =
        frames.length
          ? `${frameIndex + 1} / ${frames.length}`
          : "";
    }
  }


  function formatTime(t) {
    if (!t) return "";

    const d = new Date(t);

    if (Number.isNaN(d.getTime())) {
      return t;
    }

    return d.toLocaleString(
      "ru-RU",
      {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }
    );
  }


  /* =========================================================
     PALETTE
  ========================================================= */

  async function loadPalette() {
    if (paletteCache) {
      return paletteCache;
    }

    try {
      const response =
        await fetch(
          "/palettes.json",
          {
            cache: "force-cache"
          }
        );

      if (!response.ok) {
        throw new Error(
          "palettes.json HTTP " +
          response.status
        );
      }

      paletteCache =
        await response.json();

      return paletteCache;

    } catch (error) {
      console.warn(
        "CLOrad palette:",
        error
      );

      paletteCache = null;

      return null;
    }
  }


  function getProductPalette(product) {
    if (!paletteCache) {
      return null;
    }

    return (
      paletteCache[product] ||
      null
    );
  }


  /* =========================================================
     RLE
  ========================================================= */

  function readVarints(buffer) {
    const result = [];

    let value = 0;
    let shift = 0;

    for (const byte of buffer) {

      value |=
        (byte & 127) << shift;

      if (byte & 128) {
        shift += 7;
      } else {
        result.push(value);
        value = 0;
        shift = 0;
      }
    }

    return result;
  }


  function expandValues(
    values,
    lengths,
    expected
  ) {
    const output =
      new Uint8Array(expected);

    let position = 0;

    for (
      let i = 0;
      i < values.length &&
      i < lengths.length;
      i++
    ) {

      const value =
        values[i];

      const length =
        lengths[i];

      if (
        !Number.isFinite(length) ||
        length <= 0
      ) {
        continue;
      }

      const end =
        Math.min(
          expected,
          position + length
        );

      output.fill(
        value,
        position,
        end
      );

      position = end;

      if (position >= expected) {
        break;
      }
    }

    if (position !== expected) {
      throw new Error(
        "RLE размер не совпадает: " +
        position +
        " / " +
        expected
      );
    }

    return output;
  }


  /* =========================================================
     DEFLATE
  ========================================================= */

  async function inflateDeflate(buffer) {

    if (
      typeof DecompressionStream ===
      "undefined"
    ) {
      throw new Error(
        "DecompressionStream не поддерживается"
      );
    }

    const stream =
      new Blob([buffer])
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
     RDR DECODER
  ========================================================= */

  async function decodeRDR(
    arrayBuffer,
    product
  ) {

    const bytes =
      new Uint8Array(arrayBuffer);

    if (bytes.length < 9) {
      throw new Error(
        "RDR слишком короткий"
      );
    }


    /* -------------------------------------------------------
       IDMR
    ------------------------------------------------------- */

    const signature =
      String.fromCharCode(
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3]
      );

    if (signature !== "IDMR") {
      throw new Error(
        "Неверная сигнатура RDR: " +
        signature
      );
    }


    /* -------------------------------------------------------
       VERSION
    ------------------------------------------------------- */

    const version =
      bytes[4];

    if (version !== 1) {
      console.warn(
        "Неизвестная версия RDR:",
        version
      );
    }


    /* -------------------------------------------------------
       HEADER LENGTH
    ------------------------------------------------------- */

    const view =
      new DataView(arrayBuffer);

    const headerLength =
      view.getUint32(
        5,
        true
      );

    const headerStart = 9;

    const headerEnd =
      headerStart +
      headerLength;

    if (
      headerEnd >
      bytes.length
    ) {
      throw new Error(
        "Повреждён заголовок RDR"
      );
    }


    /* -------------------------------------------------------
       HEADER JSON
    ------------------------------------------------------- */

    const headerBytes =
      bytes.slice(
        headerStart,
        headerEnd
      );

    const headerText =
      new TextDecoder(
        "utf-8"
      ).decode(
        headerBytes
      );

    let header;

    try {
      header =
        JSON.parse(
          headerText
        );
    } catch (error) {
      throw new Error(
        "RDR JSON header не читается"
      );
    }


    /* -------------------------------------------------------
       DIMENSIONS
    ------------------------------------------------------- */

    const width =
      Number(
        header.ширина ||
        header.width
      );

    const height =
      Number(
        header.высота ||
        header.height
      );

    if (
      !width ||
      !height
    ) {
      throw new Error(
        "В RDR нет размеров"
      );
    }


    /* -------------------------------------------------------
       BODY
    ------------------------------------------------------- */

    const body =
      bytes.slice(
        headerEnd
      );

    const streamLengths =
      header?.тело?.длины_потоков;

    if (
      !Array.isArray(
        streamLengths
      ) ||
      streamLengths.length < 2
    ) {
      throw new Error(
        "В RDR нет длин потоков"
      );
    }


    /* -------------------------------------------------------
       STREAMS
    ------------------------------------------------------- */

    let offset = 0;

    const streams = [];

    for (
      const length of streamLengths
    ) {

      const len =
        Number(length);

      if (
        !Number.isFinite(len) ||
        len < 0 ||
        offset + len >
        body.length
      ) {
        throw new Error(
          "Некорректные длины потоков RDR"
        );
      }

      streams.push(
        body.slice(
          offset,
          offset + len
        )
      );

      offset += len;
    }


    /* -------------------------------------------------------
       COMPRESSION
    ------------------------------------------------------- */

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
        "RDR использует " +
        compression +
        ", нужен deflate"
      );
    }


    /* -------------------------------------------------------
       VALUES
    ------------------------------------------------------- */

    const values =
      await inflateDeflate(
        streams[0]
      );


    /* -------------------------------------------------------
       RLE LENGTHS
    ------------------------------------------------------- */

    const lengthsBuffer =
      await inflateDeflate(
        streams[1]
      );

    const lengths =
      readVarints(
        lengthsBuffer
      );


    /* -------------------------------------------------------
       PIXELS
    ------------------------------------------------------- */

    const expected =
      width * height;

    const codes =
      expandValues(
        values,
        lengths,
        expected
      );


    /* -------------------------------------------------------
       PALETTE
    ------------------------------------------------------- */

    let palette =
      null;

    if (
      streams.length >= 3
    ) {
      try {
        palette =
          await inflateDeflate(
            streams[2]
          );
      } catch (error) {
        console.warn(
          "RDR palette stream:",
          error
        );
      }
    }


    return {
      header,
      width,
      height,
      codes,
      palette,
      product
    };
  }


  /* =========================================================
     PALETTE → CANVAS
  ========================================================= */

  function makeCanvas(decoded) {

    const {
      width,
      height,
      codes,
      palette,
      product
    } = decoded;

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      width;

    canvas.height =
      height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently: false
        }
      );

    if (!ctx) {
      throw new Error(
        "Canvas недоступен"
      );
    }

    const imageData =
      ctx.createImageData(
        width,
        height
      );

    const pixels =
      imageData.data;


    /* -------------------------------------------------------
       RDR содержит 256 RGBA цветов.
    ------------------------------------------------------- */

    if (
      palette &&
      palette.length >=
      256 * 4
    ) {

      for (
        let i = 0;
        i < codes.length;
        i++
      ) {

        const code =
          codes[i];

        const src =
          code * 4;

        const dst =
          i * 4;

        pixels[dst] =
          palette[src];

        pixels[dst + 1] =
          palette[src + 1];

        pixels[dst + 2] =
          palette[src + 2];

        pixels[dst + 3] =
          palette[src + 3];

        /*
         * Код 0:
         * прибор не смотрел.
         * Это не "нет осадков".
         */
        if (code === 0) {
          pixels[dst + 3] = 0;
        }
      }

    } else {

      /*
       * Запасной вариант.
       * Если бинарной палитры нет,
       * пытаемся использовать palettes.json.
       */

      const p =
        getProductPalette(
          product
        );

      for (
        let i = 0;
        i < codes.length;
        i++
      ) {

        const code =
          codes[i];

        const dst =
          i * 4;

        if (
          code === 0
        ) {
          pixels[dst + 3] = 0;
          continue;
        }

        let color =
          null;

        if (
          p &&
          Array.isArray(p.bands)
        ) {

          color =
            p.bands.find(
              band =>
                code >=
                  Number(
                    band.lo_i ??
                    0
                  ) &&
                code <=
                  Number(
                    band.hi_i ??
                    255
                  )
            );
        }

        if (
          color &&
          Array.isArray(
            color.rgb
          )
        ) {

          pixels[dst] =
            color.rgb[0];

          pixels[dst + 1] =
            color.rgb[1];

          pixels[dst + 2] =
            color.rgb[2];

          pixels[dst + 3] =
            Number(
              color.alpha ??
              255
            );

        } else {

          pixels[dst] = 255;
          pixels[dst + 1] = 255;
          pixels[dst + 2] = 255;
          pixels[dst + 3] = 0;
        }
      }
    }


    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }


  /* =========================================================
     CANVAS → BLOB URL
  ========================================================= */

  async function canvasToObjectUrl(
    canvas
  ) {

    const blob =
      await new Promise(
        (resolve, reject) => {

          canvas.toBlob(
            result => {

              if (!result) {
                reject(
                  new Error(
                    "Canvas toBlob failed"
                  )
                );

                return;
              }

              resolve(result);
            },
            "image/png"
          );
        }
      );

    return URL.createObjectURL(
      blob
    );
  }


  /* =========================================================
     FRAME DOWNLOAD
     ========================================================= */

  async function downloadAndDecodeFrame(
    path,
    product,
    signal
  ) {

    let lastError =
      null;

    for (
      let attempt = 0;
      attempt < MAX_RETRIES;
      attempt++
    ) {

      if (
        signal?.aborted
      ) {
        throw new DOMException(
          "Aborted",
          "AbortError"
        );
      }

      try {

        if (
          attempt > 0
        ) {

          await sleep(
            RETRY_DELAYS[
              Math.min(
                attempt - 1,
                RETRY_DELAYS.length - 1
              )
            ],
            signal
          );
        }


        const response =
          await fetchWithTimeout(
            api(path),
            {
              signal,
              cache: "force-cache"
            },
            40000
          );


        if (
          !response.ok
        ) {

          /*
           * 404 / 401 обычно бессмысленно
           * повторять три раза.
           */
          if (
            response.status === 401 ||
            response.status === 404
          ) {
            throw new Error(
              "HTTP " +
              response.status
            );
          }

          throw new Error(
            "HTTP " +
            response.status
          );
        }


        const buffer =
          await response.arrayBuffer();

        if (
          !buffer ||
          buffer.byteLength < 9
        ) {
          throw new Error(
            "Пустой или повреждённый RDR"
          );
        }


        /*
         * ВАЖНО:
         * декодируем прямо здесь.
         * Если декодирование упало —
         * повторяем загрузку целиком.
         */
        const decoded =
          await decodeRDR(
            buffer,
            product
          );

        return decoded;

      } catch (error) {

        if (
          error?.name ===
          "AbortError"
        ) {
          throw error;
        }

        lastError =
          error;

        console.warn(
          `CLOrad: кадр не загрузился, попытка ${
            attempt + 1
          }/${MAX_RETRIES}`,
          error
        );
      }
    }

    throw (
      lastError ||
      new Error(
        "Не удалось загрузить кадр"
      )
    );
  }


  /* =========================================================
     CLEAR CURRENT RASTER
  ========================================================= */

  function clearRaster() {

    if (
      activeLayer
    ) {

      try {
        map.removeLayer(
          activeLayer
        );
      } catch (e) {}

      activeLayer =
        null;
    }

    if (
      activeObjectUrl
    ) {

      try {
        URL.revokeObjectURL(
          activeObjectUrl
        );
      } catch (e) {}

      activeObjectUrl =
        null;
    }
  }


  /* =========================================================
     ABORT CURRENT REQUEST
  ========================================================= */

  function abortFrameRequest() {

    if (
      frameController
    ) {

      try {
        frameController.abort();
      } catch (e) {}

      frameController =
        null;
    }
  }


  /* =========================================================
     SHOW FRAME
  ========================================================= */

  async function showFrame(
    index
  ) {

    if (
      !frames[index] ||
      !bounds ||
      !activeProduct
    ) {
      return false;
    }


    /*
     * Новый запрос получает собственный token.
     * Старый после этого уже не имеет права
     * менять карту.
     */
    const token =
      ++requestToken;


    abortFrameRequest();


    const controller =
      new AbortController();

    frameController =
      controller;


    const frame =
      frames[index];

    const product =
      activeProduct;


    try {

      /*
       * НЕ удаляем старый слой здесь.
       * Он останется на карте, пока новый
       * полностью не загрузится.
       */

      const decoded =
        await downloadAndDecodeFrame(
          frame.path,
          product,
          controller.signal
        );


      /*
       * Проверяем, что запрос всё ещё актуален.
       */
      if (
        token !== requestToken ||
        controller.signal.aborted ||
        product !== activeProduct
      ) {
        return false;
      }


      const canvas =
        makeCanvas(
          decoded
        );


      const objectUrl =
        await canvasToObjectUrl(
          canvas
        );


      /*
       * После тяжёлого Canvas тоже
       * проверяем актуальность.
       */
      if (
        token !== requestToken ||
        controller.signal.aborted ||
        product !== activeProduct
      ) {

        try {
          URL.revokeObjectURL(
            objectUrl
          );
        } catch (e) {}

        return false;
      }


      /* -----------------------------------------------------
         ATOMIC SWAP
      ----------------------------------------------------- */

      const oldLayer =
        activeLayer;

      const oldUrl =
        activeObjectUrl;


      /*
       * Сначала добавляем НОВЫЙ кадр.
       */
      const newLayer =
        L.imageOverlay(
          objectUrl,
          bounds,
          {
            opacity: 1,
            interactive: false,
            zIndex: 35
          }
        );


      newLayer.addTo(
        map
      );


      /*
       * Теперь новый кадр гарантированно
       * находится на карте.
       */
      activeLayer =
        newLayer;

      activeObjectUrl =
        objectUrl;


      /*
       * И только теперь удаляем старый.
       */
      if (
        oldLayer
      ) {

        try {
          map.removeLayer(
            oldLayer
          );
        } catch (e) {}
      }


      if (
        oldUrl &&
        oldUrl !== objectUrl
      ) {

        try {
          URL.revokeObjectURL(
            oldUrl
          );
        } catch (e) {}
      }


      frameIndex =
        index;

      setTimeline();


      setTimeLabel(
        `${PRODUCTS[product].title} • ${formatTime(frame.t)}`
      );


      map.invalidateSize(
        false
      );

      map.fire(
        "moveend"
      );


      return true;

    } catch (error) {

      /*
       * Отмена старого запроса —
       * НЕ ошибка пользователя.
       */
      if (
        error?.name ===
        "AbortError"
      ) {
        return false;
      }


      /*
       * Если запрос уже устарел —
       * вообще ничего не показываем.
       */
      if (
        token !== requestToken
      ) {
        return false;
      }


      console.error(
        "CLOrad IDARKMETEO frame:",
        error
      );


      /*
       * Старый хороший кадр остаётся.
       * Никакого удаления activeLayer.
       */
      if (!playing) {
        setTimeLabel(
          "Кадр временно недоступен"
        );
      }

      return false;

    } finally {

      if (
        frameController ===
        controller
      ) {
        frameController =
          null;
      }
    }
  }


  /* =========================================================
     LOAD PRODUCT
  ========================================================= */

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

    stopPlayback();

    requestToken++;

    abortFrameRequest();


    const productToken =
      requestToken;


    try {

      const response =
        await fetchWithTimeout(
          api(
            `frames/${product}/${cfg.mosaic}.json`
          ),
          {
            cache: "no-store"
          },
          20000
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


      /*
       * Пока метаданные грузились,
       * пользователь мог выбрать другой слой.
       */
      if (
        productToken !==
        requestToken
      ) {
        return;
      }


      activeProduct =
        product;


      frames =
        Array.isArray(
          data.frames
        )
          ? data.frames.slice().reverse()
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

        const success =
          await showFrame(
            frameIndex
          );


        /*
         * Если первый кадр продукта
         * не загрузился, старый слой
         * всё равно остаётся.
         */
        if (
          !success &&
          !activeLayer
        ) {
          setTimeLabel(
            "Кадр недоступен"
          );
        }

      } else {

        setTimeLabel(
          "Данных нет"
        );
      }


      /*
       * Обновляем список кадров раз в 10 минут.
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

      if (
        error?.name ===
        "AbortError"
      ) {
        return;
      }

      console.error(
        "CLOrad IDARKMETEO:",
        error
      );

      setTimeLabel(
        "Данные радара недоступны"
      );
    }
  }


  /* =========================================================
     BUTTONS
  ========================================================= */

  function bindButtons() {

    for (
      const [
        product,
        cfg
      ]
      of Object.entries(
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


  /* =========================================================
     TIMELINE
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

          /*
           * Каждое движение ползунка
           * отменяет предыдущий запрос.
           */
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
     PLAYBACK
  ========================================================= */

  function startPlayback() {

    if (
      playing ||
      !frames.length
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
            !frames.length ||
            !activeProduct
          ) {
            stopPlayback();
            return;
          }


          /*
           * Не начинаем следующий кадр,
           * пока предыдущий ещё декодируется.
           */
          if (
            playBusy
          ) {
            return;
          }


          playBusy = true;


          try {

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

          } finally {

            playBusy = false;
          }

        },
        900
      );
  }


  function stopPlayback() {

    playing = false;

    playBusy = false;


    if (
      playTimer
    ) {

      clearInterval(
        playTimer
      );

      playTimer =
        null;
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


  /* =========================================================
     PUBLIC API
  ========================================================= */

  window.CLOIdarkMeteo = {
    loadProduct,
    showFrame,
    startPlayback,
    stopPlayback
  };


  /* =========================================================
     START
  ========================================================= */

  bindButtons();

  bindTimeline();

  loadProduct(
    "rain"
  );

})();
