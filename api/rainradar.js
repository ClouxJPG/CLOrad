/* =========================================================
   CLOrad — RainRadar Russia Composite API
   Источник:
   https://rainradar.ru/composite/

   Автоматическое получение актуального timestamp.
   manifest.json — только дополнительный источник.
   Тайлы:
   /composite/{timestamp}/{z}/{x}_{y}.png
   ========================================================= */

const sharp = require("sharp");

/* =========================================================
   CONFIG
   ========================================================= */

const MANIFEST_URL =
  "https://rainradar.ru/composite/manifest.json";

const COMPOSITE_URL =
  "https://rainradar.ru/composite/";

const CACHE_TIME = 30 * 1000;

/*
 * RainRadar использует 10-минутные timestamps.
 */
const TIMESTAMP_STEP = 600;

/*
 * Для автоматического поиска проверяем только
 * последние 12 возможных кадров.
 *
 * Это максимум 12 запросов вместо 37+ последовательных.
 */
const SEARCH_STEPS = 12;

const REQUEST_TIMEOUT = 3500;

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CLOrad/1.0";

/* =========================================================
   RGMC ОЯ
   НЕ ИЗМЕНЯТЬ
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
   CACHE
   ========================================================= */

let manifestCache = null;
let manifestCacheTime = 0;

let latestTimestampCache = null;
let latestTimestampCacheTime = 0;

const tileCache = new Map();

/* =========================================================
   SAFE FETCH
   ========================================================= */

async function fetchWithTimeout(
  url,
  options = {},
  timeout = REQUEST_TIMEOUT
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   FETCH TEXT
   ========================================================= */

async function fetchText(url) {
  const response =
    await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept":
            "text/html,application/json,text/plain,*/*"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  return await response.text();
}

/* =========================================================
   FETCH JSON
   ========================================================= */

async function fetchJSON(url) {
  const response =
    await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept":
            "application/json,text/plain,*/*"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  const text =
    await response.text();

  if (!text) {
    throw new Error(
      "Пустой ответ"
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Ответ не является JSON"
    );
  }
}

/* =========================================================
   FETCH IMAGE
   ========================================================= */

async function fetchBuffer(url) {
  const response =
    await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept":
            "image/png,image/*,*/*"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  return Buffer.from(
    arrayBuffer
  );
}

/* =========================================================
   TIMESTAMP
   ========================================================= */

function normalizeTimestamp(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    if (
      value >= 1000000000 &&
      value <= 3000000000
    ) {
      return Math.floor(value);
    }

    return null;
  }

  const text =
    String(value).trim();

  /*
   * Unix timestamp.
   */
  if (
    /^\d{9,12}$/.test(text)
  ) {
    const number =
      Number(text);

    if (
      Number.isFinite(number) &&
      number >= 1000000000 &&
      number <= 3000000000
    ) {
      return Math.floor(number);
    }
  }

  /*
   * ISO / date.
   */
  const parsed =
    Date.parse(text);

  if (
    !Number.isNaN(parsed)
  ) {
    return Math.floor(
      parsed / 1000
    );
  }

  return null;
}

/* =========================================================
   EXTRACT TIMESTAMPS
   ========================================================= */

function extractTimestamps(text) {
  const result =
    new Set();

  if (!text) {
    return [];
  }

  /*
   * Основной формат:
   *
   * /composite/1790614800/
   */

  const regex =
    /\/composite\/(\d{9,12})\//g;

  let match;

  while (
    (match = regex.exec(text)) !== null
  ) {
    const timestamp =
      normalizeTimestamp(
        match[1]
      );

    if (timestamp) {
      result.add(timestamp);
    }
  }

  /*
   * Дополнительный поиск timestamp.
   */

  const loose =
    /\b(\d{10})\b/g;

  while (
    (match = loose.exec(text)) !== null
  ) {
    const timestamp =
      normalizeTimestamp(
        match[1]
      );

    if (timestamp) {
      result.add(timestamp);
    }
  }

  return Array.from(
    result
  ).sort(
    (a, b) => a - b
  );
}

/* =========================================================
   MANIFEST
   ========================================================= */

