// api/radar.js

const NOWCAST = "https://www.nowcast.ru";
const DEMO_URL = `${NOWCAST}/demo/demo.html`;
const WMS_URL = `${NOWCAST}/baltrad_wsgi`;
const VECTOR_URL = `${NOWCAST}/vector_wsgi`;
const TOKEN_URL = `${NOWCAST}/get_token`;

// Именно этот слой выбран в demo.html Nowcast
const DEFAULT_LAYER =
  "bufr_dbz1,bufr_novosib_dbz1,bufr_vlad_dbz1";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );
  return res;
}

function sendJSON(res, status, data) {
  cors(res);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function getToken() {
  const r = await fetch(TOKEN_URL, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 CLOrad"
    }
  });

  if (!r.ok) {
    throw new Error(`Nowcast /get_token: HTTP ${r.status}`);
  }

  const data = await r.json();

  if (!data || !data.token) {
    throw new Error("Nowcast /get_token не вернул token");
  }

  return data.token;
}

function addToken(url, token) {
  const u = new URL(url);
  u.searchParams.set("token", token);
  return u.toString();
}

async function nowcastRequest(url, options = {}) {
  let token = await getToken();

  let response = await fetch(addToken(url, token), {
    ...options,
    headers: {
      "User-Agent": "Mozilla/5.0 CLOrad",
      ...(options.headers || {})
    }
  });

  // Если токен протух — получаем новый и повторяем запрос
  if (response.status === 403) {
    token = await getToken();

    response = await fetch(addToken(url, token), {
      ...options,
      headers: {
        "User-Agent": "Mozilla/5.0 CLOrad",
        ...(options.headers || {})
      }
    });
  }

  return response;
}

/*
========================================================
GETCAPABILITIES
========================================================
*/

async function getCapabilities() {
  const url =
    `${WMS_URL}?SERVICE=WMS` +
    `&VERSION=1.1.1` +
    `&REQUEST=GetCapabilities`;

  const response = await nowcastRequest(url);

  const text = await response.text();

  return {
    response,
    text
  };
}

/*
========================================================
ИЗВЛЕЧЕНИЕ TIME ИЗ WMS
========================================================
*/

