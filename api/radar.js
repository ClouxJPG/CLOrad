// api/radar.js

const NOWCAST = "https://www.nowcast.ru";
const DEMO_URL = `${NOWCAST}/demo/demo.html`;
const TOKEN_URL = `${NOWCAST}/get_token`;
const WMS_URL = `${NOWCAST}/baltrad_wsgi`;
const VECTOR_URL = `${NOWCAST}/vector_wsgi`;

const DEFAULT_LAYER =
  "bufr_dbz1,bufr_novosib_dbz1,bufr_vlad_dbz1";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

function sendJSON(res, status, data) {
  cors(res);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

/* =====================================================
   TOKEN
===================================================== */

async function getToken() {
  const response = await fetch(TOKEN_URL, {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: DEMO_URL,
      "User-Agent": UA
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `/get_token HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `/get_token вернул не JSON: ${text.slice(0, 1000)}`
    );
  }

  if (!data.token) {
    throw new Error("В ответе Nowcast отсутствует token");
  }

  return data.token;
}

function addToken(url, token) {
  const u = new URL(url);
  u.searchParams.set("token", token);
  return u.toString();
}

/* =====================================================
   NOWCAST REQUEST
===================================================== */

async function nowcastFetch(url, options = {}) {
  let token = await getToken();

  let response = await fetch(addToken(url, token), {
    ...options,
    redirect: "follow",
    headers: {
      Accept: "*/*",
      Referer: DEMO_URL,
      Origin: NOWCAST,
      "User-Agent": UA,
      ...(options.headers || {})
    }
  });

  if (response.status === 403) {
    token = await getToken();

    response = await fetch(addToken(url, token), {
      ...options,
      redirect: "follow",
      headers: {
        Accept: "*/*",
        Referer: DEMO_URL,
        Origin: NOWCAST,
        "User-Agent": UA,
        ...(options.headers || {})
      }
    });
  }

  return response;
}

/* =====================================================
   GETCAPABILITIES
===================================================== */

async function getCapabilities() {
  const url =
    `${WMS_URL}?SERVICE=WMS` +
    `&VERSION=1.1.1` +
    `&REQUEST=GetCapabilities`;

  const response = await nowcastFetch(url);
  const text = await response.text();

  return {
    response,
    text
  };
}

/* =====================================================
   TIMES
===================================================== */

function extractTimes(xml) {
  const set = new Set();

  const regex =
    /20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

  const matches = xml.match(regex) || [];

  for (const time of matches) {
    set.add(time);
  }

  return [...set].sort();
}

/* =====================================================
   PNG ANALYSIS
===================================================== */

/*
   PNG имеет сигнатуру:
   89 50 4E 47 0D 0A 1A 0A

   Здесь мы не декодируем PNG полностью.
   Просто определяем, что сервер действительно
   вернул PNG, а не XML/ошибку.
*/

function isPNG(buffer) {
  if (!buffer || buffer.length < 24) {
    return false;
  }

  return (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

/* =====================================================
   WMS GETMAP
===================================================== */

async function requestMap({
  time,
  layer,
  srs,
  bbox,
  width,
  height
}) {
  const params = new URLSearchParams();

  params.set("SERVICE", "WMS");
  params.set("VERSION", "1.1.1");
  params.set("REQUEST", "GetMap");

  params.set(
    "LAYERS",
    layer || DEFAULT_LAYER
  );

  params.set("STYLES", "");

  params.set("SRS", srs);

  params.set("BBOX", bbox);

  params.set("WIDTH", String(width));
  params.set("HEIGHT", String(height));

  params.set("FORMAT", "image/png");
  params.set("TRANSPARENT", "TRUE");

  params.set("TIME", time);

  const cleanUrl =
    `${WMS_URL}?${params.toString()}`;

  const response =
    await nowcastFetch(cleanUrl);

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  return {
    response,
    buffer,
    url: cleanUrl,
    png: isPNG(buffer)
  };
}

/* =====================================================
   AUTOMATIC WMS SEARCH
===================================================== */

async function findWorkingMap(time, layer) {
  /*
    Пробуем наиболее вероятные варианты.
  */

  const attempts = [

    // 1. WGS84 — стандартный вариант WMS 1.1.1
    {
      name: "EPSG:4326-EuropeRussia",
      srs: "EPSG:4326",
      bbox: "20,40,180,82",
      width: 1200,
      height: 700
    },

    // 2. Более широкий охват
    {
      name: "EPSG:4326-wide",
      srs: "EPSG:4326",
      bbox: "-20,35,180,85",
      width: 1200,
      height: 700
    },

    // 3. Только европейская часть
    {
      name: "EPSG:4326-EuropeanRussia",
      srs: "EPSG:4326",
      bbox: "20,40,100,75",
      width: 1200,
      height: 700
    },

    // 4. Web Mercator
    {
      name: "EPSG:3857-world",
      srs: "EPSG:3857",
      bbox:
        "-20037508,-20037508,20037508,20037508",
      width: 1200,
      height: 700
    },

    // 5. Web Mercator — Россия
    {
      name: "EPSG:3857-Russia",
      srs: "EPSG:3857",
      bbox:
        "2226389,4865942,20037508,15538711",
      width: 1200,
      height: 700
    }
  ];

  const results = [];

  for (const attempt of attempts) {
    try {
      const result =
        await requestMap({
          time,
          layer,
          srs: attempt.srs,
          bbox: attempt.bbox,
          width: attempt.width,
          height: attempt.height
        });

      const info = {
        name: attempt.name,
        status: result.response.status,
        contentType:
          result.response.headers.get("content-type"),
        bytes: result.buffer.length,
        png: result.png,
        url: result.url
      };

      results.push(info);

      /*
        Первый настоящий PNG используем.
      */

      if (
        result.response.ok &&
        result.png
      ) {
        return {
          ...result,
          attempt: info,
          attempts: results
        };
      }

    } catch (e) {
      results.push({
        name: attempt.name,
        ok: false,
        error: e.message
      });
    }
  }

  return {
    result: null,
    attempts: results
  };
}

/* =====================================================
   VECTOR
===================================================== */

async function getVector(time, layer) {
  const params = new URLSearchParams();

  params.set("time", time);
  params.set(
    "title",
    layer || DEFAULT_LAYER
  );

  const url =
    `${VECTOR_URL}?${params.toString()}`;

  const response =
    await nowcastFetch(url);

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw: text
    };
  }

  return {
    response,
    data
  };
}

/* =====================================================
   HANDLER
===================================================== */

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const action =
    req.query.action || "diagnostic";

  try {

    /* ================================================
       TOKEN
    ================================================ */

    if (action === "token") {
      try {
        const token =
          await getToken();

        return sendJSON(
          res,
          200,
          {
            ok: true,
            source: "nowcast",
            tokenReceived: true,
            tokenLength: token.length
          }
        );

      } catch (e) {
        return sendJSON(
          res,
          502,
          {
            ok: false,
            source: "nowcast",
            error: e.message
          }
        );
      }
    }

    /* ================================================
       TIMES
    ================================================ */

    if (action === "nowcast-times") {
      const result =
        await getCapabilities();

      if (!result.response.ok) {
        return sendJSON(
          res,
          result.response.status,
          {
            ok: false,
            source: "nowcast",
            status:
              result.response.status,
            body:
              result.text.slice(0, 3000)
          }
        );
      }

      const times =
        extractTimes(result.text);

      return sendJSON(
        res,
        200,
        {
          ok: true,
          source: "nowcast",
          layer: "bufr_dbz1",
          status:
            result.response.status,
          count:
            times.length,
          times
        }
      );
    }

    /* ================================================
       IMAGE
    ================================================ */

    if (action === "nowcast-image") {
      const time =
        req.query.time;

      const layer =
        req.query.layer ||
        DEFAULT_LAYER;

      if (!time) {
        return sendJSON(
          res,
          400,
          {
            ok: false,
            error:
              "Не указан параметр time"
          }
        );
      }

      const result =
        await findWorkingMap(
          time,
          layer
        );

      if (
        !result ||
        !result.buffer ||
        !result.png
      ) {
        return sendJSON(
          res,
          502,
          {
            ok: false,
            source: "nowcast",
            error:
              "Не найден рабочий WMS PNG",
            attempts:
              result?.attempts || []
          }
        );
      }

      cors(res);

      res.status(200);

      res.setHeader(
        "Content-Type",
        "image/png"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=60"
      );

      res.setHeader(
        "X-Nowcast-Time",
        time
      );

      res.setHeader(
        "X-Nowcast-Layer",
        layer
      );

      res.setHeader(
        "X-WMS-Variant",
        result.attempt.name
      );

      res.end(result.buffer);

      return;
    }

    /* ================================================
       DEBUG IMAGE
    ================================================ */

    if (action === "nowcast-image-debug") {
      const time =
        req.query.time;

      const layer =
        req.query.layer ||
        DEFAULT_LAYER;

      if (!time) {
        return sendJSON(
          res,
          400,
          {
            ok: false,
            error:
              "Не указан time"
          }
        );
      }

      const result =
        await findWorkingMap(
          time,
          layer
        );

      return sendJSON(
        res,
        200,
        {
          ok:
            !!result?.png,
          time,
          layer,
          selected:
            result?.attempt || null,
          attempts:
            result?.attempts || []
        }
      );
    }

    /* ================================================
       VECTOR
    ================================================ */

    if (action === "nowcast") {
      const time =
        req.query.time;

      const layer =
        req.query.layer ||
        DEFAULT_LAYER;

      if (!time) {
        return sendJSON(
          res,
          400,
          {
            ok: false,
            error:
              "Не указан time"
          }
        );
      }

      const result =
        await getVector(
          time,
          layer
        );

      if (!result.response.ok) {
        return sendJSON(
          res,
          result.response.status,
          {
            ok: false,
            source: "nowcast",
            status:
              result.response.status,
            data:
              result.data
          }
        );
      }

      return sendJSON(
        res,
        200,
        {
          ok: true,
          source: "nowcast",
          layer,
          time,
          status:
            result.response.status,
          data:
            result.data
        }
      );
    }

    /* ================================================
       RAW CAPABILITIES
    ================================================ */

    if (action === "capabilities") {
      const result =
        await getCapabilities();

      cors(res);

      res.status(
        result.response.status
      );

      res.setHeader(
        "Content-Type",
        "application/xml; charset=utf-8"
      );

      res.end(result.text);

      return;
    }

    /* ================================================
       DIAGNOSTIC
    ================================================ */

    if (action === "diagnostic") {
      const started =
        Date.now();

      const output = {
        ok: true,
        service:
          "CLOrad → Nowcast diagnostic v3",
        nowcast: NOWCAST,
        requests: []
      };

      /* homepage */

      try {
        const r =
          await fetch(
            `${NOWCAST}/`,
            {
              headers: {
                "User-Agent": UA
              }
            }
          );

        output.requests.push({
          name: "homepage",
          status: r.status,
          ok: r.ok
        });

      } catch (e) {
        output.ok = false;

        output.requests.push({
          name: "homepage",
          ok: false,
          error: e.message
        });
      }

      /* demo */

      try {
        const r =
          await fetch(
            DEMO_URL,
            {
              headers: {
                "User-Agent": UA
              }
            }
          );

        output.requests.push({
          name: "demo",
          status: r.status,
          ok: r.ok
        });

      } catch (e) {
        output.ok = false;

        output.requests.push({
          name: "demo",
          ok: false,
          error: e.message
        });
      }

      /* token */

      try {
        const token =
          await getToken();

        output.requests.push({
          name: "get_token",
          status: 200,
          ok: true,
          tokenReceived: true,
          tokenLength:
            token.length
        });

      } catch (e) {
        output.ok = false;

        output.requests.push({
          name: "get_token",
          ok: false,
          error: e.message
        });

        return sendJSON(
          res,
          502,
          output
        );
      }

      /* capabilities */

      const cap =
        await getCapabilities();

      output.requests.push({
        name:
          "GetCapabilities_with_token",
        status:
          cap.response.status,
        ok:
          cap.response.ok,
        contentType:
          cap.response.headers.get(
            "content-type"
          ),
        bodyPreview:
          cap.text.slice(0, 800)
      });

      if (!cap.response.ok) {
        output.ok = false;

        return sendJSON(
          res,
          502,
          output
        );
      }

      /* times */

      const times =
        extractTimes(cap.text);

      const latest =
        times.length
          ? times[times.length - 1]
          : null;

      output.requests.push({
        name:
          "latest_timestamp",
        ok:
          !!latest,
        timestamp:
          latest,
        totalTimes:
          times.length
      });

      /* vector */

      if (latest) {
        try {
          const v =
            await getVector(
              latest,
              DEFAULT_LAYER
            );

          output.requests.push({
            name:
              "vector_with_real_timestamp",
            status:
              v.response.status,
            ok:
              v.response.ok,
            contentType:
              v.response.headers.get(
                "content-type"
              ),
            dataCount:
              Array.isArray(v.data)
                ? v.data.length
                : null
          });

        } catch (e) {
          output.ok = false;

          output.requests.push({
            name:
              "vector_with_real_timestamp",
            ok: false,
            error: e.message
          });
        }

        /* WMS */

        try {
          const map =
            await findWorkingMap(
              latest,
              DEFAULT_LAYER
            );

          output.requests.push({
            name:
              "WMS_GetMap_auto",
            ok:
              !!map?.png,
            selected:
              map?.attempt || null,
            attempts:
              map?.attempts || []
          });

          if (!map?.png) {
            output.ok = false;
          }

        } catch (e) {
          output.ok = false;

          output.requests.push({
            name:
              "WMS_GetMap_auto",
            ok: false,
            error: e.message
          });
        }
      }

      output.summary = {
        durationMs:
          Date.now() - started,
        totalTimes:
          times.length,
        failedRequests:
          output.requests.filter(
            x => x.ok === false
          ).length
      };

      return sendJSON(
        res,
        output.ok ? 200 : 502,
        output
      );
    }

    /* ================================================
       UNKNOWN
    ================================================ */

    return sendJSON(
      res,
      400,
      {
        ok: false,
        error:
          "Unknown action",
        availableActions: [
          "diagnostic",
          "token",
          "nowcast-times",
          "nowcast-image",
          "nowcast-image-debug",
          "nowcast",
          "capabilities"
        ]
      }
    );

  } catch (e) {
    console.error(
      "CLOrad radar error:",
      e
    );

    return sendJSON(
      res,
      500,
      {
        ok: false,
        error:
          e.message ||
          String(e)
      }
    );
  }
}
