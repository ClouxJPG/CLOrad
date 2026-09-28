/* =========================================================
   CLOrad — RainRadar server-side raster colorizer
   ---------------------------------------------------------
   Источник:
   https://rainradar.ru/composite/manifest.json

   Сервер:
   1. получает manifest
   2. получает исходный grayscale PNG
   3. перекрашивает его в палитру ОЯ
   4. чёрный фон делает прозрачным
   5. возвращает готовый PNG

   Никаких постоянных файлов с кадрами не создаётся.
   ========================================================= */

const sharp = require("sharp");

/* =========================================================
   CONFIG
   ========================================================= */

const MANIFEST_URL =
  "https://rainradar.ru/composite/manifest.json";

const TILE_BASE =
  "https://rainradar.ru/composite/";

const CACHE_TIME = 30 * 1000;

/* =========================================================
   ОЯ PALETTE
   НЕ МЕНЯТЬ
   ========================================================= */

const RGMC_OY_PALETTE = [
  "#b9c1c7",
  "#a9c7f4",
  "#63eda5",
  "#43cf89",
  "#4db84e",
  "#fff89c",
  "#75a6ef",
  "#5279ed",
  "#504a9b",
  "#ffc0a8",
  "#fa82a0",
  "#ff4d4d",
  "#db9248",
  "#ad7544",
  "#924b48",
  "#f2aaf0",
  "#e85ae7",
  "#ca3cc7",
  "#777c91"
];

/* =========================================================
   HEX → RGB
   ========================================================= */

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

const PALETTE_RGB =
  RGMC_OY_PALETTE.map(hexToRgb);

/* =========================================================
   GRAYSCALE → ОЯ LEVEL
   ---------------------------------------------------------
   Значения подобраны под фактическое распределение
   RainRadar grayscale raster.

   0–4      = фон
   дальше   = 19 цветовых уровней

   Это НЕ линейная шкала 0–255.
   ========================================================= */

function grayToLevel(v) {

  if (v <= 4)   return -1;

  if (v <= 7)   return 0;
  if (v <= 10)  return 1;
  if (v <= 13)  return 2;
  if (v <= 16)  return 3;
  if (v <= 20)  return 4;
  if (v <= 24)  return 5;
  if (v <= 29)  return 6;
  if (v <= 35)  return 7;
  if (v <= 43)  return 8;
  if (v <= 53)  return 9;
  if (v <= 66)  return 10;
  if (v <= 82)  return 11;
  if (v <= 101) return 12;
  if (v <= 122) return 13;
  if (v <= 143) return 14;
  if (v <= 158) return 15;
  if (v <= 171) return 16;
  if (v <= 185) return 17;

  return 18;
}

/* =========================================================
   PREBUILT LOOKUP TABLE
   ---------------------------------------------------------
   Не вычисляем шкалу для каждого пикселя.
   ========================================================= */

const LUT = new Int16Array(256);

for (let i = 0; i < 256; i++) {
  LUT[i] = grayToLevel(i);
}

/* =========================================================
   MEMORY CACHE
   ========================================================= */

const cache = new Map();

/* =========================================================
   MANIFEST CACHE
   ========================================================= */

let manifestCache = null;
let manifestTime = 0;

/* =========================================================
   GET MANIFEST
   ========================================================= */

