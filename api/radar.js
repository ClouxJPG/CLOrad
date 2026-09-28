/* =========================================================
   CLOrad — RainRadar API
   ---------------------------------------------------------
   GET /api/rainradar?manifest=1

   GET /api/rainradar
     ?timestamp=...
     &z=...
     &x=...
     &y=...

   Источник:
   https://rainradar.ru/composite/

   Сервер:
   1. получает manifest
   2. отдаёт нормализованный список кадров
   3. получает исходный grayscale PNG
   4. перекрашивает его в RGMC ОЯ
   5. чёрный/no-data делает прозрачным

   index.html НЕ требуется менять.
   ========================================================= */

const sharp =
  require("sharp");

/* =========================================================
   CONFIG
   ========================================================= */

const MANIFEST_URL =
  "https://rainradar.ru/composite/manifest.json";

const TILE_BASE =
  "https://rainradar.ru/composite";

const FETCH_TIMEOUT =
  15000;

const MAX_CACHE =
  250;

/* =========================================================
   RGMC ОЯ PALETTE
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
   HEX -> RGB
   ========================================================= */

const PALETTE_RGB =
  RGMC_OY_PALETTE.map(
    hex => {

      const value =
        hex.replace(
          "#",
          ""
        );

      return [

        parseInt(
          value.slice(0, 2),
          16
        ),

        parseInt(
          value.slice(2, 4),
          16
        ),

        parseInt(
          value.slice(4, 6),
          16
        )

      ];

    }
  );

/* =========================================================
   CACHE
   ========================================================= */

const tileCache =
  new Map();

function cacheGet(key) {

  if (
    !tileCache.has(key)
  ) {
    return null;
  }

  const value =
    tileCache.get(key);

  /*
   * LRU:
   * переносим элемент
   * в конец Map.
   */

  tileCache.delete(key);
  tileCache.set(key, value);

  return value;
}

function cacheSet(
  key,
  value
) {

  if (
    tileCache.has(key)
  ) {
    tileCache.delete(key);
  }

  tileCache.set(
    key,
    value
  );

  while (
    tileCache.size >
    MAX_CACHE
  ) {

    const first =
      tileCache.keys().next().value;

    tileCache.delete(
      first
    );

  }
}

/* =========================================================
   FETCH WITH TIMEOUT
   ========================================================= */

async function fetchWithTimeout(
  url,
  options = {},
  timeout = FETCH_TIMEOUT
) {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeout
    );

  try {

    return await fetch(
      url,
      {
        ...options,
        signal:
          controller.signal
      }
    );

  } finally {

    clearTimeout(timer);

  }
}

/* =========================================================
   MANIFEST VALUE EXTRACTION
   ========================================================= */

function addTimestamp(
  output,
  value
) {

  if (
    typeof value ===
      "string" ||
    typeof value ===
      "number"
  ) {

    const text =
      String(value).trim();

    if (text) {
      output.push(text);
    }

    return;
  }

  if (
    value &&
    typeof value ===
      "object"
  ) {

    const timestamp =
      value.timestamp ??
      value.time ??
      value.ts ??
      value.datetime ??
      value.date ??
      value.id;

    if (
      typeof timestamp ===
        "string" ||
      typeof timestamp ===
        "number"
    ) {

      const text =
        String(timestamp).trim();

      if (text) {
        output.push(text);
      }

    }

  }
}

/* =========================================================
   MANIFEST NORMALIZER
   ========================================================= */

function normalizeManifest(
  data
) {

  const result =
    [];

  if (
    Array.isArray(data)
  ) {

    data.forEach(
      value =>
        addTimestamp(
          result,
          value
        )
    );

  } else if (
    data &&
    typeof data ===
      "object"
  ) {

    /*
     * Основные возможные
     * варианты manifest.
     */

    const arrays = [

      data.frames,
      data.times,
      data.timestamps,
      data.images,
      data.items,
      data.data

    ];

    for (
      const array of arrays
    ) {

      if (
        Array.isArray(array)
      ) {

        array.forEach(
          value =>
            addTimestamp(
              result,
              value
            )
        );

      }

    }

    addTimestamp(
      result,
      data.timestamp
    );

    addTimestamp(
      result,
      data.time
    );

    addTimestamp(
      result,
      data.latest
    );

    addTimestamp(
      result,
      data.current
    );

  }

  const unique =
    [
      ...new Set(
        result
      )
    ];

  /*
   * Если timestamps числовые —
   * сортируем по времени.
   */

  const numeric =
    unique.every(
      value =>
        /^\d+$/.test(
          String(value)
        )
    );

  if (numeric) {

    unique.sort(
      (a, b) =>
        Number(a) -
        Number(b)
    );

  }

  return unique;
}

