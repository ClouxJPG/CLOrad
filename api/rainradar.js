/* =========================================================
   CLOrad — RainRadar Russia Composite API
   Источник:
   rainradar

   Автоматическое получение timestamp.
   manifest.json НЕ является обязательным.
   ========================================================= */

const sharp = require("sharp");

const MANIFEST_URL =
  "https://rainradar.ru/composite/manifest.json";

const COMPOSITE_URL =
  "https://rainradar.ru/composite/";

const CACHE_TIME = 30 * 1000;
const TIMESTAMP_STEP = 600; // 10 минут

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CLOrad/1.0";

/* =========================================================
   RGMC ОЯ — НЕ ИЗМЕНЯТЬ
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
   HTTP
   ========================================================= */

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept":
        "text/html,application/json,image/png,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`
    );
  }

  return await response.text();
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "image/png,image/*,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

/* =========================================================
   TIMESTAMP NORMALIZATION
   ========================================================= */

function normalizeTimestamp(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    if (
      Number.isFinite(value) &&
      value > 1000000000 &&
      value < 3000000000
    ) {
      return Math.floor(value);
    }

    return null;
  }

  const text = String(value).trim();

  if (/^\d{9,12}$/.test(text)) {
    const n = Number(text);

    if (
      Number.isFinite(n) &&
      n > 1000000000 &&
      n < 3000000000
    ) {
      return Math.floor(n);
    }
  }

  const parsed = Date.parse(text);

  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }

  return null;
}

/* =========================================================
   EXTRACT TIMESTAMPS FROM ANY TEXT
   ========================================================= */

function extractTimestamps(text) {
  const result = new Set();

  if (!text) {
    return [];
  }

  /*
   * Ищем именно 10-значные Unix timestamp.
   *
   * Например:
   * /composite/1790614800/
   */

  const regex = /(?:^|[/"'=:_-])(\d{10})(?=[/"'?:_.,<>\s-]|$)/g;

  let match;

  while ((match = regex.exec(text)) !== null) {
    const timestamp = normalizeTimestamp(match[1]);

    if (timestamp) {
      result.add(timestamp);
    }
  }

  /*
   * Дополнительно ищем любые 9-12 значные числа,
   * которые похожи на Unix timestamp.
   */

  const looseRegex = /\b(\d{9,12})\b/g;

  while ((match = looseRegex.exec(text)) !== null) {
    const timestamp = normalizeTimestamp(match[1]);

    if (timestamp) {
      result.add(timestamp);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}

/* =========================================================
   MANIFEST PARSER
   ========================================================= */

function extractManifestTimestamps(data) {
  const result = new Set();

  function walk(value, depth = 0) {
    if (depth > 8 || value === null || value === undefined) {
      return;
    }

    if (
      typeof value === "string" ||
      typeof value === "number"
    ) {
      const timestamp = normalizeTimestamp(value);

      if (timestamp) {
        result.add(timestamp);
      }

      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, depth + 1);
      }

      return;
    }

    if (typeof value === "object") {
      for (const key of Object.keys(value)) {
        walk(key, depth + 1);
        walk(value[key], depth + 1);
      }
    }
  }

  walk(data);

  return Array.from(result).sort((a, b) => a - b);
}

/* =========================================================
   METHOD 1
   MANIFEST
   ========================================================= */

async function getFromManifest() {
  const now = Date.now();

  if (
    manifestCache &&
    now - manifestCacheTime < CACHE_TIME
  ) {
    return manifestCache;
  }

  const response = await fetch(MANIFEST_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json,text/plain,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(
      `manifest HTTP ${response.status}`
    );
  }

  const data = await response.json();

  const timestamps =
    extractManifestTimestamps(data);

  if (!timestamps.length) {
    throw new Error(
      "manifest не содержит timestamp"
    );
  }

  manifestCache = timestamps;
  manifestCacheTime = now;

  return timestamps;
}

/* =========================================================
   METHOD 2
   DIRECTORY LISTING
   ========================================================= */

async function getFromDirectory() {
  const html = await fetchText(COMPOSITE_URL);

  const timestamps =
    extractTimestamps(html);

  if (!timestamps.length) {
    throw new Error(
      "В /composite/ не найдено timestamp"
    );
  }

  return timestamps;
}

/* =========================================================
   TILE EXISTENCE CHECK
   ========================================================= */

async function checkTimestamp(timestamp) {
  /*
   * Используем один реальный тайл.
   *
   * z=5 / x=19 / y=9
   *
   * Такой запрос нужен только для определения,
   * существует ли конкретный timestamp.
   */

  const url =
    `${COMPOSITE_URL}` +
    `${encodeURIComponent(timestamp)}/5/19_9.png`;

  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "image/png,*/*"
      }
    });

    return response.ok;
  } catch {
    return false;
  }
}