async function getManifest() {

  const now = Date.now();

  if (
    manifestCache &&
    now - manifestTime < CACHE_TIME
  ) {
    return manifestCache;
  }

  const response = await fetch(MANIFEST_URL, {
    headers: {
      "User-Agent": "CLOrad/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `RainRadar manifest HTTP ${response.status}`
    );
  }

  const data = await response.json();

  manifestCache = data;
  manifestTime = now;

  return data;
}

/* =========================================================
   FIND TIMESTAMP
   ---------------------------------------------------------
   Manifest у RainRadar может иметь немного разную структуру,
   поэтому ищем timestamp достаточно гибко.
   ========================================================= */

function extractTimestamp(manifest) {

  if (!manifest) {
    return null;
  }

  if (typeof manifest === "string") {
    return manifest;
  }

  if (Array.isArray(manifest)) {

    for (const item of manifest) {

      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {

        const value =
          item.timestamp ??
          item.time ??
          item.ts ??
          item.id;

        if (value != null) {
          return String(value);
        }
      }
    }
  }

  if (typeof manifest === "object") {

    const direct =
      manifest.timestamp ??
      manifest.time ??
      manifest.latest ??
      manifest.current;

    if (direct != null) {
      return String(direct);
    }

    const arrays = [
      manifest.frames,
      manifest.times,
      manifest.timestamps,
      manifest.images
    ];

    for (const arr of arrays) {

      if (!Array.isArray(arr) || !arr.length) {
        continue;
      }

      const last = arr[arr.length - 1];

      if (typeof last === "string") {
        return last;
      }

      if (last && typeof last === "object") {

        const value =
          last.timestamp ??
          last.time ??
          last.ts ??
          last.id;

        if (value != null) {
          return String(value);
        }
      }
    }
  }

  return null;
}

/* =========================================================
   SOURCE TILE URL
   ========================================================= */

function sourceTileUrl(timestamp, z, x, y) {

  return (
    TILE_BASE +
    encodeURIComponent(timestamp) +
    "/" +
    z +
    "/" +
    x +
    "_" +
    y +
    ".png"
  );
}

/* =========================================================
   COLORIZE TILE
   ========================================================= */

async function colorize(buffer) {

  const image = sharp(buffer, {
    failOn: "none"
  });

  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true
    });

  const out = Buffer.allocUnsafe(
    info.width *
    info.height *
    4
  );

  let p = 0;

  for (let i = 0; i < data.length; i += 4) {

    /*
      RainRadar source is grayscale.

      Берём red channel.
      Для защиты от случайных цветных PNG
      также можно использовать максимум каналов.
    */

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const gray =
      Math.max(r, g, b);

    const level = LUT[gray];

    if (level < 0) {

      out[p++] = 0;
      out[p++] = 0;
      out[p++] = 0;
      out[p++] = 0;

      continue;
    }

    const color =
      PALETTE_RGB[level];

    out[p++] = color[0];
    out[p++] = color[1];
    out[p++] = color[2];

    /*
      Полностью непрозрачный радар.
      Никакого смешивания цветов.
    */

    out[p++] = 255;
  }

  /*
    ВАЖНО:
    размеры исходного PNG сохраняются 1:1.
    Никакого resize / blur / interpolation на сервере.
  */

  return sharp(out, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  })
    .png({
      compressionLevel: 6,
      adaptiveFiltering: false
    })
    .toBuffer();
}

/* =========================================================
   HANDLER
   ========================================================= */

module.exports = async function handler(req, res) {

  try {

    const {
      manifest,
      timestamp,
      z,
      x,
      y
    } = req.query;

    /* =====================================================
       MANIFEST
       ===================================================== */

    if (manifest === "1") {

      const data =
        await getManifest();

      res.setHeader(
        "Cache-Control",
        "public, s-maxage=30, stale-while-revalidate=60"
      );

      res.status(200).json(data);

      return;
    }

    /* =====================================================
       TILE VALIDATION
       ===================================================== */

    if (
      !timestamp ||
      z == null ||
      x == null ||
      y == null
    ) {

      res.status(400).json({
        error: "Missing timestamp/z/x/y"
      });

      return;
    }

    const Z = Number(z);
    const X = Number(x);
    const Y = Number(y);

    if (
      !Number.isInteger(Z) ||
      !Number.isInteger(X) ||
      !Number.isInteger(Y) ||
      Z < 0 ||
      X < 0 ||
      Y < 0
    ) {

      res.status(400).json({
        error: "Invalid tile coordinates"
      });

      return;
    }

    /* =====================================================
       CACHE KEY
       ===================================================== */

    const key =
      `${timestamp}/${Z}/${X}/${Y}`;

    const cached =
      cache.get(key);

    if (cached) {

      res.setHeader(
        "Content-Type",
        "image/png"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=30"
      );

      res.status(200).send(cached);

      return;
    }

    /* =====================================================
       GET ORIGINAL TILE
       ===================================================== */

    const url =
      sourceTileUrl(
        timestamp,
        Z,
        X,
        Y
      );

    const response =
      await fetch(url, {
        headers: {
          "User-Agent": "CLOrad/1.0",
          "Accept": "image/png,image/*"
        }
      });

    if (!response.ok) {

      res.status(response.status).json({
        error:
          `RainRadar tile HTTP ${response.status}`
      });

      return;
    }

    const source =
      Buffer.from(
        await response.arrayBuffer()
      );

    /* =====================================================
       COLORIZE
       ===================================================== */

    const output =
      await colorize(source);

    /* =====================================================
       MEMORY CACHE
       ===================================================== */

    cache.set(key, output);

    /*
      Ограничиваем cache.
      Постоянных файлов на сервере нет.
    */

    if (cache.size > 250) {

      const firstKey =
        cache.keys().next().value;

      cache.delete(firstKey);
    }

    /* =====================================================
       RESPONSE
       ===================================================== */

    res.setHeader(
      "Content-Type",
      "image/png"
    );

    res.setHeader(
      "Cache-Control",
      "public, max-age=30, s-maxage=30"
    );

    res.setHeader(
      "X-CLOrad-RainRadar",
      "server-colorized"
    );

    res.status(200).send(output);

  } catch (error) {

    console.error(
      "CLOrad RainRadar:",
      error
    );

    res.status(500).json({
      error: "RainRadar processing failed",
      message: String(error.message || error)
    });
  }
};