function extractTimes(xml) {
  const times = new Set();

  // ISO timestamps
  const iso =
    /20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

  const matches = xml.match(iso) || [];

  for (const t of matches) {
    times.add(t);
  }

  // Иногда WMS возвращает интервалы:
  // start/end/PT10M
  const extentMatches =
    xml.match(/20\d{2}-\d{2}-\d{2}T[^<\s]+/g) || [];

  for (const t of extentMatches) {
    if (t.includes("Z")) {
      const clean = t
        .replace(/&lt;/g, "")
        .replace(/&gt;/g, "")
        .replace(/["']/g, "");

      if (
        /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(
          clean
        )
      ) {
        times.add(clean);
      }
    }
  }

  return [...times].sort();
}

/*
========================================================
PNG WMS
========================================================
*/

async function getRadarImage({
  time,
  layer,
  width,
  height,
  bbox,
  format
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

  params.set(
    "SRS",
    "EPSG:4326"
  );

  params.set(
    "BBOX",
    bbox || "20,40,180,82"
  );

  params.set(
    "WIDTH",
    String(width || 1200)
  );

  params.set(
    "HEIGHT",
    String(height || 700)
  );

  params.set(
    "FORMAT",
    format || "image/png"
  );

  params.set(
    "TRANSPARENT",
    "TRUE"
  );

  if (time) {
    params.set("TIME", time);
  }

  const url =
    `${WMS_URL}?${params.toString()}`;

  const response =
    await nowcastRequest(url);

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  return {
    response,
    buffer
  };
}

/*
========================================================
VECTOR
========================================================
*/

async function getVector({
  time,
  layer
}) {
  const params = new URLSearchParams();

  params.set(
    "time",
    time
  );

  params.set(
    "title",
    layer || DEFAULT_LAYER
  );

  const url =
    `${VECTOR_URL}?${params.toString()}`;

  const response =
    await nowcastRequest(url);

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

/*
========================================================
DIAGNOSTIC
========================================================
*/

async function diagnosticRequest(
  name,
  url,
  tokenRequired = false
) {
  try {
    let response;

    if (tokenRequired) {
      response =
        await nowcastRequest(url);
    } else {
      response =
        await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 CLOrad"
          }
        });
    }

    const contentType =
      response.headers.get(
        "content-type"
      );

    let preview = "";

    if (
      contentType &&
      (
        contentType.includes("json") ||
        contentType.includes("xml") ||
        contentType.includes("text")
      )
    ) {
      const text =
        await response.text();

      preview =
        text.substring(0, 1000);
    }

    return {
      name,
      url,
      status: response.status,
      ok: response.ok,
      contentType,
      bodyPreview: preview
    };
  } catch (e) {
    return {
      name,
      url,
      ok: false,
      error: e.message
    };
  }
}

/*
========================================================
MAIN
========================================================
*/

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const action =
      req.query.action || "diagnostic";

    /*
    ----------------------------------------------
    DIAGNOSTIC
    ----------------------------------------------
    */

    if (action === "diagnostic") {
      const start =
        Date.now();

      const requests = [];

      requests.push(
        await diagnosticRequest(
          "homepage",
          `${NOWCAST}/`,
          false
        )
      );

      requests.push(
        await diagnosticRequest(
          "demo",
          DEMO_URL,
          false
        )
      );

      let token = null;

      try {
        token =
          await getToken();

        requests.push({
          name: "get_token",
          url: TOKEN_URL,
          status: 200,
          ok: true,
          tokenReceived: true,
          tokenLength: token.length
        });
      } catch (e) {
        requests.push({
          name: "get_token",
          url: TOKEN_URL,
          ok: false,
          error: e.message
        });
      }

      const capUrl =
        `${WMS_URL}?SERVICE=WMS` +
        `&VERSION=1.1.1` +
        `&REQUEST=GetCapabilities`;

      if (token) {
        const cap =
          await diagnosticRequest(
            "GetCapabilities_with_token",
            capUrl,
            true
          );

        requests.push(cap);
      }

      const testTime =
        new Date().toISOString();

      const vectorUrl =
        `${VECTOR_URL}?time=${encodeURIComponent(
          testTime
        )}&title=${encodeURIComponent(
          "bufr_dbz1"
        )}`;

      if (token) {
        const vector =
          await diagnosticRequest(
            "vector_with_token",
            vectorUrl,
            true
          );

        requests.push(vector);
      }

      const failed =
        requests.filter(
          x => x.ok === false
        );

      return sendJSON(
        res,
        failed.length ? 502 : 200,
        {
          ok: failed.length === 0,
          service:
            "CLOrad → Nowcast diagnostic",
          nowcast: NOWCAST,
          requests,
          summary: {
            durationMs:
              Date.now() - start,
            totalRequests:
              requests.length,
            failedRequests:
              failed.length
          }
        }
      );
    }

    /*
    ----------------------------------------------
    NOWCAST TIMES
    ----------------------------------------------
    */

    if (action === "nowcast-times") {
      const {
        response,
        text
      } = await getCapabilities();

      if (!response.ok) {
        return sendJSON(
          res,
          response.status,
          {
            ok: false,
            source: "nowcast",
            status:
              response.status,
            error:
              "GetCapabilities failed",
            body:
              text.substring(0, 2000)
          }
        );
      }

      const times =
        extractTimes(text);

      return sendJSON(
        res,
        200,
        {
          ok: true,
          source: "nowcast",
          layer: "bufr_dbz1",
          status: response.status,
          count: times.length,
          times
        }
      );
    }

    /*
    ----------------------------------------------
    NOWCAST IMAGE
    ----------------------------------------------
    */

    if (action === "nowcast-image") {
      const time =
        req.query.time || "";

      const layer =
        req.query.layer ||
        DEFAULT_LAYER;

      const width =
        Number(req.query.width) ||
        1200;

      const height =
        Number(req.query.height) ||
        700;

      const bbox =
        req.query.bbox ||
        "20,40,180,82";

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
        await getRadarImage({
          time,
          layer,
          width,
          height,
          bbox
        });

      if (!result.response.ok) {
        const errorText =
          result.buffer
            .toString("utf8")
            .substring(0, 3000);

        return sendJSON(
          res,
          result.response.status,
          {
            ok: false,
            source: "nowcast",
            status:
              result.response.status,
            error:
              "WMS GetMap failed",
            body:
              errorText
          }
        );
      }

      cors(res);

      res.status(200);

      res.setHeader(
        "Content-Type",
        result.response.headers.get(
          "content-type"
        ) || "image/png"
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

      res.end(result.buffer);

      return;
    }

    /*
    ----------------------------------------------
    VECTOR
    ----------------------------------------------
    */

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
        await getVector({
          time,
          layer
        });

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

    /*
    ----------------------------------------------
    RAW CAPABILITIES
    ----------------------------------------------
    */

    if (action === "capabilities") {
      const {
        response,
        text
      } = await getCapabilities();

      cors(res);

      res.status(
        response.status
      );

      res.setHeader(
        "Content-Type",
        response.headers.get(
          "content-type"
        ) ||
          "application/xml; charset=utf-8"
      );

      res.end(text);

      return;
    }

    /*
    ----------------------------------------------
    TOKEN TEST
    ----------------------------------------------
    */

    if (action === "token") {
      const token =
        await getToken();

      return sendJSON(
        res,
        200,
        {
          ok: true,
          source: "nowcast",
          tokenReceived: true,
          tokenLength:
            token.length
        }
      );
    }

    /*
    ----------------------------------------------
    UNKNOWN ACTION
    ----------------------------------------------
    */

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
          "capabilities",
          "nowcast-times",
          "nowcast-image",
          "nowcast"
        ]
      }
    );

  } catch (error) {
    console.error(
      "CLOrad radar API error:",
      error
    );

    return sendJSON(
      res,
      500,
      {
        ok: false,
        error:
          error.message ||
          String(error)
      }
    );
  }
}