function extractManifestTimestamps(data) {
  const result =
    new Set();

  function walk(
    value,
    depth = 0
  ) {
    if (
      depth > 8 ||
      value === null ||
      value === undefined
    ) {
      return;
    }

    if (
      typeof value === "string" ||
      typeof value === "number"
    ) {
      const timestamp =
        normalizeTimestamp(
          value
        );

      if (timestamp) {
        result.add(timestamp);
      }

      return;
    }

    if (
      Array.isArray(value)
    ) {
      for (
        const item of value
      ) {
        walk(
          item,
          depth + 1
        );
      }

      return;
    }

    if (
      typeof value === "object"
    ) {
      for (
        const key of Object.keys(value)
      ) {
        walk(
          key,
          depth + 1
        );

        walk(
          value[key],
          depth + 1
        );
      }
    }
  }

  walk(data);

  return Array.from(
    result
  ).sort(
    (a, b) => a - b
  );
}

/* =========================================================
   GET MANIFEST
   ========================================================= */

async function getFromManifest() {
  const now =
    Date.now();

  if (
    manifestCache &&
    now - manifestCacheTime <
      CACHE_TIME
  ) {
    return manifestCache;
  }

  const data =
    await fetchJSON(
      MANIFEST_URL
    );

  const timestamps =
    extractManifestTimestamps(
      data
    );

  if (
    !timestamps.length
  ) {
    throw new Error(
      "В manifest нет timestamp"
    );
  }

  manifestCache =
    timestamps;

  manifestCacheTime =
    now;

  return timestamps;
}

/* =========================================================
   GET COMPOSITE DIRECTORY
   ========================================================= */

async function getFromDirectory() {
  const text =
    await fetchText(
      COMPOSITE_URL
    );

  const timestamps =
    extractTimestamps(
      text
    );

  if (
    !timestamps.length
  ) {
    throw new Error(
      "В /composite/ нет списка timestamp"
    );
  }

  return timestamps;
}

/* =========================================================
   MAKE SOURCE TILE URL
   ========================================================= */