/* =========================================================
   MANIFEST REQUEST
   ========================================================= */

async function getManifest() {

  const response =
    await fetchWithTimeout(
      MANIFEST_URL,
      {
        headers: {
          "Accept":
            "application/json,*/*"
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

  const frames =
    normalizeManifest(
      data
    );

  if (!frames.length) {

    throw new Error(
      "RainRadar manifest пуст"
    );

  }

  return {
    frames,
    latest:
      frames[
        frames.length - 1
      ]
  };
}

/* =========================================================
   GRAYSCALE -> RGMC ОЯ LEVEL
   =========================================================

   Важно:
   исходный RainRadar PNG содержит
   преимущественно низкие grayscale
   значения.

   Поэтому не используем тупое
   равномерное деление 0..255.

   Сильные значения распределены
   по верхним уровням отдельно.
   ========================================================= */

function grayToLevel(
  value
) {

  /*
   * Чёрный / почти чёрный —
   * отсутствие данных.
   */

  if (
    value <= 4
  ) {
    return -1;
  }

  if (
    value <= 7
  ) {
    return 0;
  }

  if (
    value <= 10
  ) {
    return 1;
  }

  if (
    value <= 13
  ) {
    return 2;
  }

  if (
    value <= 16
  ) {
    return 3;
  }

  if (
    value <= 20
  ) {
    return 4;
  }

  if (
    value <= 24
  ) {
    return 5;
  }

  if (
    value <= 29
  ) {
    return 6;
  }

  if (
    value <= 35
  ) {
    return 7;
  }

  if (
    value <= 43
  ) {
    return 8;
  }

  if (
    value <= 53
  ) {
    return 9;
  }

  if (
    value <= 66
  ) {
    return 10;
  }

  if (
    value <= 82
  ) {
    return 11;
  }

  if (
    value <= 101
  ) {
    return 12;
  }

  if (
    value <= 122
  ) {
    return 13;
  }

  if (
    value <= 143
  ) {
    return 14;
  }

  if (
    value <= 158
  ) {
    return 15;
  }

  if (
    value <= 171
  ) {
    return 16;
  }

  if (
    value <= 185
  ) {
    return 17;
  }

  return 18;
}

/* =========================================================
   LUT
   ========================================================= */

const LUT =
  new Int16Array(
    256
  );

for (
  let i = 0;
  i < 256;
  i++
) {

  LUT[i] =
    grayToLevel(i);

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
    "/" +
    encodeURIComponent(
      timestamp
    ) +
    "/" +
    encodeURIComponent(
      z
    ) +
    "/" +
    encodeURIComponent(
      x
    ) +
    "_" +
    encodeURIComponent(
      y
    ) +
    ".png"
  );

}

/* =========================================================
   TILE PARAMETER VALIDATION
   ========================================================= */

function validInteger(
  value,
  min,
  max
) {

  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return false;
  }

  const n =
    Number(value);

  return (
    Number.isInteger(n) &&
    n >= min &&
    n <= max
  );

}

/* =========================================================
   COLORIZE TILE
   ========================================================= */

async function colorizeTile(
  buffer
) {

  const image =
    sharp(
      buffer,
      {
        failOn:
          "none"
      }
    )
    .ensureAlpha()
    .raw();

  const {
    data,
    info
  } =
    await image.toBuffer(
      {
        resolveWithObject:
          true
      }
    );

  const output =
    Buffer.allocUnsafe(
      info.width *
      info.height *
      4
    );

  let sourceIndex =
    0;

  let outputIndex =
    0;

  while (
    sourceIndex <
    data.length
  ) {

    const r =
      data[
        sourceIndex
      ];

    const g =
      data[
        sourceIndex + 1
      ];

    const b =
      data[
        sourceIndex + 2
      ];

    const sourceAlpha =
      data[
        sourceIndex + 3
      ];

    /*
     * RainRadar source is grayscale.
     *
     * Берём максимальный канал,
     * чтобы не потерять яркость.
     */

    const gray =
      Math.max(
        r,
        g,
        b
      );

    const level =
      LUT[gray];

    if (
      level < 0 ||
      sourceAlpha === 0
    ) {

      output[
        outputIndex
      ] = 0;

      output[
        outputIndex + 1
      ] = 0;

      output[
        outputIndex + 2
      ] = 0;

      output[
        outputIndex + 3
      ] = 0;

    } else {

      const rgb =
        PALETTE_RGB[
          level
        ];

      output[
        outputIndex
      ] =
        rgb[0];

      output[
        outputIndex + 1
      ] =
        rgb[1];

      output[
        outputIndex + 2
      ] =
        rgb[2];

      output[
        outputIndex + 3
      ] =
        255;

    }

    sourceIndex += 4;
    outputIndex += 4;

  }

  return sharp(
    output,
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
      compressionLevel:
        6,

      adaptiveFiltering:
        false
    })
    .toBuffer();

}

