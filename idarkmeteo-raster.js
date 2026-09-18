// ============================================================
// CLOrad — iDarkMeteo raster renderer
//
// .rdr → IDMR → JSON header → deflate → indexed raster
// → embedded palette → Canvas PNG
// ============================================================

(function () {
  "use strict";

  const API =
    "/api/idarkmeteo?path=";

  // ----------------------------------------------------------
  // API URL
  // ----------------------------------------------------------

  function api(path) {
    return (
      API +
      encodeURIComponent(path)
    );
  }

  // ----------------------------------------------------------
  // Fetch binary
  // ----------------------------------------------------------

  async function fetchBuffer(path) {
    const r = await fetch(
      api(path),
      {
        cache: "no-store"
      }
    );

    if (!r.ok) {
      let detail = "";

      try {
        const j =
          await r.json();

        if (j?.upstream) {
          detail =
            ": " + j.upstream;
        }
      } catch {}

      throw new Error(
        "HTTP " +
        r.status +
        " for " +
        path +
        detail
      );
    }

    return await r.arrayBuffer();
  }

  // ----------------------------------------------------------
  // Read little-endian uint32
  // ----------------------------------------------------------

  function u32(view, offset) {
    return view.getUint32(
      offset,
      true
    );
  }

  // ----------------------------------------------------------
  // Read IDMR header
  // ----------------------------------------------------------

  function parseRDR(buffer) {
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
        "Invalid IDMR signature"
      );
    }

    // Version
    const version =
      bytes[4];

    if (version !== 1) {
      throw new Error(
        "Unsupported IDMR version: " +
        version
      );
    }

    // Header length
    const view =
      new DataView(buffer);

    const headerLength =
      u32(view, 5);

    const headerStart = 9;
    const headerEnd =
      headerStart +
      headerLength;

    if (
      headerEnd >
      buffer.byteLength
    ) {
      throw new Error(
        "Invalid IDMR header length"
      );
    }

    // JSON header
    const decoder =
      new TextDecoder(
        "utf-8"
      );

    const headerText =
      decoder.decode(
        bytes.subarray(
          headerStart,
          headerEnd
        )
      );

    let header;

    try {
      header =
        JSON.parse(headerText);
    } catch (e) {
      throw new Error(
        "Invalid IDMR JSON header"
      );
    }

    return {
      version,
      header,
      bodyOffset: headerEnd
    };
  }

  // ----------------------------------------------------------
  // Split compressed streams
  // ----------------------------------------------------------

  function getStreams(
    buffer,
    parsed
  ) {
    const header =
      parsed.header;

    const lengths =
      header?.тело
        ?.длины_потоков;

    if (
      !Array.isArray(lengths) ||
      lengths.length < 3
    ) {
      throw new Error(
        "RDR stream lengths missing"
      );
    }

    const bytes =
      new Uint8Array(buffer);

    let offset =
      parsed.bodyOffset;

    const streams = [];

    for (
      const length of lengths
    ) {
      if (
        !Number.isInteger(length) ||
        length < 0 ||
        offset + length >
          bytes.length
      ) {
        throw new Error(
          "Invalid RDR stream length"
        );
      }

      streams.push(
        bytes.slice(
          offset,
          offset + length
        )
      );

      offset += length;
    }

    return streams;
  }

  // ----------------------------------------------------------
  // Deflate decompression
  // ----------------------------------------------------------

  async function inflate(
    data
  ) {
    if (
      typeof DecompressionStream ===
      "undefined"
    ) {
      throw new Error(
        "Browser does not support DecompressionStream"
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

    const response =
      new Response(stream);

    return new Uint8Array(
      await response.arrayBuffer()
    );
  }

  // ----------------------------------------------------------
  // Variable-length integer decoding
  // ----------------------------------------------------------

  function decodeLengths(
    bytes
  ) {
    const result = [];

    let n = 0;
    let shift = 0;

    for (
      const b of bytes
    ) {
      n |=
        (b & 127) << shift;

      if (b & 128) {
        shift += 7;

        if (shift > 28) {
          throw new Error(
            "Invalid RLE length"
          );
        }
      } else {
        result.push(n);

        n = 0;
        shift = 0;
      }
    }

    if (shift !== 0) {
      throw new Error(
        "Truncated RLE lengths"
      );
    }

    return result;
  }

  // ----------------------------------------------------------
  // Decode indexed raster
  // ----------------------------------------------------------

  async function decodeRDR(
    buffer
  ) {
    const parsed =
      parseRDR(buffer);

    const header =
      parsed.header;

    const streams =
      getStreams(
        buffer,
        parsed
      );

    const compression =
      header?.тело?.жатьё ||
      "deflate";

    if (
      compression !== "deflate"
    ) {
      throw new Error(
        "Unsupported RDR compression: " +
        compression
      );
    }

    // --------------------------------------------------------
    // Stream 0:
    // values
    // --------------------------------------------------------

    const values =
      await inflate(
        streams[0]
      );

    // --------------------------------------------------------
    // Stream 1:
    // run lengths
    // --------------------------------------------------------

    const lengthBytes =
      await inflate(
        streams[1]
      );

    const lengths =
      decodeLengths(
        lengthBytes
      );

    // --------------------------------------------------------
    // Reconstruct pixels
    // --------------------------------------------------------

    const width =
      Number(
        header.ширина
      );

    const height =
      Number(
        header.высота
      );

    if (
      !width ||
      !height
    ) {
      throw new Error(
        "Invalid raster dimensions"
      );
    }

    const expected =
      width * height;

    if (
      values.length !==
      lengths.length
    ) {
      throw new Error(
        "RDR values/RLE mismatch"
      );
    }

    const pixels =
      new Uint8Array(
        expected
      );

    let position = 0;

    for (
      let i = 0;
      i < values.length;
      i++
    ) {
      const value =
        values[i];

      const count =
        lengths[i];

      if (
        position + count >
        expected
      ) {
        throw new Error(
          "RDR raster overflow"
        );
      }

      pixels.fill(
        value,
        position,
        position + count
      );

      position += count;
    }

    if (
      position !== expected
    ) {
      throw new Error(
        "RDR raster size mismatch: " +
        position +
        " / " +
        expected
      );
    }

    return {
      header,
      width,
      height,
      pixels
    };
  }

  // ----------------------------------------------------------
  // Embedded palette
  // ----------------------------------------------------------

  function getPalette(
    header
  ) {
    const p =
      header?.тело?.палитра;

    if (!p) {
      return null;
    }

    /*
      Palette format:
      256 colors × 4 bytes:
      R G B A
    */

    if (
      Array.isArray(p)
    ) {
      return new Uint8Array(p);
    }

    return null;
  }

  // ----------------------------------------------------------
  // Draw raster
  // ----------------------------------------------------------

  function rasterToCanvas(
    raster
  ) {
    const {
      width,
      height,
      pixels,
      header
    } = raster;

    const palette =
      getPalette(header);

    if (
      !palette ||
      palette.length <
        256 * 4
    ) {
      throw new Error(
        "Embedded RDR palette is missing"
      );
    }

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

    const image =
      ctx.createImageData(
        width,
        height
      );

    const out =
      image.data;

    for (
      let i = 0;
      i < pixels.length;
      i++
    ) {
      const index =
        pixels[i];

      const p =
        index * 4;

      out[i * 4] =
        palette[p];

      out[i * 4 + 1] =
        palette[p + 1];

      out[i * 4 + 2] =
        palette[p + 2];

      out[i * 4 + 3] =
        palette[p + 3];
    }

    ctx.putImageData(
      image,
      0,
      0
    );

    return canvas;
  }

  // ----------------------------------------------------------
  // Canvas → PNG URL
  // ----------------------------------------------------------

  function canvasURL(
    canvas
  ) {
    return new Promise(
      (resolve, reject) => {
        canvas.toBlob(
          blob => {
            if (!blob) {
              reject(
                new Error(
                  "PNG conversion failed"
                )
              );

              return;
            }

            resolve(
              URL.createObjectURL(
                blob
              )
            );
          },
          "image/png"
        );
      }
    );
  }

  // ----------------------------------------------------------
  // Render one .rdr
  // ----------------------------------------------------------

  async function frameToImageUrl(
    path
  ) {
    if (!path) {
      throw new Error(
        "Empty frame path"
      );
    }

    const buffer =
      await fetchBuffer(path);

    const raster =
      await decodeRDR(
        buffer
      );

    console.log(
      "[CLOrad] RDR:",
      path,
      raster.width +
        "×" +
        raster.height,
      raster.header
    );

    const canvas =
      rasterToCanvas(
        raster
      );

    return canvasURL(
      canvas
    );
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  window.CLOIdarkRaster = {
    frameToImageUrl
  };

  // ----------------------------------------------------------
  // Test
  // ----------------------------------------------------------

  window.testIdarkmeteo =
    async function (path) {
      try {
        const url =
          await frameToImageUrl(
            path
          );

        console.log(
          "[CLOrad] iDarkMeteo OK:",
          url
        );

        return url;
      } catch (e) {
        console.error(
          "[CLOrad] iDarkMeteo ERROR:",
          e
        );

        throw e;
      }
    };
})();
