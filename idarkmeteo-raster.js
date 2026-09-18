/* =========================================================
   CLOrad — IDARKMETEO RASTER DECODER

   ТОЛЬКО:
   .rdr → декодирование → Canvas → ObjectURL

   НЕ управляет:
   - кнопками
   - продуктами
   - таймлайном
   - Leaflet
========================================================= */

(function () {

  "use strict";

  const API =
    "/api/idarkmeteo?path=";

  let palettePromise =
    null;


  /* =========================================================
     API
  ========================================================= */

  function api(path) {

    return (
      API +
      encodeURIComponent(path)
    );

  }


  /* =========================================================
     ABORT
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
     PALETTE
  ========================================================= */

  async function loadPalette(
    product,
    signal
  ) {

    throwIfAborted(
      signal
    );


    if (!palettePromise) {

      palettePromise =
        fetch(
          api("palettes.json"),
          {
            cache: "force-cache"
          }
        )
        .then(response => {

          if (!response.ok) {

            throw new Error(
              "palettes.json: HTTP " +
              response.status
            );

          }

          return response.json();

        });

    }


    const all =
      await palettePromise;


    throwIfAborted(
      signal
    );


    return (
      all?.[product] ||
      all?.palettes?.[product] ||
      null
    );

  }


  /* =========================================================
     FIND PALETTE BAND
  ========================================================= */

  function findBand(
    bands,
    index
  ) {

    for (
      const band of bands || []
    ) {

      const lo =
        Number(
          band.lo_i
        );

      const hi =
        Number(
          band.hi_i
        );

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
     DEFLATE
  ========================================================= */

  async function inflateDeflate(
    buffer,
    signal
  ) {

    throwIfAborted(
      signal
    );


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


    const response =
      new Response(
        stream
      );


    const result =
      await response.arrayBuffer();


    throwIfAborted(
      signal
    );


    return new Uint8Array(
      result
    );

  }


  /* =========================================================
     VARINT RLE
  ========================================================= */

  function readVarints(
    buffer,
    signal
  ) {

    const result = [];

    let value = 0;
    let multiplier = 1;

    for (
      let i = 0;
      i < buffer.length;
      i++
    ) {

      if (
        i % 65536 === 0
      ) {

        throwIfAborted(
          signal
        );

      }


      const byte =
        buffer[i];


      value +=
        (byte & 127) *
        multiplier;


      if (
        byte & 128
      ) {

        multiplier *= 128;

      } else {

        result.push(
          value
        );

        value = 0;
        multiplier = 1;

      }

    }


    if (
      multiplier !== 1
    ) {

      throw new Error(
        "RLE: оборванный varint"
      );

    }


    return result;

  }


  /* =========================================================
     EXPAND RLE
  ========================================================= */

  function expandRLE(
    values,
    lengths,
    expected,
    signal
  ) {

    const output =
      new Uint8Array(
        expected
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

      if (
        i % 65536 === 0
      ) {

        throwIfAborted(
          signal
        );

      }


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


      position =
        end;


      if (
        position >= expected
      ) {

        break;

      }

    }


    throwIfAborted(
      signal
    );


    if (
      position !== expected
    ) {

      throw new Error(
        "RLE: получено " +
        position +
        " пикселей из " +
        expected
      );

    }


    return output;

  }


  /* =========================================================
     RDR DECODER
  ========================================================= */

  async function decodeRDR(
    arrayBuffer,
    signal
  ) {

    throwIfAborted(
      signal
    );


    const bytes =
      new Uint8Array(
        arrayBuffer
      );


    if (
      bytes.length < 9
    ) {

      throw new Error(
        "RDR слишком короткий"
      );

    }


    const signature =
      String.fromCharCode(
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3]
      );


    if (
      signature !== "IDMR"
    ) {

      throw new Error(
        "Неверная сигнатура: " +
        signature
      );

    }


    const version =
      bytes[4];


    if (
      version !== 1
    ) {

      console.warn(
        "CLOrad: неизвестная версия RDR:",
        version
      );

    }


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
        "Повреждённый RDR header"
      );

    }


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

    } catch {

      throw new Error(
        "RDR header не является JSON"
      );

    }


    throwIfAborted(
      signal
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
        "В RDR отсутствуют размеры"
      );

    }


    const streamLengths =
      header?.тело?.длины_потоков;


    if (
      !Array.isArray(
        streamLengths
      ) ||
      streamLengths.length < 2
    ) {

      throw new Error(
        "В RDR отсутствуют потоки"
      );

    }


    const body =
      bytes.slice(
        headerEnd
      );


    const streams = [];

    let offset = 0;


    for (
      const rawLength
      of streamLengths
    ) {

      throwIfAborted(
        signal
      );


      const length =
        Number(
          rawLength
        );


      if (
        !Number.isFinite(length) ||
        length < 0 ||
        offset + length >
        body.length
      ) {

        throw new Error(
          "Некорректная длина RDR-потока"
        );

      }


      streams.push(
        body.slice(
          offset,
          offset + length
        )
      );


      offset += length;

    }


    const compression =
      String(
        header?.тело?.жатьё ??
        "deflate"
      ).toLowerCase();


    if (
      compression !== "deflate"
    ) {

      throw new Error(
        "Неподдерживаемое сжатие RDR: " +
        compression
      );

    }


    const values =
      await inflateDeflate(
        streams[0],
        signal
      );


    const lengthsCompressed =
      await inflateDeflate(
        streams[1],
        signal
      );


    const lengths =
      readVarints(
        lengthsCompressed,
        signal
      );


    const expected =
      width * height;


    const pixels =
      expandRLE(
        values,
        lengths,
        expected,
        signal
      );


    return {

      header,

      width,

      height,

      pixels

    };

  }


  /* =========================================================
     PIXELS → CANVAS
  ========================================================= */

  function makeCanvas(
    pixels,
    width,
    height,
    palette,
    signal
  ) {

    throwIfAborted(
      signal
    );


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
        "2d"
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


    const out =
      imageData.data;


    const bands =
      palette?.bands ||
      [];


    for (
      let i = 0, p = 0;
      i < pixels.length;
      i++, p += 4
    ) {

      if (
        i % 65536 === 0
      ) {

        throwIfAborted(
          signal
        );

      }


      const index =
        pixels[i];


      if (
        index === 0
      ) {

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

        continue;

      }


      out[p] =
        Number(
          band.rgb[0]
        ) || 0;

      out[p + 1] =
        Number(
          band.rgb[1]
        ) || 0;

      out[p + 2] =
        Number(
          band.rgb[2]
        ) || 0;

      out[p + 3] =
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


    throwIfAborted(
      signal
    );


    ctx.putImageData(
      imageData,
      0,
      0
    );


    return canvas;

  }


  /* =========================================================
     CANVAS → OBJECT URL
  ========================================================= */

  async function canvasToUrl(
    canvas,
    signal
  ) {

    throwIfAborted(
      signal
    );


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

              resolve(
                result
              );

            },
            "image/png"
          );

        }
      );


    throwIfAborted(
      signal
    );


    return URL.createObjectURL(
      blob
    );

  }


  /* =========================================================
     MAIN
  ========================================================= */

  async function frameToImageUrl(
    path,
    product,
    signal
  ) {

    if (!path) {

      throw new Error(
        "Путь к RDR не указан"
      );

    }


    throwIfAborted(
      signal
    );


    /* -------------------------------------------------------
       FETCH RDR

       ВАЖНО:
       Теперь AbortSignal реально
       передаётся fetch().
    ------------------------------------------------------- */

    const response =
      await fetch(
        api(path),
        {
          cache: "force-cache",
          signal
        }
      );


    throwIfAborted(
      signal
    );


    if (!response.ok) {

      throw new Error(
        "Raster HTTP " +
        response.status
      );

    }


    const buffer =
      await response.arrayBuffer();


    throwIfAborted(
      signal
    );


    if (
      !buffer ||
      buffer.byteLength < 9
    ) {

      throw new Error(
        "Получен пустой RDR"
      );

    }


    /* -------------------------------------------------------
       DECODE
    ------------------------------------------------------- */

    const decoded =
      await decodeRDR(
        buffer,
        signal
      );


    throwIfAborted(
      signal
    );


    /* -------------------------------------------------------
       PALETTE
    ------------------------------------------------------- */

    const palette =
      await loadPalette(
        product,
        signal
      );


    throwIfAborted(
      signal
    );


    /* -------------------------------------------------------
       CANVAS
    ------------------------------------------------------- */

    const canvas =
      makeCanvas(
        decoded.pixels,
        decoded.width,
        decoded.height,
        palette,
        signal
      );


    throwIfAborted(
      signal
    );


    /* -------------------------------------------------------
       OBJECT URL
    ------------------------------------------------------- */

    const url =
      await canvasToUrl(
        canvas,
        signal
      );


    /*
       Если отменили прямо после
       создания ObjectURL —
       сразу освобождаем его.
    */

    if (signal?.aborted) {

      try {

        URL.revokeObjectURL(
          url
        );

      } catch {}

      throw new DOMException(
        "Aborted",
        "AbortError"
      );

    }


    /*
       Canvas больше не нужен.
    */

    canvas.width = 1;
    canvas.height = 1;


    return {

      url,

      header:
        decoded.header

    };

  }


  /* =========================================================
     PUBLIC
  ========================================================= */

  window.CLOIdarkRaster = {

    frameToImageUrl

  };

})();