/* =========================================================
   METHOD 3
   AUTOMATIC TIME SEARCH
   ========================================================= */

async function discoverByTime() {
  const now = Math.floor(Date.now() / 1000);

  /*
   * Округляем текущее время вниз до 10 минут.
   */

  const current =
    Math.floor(now / TIMESTAMP_STEP) *
    TIMESTAMP_STEP;

  /*
   * Проверяем последние 6 часов.
   *
   * Обычно актуальный timestamp будет найден
   * буквально за несколько запросов.
   */

  const MAX_STEPS = 36;

  for (let i = 0; i <= MAX_STEPS; i++) {
    const timestamp =
      current - i * TIMESTAMP_STEP;

    if (await checkTimestamp(timestamp)) {
      return timestamp;
    }
  }

  throw new Error(
    "Не найден актуальный timestamp RainRadar"
  );
}

/* =========================================================
   FIND LATEST
   ========================================================= */

async function getLatestTimestamp() {
  const now = Date.now();

  if (
    latestTimestampCache &&
    now - latestTimestampCacheTime < CACHE_TIME
  ) {
    return latestTimestampCache;
  }

  /*
   * 1. Manifest
   */

  try {
    const timestamps =
      await getFromManifest();

    if (timestamps.length) {
      const latest =
        timestamps[timestamps.length - 1];

      latestTimestampCache = latest;
      latestTimestampCacheTime = now;

      return latest;
    }
  } catch {
    // продолжаем fallback
  }

  /*
   * 2. /composite/
   */

  try {
    const timestamps =
      await getFromDirectory();

    if (timestamps.length) {
      const latest =
        timestamps[timestamps.length - 1];

      latestTimestampCache = latest;
      latestTimestampCacheTime = now;

      return latest;
    }
  } catch {
    // продолжаем fallback
  }

  /*
   * 3. Автоматический поиск по времени
   */

  const latest =
    await discoverByTime();

  latestTimestampCache = latest;
  latestTimestampCacheTime = now;

  return latest;
}

/* =========================================================
   FIND FRAMES
   ========================================================= */

async function getFrames() {
  /*
   * Manifest
   */

  try {
    const timestamps =
      await getFromManifest();

    if (timestamps.length) {
      return timestamps;
    }
  } catch {
    // fallback
  }

  /*
   * Directory
   */

  try {
    const timestamps =
      await getFromDirectory();

    if (timestamps.length) {
      return timestamps;
    }
  } catch {
    // fallback
  }

  /*
   * Если получить историю невозможно,
   * возвращаем хотя бы актуальный кадр.
   */

  const latest =
    await getLatestTimestamp();

  return [latest];
}

/* =========================================================
   GRAYSCALE → RGMC OЯ
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
   COLORIZE
   ========================================================= */

