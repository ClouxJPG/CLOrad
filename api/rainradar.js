/* =========================================================
   CLOrad — RainRadar API
   Источник:
   https://rainradar.ru/composite/

   Формат:
   /composite/{timestamp}/{z}/{x}_{y}.png

   ВАЖНО:
   - никаких sharp
   - никаких тяжёлых библиотек
   - без HEAD-запросов
   - короткие таймауты
   - Vercel Serverless Function
   ========================================================= */

"use strict";

/* =========================================================
   CONFIG
   ========================================================= */

const COMPOSITE_URL =
  "https://rainradar.ru/composite/";

const CACHE_TIME =
  30 * 1000;

const TIMESTAMP_STEP =
  600;

const SEARCH_STEPS =
  18;

const REQUEST_TIMEOUT =
  3000;


/* =========================================================
   HELPERS
   ========================================================= */

function json(
  body,
  status = 200
) {
  return {
    status,
    headers: {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store, no-cache, must-revalidate"
    },
    body: JSON.stringify(body)
  };
}


function nowUnix() {
  return Math.floor(
    Date.now() / 1000
  );
}


function normalizeTimestamp(
  value
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return null;
  }

  return (
    Math.floor(
      n / TIMESTAMP_STEP
    ) * TIMESTAMP_STEP
  );
}


function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}


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
   CHECK ONE RAINRADAR FRAME
   ========================================================= */

async function checkTimestamp(
  timestamp
) {
  const url =
    COMPOSITE_URL +
    timestamp +
    "/5/19_9.png";

  try {
    /*
      GET, а не HEAD.
      RainRadar может нормально отдавать PNG
      на GET, но HEAD может работать иначе.
    */

    const response =
      await fetchWithTimeout(
        url,
        {
          method: "GET",
          cache: "no-store"
        },
        REQUEST_TIMEOUT
      );

    if (
      !response.ok
    ) {
      return null;
    }

    const type =
      (
        response.headers.get(
          "content-type"
        ) || ""
      ).toLowerCase();

    /*
      Если сервер действительно отдал PNG —
      кадр существует.
    */

    if (
      type.includes("image") ||
      type.includes("png")
    ) {
      return timestamp;
    }

    /*
      Иногда Content-Type может быть странным.
      Сам факт успешного ответа тоже считаем
      достаточным, если это не HTML/JSON.
    */

    if (
      !type.includes("text/html") &&
      !type.includes("application/json")
    ) {
      return timestamp;
    }

    return null;

  } catch {
    return null;
  }
}


/* =========================================================
   FIND LATEST FRAME
   ========================================================= */

async function discoverLatest() {
  const current =
    normalizeTimestamp(
      nowUnix()
    );

  if (!current) {
    return null;
  }

  /*
    Проверяем сразу пачку последних
    десятиминутных времён.

    Это намного быстрее и безопаснее,
    чем делать 18 последовательных запросов.
  */

  const candidates = [];

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
        timestamp =>
          checkTimestamp(
            timestamp
          )
      )
    );

  for (
    let i = 0;
    i < results.length;
    i++
  ) {
    if (
      results[i] !== null
    ) {
      return results[i];
    }
  }

  return null;
}


/* =========================================================
   FRAME LIST
   ========================================================= */

async function getFrames() {
  const latest =
    await discoverLatest();

  if (!latest) {
    return [];
  }

  /*
    Возвращаем существующий кадр.
    Timeline сможет работать даже если
    RainRadar временно отдаёт только
    последний доступный composite.
  */

  return [
    {
      timestamp: latest,
      time:
        new Date(
          latest * 1000
        ).toISOString()
    }
  ];
}


/* =========================================================
   TILE
   ========================================================= */

async function getTile(
  timestamp,
  z,
  x,
  y
) {
  const url =
    COMPOSITE_URL +
    timestamp +
    "/" +
    z +
    "/" +
    x +
    "_" +
    y +
    ".png";

  const response =
    await fetchWithTimeout(
      url,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          "Accept":
            "image/png,image/*;q=0.9,*/*;q=0.5"
        }
      },
      REQUEST_TIMEOUT
    );

  if (
    !response.ok
  ) {
    return {
      status:
        response.status
    };
  }

  const buffer =
    await response.arrayBuffer();

  return {
    status: 200,
    buffer,
    contentType:
      response.headers.get(
        "content-type"
      ) || "image/png"
  };
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

      /* -----------------------------------------------
         MANIFEST
         ----------------------------------------------- */

      if (
        String(
          query.manifest
        ) === "1"
      ) {
        const frames =
          await getFrames();

        if (
          frames.length === 0
        ) {
          return res
            .status(503)
            .json({
              ok: false,
              error:
                "RainRadar: доступные кадры не найдены"
            });
        }

        return res
          .status(200)
          .setHeader(
            "Cache-Control",
            "no-store"
          )
          .json({
            ok: true,
            source:
              "rainradar.ru/composite",
            frames
          });
      }


      /* -----------------------------------------------
         TIMESTAMP
         ----------------------------------------------- */

      const timestamp =
        normalizeTimestamp(
          query.timestamp
        );

      if (!timestamp) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Не указан timestamp"
          });
      }


      /* -----------------------------------------------
         TILE COORDINATES
         ----------------------------------------------- */

      const z =
        Number(query.z);

      const x =
        Number(query.x);

      const y =
        Number(query.y);

      if (
        !Number.isInteger(z) ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        z < 0 ||
        z > 20 ||
        x < 0 ||
        y < 0
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Некорректные координаты тайла"
          });
      }


      /* -----------------------------------------------
         GET TILE
         ----------------------------------------------- */

      const tile =
        await getTile(
          timestamp,
          z,
          x,
          y
        );

      if (
        tile.status !== 200
      ) {
        return res
          .status(tile.status)
          .json({
            ok: false,
            error:
              "RainRadar tile unavailable"
          });
      }


      /* -----------------------------------------------
         RETURN ORIGINAL PNG
         ----------------------------------------------- */

      res.status(200);

      res.setHeader(
        "Content-Type",
        tile.contentType
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=30"
      );

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      return res.end(
        Buffer.from(
          tile.buffer
        )
      );

    } catch (error) {
      console.error(
        "CLOrad RainRadar API:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "RainRadar API error",
          message:
            error &&
            error.message
              ? error.message
              : String(error)
        });
    }
  };
