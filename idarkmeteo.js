/* =========================================================
   CLOrad — iDarkMeteo
   rain/.rdr renderer

   IDMR → JSON header → 3 streams → RLE → RGBA → PNG
   ========================================================= */

(function () {
  "use strict";

  const API = "/api/idarkmeteo?path=";

  // ---------------------------------------------------------
  // API
  // ---------------------------------------------------------

  function api(path) {
    return API + encodeURIComponent(path);
  }

  async function fetchBuffer(path) {
    const response = await fetch(api(path), {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "iDarkMeteo HTTP " +
        response.status +
        ": " +
        path
      );
    }

    return await response.arrayBuffer();
  }

  async function fetchJSON(path) {
    const response = await fetch(api(path), {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "iDarkMeteo HTTP " +
        response.status +
        ": " +
        path
      );
    }

    return await response.json();
  }

  // ---------------------------------------------------------
  // Decompression
  // ---------------------------------------------------------

  async function decompress(buffer, method) {
    method = String(method || "deflate").toLowerCase();

    if (method !== "deflate") {
      throw new Error(
        "RDR compression '" +
        method +
        "' is not supported by this browser renderer"
      );
    }

    if (!("DecompressionStream" in window)) {
      throw new Error(
        "DecompressionStream is not supported"
      );
    }

    const stream =
      new Blob([buffer])
        .stream()
        .pipeThrough(
          new DecompressionStream("deflate")
        );

    return await new Response(stream)
      .arrayBuffer();
  }

  // ---------------------------------------------------------
  // Little-endian uint32
  // ---------------------------------------------------------

  function readUint32LE(bytes, offset) {
    return (
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)
    ) >>> 0;
  }

  // ---------------------------------------------------------
  // Varint decoder
  // ---------------------------------------------------------

  function decodeVarints(buffer) {
    const bytes = new Uint8Array(buffer);

    const result = [];

    let value = 0;
    let shift = 0;

    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];

      value +=
        (b & 127) *
        Math.pow(2, shift);

      if (b & 128) {
        shift += 7;

        if (shift > 35) {
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

  // ---------------------------------------------------------
  // RDR parser
  // ---------------------------------------------------------

  async function parseRDR(buffer) {
    const bytes =
      new Uint8Array(buffer);

    if (bytes.length < 9) {
      throw new Error(
        "RDR file is too small"
      );
    }

    // IDMR
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

    // version
    if (bytes[4] !== 1) {
      throw new Error(
        "Unsupported RDR version: " +
        bytes[4]
      );
    }

    // header length
    const headerLength =
      readUint32LE(bytes, 5);

    const headerStart = 9;
    const headerEnd =
      headerStart + headerLength;

    if (
      headerEnd > bytes.length
    ) {
      throw new Error(
        "Invalid RDR header length"
      );
    }

    // JSON header
    const headerText =
      new TextDecoder("utf-8")
        .decode(
          bytes.subarray(
            headerStart,
            headerEnd
          )
        );

    let header;

    try {
      header =
        JSON.parse(headerText);
    } catch {
      throw new Error(
        "Invalid RDR JSON header"
      );
    }

    // dimensions
    const width =
      Number(header.ширина);

    const height =
      Number(header.высота);

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

    // -------------------------------------------------------
    // Streams
    // -------------------------------------------------------

    const body =
      bytes.subarray(headerEnd);

    const streamLengths =
      header?.тело?.длины_потоков;

    if (
      !Array.isArray(streamLengths) ||
      streamLengths.length < 3
    ) {
      throw new Error(
        "RDR stream lengths are missing"
      );
    }

    const streams = [];

    let offset = 0;

    for (const rawLength of streamLengths) {
      const length =
        Number(rawLength);

      if (
        !Number.isInteger(length) ||
        length < 0 ||
        offset + length > body.length
      ) {
        throw new Error(
          "Invalid RDR stream length"
        );
      }

      streams.push(
        body.subarray(
          offset,
          offset + length
        )
      );

      offset += length;
    }

    // -------------------------------------------------------
    // Compression
    // -------------------------------------------------------

    const compression =
      String(
        header?.тело?.жатьё ||
        "deflate"
      ).toLowerCase();

    // -------------------------------------------------------
    // Stream 0 — values
    // -------------------------------------------------------

    const valuesBuffer =
      await decompress(
        streams[0],
        compression
      );

    const values =
      new Uint8Array(
        valuesBuffer
      );

    // -------------------------------------------------------
    // Stream 1 — RLE lengths
    // -------------------------------------------------------

    const lengthsBuffer =
      await decompress(
        streams[1],
        compression
      );

    const runLengths =
      decodeVarints(
        lengthsBuffer
      );

    if (
      values.length !==
      runLengths.length
    ) {
      throw new Error(
        "RDR RLE mismatch: values=" +
        values.length +
        " lengths=" +
        runLengths.length
      );
    }

    // -------------------------------------------------------
    // Reconstruct raster
    // -------------------------------------------------------

    const pixelCount =
      width * height;

    const raster =
      new Uint8Array(
        pixelCount
      );

    let position = 0;

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

    if (
      position !== pixelCount
    ) {
      throw new Error(
        "RDR raster size mismatch: " +
        position +
        " / " +
        pixelCount
      );
    }

    // -------------------------------------------------------
    // Stream 2 — palette
    // -------------------------------------------------------

    const paletteBuffer =
      await decompress(
        streams[2],
        compression
      );

    const palette =
      new Uint8Array(
        paletteBuffer
      );

    const bytesPerColor =
      Number(
        header?.тело?.палитра
      );

    if (
      !Number.isInteger(
        bytesPerColor
      ) ||
      bytesPerColor < 4
    ) {
      throw new Error(
        "Invalid RDR palette size: " +
        bytesPerColor
      );
    }

    const requiredPaletteSize =
      256 * bytesPerColor;

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
      bytesPerColor,
      header
    };
  }

  // ---------------------------------------------------------
  // RDR → PNG
  // ---------------------------------------------------------

  async function rdrToPNG(buffer) {
    const decoded =
      await parseRDR(buffer);

    const {
      width,
      height,
      raster,
      palette,
      bytesPerColor
    } = decoded;

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = width;
    canvas.height = height;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      throw new Error(
        "Canvas 2D is unavailable"
      );
    }

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
        index * bytesPerColor;

      pixels[i * 4] =
        palette[paletteOffset];

      pixels[i * 4 + 1] =
        palette[paletteOffset + 1];

      pixels[i * 4 + 2] =
        palette[paletteOffset + 2];

      pixels[i * 4 + 3] =
        palette[paletteOffset + 3];
    }

    ctx.putImageData(
      image,
      0,
      0
    );

    const blob =
      await new Promise(
        (resolve, reject) => {
          canvas.toBlob(
            result => {
              if (!result) {
                reject(
                  new Error(
                    "PNG creation failed"
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

  // ---------------------------------------------------------
  // Frame → image URL
  // ---------------------------------------------------------

  async function frameToImageUrl(
    path
  ) {
    const buffer =
      await fetchBuffer(path);

    return await rdrToPNG(
      buffer
    );
  }

  // ---------------------------------------------------------
  // Rain metadata
  // ---------------------------------------------------------

  async function getRainFrames() {
    return await fetchJSON(
      "frames/rain/wide.json"
    );
  }

  // ---------------------------------------------------------
  // EPSG:3857 → Leaflet
  // ---------------------------------------------------------

  function mercatorToLatLng(
    x,
    y
  ) {
    const R =
      6378137;

    const lng =
      (x / R) *
      180 /
      Math.PI;

    const lat =
      (
        2 *
        Math.atan(
          Math.exp(
            y / R
          )
        ) -
        Math.PI / 2
      ) *
      180 /
      Math.PI;

    return [
      lat,
      lng
    ];
  }

  function boxToBounds(
    box
  ) {
    const southwest =
      mercatorToLatLng(
        Number(box[0]),
        Number(box[1])
      );

    const northeast =
      mercatorToLatLng(
        Number(box[2]),
        Number(box[3])
      );

    return [
      southwest,
      northeast
    ];
  }

  // ---------------------------------------------------------
  // Add rain overlay
  // ---------------------------------------------------------

  async function addRainOverlay(
    map
  ) {
    if (!map) {
      throw new Error(
        "Leaflet map is required"
      );
    }

    const data =
      await getRainFrames();

    if (
      !data ||
      !Array.isArray(
        data.frames
      ) ||
      !data.frames.length
    ) {
      throw new Error(
        "No iDarkMeteo rain frames"
      );
    }

    const frame =
      data.frames[0];

    const imageUrl =
      await frameToImageUrl(
        frame.path
      );

    const bounds =
      boxToBounds(
        data.box
      );

    const overlay =
      L.imageOverlay(
        imageUrl,
        bounds,
        {
          opacity: 1,
          interactive: false
        }
      );

    overlay.addTo(map);

    return {
      overlay,
      frame,
      bounds,
      metadata: data
    };
  }

  // ---------------------------------------------------------
  // Public API
  // ---------------------------------------------------------

  window.CLOIdarkRaster = {
    fetchJSON,
    fetchBuffer,
    parseRDR,
    rdrToPNG,
    frameToImageUrl,
    getRainFrames,
    boxToBounds,
    addRainOverlay
  };

})();