async function colorize(buffer) {
  const image =
    sharp(buffer).ensureAlpha();

  const {
    data,
    info
  } = await image.raw().toBuffer({
    resolveWithObject: true
  });

  const output =
    Buffer.alloc(info.width * info.height * 4);

  for (
    let i = 0, j = 0;
    i < data.length;
    i += info.channels, j += 4
  ) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    /*
     * RainRadar tiles являются grayscale.
     * Берём максимальный канал.
     */

    const gray =
      Math.max(r, g, b);

    /*
     * Чёрный / почти чёрный =
     * отсутствие данных.
     */

    if (gray <= 4) {
      output[j] = 0;
      output[j + 1] = 0;
      output[j + 2] = 0;
      output[j + 3] = 0;
      continue;
    }

    const level =
      grayToLevel(gray);

    if (level < 0) {
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
      parseInt(hex.slice(1, 3), 16);

    output[j + 1] =
      parseInt(hex.slice(3, 5), 16);

    output[j + 2] =
      parseInt(hex.slice(5, 7), 16);

    output[j + 3] = 255;
  }

  return await sharp(output, {
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
   TILE URL
   ========================================================= */

function makeTileUrl(
  timestamp,
  z,
  x,
  y
) {
  return (
    `${COMPOSITE_URL}` +
    `${encodeURIComponent(timestamp)}/` +
    `${z}/` +
    `${x}_${y}.png`
  );
}

/* =========================================================
   TILE CACHE
   ========================================================= */

function getCachedTile(key) {
  const item =
    tileCache.get(key);

  if (!item) {
    return null;
  }

  if (
    Date.now() - item.time >
    CACHE_TIME
  ) {
    tileCache.delete(key);
    return null;
  }

  return item.buffer;
}

function setCachedTile(
  key,
  buffer
) {
  tileCache.set(key, {
    buffer,
    time: Date.now()
  });

  /*
   * Максимум 200 тайлов.
   */

  if (tileCache.size > 200) {
    const first =
      tileCache.keys().next().value;

    if (first) {
      tileCache.delete(first);
    }
  }
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */

module.exports = async function handler(
  req,
  res
) {
  try {
    const {
      manifest,
      timestamp,
      z,
      x,
      y
    } = req.query || {};

    /* =====================================================
       MANIFEST / FRAME REQUEST
       ===================================================== */

    if (manifest === "1") {
      const frames =
        await getFrames();

      const latest =
        frames[frames.length - 1];

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );

      return res.status(200).json({
        ok: true,
        frames,
        latest,
        step: TIMESTAMP_STEP
      });
    }

    /* =====================================================
       LATEST TIMESTAMP REQUEST
       ===================================================== */

    if (
      !timestamp &&
      !z &&
      !x &&
      !y
    ) {
      const latest =
        await getLatestTimestamp();

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      return res.status(200).json({
        ok: true,
        latest,
        step: TIMESTAMP_STEP
      });
    }

    /* =====================================================
       TILE
       ===================================================== */

    if (
      !timestamp ||
      z === undefined ||
      x === undefined ||
      y === undefined
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Нужны timestamp, z, x и y"
      });
    }

    const zi = Number(z);
    const xi = Number(x);
    const yi = Number(y);

    if (
      !Number.isInteger(zi) ||
      !Number.isInteger(xi) ||
      !Number.isInteger(yi)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Некорректные координаты тайла"
      });
    }

    const cacheKey =
      `${timestamp}/${zi}/${xi}/${yi}`;

    const cached =
      getCachedTile(cacheKey);

    if (cached) {
      res.setHeader(
        "Content-Type",
        "image/png"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=30"
      );

      return res.status(200).send(cached);
    }

    const sourceUrl =
      makeTileUrl(
        timestamp,
        zi,
        xi,
        yi
      );

    const source =
      await fetchBuffer(sourceUrl);

    const colored =
      await colorize(source);

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

    return res.status(200).send(colored);
  } catch (error) {
    console.error(
      "RainRadar API error:",
      error
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Ошибка RainRadar API"
    });
  }
};
