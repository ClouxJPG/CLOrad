/* =========================================================
   CLOrad — iDarkMeteo RDR renderer
   .rdr → IDMR → streams → RLE → RGBA → PNG
   ========================================================= */

(function () {
  "use strict";

  const API = "/api/idarkmeteo?path=";

  function api(path) {
    return API + encodeURIComponent(path);
  }

  async function fetchBuffer(path) {
    const response = await fetch(api(path), {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "HTTP " + response.status + " for " + path
      );
    }

    return await response.arrayBuffer();
  }

  /* =========================================================
     Decompression
     ========================================================= */

  async function decompress(buffer, method) {
    method = String(method || "deflate").toLowerCase();

    if (method !== "deflate") {
      throw new Error(
        "Unsupported RDR compression: " + method
      );
    }

    if (!("DecompressionStream" in window)) {
      throw new Error(
        "DecompressionStream is not supported"
      );
    }

    const stream = new Blob([buffer])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));

    return await new Response(stream).arrayBuffer();
  }

  /* =========================================================
     Varint RLE
     ========================================================= */

  function decodeVarints(buffer) {
    const bytes = new Uint8Array(buffer);
    const result = [];

    let value = 0;
    let shift = 0;

    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];

      value |= (b & 127) << shift;

      if (b & 128) {
        shift += 7;

        if (shift > 28) {
          throw new Error(
            "Invalid RDR varint"
          );
        }
      } else {
        result.push(value);
        value = 0;
        shift = 0;
      }
    }

    if (shift !== 0) {
      throw new Error(
        "Truncated RDR varint stream"
      );
    }

    return result;
  }

  /* =========================================================
     RDR parser
     ========================================================= */

  async function parseRDR(buffer) {
    const bytes = new Uint8Array(buffer);

    if (bytes.length < 9) {
      throw new Error(
        "RDR file is too small"
      );
    }

    /* IDMR */
    if (
      bytes[0] !== 0x49 ||
      bytes[1] !== 0x44 ||
      bytes[2] !== 0x4d ||
      bytes[3] !== 0x52
    ) {
      throw new Error(
        "Invalid RDR signature"
      );
    }

    /* version */
    const version = bytes[4];

    if (version !== 1) {
      throw new Error(
        "Unsupported RDR version: " + version
      );
    }

    /* header length, little endian */
    const headerLength =
      bytes[5] |
      (bytes[6] << 8) |
      (bytes[7] << 16) |
      (bytes[8] << 24);

    const headerStart = 9;
    const headerEnd = headerStart + headerLength;

    if (headerEnd > bytes.length) {
      throw new Error(
        "Invalid RDR header length"
      );
    }

    /* JSON header */
    const decoder = new TextDecoder("utf-8");

    const headerText = decoder.decode(
      bytes.subarray(
        headerStart,
        headerEnd
      )
    );

    let header;

    try {
      header = JSON.parse(headerText);
    } catch (e) {
      throw new Error(
        "RDR JSON header is invalid"
      );
    }

    const width = Number(header.ширина);
    const height = Number(header.высота);

    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error(
        "Invalid RDR dimensions"
      );
    }

    const body = bytes.subarray(headerEnd);

    const lengths =
      header &&
      header.тело &&
      header.тело.длины_потоков;

    if (
      !Array.isArray(lengths) ||
      lengths.length < 3
    ) {
      throw new Error(
        "RDR stream lengths are missing"
      );
    }

    const streams = [];

    let offset = 0;

    for (const length of lengths) {
      const n = Number(length);

      if (
        !Number.isInteger(n) ||
        n < 0 ||
        offset + n > body.length
      ) {
        throw new Error(
          "Invalid RDR stream length"
        );
      }

      streams.push(
        body.subarray(
          offset,
          offset + n
        )
      );

      offset += n;
    }

    const compression =
      header &&
      header.тело &&
      header.тело.жатьё
        ? header.тело.жатьё
        : "deflate";

    /* =======================================================
       Stream 0 — pixel values
       ======================================================= */

    const valuesBuffer =
      await decompress(
        streams[0],
        compression
      );

    const values =
      new Uint8Array(valuesBuffer);

    /* =======================================================
       Stream 1 — RLE lengths
       ======================================================= */

    const lengthsBuffer =
      await decompress(
        streams[1],
        compression
      );

    const runLengths =
      decodeVarints(lengthsBuffer);

    const pixelCount =
      width * height;

    const raster =
      new Uint8Array(pixelCount);

    let position = 0;

    if (values.length !== runLengths.length) {
      throw new Error(
        "RDR RLE mismatch: values=" +
        values.length +
        " lengths=" +
        runLengths.length
      );
    }

    for (
      let i = 0;
      i < values.length;
      i++
    ) {
      const count =
        Number(runLengths[i]);

      if (
        !Number.isInteger(count) ||
        count < 0
      ) {
        throw new Error(
          "Invalid RDR run length"
        );
      }

      if (
        position + count >
        pixelCount
      ) {
        throw new Error(
          "RDR RLE exceeds raster size"
        );
      }

      raster.fill(
        values[i],
        position,
        position + count
      );

      position += count;
    }

    if (position !== pixelCount) {
      throw new Error(
        "RDR raster size mismatch: " +
        position +
        " / " +
        pixelCount
      );
    }

    /* =======================================================
       Stream 2 — embedded RGBA palette
       ======================================================= */

    const paletteBuffer =
      await decompress(
        streams[2],
        compression
      );

    const paletteBytes =
      Number(
        header &&
        header.тело &&
        header.тело.палитра
      );

    if (
      !Number.isInteger(paletteBytes) ||
      paletteBytes <= 0
    ) {
      throw new Error(
        "Invalid RDR palette size"
      );
    }

    const palette =
      new Uint8Array(paletteBuffer);

    const requiredPaletteSize =
      256 * paletteBytes;

    if (
      palette.length <
      requiredPaletteSize
    ) {
      throw new Error(
        "RDR palette is too small: " +
        palette.length +
        " / " +
        requiredPaletteSize
      );
    }

    return {
      width,
      height,
      raster,
      palette,
      paletteBytes,
      header
    };
  }

  /* =========================================================
     RDR → PNG
     ========================================================= */

  async function rdrToPNG(buffer) {
    const decoded =
      await parseRDR(buffer);

    const {
      width,
      height,
      raster,
      palette,
      paletteBytes
    } = decoded;

    const canvas =
      document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: false
      });

    const image =
      ctx.createImageData(
        width,
        height
      );

    const pixels =
      image.data;

    for (
      let i = 0;
      i < raster.length;
      i++
    ) {
      const index =
        raster[i];

      const paletteOffset =
        index * paletteBytes;

      /*
       * Standard Idarkmeteo palette:
       * R G B A
       */

      pixels[i * 4] =
        palette[paletteOffset] || 0;

      pixels[i * 4 + 1] =
        palette[paletteOffset + 1] || 0;

      pixels[i * 4 + 2] =
        palette[paletteOffset + 2] || 0;

      pixels[i * 4 + 3] =
        palette[paletteOffset + 3] || 0;
    }

    ctx.putImageData(
      image,
      0,
      0
    );

    return await new Promise(
      (resolve, reject) => {
        canvas.toBlob(
          blob => {
            if (!blob) {
              reject(
                new Error(
                  "PNG creation failed"
                )
              );
              return;
            }

            resolve(
              URL.createObjectURL(blob)
            );
          },
          "image/png"
        );
      }
    );
  }

  /* =========================================================
     Public API
     ========================================================= */

  async function frameToImageUrl(
    path,
    product,
    width,
    height
  ) {
    if (!path) {
      throw new Error(
        "Empty frame path"
      );
    }

    const buffer =
      await fetchBuffer(path);

    /*
     * Actual Idarkmeteo frames are .rdr.
     * PNG/TIFF fallbacks are intentionally
     * not used: according to the API docs
     * they were disabled on 12 Sep 2026.
     */

    return await rdrToPNG(buffer);
  }

  window.CLOIdarkRaster = {
    frameToImageUrl
  };

})();
