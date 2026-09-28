/* =========================================================
   CLOrad — RainRadar API
   grayscale RainRadar PNG → РГМЦ PNG

   Вход:
   /api/rainradar
     ?timestamp=...
     &z=...
     &x=...
     &y=...

   Выход:
   готовый PNG-тайл с палитрой РГМЦ

   Чёрный фон:
   полностью прозрачный

   ========================================================= */

import sharp from "sharp";

/* =======================================================
   SOURCE
   ======================================================= */

const RR_ROOT =
  "https://rainradar.ru/composite/";

/* =======================================================
   РГМЦ
   ТА ЖЕ ПАЛИТРА, ЧТО У ДМРЛ
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
   GRAYSCALE CALIBRATION
   =======================================================

   RainRadar PNG содержит градации серого.

   0–4:
     фон → прозрачность

   5–180:
     радарный диапазон

   >180:
     максимум РГМЦ

   Это фиксированная шкала:
   один и тот же оттенок RainRadar всегда означает
   один и тот же цвет РГМЦ.
   ======================================================= */

const TRANSPARENT_MAX =
  4;

const RADAR_MIN =
  5;

const RADAR_MAX =
  180;

/* =======================================================
   CACHE
   ======================================================= */

const TILE_CACHE =
  new Map();

const TILE_CACHE_LIMIT =
  250;

/* =======================================================
   TILE URL
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
   NUMBER VALIDATION
   ======================================================= */

function isInteger(value) {
  return (
    Number.isInteger(
      Number(value)
    )
  );
}

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

  if (
    x < 0 ||
    x >= max ||
    y < 0 ||
    y >= max
  ) {
    return false;
  }

  return true;
}

/* =======================================================
   GRAY → РГМЦ
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
   PROCESS TILE
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

    const sourceAlpha =
      source[i + 3];

    /*
     * RainRadar сейчас отдаёт
     * grayscale, поэтому берём
     * среднюю яркость.
     */

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

    const out =
      i;

    /*
     * ЧЁРНЫЙ ФОН
     * → полностью прозрачный.
     */

    if (
      paletteIndex < 0 ||
      sourceAlpha === 0
    ) {
      output[out] =
        0;

      output[out + 1] =
        0;

      output[out + 2] =
        0;

      output[out + 3] =
        0;

      continue;
    }

    const color =
      RGMC_PALETTE[
        paletteIndex
      ];

    output[out] =
      color[0];

    output[out + 1] =
      color[1];

    output[out + 2] =
      color[2];

    output[out + 3] =
      sourceAlpha;
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
   FETCH SOURCE
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
   CACHE TILE
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

  /*
   * LRU:
   * недавно использованный
   * переносим в конец.
   */

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
   HEADERS
   ======================================================= */

function setHeaders(
  res
) {
  /*
   * CDN может хранить готовый
   * перекрашенный тайл.
   *
   * Поэтому при повторном просмотре
   * одного и того же кадра Vercel
   * не обязан каждый раз запускать
   * Sharp.
   */

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=900"
  );

  res.setHeader(
    "Content-Type",
    "image/png"
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

    /* ---------------------------------------------------
       VALIDATION
       --------------------------------------------------- */

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

    /* ---------------------------------------------------
       CACHE KEY
       --------------------------------------------------- */

    const cacheKey =
      [
        timestamp,
        z,
        x,
        y
      ].join("/");

    /* ---------------------------------------------------
       MEMORY CACHE
       --------------------------------------------------- */

    const cached =
      getCached(
        cacheKey
      );

    if (cached) {
      setHeaders(res);

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

    /* ---------------------------------------------------
       SOURCE
       --------------------------------------------------- */

    const source =
      await getSourceTile(
        timestamp,
        z,
        x,
        y
      );

    /* ---------------------------------------------------
       COLORIZE
       --------------------------------------------------- */

    const output =
      await processTile(
        source
      );

    /* ---------------------------------------------------
       CACHE
       --------------------------------------------------- */

    setCached(
      cacheKey,
      output
    );

    /* ---------------------------------------------------
       RESPONSE
       --------------------------------------------------- */

    setHeaders(res);

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
