/* =========================================================
   CLOrad — iDarkMeteo raster renderer
   .rdr → PNG → TIFF → indexed raster
   ========================================================= */

(function () {
  "use strict";

  const API = "/api/idarkmeteo?path=";

  function api(path) {
    return API + encodeURIComponent(path);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isPNG(buf) {
    if (!buf || buf.byteLength < 8) return false;
    const b = new Uint8Array(buf);
    return (
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a
    );
  }

  function isTIFF(buf) {
    if (!buf || buf.byteLength < 4) return false;

    const b = new Uint8Array(buf);

    return (
      (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)
    );
  }

  async function fetchBuffer(path) {
    const r = await fetch(api(path), {
      cache: "no-store"
    });

    if (!r.ok) {
      throw new Error("HTTP " + r.status + " for " + path);
    }

    return await r.arrayBuffer();
  }

  function imageFromBlob(buffer, type) {
    const blob = new Blob([buffer], {
      type: type || "image/png"
    });

    return URL.createObjectURL(blob);
  }

  function hexToRGBA(v) {
    if (typeof v !== "string") return null;

    let s = v.trim();

    if (s[0] === "#") s = s.slice(1);

    if (s.length === 3) {
      s = s.split("").map(x => x + x).join("");
    }

    if (s.length !== 6 && s.length !== 8) return null;

    const n = parseInt(s, 16);

    if (!Number.isFinite(n)) return null;

    if (s.length === 6) {
      return [
        (n >> 16) & 255,
        (n >> 8) & 255,
        n & 255,
        255
      ];
    }

    return [
      (n >> 24) & 255,
      (n >> 16) & 255,
      (n >> 8) & 255,
      n & 255
    ];
  }

  function colorToRGBA(v) {
    if (Array.isArray(v)) {
      if (v.length >= 4) {
        return [
          Number(v[0]) || 0,
          Number(v[1]) || 0,
          Number(v[2]) || 0,
          Number(v[3]) || 0
        ];
      }

      if (v.length >= 3) {
        return [
          Number(v[0]) || 0,
          Number(v[1]) || 0,
          Number(v[2]) || 0,
          255
        ];
      }
    }

    if (typeof v === "string") {
      return hexToRGBA(v);
    }

    if (v && typeof v === "object") {
      if ("color" in v) return colorToRGBA(v.color);
      if ("colour" in v) return colorToRGBA(v.colour);

      if ("r" in v && "g" in v && "b" in v) {
        return [
          Number(v.r) || 0,
          Number(v.g) || 0,
          Number(v.b) || 0,
          "a" in v ? Number(v.a) || 0 : 255
        ];
      }
    }

    return null;
  }

  function paletteArray(data) {
    if (!data) return null;

    if (Array.isArray(data)) return data;

    if (Array.isArray(data.palette)) return data.palette;
    if (Array.isArray(data.colors)) return data.colors;
    if (Array.isArray(data.colours)) return data.colours;
    if (Array.isArray(data.entries)) return data.entries;

    if (data.palette && typeof data.palette === "object") {
      return data.palette;
    }

    return data;
  }

  async function loadPalette(product) {
    const candidates = [
      "palettes.json",
      "palettes/" + product + ".json",
      "palette/" + product + ".json"
    ];

    for (const p of candidates) {
      try {
        const r = await fetch(api(p), { cache: "no-store" });

        if (!r.ok) continue;

        const json = await r.json();
        return paletteArray(json);
      } catch (_) {}
    }

    return null;
  }

  function getPaletteColor(palette, index) {
    if (!palette) return null;

    let value = null;

    if (Array.isArray(palette)) {
      value = palette[index];
    } else if (typeof palette === "object") {
      value =
        palette[index] ??
        palette[String(index)] ??
        palette["i" + index];
    }

    return colorToRGBA(value);
  }

  /*
    Если палитру не удалось получить, НЕ используем
    выдуманные цвета для самого радара.
    Вместо этого применяем нейтральную grayscale-шкалу,
    чтобы хотя бы проверить наличие raster.
  */
  function fallbackColor(index) {
    if (index === 0) return [0, 0, 0, 0];

    if (index === 1) return [190, 190, 190, 80];

    const v = Math.max(
      0,
      Math.min(255, Math.round((index / 255) * 255))
    );

    return [v, v, v, 210];
  }

  async function rasterToPNG(
    buffer,
    width,
    height,
    product
  ) {
    const expected = width * height;

    if (!expected || expected <= 0) {
      throw new Error("Invalid raster dimensions");
    }

    const bytes = new Uint8Array(buffer);

    /*
      Возможны небольшие служебные заголовки.
      Поэтому сначала ищем участок, который может содержать
      ровно width*height байт.
    */
    let data = null;

    if (bytes.byteLength === expected) {
      data = bytes;
    } else if (bytes.byteLength > expected) {
      /*
        Самый вероятный вариант — raster лежит в конце.
      */
      data = bytes.subarray(bytes.byteLength - expected);

      /*
        Если это очевидно не raster, попробуем начало.
      */
      if (data.length !== expected) {
        data = bytes.subarray(0, expected);
      }
    }

    if (!data || data.length !== expected) {
      throw new Error(
        "Raster size mismatch: got " +
        bytes.byteLength +
        ", expected " +
        expected
      );
    }

    const palette = await loadPalette(product);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", {
      willReadFrequently: false
    });

    const image = ctx.createImageData(width, height);
    const out = image.data;

    for (let i = 0; i < data.length; i++) {
      const idx = data[i];

      /*
        0 = no coverage / NODATA
      */
      if (idx === 0) {
        out[i * 4] = 0;
        out[i * 4 + 1] = 0;
        out[i * 4 + 2] = 0;
        out[i * 4 + 3] = 0;
        continue;
      }

      const c =
        getPaletteColor(palette, idx) ||
        fallbackColor(idx);

      out[i * 4] = c[0];
      out[i * 4 + 1] = c[1];
      out[i * 4 + 2] = c[2];
      out[i * 4 + 3] = c[3];
    }

    ctx.putImageData(image, 0, 0);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error("Canvas PNG conversion failed"));
          return;
        }

        resolve(URL.createObjectURL(blob));
      }, "image/png");
    });
  }

  async function tiffToPNG(
    buffer,
    width,
    height,
    product
  ) {
    /*
      GeoTIFF.js используется только если файл действительно TIFF.
    */

    let GeoTIFF;

    try {
      const mod = await import(
        "https://unpkg.com/geotiff@2.1.3/+esm"
      );

      GeoTIFF = mod;
    } catch (e) {
      throw new Error(
        "GeoTIFF library failed to load: " + e.message
      );
    }

    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();

    const raster = await image.readRasters({
      interleave: true
    });

    const w = image.getWidth() || width;
    const h = image.getHeight() || height;

    if (!w || !h) {
      throw new Error("TIFF has no valid dimensions");
    }

    const palette = await loadPalette(product);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    const out = ctx.createImageData(w, h);
    const pixels = out.data;

    for (let i = 0; i < w * h; i++) {
      const idx = Number(raster[i]) || 0;

      if (idx === 0) {
        pixels[i * 4] = 0;
        pixels[i * 4 + 1] = 0;
        pixels[i * 4 + 2] = 0;
        pixels[i * 4 + 3] = 0;
        continue;
      }

      const c =
        getPaletteColor(palette, idx) ||
        fallbackColor(idx);

      pixels[i * 4] = c[0];
      pixels[i * 4 + 1] = c[1];
      pixels[i * 4 + 2] = c[2];
      pixels[i * 4 + 3] = c[3];
    }

    ctx.putImageData(out, 0, 0);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error("TIFF PNG conversion failed"));
          return;
        }

        resolve(URL.createObjectURL(blob));
      }, "image/png");
    });
  }

  async function tryPNG(path) {
    const buffer = await fetchBuffer(path);

    if (!isPNG(buffer)) {
      throw new Error("Response is not PNG");
    }

    return imageFromBlob(buffer, "image/png");
  }

  async function tryRDR(
    path,
    width,
    height,
    product
  ) {
    const buffer = await fetchBuffer(path);

    /*
      Иногда сервер может вернуть PNG несмотря на .rdr.
    */
    if (isPNG(buffer)) {
      return imageFromBlob(buffer, "image/png");
    }

    /*
      Иногда .rdr фактически является TIFF.
    */
    if (isTIFF(buffer)) {
      return await tiffToPNG(
        buffer,
        width,
        height,
        product
      );
    }

    /*
      Последняя попытка — индексный raster.
    */
    return await rasterToPNG(
      buffer,
      width,
      height,
      product
    );
  }

  async function frameToImageUrl(
    path,
    product,
    width,
    height
  ) {
    if (!path) {
      throw new Error("Empty frame path");
    }

    /*
      1. Прямой .rdr
    */
    try {
      return await tryRDR(
        path,
        width,
        height,
        product
      );
    } catch (rdrError) {
      console.warn(
        "[CLOrad] RDR failed:",
        rdrError
      );
    }

    /*
      2. Самый важный fallback:
         тот же кадр, но .png
    */
    if (/\.rdr$/i.test(path)) {
      const pngPath = path.replace(
        /\.rdr$/i,
        ".png"
      );

      try {
        console.log(
          "[CLOrad] Trying PNG:",
          pngPath
        );

        return await tryPNG(pngPath);
      } catch (pngError) {
        console.warn(
          "[CLOrad] PNG fallback failed:",
          pngError
        );
      }
    }

    throw new Error(
      "Unable to render frame: " + path
    );
  }

  window.CLOIdarkRaster = {
    frameToImageUrl
  };
})();
