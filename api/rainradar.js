/* =========================================================
   CLOrad — RainRadar API

   Режимы:

   1. Manifest:
      /api/rainradar?manifest=1

   2. Tile:
      /api/rainradar
        ?timestamp=...
        &z=...
        &x=...
        &y=...

   RainRadar grayscale PNG
   →
   РГМЦ palette PNG

   Чёрный фон → прозрачность
   ========================================================= */

import sharp from "sharp";

/* =======================================================
   SOURCE
   ======================================================= */

const RR_ROOT =
  "https://rainradar.ru/composite/";

const RR_MANIFEST =
  RR_ROOT + "manifest.json";

/* =======================================================
   РГМЦ PALETTE
   ======================================================= */

const RGMC_PALETTE = [
  [185, 193, 199], // #b9c1c7
  [169, 199, 244], // #a9c7f4
  [99, 237, 165],  // #63eda5
  [67, 207, 137],  // #43cf89
  [77, 184, 78],   // #4db84e
  [255, 248, 156], // #fff89c
  [117, 166, 239], // #75a6ef
  [82, 121, 237],  // #5279ed
  [80, 74, 155],   // #504a9b
  [255, 192, 168], // #ffc0a8
  [250, 130, 160], // #fa82a0
  [255, 77, 77],   // #ff4d4d
  [219, 146, 72],  // #db9248
  [173, 117, 68],  // #ad7544
  [146, 75, 72],   // #924b48
  [242, 170, 240], // #f2aaf0
  [232, 90, 231],  // #e85ae7
  [202, 60, 199],  // #ca3cc7
  [119, 124, 145]  // #777c91
];

/* =======================================================
   GRAYSCALE
   ======================================================= */

const TRANSPARENT_MAX = 4;
const RADAR_MIN = 5;
const RADAR_MAX = 180;

/* =======================================================
   TILE CACHE
   ======================================================= */

const TILE_CACHE = new Map();
const TILE_CACHE_LIMIT = 250;

/* =======================================================
   MANIFEST CACHE
   ======================================================= */

let manifestCache = null;
let manifestCacheTime = 0;

const MANIFEST_CACHE_MS =
  30000;

/* =======================================================
   SOURCE TILE
   ======================================================= */

function sourceTileUrl(
  timestamp,
  z,
  x,
  y
) {
  return (
    RR_ROOT +
    timestamp +
    "/" +
    z +
    "/" +
    x +
    "_" +
    y +
    ".png"
  );
}

/* =======================================================
   INTEGER
   ======================================================= */

function isInteger(value) {
  return Number.isInteger(
    Number(value)
  );
}

/* =======================================================
   TILE VALIDATION
   ======================================================= */

function validTileCoordinate(
  z,
  x,
  y
) {
  if (
    !isInteger(z) ||
    !isInteger(x) ||
    !isInteger(y)
  ) {
    return false;
  }

  z = Number(z);
  x = Number(x);
  y = Number(y);

  if (
    z < 0 ||
    z > 20
  ) {
    return false;
  }

  const max =
    Math.pow(
      2,
      z
    );

  return (
    x >= 0 &&
    x < max &&
    y >= 0 &&
    y < max
  );
}

/* =======================================================
   GRAY → PALETTE
   ======================================================= */

function grayToPaletteIndex(
  gray
) {
  if (
    gray <=
    TRANSPARENT_MAX
  ) {
    return -1;
  }

  const normalized =
    (
      gray -
      RADAR_MIN
    ) /
    (
      RADAR_MAX -
      RADAR_MIN
    );

  const value =
    Math.max(
      0,
      Math.min(
        1,
        normalized
      )
    );

  const index =
    Math.floor(
      value *
      RGMC_PALETTE.length
    );

  return Math.min(
    RGMC_PALETTE.length - 1,
    index
  );
}

/* =======================================================
   COLORIZE TILE
   ======================================================= */

async function processTile(
  sourceBuffer
) {
  const decoded =
    await sharp(
      sourceBuffer
    )
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject:
          true
      });

  const width =
    decoded.info.width;

  const height =
    decoded.info.height;

  const source =
    decoded.data;

  const output =
    Buffer.alloc(
      width *
      height *
      4
    );

  for (
    let i = 0;
    i < source.length;
    i += 4
  ) {
    const r =
      source[i];

    const g =
      source[i + 1];

    const b =
      source[i + 2];

    const alpha =
      source[i + 3];

    const gray =
      Math.round(
        (
          r +
          g +
          b
        ) / 3
      );

    const paletteIndex =
      grayToPaletteIndex(
        gray
      );

    if (
      paletteIndex < 0 ||
      alpha === 0
    ) {
      output[i] = 0;
      output[i + 1] = 0;
      output[i + 2] = 0;
      output[i + 3] = 0;

      continue;
    }

    const color =
      RGMC_PALETTE[
        paletteIndex
      ];

    output[i] =
      color[0];

    output[i + 1] =
      color[1];

    output[i + 2] =
      color[2];

    output[i + 3] =
      alpha;
  }

  return sharp(
    output,
    {
      raw: {
        width,
        height,
        channels: 4
      }
    }
  )
    .png({
      compressionLevel: 3,
      adaptiveFiltering: false,
      palette: false
    })
    .toBuffer();
}

