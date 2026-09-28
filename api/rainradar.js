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

const CACHE_TIME =
  30 * 1000;

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
   Умеренная нелинейная шкала.

   Важно:
   0–4 = прозрачный фон.

   Значения RainRadar в районе 5–30
   не должны всё время оставаться
   на самом слабом уровне.

   При этом верхние значения не
   искусственно загоняются в максимум.
   ========================================================= */

function grayToLevel(v) {

  if (v <= 4) {
    return -1;
  }

  if (v <= 6) {
    return 0;
  }

  if (v <= 8) {
    return 1;
  }

  if (v <= 10) {
    return 2;
  }

  if (v <= 12) {
    return 3;
  }

  if (v <= 15) {
    return 4;
  }

  if (v <= 18) {
    return 5;
  }

  if (v <= 22) {
    return 6;
  }

  if (v <= 27) {
    return 7;
  }

  if (v <= 33) {
    return 8;
  }

  if (v <= 41) {
    return 9;
  }

  if (v <= 51) {
    return 10;
  }

  if (v <= 64) {
    return 11;
  }

  if (v <= 80) {
    return 12;
  }

  if (v <= 100) {
    return 13;
  }

  if (v <= 122) {
    return 14;
  }

  if (v <= 143) {
    return 15;
  }

  if (v <= 160) {
    return 16;
  }

  if (v <= 176) {
    return 17;
  }

  return 18;
}

/* =========================================================
   LOOKUP TABLE
   ========================================================= */

const LUT =
  new Int16Array(256);

for (
  let i = 0;
  i < 256;
  i++
) {
  LUT[i] =
    grayToLevel(i);
}

/* =========================================================
   TILE CACHE
   ========================================================= */

const cache =
  new Map();

/* =========================================================
   MANIFEST CACHE
   ========================================================= */

let manifestCache =
  null;

let manifestTime =
  0;

/* =========================================================
   FETCH MANIFEST
   ========================================================= */

async function getManifest() {

  const now =
    Date.now();

  if (
    manifestCache &&
    now - manifestTime <
      CACHE_TIME
  ) {
    return manifestCache;
  }

  const response =
    await fetch(
      MANIFEST_URL,
      {
        method: "GET",

        headers: {
          "User-Agent":
            "Mozilla/5.0 CLOrad/1.0",

          "Accept":
            "application/json,text/plain,*/*"
        },

        cache: "no-store"
      }
    );

  if (!response.ok) {

    throw new Error(
      `RainRadar manifest HTTP ${response.status}`
    );
  }

  const text =
    await response.text();

  if (!text) {

    throw new Error(
      "RainRadar manifest is empty"
    );
  }

  let data;

  try {

    data =
      JSON.parse(text);

  } catch (error) {

    throw new Error(
      "RainRadar manifest is not valid JSON"
    );
  }

  manifestCache =
    data;

  manifestTime =
    now;

  return data;
}

/* =========================================================
   TIMESTAMP EXTRACTION
   ========================================================= */

function itemToTimestamp(item) {

  if (
    typeof item === "string" ||
    typeof item === "number"
  ) {
    return String(item);
  }

  if (
    !item ||
    typeof item !== "object"
  ) {
    return "";
  }

  const value =
    item.timestamp ??
    item.time ??
    item.ts ??
    item.datetime ??
    item.date ??
    item.id ??
    "";

  return value == null
    ? ""
    : String(value);
}

/* =========================================================
   NORMALIZE MANIFEST
   ========================================================= */

function normalizeManifest(data) {

  let result = [];

  /* -------------------------------------------------------
     ARRAY
     ------------------------------------------------------- */

  if (
    Array.isArray(data)
  ) {

    result =
      data
        .map(itemToTimestamp)
        .filter(Boolean);

  }

  /* -------------------------------------------------------
     OBJECT
     ------------------------------------------------------- */

  else if (
    data &&
    typeof data === "object"
  ) {

    const directKeys = [
      "frames",
      "times",
      "timestamps",
      "images",
      "data",
      "items"
    ];

    for (
      const key of directKeys
    ) {

      const value =
        data[key];

      if (
        Array.isArray(value) &&
        value.length
      ) {

        result =
          value
            .map(itemToTimestamp)
            .filter(Boolean);

        if (
          result.length
        ) {
          break;
        }
      }
    }

    /* -----------------------------------------------------
       Один timestamp
       ----------------------------------------------------- */

    if (
      !result.length
    ) {

      const single =
        itemToTimestamp(data);

      if (single) {
        result = [single];
      }
    }
  }

  /* -------------------------------------------------------
     UNIQUE
     ------------------------------------------------------- */

  result =
    [
      ...new Set(result)
    ];

  return result;
}

/* =========================================================
   SOURCE TILE URL
   ========================================================= */