/* =========================================================
   TILE REQUEST
   ========================================================= */

async function getTile(
  timestamp,
  z,
  x,
  y
) {

  const cacheKey =
    [
      timestamp,
      z,
      x,
      y
    ].join("/");

  const cached =
    cacheGet(
      cacheKey
    );

  if (cached) {
    return cached;
  }

  const url =
    sourceTileUrl(
      timestamp,
      z,
      x,
      y
    );

  const response =
    await fetchWithTimeout(
      url,
      {
        headers: {
          "Accept":
            "image/png,image/*,*/*"
        },
        cache:
          "no-store"
      }
    );

  if (!response.ok) {

    throw new Error(
      "RainRadar tile HTTP " +
      response.status
    );

  }

  const source =
    Buffer.from(
      await response.arrayBuffer()
    );

  if (
    !source.length
  ) {

    throw new Error(
      "RainRadar tile пуст"
    );

  }

  const output =
    await colorizeTile(
      source
    );

  cacheSet(
    cacheKey,
    output
  );

  return output;
}

/* =========================================================
   ERROR JSON
   ========================================================= */

function jsonError(
  res,
  status,
  message
) {

  res
    .status(status)
    .setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    )
    .setHeader(
      "Cache-Control",
      "no-store"
    )
    .json({
      ok: false,
      error:
        message
    });

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

      /* ===================================================
         MANIFEST
         =================================================== */

      if (
        req.query &&
        (
          req.query.manifest === "1" ||
          req.query.manifest === "true"
        )
      ) {

        const manifest =
          await getManifest();

        res
          .status(200)
          .setHeader(
            "Content-Type",
            "application/json; charset=utf-8"
          )
          .setHeader(
            "Cache-Control",
            "no-store, max-age=0"
          )
          .json({
            ok: true,
            frames:
              manifest.frames,
            latest:
              manifest.latest
          });

        return;
      }

      /* ===================================================
         TILE PARAMETERS
         =================================================== */

      const timestamp =
        req.query &&
        req.query.timestamp;

      const z =
        req.query &&
        req.query.z;

      const x =
        req.query &&
        req.query.x;

      const y =
        req.query &&
        req.query.y;

      if (
        !timestamp ||
        !validInteger(
          z,
          0,
          22
        ) ||
        !validInteger(
          x,
          0,
          1000000
        ) ||
        !validInteger(
          y,
          0,
          1000000
        )
      ) {

        jsonError(
          res,
          400,
          "Неверные параметры RainRadar"
        );

        return;
      }

      const image =
        await getTile(
          String(timestamp),
          Number(z),
          Number(x),
          Number(y)
        );

      res
        .status(200)
        .setHeader(
          "Content-Type",
          "image/png"
        )
        .setHeader(
          "Cache-Control",
          "public, max-age=30, s-maxage=60, stale-while-revalidate=120"
        )
        .setHeader(
          "X-CLOrad-RainRadar",
          "1"
        )
        .end(image);

    } catch (error) {

      console.error(
        "CLOrad RainRadar API:",
        error
      );

      const message =
        error &&
        error.name ===
          "AbortError"
          ? "RainRadar: превышено время ожидания"
          : (
              error &&
              error.message
                ? error.message
                : "Неизвестная ошибка RainRadar"
            );

      /*
       * Если запрос был за PNG —
       * всё равно возвращаем JSON,
       * чтобы ошибка была видна.
       */

      jsonError(
        res,
        502,
        message
      );

    }

  };
