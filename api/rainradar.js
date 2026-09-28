/* =========================================================
   CLOrad — RainRadar API
   Источник:
   https://rainradar.ru/composite/

   Формат:
   /composite/{timestamp}/{z}/{x}_{y}.png

   ВАЖНО:
   - ES Module, совместимо с package.json "type": "module"
   - без sharp
   - без тяжёлых библиотек
   - без HEAD
   - без перебора 18 запросов
   - короткие таймауты
   ========================================================= */

"use strict";


/* =========================================================
   CONFIG
   ========================================================= */

const COMPOSITE_URL =
  "https://rainradar.ru/composite/";

const TIMESTAMP_STEP =
  600;

const REQUEST_TIMEOUT =
  4000;


/* =========================================================
   FETCH
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
   TIMESTAMP
   ========================================================= */

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


/* =========================================================
   CURRENT TIMESTAMP
   ========================================================= */

function currentTimestamp() {
  return normalizeTimestamp(
    Math.floor(
      Date.now() / 1000
    )
  );
}


/* =========================================================
   CHECK TILE
   ========================================================= */

async function checkTile(
  timestamp
) {
  const url =
    COMPOSITE_URL +
    timestamp +
    "/5/19_9.png";

  try {
    const response =
      await fetchWithTimeout(
        url,
        {
          method: "GET",
          cache: "no-store"
        }
      );

    if (
      !response.ok
    ) {
      return false;
    }

    const type =
      (
        response.headers.get(
          "content-type"
        ) || ""
      ).toLowerCase();

    if (
      type.includes("image") ||
      type.includes("png")
    ) {
      return true;
    }

    if (
      !type.includes("text/html") &&
      !type.includes("json")
    ) {
      return true;
    }

    return false;

  } catch {
    return false;
  }
}


/* =========================================================
   FIND LATEST
   ========================================================= */

async function findLatest() {

  const current =
    currentTimestamp();

  if (!current) {
    return null;
  }


  /* -------------------------------------------------------
     Текущий кадр
     ------------------------------------------------------- */

  if (
    await checkTile(
      current
    )
  ) {
    return current;
  }


  /* -------------------------------------------------------
     Предыдущий кадр
     ------------------------------------------------------- */

  const previous =
    current -
    TIMESTAMP_STEP;

  if (
    await checkTile(
      previous
    )
  ) {
    return previous;
  }


  /* -------------------------------------------------------
     Ещё один предыдущий
     ------------------------------------------------------- */

  const previous2 =
    current -
    TIMESTAMP_STEP * 2;

  if (
    await checkTile(
      previous2
    )
  ) {
    return previous2;
  }

  return null;
}


/* =========================================================
   TILE URL
   ========================================================= */

function tileUrl(
  timestamp,
  z,
  x,
  y
) {
  return (
    COMPOSITE_URL +
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


/* =========================================================
   HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {

  try {

    const query =
      req.query || {};


    /* =====================================================
       MANIFEST
       ===================================================== */

    if (
      String(
        query.manifest
      ) === "1"
    ) {

      const latest =
        await findLatest();

      if (!latest) {

        return res
          .status(503)
          .json({
            ok: false,
            error:
              "RainRadar сейчас не отдал доступный кадр"
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

          frames: [
            {
              timestamp:
                latest,

              time:
                new Date(
                  latest * 1000
                ).toISOString()
            }
          ]

        });
    }


    /* =====================================================
       TIMESTAMP
       ===================================================== */

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


    /* =====================================================
       COORDINATES
       ===================================================== */

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


    /* =====================================================
       REQUEST RAINRADAR TILE
       ===================================================== */

    const url =
      tileUrl(
        timestamp,
        z,
        x,
        y
      );


    const response =
      await fetchWithTimeout(
        url,
        {
          method: "GET",
          cache: "no-store",

          headers: {
            "Accept":
              "image/png,image/*,*/*;q=0.8"
          }
        }
      );


    /* =====================================================
       RAINRADAR ERROR
       ===================================================== */

    if (
      !response.ok
    ) {

      return res
        .status(
          response.status
        )
        .json({
          ok: false,
          error:
            "RainRadar tile unavailable",
          status:
            response.status
        });
    }


    /* =====================================================
       PNG
       ===================================================== */

    const buffer =
      await response.arrayBuffer();


    /* =====================================================
       RESPONSE
       ===================================================== */

    res.status(200);

    res.setHeader(
      "Content-Type",
      "image/png"
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
        buffer
      )
    );

  } catch (error) {

    console.error(
      "CLOrad RainRadar:",
      error
    );

    return res
      .status(500)
      .json({
        ok: false,
        error:
          "RainRadar API error",
        message:
          error?.message ||
          String(error)
      });
  }
}