function sourceTileUrl(
  timestamp,
  z,
  x,
  y
) {

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
   COLORIZE
   ========================================================= */

async function colorize(buffer) {

  const image =
    sharp(
      buffer,
      {
        failOn: "none"
      }
    );

  const {
    data,
    info
  } =
    await image
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject:
          true
      });

  const pixelCount =
    info.width *
    info.height;

  const out =
    Buffer.allocUnsafe(
      pixelCount * 4
    );

  let p = 0;

  for (
    let i = 0;
    i < data.length;
    i += 4
  ) {

    const r =
      data[i];

    const g =
      data[i + 1];

    const b =
      data[i + 2];

    /*
      Исходный RainRadar raster —
      grayscale.

      Берём максимальный канал,
      чтобы случайный небольшой
      цветовой шум не занижал значение.
    */

    const gray =
      Math.max(
        r,
        g,
        b
      );

    const level =
      LUT[gray];

    /* -----------------------------------------------------
       TRANSPARENT BACKGROUND
       ----------------------------------------------------- */

    if (
      level < 0
    ) {

      out[p++] = 0;
      out[p++] = 0;
      out[p++] = 0;
      out[p++] = 0;

      continue;
    }

    /* -----------------------------------------------------
       PALETTE
       ----------------------------------------------------- */

    const color =
      PALETTE_RGB[level];

    out[p++] =
      color[0];

    out[p++] =
      color[1];

    out[p++] =
      color[2];

    out[p++] =
      255;
  }

  /* -------------------------------------------------------
     ВАЖНО:

     width / height исходного PNG
     остаются абсолютно такими же.

     resize НЕТ.
     blur НЕТ.
     interpolation НЕТ.
     ------------------------------------------------------- */

  return (
    sharp(
      out,
      {
        raw: {
          width:
            info.width,

          height:
            info.height,

          channels:
            4
        }
      }
    )
      .png({
        compressionLevel: 6,

        adaptiveFiltering:
          false
      })
      .toBuffer()
  );
}

/* =========================================================
   CACHE
   ========================================================= */

function getCached(
  key
) {

  const item =
    cache.get(key);

  if (!item) {
    return null;
  }

  /*
    Небольшой TTL.
  */

  if (
    Date.now() -
      item.time >
    30 * 1000
  ) {

    cache.delete(key);

    return null;
  }

  return item.buffer;
}

function setCached(
  key,
  buffer
) {

  cache.set(
    key,
    {
      buffer,
      time: Date.now()
    }
  );

  /*
    Не даём памяти
    бесконечно расти.
  */

  while (
    cache.size > 200
  ) {

    const first =
      cache.keys()
        .next()
        .value;

    cache.delete(first);
  }
}

/* =========================================================
   HANDLER
   ========================================================= */

module.exports =
async function handler(
  req,
  res
) {

  try {

    const query =
      req.query || {};

    const manifest =
      query.manifest;

    const timestamp =
      query.timestamp;

    const z =
      query.z;

    const x =
      query.x;

    const y =
      query.y;

    /* =====================================================
       MANIFEST REQUEST
       ===================================================== */

    if (
      manifest === "1"
    ) {

      const data =
        await getManifest();

      const timestamps =
        normalizeManifest(data);

      /*
        Возвращаем исходный manifest,
        чтобы существующий rainradar.js
        продолжал работать.
      */

      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );

      res.setHeader(
        "Cache-Control",
        "public, s-maxage=30, stale-while-revalidate=60"
      );

      /*
        Диагностический header.
        Можно увидеть, что manifest
        действительно дошёл.
      */

      res.setHeader(
        "X-CLOrad-RainRadar-Frames",
        String(
          timestamps.length
        )
      );

      res.status(200)
        .send(
          JSON.stringify(data)
        );

      return;
    }

    /* =====================================================
       TILE REQUEST
       ===================================================== */

    if (
      !timestamp ||
      z == null ||
      x == null ||
      y == null
    ) {

      res.status(400)
        .json({
          error:
            "Missing timestamp/z/x/y"
        });

      return;
    }

    const Z =
      Number(z);

    const X =
      Number(x);

    const Y =
      Number(y);

    /* =====================================================
       COORDINATE VALIDATION
       ===================================================== */

    if (
      !Number.isInteger(Z) ||
      !Number.isInteger(X) ||
      !Number.isInteger(Y) ||
      Z < 0 ||
      X < 0 ||
      Y < 0
    ) {

      res.status(400)
        .json({
          error:
            "Invalid tile coordinates"
        });

      return;
    }

    /* =====================================================
       CACHE KEY
       ===================================================== */

    const key =
      [
        timestamp,
        Z,
        X,
        Y
      ].join("/");

    const cached =
      getCached(key);

    if (cached) {

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
        "cache"
      );

      res.status(200)
        .send(cached);

      return;
    }

    /* =====================================================
       SOURCE URL
       ===================================================== */

    const url =
      sourceTileUrl(
        timestamp,
        Z,
        X,
        Y
      );

    /* =====================================================
       SOURCE REQUEST
       ===================================================== */

    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {
            "User-Agent":
              "Mozilla/5.0 CLOrad/1.0",

            "Accept":
              "image/png,image/*,*/*"
          },

          cache: "no-store"
        }
      );

    /* =====================================================
       SOURCE ERROR
       ===================================================== */

    if (
      !response.ok
    ) {

      res.status(
        response.status
      )
        .json({
          error:
            `RainRadar source tile HTTP ${response.status}`,

          url
        });

      return;
    }

    /* =====================================================
       SOURCE BUFFER
       ===================================================== */

    const source =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (
      !source.length
    ) {

      throw new Error(
        "RainRadar source tile is empty"
      );
    }

    /* =====================================================
       COLORIZE
       ===================================================== */

    const output =
      await colorize(
        source
      );

    /* =====================================================
       SAVE MEMORY CACHE
       ===================================================== */

    setCached(
      key,
      output
    );

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

    res.status(200)
      .send(output);

  } catch (error) {

    console.error(
      "CLOrad RainRadar ERROR:",
      error
    );

    res.status(500)
      .json({
        error:
          "RainRadar processing failed",

        message:
          String(
            error?.message ||
            error
          )
      });
  }
};