/* =======================================================
   FETCH SOURCE TILE
   ======================================================= */

async function getSourceTile(
  timestamp,
  z,
  x,
  y
) {
  const url =
    sourceTileUrl(
      timestamp,
      z,
      x,
      y
    );

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "User-Agent":
            "Mozilla/5.0",
          "Accept":
            "image/png,image/*,*/*",
          "Referer":
            "https://rainradar.ru/"
        },

        cache:
          "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      "RainRadar source HTTP " +
      response.status
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(
      arrayBuffer
    );

  if (!buffer.length) {
    throw new Error(
      "RainRadar вернул пустой PNG"
    );
  }

  return buffer;
}

/* =======================================================
   FETCH MANIFEST
   ======================================================= */

async function getManifest() {
  const now =
    Date.now();

  if (
    manifestCache &&
    now -
      manifestCacheTime <
      MANIFEST_CACHE_MS
  ) {
    return manifestCache;
  }

  const response =
    await fetch(
      RR_MANIFEST,
      {
        method: "GET",

        headers: {
          "User-Agent":
            "Mozilla/5.0",
          "Accept":
            "application/json,*/*",
          "Referer":
            "https://rainradar.ru/"
        },

        cache:
          "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      "RainRadar manifest HTTP " +
      response.status
    );
  }

  const data =
    await response.json();

  if (
    !Array.isArray(data)
  ) {
    throw new Error(
      "RainRadar manifest имеет неверный формат"
    );
  }

  manifestCache =
    data;

  manifestCacheTime =
    now;

  return data;
}

/* =======================================================
   NORMALIZE MANIFEST
   ======================================================= */

function normalizeManifest(
  data
) {
  const frames = [];

  for (
    const item of data
  ) {
    if (
      !Array.isArray(item) ||
      item.length < 2
    ) {
      continue;
    }

    const timestamp =
      Number(
        item[0]
      );

    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      continue;
    }

    frames.push({
      timestamp
    });
  }

  frames.sort(
    (a, b) =>
      a.timestamp -
      b.timestamp
  );

  return frames;
}

/* =======================================================
   CACHE
   ======================================================= */

function getCached(
  key
) {
  const value =
    TILE_CACHE.get(
      key
    );

  if (!value) {
    return null;
  }

  TILE_CACHE.delete(
    key
  );

  TILE_CACHE.set(
    key,
    value
  );

  return value;
}

function setCached(
  key,
  value
) {
  if (
    TILE_CACHE.has(key)
  ) {
    TILE_CACHE.delete(
      key
    );
  }

  TILE_CACHE.set(
    key,
    value
  );

  while (
    TILE_CACHE.size >
    TILE_CACHE_LIMIT
  ) {
    const first =
      TILE_CACHE
        .keys()
        .next()
        .value;

    if (
      first === undefined
    ) {
      break;
    }

    TILE_CACHE.delete(
      first
    );
  }
}

/* =======================================================
   IMAGE HEADERS
   ======================================================= */

function setImageHeaders(
  res
) {
  res.setHeader(
    "Content-Type",
    "image/png"
  );

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=900"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );
}

/* =======================================================
   JSON HEADERS
   ======================================================= */

function setJsonHeaders(
  res
) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "public, max-age=20, s-maxage=30, stale-while-revalidate=60"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );
}

/* =======================================================
   HANDLER
   ======================================================= */

export default async function handler(
  req,
  res
) {
  try {

    /* ===================================================
       MANIFEST
       =================================================== */

    if (
      String(
        req.query?.manifest
      ) === "1"
    ) {
      const data =
        await getManifest();

      const frames =
        normalizeManifest(
          data
        );

      setJsonHeaders(
        res
      );

      return res
        .status(200)
        .json({
          frames
        });
    }

    /* ===================================================
       TILE
       =================================================== */

    const timestamp =
      Number(
        req.query?.timestamp
      );

    const z =
      Number(
        req.query?.z
      );

    const x =
      Number(
        req.query?.x
      );

    const y =
      Number(
        req.query?.y
      );

    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid timestamp"
        });
    }

    if (
      !validTileCoordinate(
        z,
        x,
        y
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid tile coordinates"
        });
    }

    const cacheKey =
      [
        timestamp,
        z,
        x,
        y
      ].join("/");

    const cached =
      getCached(
        cacheKey
      );

    if (cached) {
      setImageHeaders(
        res
      );

      res.setHeader(
        "Content-Length",
        String(
          cached.length
        )
      );

      return res
        .status(200)
        .send(cached);
    }

    const source =
      await getSourceTile(
        timestamp,
        z,
        x,
        y
      );

    const output =
      await processTile(
        source
      );

    setCached(
      cacheKey,
      output
    );

    setImageHeaders(
      res
    );

    res.setHeader(
      "Content-Length",
      String(
        output.length
      )
    );

    return res
      .status(200)
      .send(output);

  } catch (error) {

    console.error(
      "CLOrad RainRadar API:",
      error
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res
      .status(500)
      .json({
        error:
          "RainRadar processing failed",

        message:
          error?.message ||
          String(error)
      });
  }
}