function makeSourceTileUrl(
  timestamp,
  z = 5,
  x = 19,
  y = 9
) {
  return (
    COMPOSITE_URL +
    encodeURIComponent(
      timestamp
    ) +
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
   CHECK TIMESTAMP
   ========================================================= */

/*
 * Не используем HEAD:
 * некоторые серверы нормально отдают PNG,
 * но некорректно обрабатывают HEAD.
 *
 * Делаем обычный GET.
 */

async function checkTimestamp(
  timestamp
) {
  try {
    const response =
      await fetchWithTimeout(
        makeSourceTileUrl(
          timestamp
        ),
        {
          headers: {
            "User-Agent":
              USER_AGENT,
            "Accept":
              "image/png,image/*,*/*"
          }
        },
        REQUEST_TIMEOUT
      );

    if (
      !response.ok
    ) {
      return false;
    }

    /*
     * Нам достаточно успешного HTTP.
     * Сам PNG здесь не нужен.
     */
    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   AUTOMATIC TIMESTAMP SEARCH
   ========================================================= */

async function discoverLatest() {
  const now =
    Math.floor(
      Date.now() / 1000
    );

  /*
   * Округляем до 10 минут.
   */
  const current =
    Math.floor(
      now / TIMESTAMP_STEP
    ) * TIMESTAMP_STEP;

  /*
   * Проверяем последние 12 кадров
   * одновременно.
   */

  const candidates =
    [];

  for (
    let i = 0;
    i < SEARCH_STEPS;
    i++
  ) {
    candidates.push(
      current -
      i * TIMESTAMP_STEP
    );
  }

  const results =
    await Promise.all(
      candidates.map(
        async timestamp => ({
          timestamp,
          exists:
            await checkTimestamp(
              timestamp
            )
        })
      )
    );

  /*
   * Берём самый свежий существующий.
   */

  const valid =
    results
      .filter(
        item => item.exists
      )
      .sort(
        (a, b) =>
          b.timestamp -
          a.timestamp
      );

  if (
    valid.length
  ) {
    return valid[0]
      .timestamp;
  }

  throw new Error(
    "RainRadar: актуальный кадр не найден"
  );
}

/* =========================================================
   GET LATEST TIMESTAMP
   ========================================================= */

async function getLatestTimestamp() {
  const now =
    Date.now();

  if (
    latestTimestampCache &&
    now -
      latestTimestampCacheTime <
      CACHE_TIME
  ) {
    return latestTimestampCache;
  }

  /*
   * 1. Manifest.
   *
   * Если он не работает —
   * НЕ падаем.
   */

  try {
    const frames =
      await getFromManifest();

    if (
      frames.length
    ) {
      const latest =
        frames[
          frames.length - 1
        ];

      latestTimestampCache =
        latest;

      latestTimestampCacheTime =
        now;

      return latest;
    }
  } catch (error) {
    console.warn(
      "RainRadar manifest:",
      error?.message
    );
  }

  /*
   * 2. /composite/
   */

  try {
    const frames =
      await getFromDirectory();

    if (
      frames.length
    ) {
      const latest =
        frames[
          frames.length - 1
        ];

      latestTimestampCache =
        latest;

      latestTimestampCacheTime =
        now;

      return latest;
    }
  } catch (error) {
    console.warn(
      "RainRadar directory:",
      error?.message
    );
  }

  /*
   * 3. Автоматический поиск.
   */

  const latest =
    await discoverLatest();

  latestTimestampCache =
    latest;

  latestTimestampCacheTime =
    now;

  return latest;
}

/* =========================================================
   GET FRAMES
   ========================================================= */

async function getFrames() {
  /*
   * История через manifest.
   */

  try {
    const frames =
      await getFromManifest();

    if (
      frames.length
    ) {
      return frames;
    }
  } catch (error) {
    console.warn(
      "RainRadar manifest:",
      error?.message
    );
  }

  /*
   * История через /composite/.
   */

  try {
    const frames =
      await getFromDirectory();

    if (
      frames.length
    ) {
      return frames;
    }
  } catch (error) {
    console.warn(
      "RainRadar directory:",
      error?.message
    );
  }

  /*
   * Если история недоступна,
   * возвращаем только актуальный кадр.
   */

  return [
    await getLatestTimestamp()
  ];
}

/* =========================================================
   RGMC ОЯ MAPPING
   ========================================================= */

function grayToLevel(v) {
  if (v <= 4) return -1;
  if (v <= 6) return 0;
  if (v <= 8) return 1;
  if (v <= 10) return 2;
  if (v <= 12) return 3;
  if (v <= 15) return 4;
  if (v <= 18) return 5;
  if (v <= 22) return 6;
  if (v <= 27) return 7;
  if (v <= 33) return 8;
  if (v <= 41) return 9;
  if (v <= 51) return 10;
  if (v <= 64) return 11;
  if (v <= 80) return 12;
  if (v <= 100) return 13;
  if (v <= 122) return 14;
  if (v <= 143) return 15;
  if (v <= 160) return 16;
  if (v <= 176) return 17;

  return 18;
}

/* =========================================================
   COLORIZE PNG
   ========================================================= */

async function colorize(
  buffer
) {
  const {
    data,
    info
  } =
    await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject: true
      });

  const output =
    Buffer.alloc(
      info.width *
      info.height *
      4
    );

  for (
    let i = 0, j = 0;
    i < data.length;
    i += info.channels,
    j += 4
  ) {
    const r =
      data[i] || 0;

    const g =
      data[i + 1] || 0;

    const b =
      data[i + 2] || 0;

    const gray =
      Math.max(
        r,
        g,
        b
      );

    /*
     * Чёрный фон = прозрачность.
     */

    if (
      gray <= 4
    ) {
      output[j] = 0;
      output[j + 1] = 0;
      output[j + 2] = 0;
      output[j + 3] = 0;

      continue;
    }

    const level =
      grayToLevel(
        gray
      );

    if (
      level < 0
    ) {
      output[j] = 0;
      output[j + 1] = 0;
      output[j + 2] = 0;
      output[j + 3] = 0;

      continue;
    }

    const hex =
      RGMC_OY_PALETTE[
        Math.min(
          level,
          RGMC_OY_PALETTE.length - 1
        )
      ];

    output[j] =
      parseInt(
        hex.slice(1, 3),
        16
      );

    output[j + 1] =
      parseInt(
        hex.slice(3, 5),
        16
      );

    output[j + 2] =
      parseInt(
        hex.slice(5, 7),
        16
      );

    output[j + 3] =
      255;
  }

  return await sharp(
    output,
    {
      raw: {
        width:
          info.width,

        height:
          info.height,

        channels: 4
      }
    }
  )
    .png({
      compressionLevel: 6,
      adaptiveFiltering: false
    })
    .toBuffer();
}

/* =========================================================
   TILE CACHE
   ========================================================= */

function getCachedTile(
  key
) {
  const item =
    tileCache.get(
      key
    );

  if (!item) {
    return null;
  }

  if (
    Date.now() -
      item.time >
      CACHE_TIME
  ) {
    tileCache.delete(
      key
    );

    return null;
  }

  return item.buffer;
}

function setCachedTile(
  key,
  buffer
) {
  tileCache.set(
    key,
    {
      buffer,
      time:
        Date.now()
    }
  );

  /*
   * Ограничиваем память.
   */

  while (
    tileCache.size >
    200
  ) {
    const first =
      tileCache.keys()
        .next()
        .value;

    if (
      first === undefined
    ) {
      break;
    }

    tileCache.delete(
      first
    );
  }
}

/* =========================================================
   MAIN VERCEL HANDLER
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

      /* ===================================================
         FRAMES
         =================================================== */

      if (
        manifest === "1"
      ) {
        const frames =
          await getFrames();

        const latest =
          frames[
            frames.length - 1
          ];

        res.setHeader(
          "Cache-Control",
          "no-store"
        );

        res.setHeader(
          "Content-Type",
          "application/json; charset=utf-8"
        );

        return res
          .status(200)
          .json({
            ok: true,
            frames,
            latest,
            step:
              TIMESTAMP_STEP
          });
      }

      /* ===================================================
         LATEST
         =================================================== */

      if (
        timestamp === undefined &&
        z === undefined &&
        x === undefined &&
        y === undefined
      ) {
        const latest =
          await getLatestTimestamp();

        res.setHeader(
          "Cache-Control",
          "no-store"
        );

        res.setHeader(
          "Content-Type",
          "application/json; charset=utf-8"
        );

        return res
          .status(200)
          .json({
            ok: true,
            latest,
            step:
              TIMESTAMP_STEP
          });
      }

      /* ===================================================
         TILE PARAMETERS
         =================================================== */

      if (
        timestamp === undefined ||
        z === undefined ||
        x === undefined ||
        y === undefined
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Нужны timestamp, z, x и y"
          });
      }

      const zi =
        Number(z);

      const xi =
        Number(x);

      const yi =
        Number(y);

      if (
        !Number.isInteger(zi) ||
        !Number.isInteger(xi) ||
        !Number.isInteger(yi)
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Некорректные координаты тайла"
          });
      }

      /* ===================================================
         CACHE
         =================================================== */

      const cacheKey =
        `${timestamp}/${zi}/${xi}/${yi}`;

      const cached =
        getCachedTile(
          cacheKey
        );

      if (cached) {
        res.setHeader(
          "Content-Type",
          "image/png"
        );

        res.setHeader(
          "Cache-Control",
          "public, max-age=30"
        );

        return res
          .status(200)
          .send(cached);
      }

      /* ===================================================
         SOURCE RAINRADAR TILE
         =================================================== */

      const sourceUrl =
        makeSourceTileUrl(
          timestamp,
          zi,
          xi,
          yi
        );

      const source =
        await fetchBuffer(
          sourceUrl
        );

      /* ===================================================
         COLORIZE
         =================================================== */

      const colored =
        await colorize(
          source
        );

      setCachedTile(
        cacheKey,
        colored
      );

      res.setHeader(
        "Content-Type",
        "image/png"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=30"
      );

      return res
        .status(200)
        .send(colored);
    } catch (error) {
      console.error(
        "RainRadar API:",
        error
      );

      /*
       * Ошибку отдаём как JSON,
       * а не заставляем Vercel
       * падать без ответа.
       */

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error?.message ||
            "RainRadar API error"
        });
    }
  };
