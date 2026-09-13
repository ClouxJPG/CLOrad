// api/radar.js

const NOWCAST = "https://www.nowcast.ru";
const DEMO_URL = `${NOWCAST}/demo/demo.html`;

const WMS_URL = `${NOWCAST}/baltrad_wsgi`;
const VECTOR_URL = `${NOWCAST}/vector_wsgi`;
const TOKEN_URL = `${NOWCAST}/get_token`;


// ============================================================
// MAIN
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = String(req.query.action || "status");

  try {
    // ----------------------------------------------------------
    // STATUS
    // ----------------------------------------------------------

    if (action === "status") {
      return res.status(200).json({
        ok: true,
        service: "CLOrad radar API",
        source: "Nowcast",
        tokenEndpoint: TOKEN_URL,
        actions: [
          "status",
          "diagnostic",
          "nowcast-times",
          "nowcast-image",
          "nowcast"
        ]
      });
    }


    // ----------------------------------------------------------
    // DIAGNOSTIC
    // ----------------------------------------------------------

    if (action === "diagnostic") {
      const result = await diagnostic();

      return res
        .status(result.httpStatus || 200)
        .json(result);
    }


    // ----------------------------------------------------------
    // GET TIMES
    // ----------------------------------------------------------

    if (action === "nowcast-times") {
      const result = await getNowcastTimes();

      return res
        .status(result.httpStatus || 200)
        .json(result);
    }


    // ----------------------------------------------------------
    // RADAR IMAGE
    // ----------------------------------------------------------

    if (action === "nowcast-image") {
      return await getNowcastImage(req, res);
    }


    // ----------------------------------------------------------
    // VECTOR DATA
    // ----------------------------------------------------------

    if (action === "nowcast") {
      const result = await getNowcastVector(req);

      return res
        .status(result.httpStatus || 200)
        .json(result);
    }


    // ----------------------------------------------------------
    // UNKNOWN
    // ----------------------------------------------------------

    return res.status(400).json({
      ok: false,
      error: "Unknown action",
      action
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Unhandled API error",
      message: error?.message || String(error),
      stack: error?.stack || null
    });
  }
}



// ============================================================
// TOKEN
// ============================================================

async function getNowcastToken() {
  const started = Date.now();

  const response = await fetch(TOKEN_URL, {
    method: "GET",
    headers: browserHeaders(DEMO_URL)
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      contentType:
        response.headers.get("content-type"),
      body: text.slice(0, 3000),
      durationMs: Date.now() - started
    };
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: "Nowcast /get_token returned invalid JSON",
      body: text.slice(0, 3000),
      durationMs: Date.now() - started
    };
  }

  if (!data.token) {
    return {
      ok: false,
      status: 502,
      error: "Nowcast /get_token did not return token",
      response: data,
      durationMs: Date.now() - started
    };
  }

  return {
    ok: true,
    token: data.token,
    status: response.status,
    durationMs: Date.now() - started
  };
}



// ============================================================
// BROWSER HEADERS
// ============================================================

function browserHeaders(referer = DEMO_URL) {
  return {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
      "Version/18.0 Mobile/15E148 Safari/604.1",

    "Accept":
      "*/*",

    "Accept-Language":
      "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",

    "Referer":
      referer,

    "Origin":
      NOWCAST,

    "Sec-Fetch-Site":
      "same-origin",

    "Sec-Fetch-Mode":
      "cors",

    "Sec-Fetch-Dest":
      "empty"
  };
}



// ============================================================
// AUTHENTICATED NOWCAST REQUEST
// ============================================================

async function nowcastFetch(url, options = {}) {
  const tokenResult =
    await getNowcastToken();

  if (!tokenResult.ok) {
    return {
      ok: false,
      status: tokenResult.status || 502,
      tokenError: true,
      tokenResult
    };
  }

  const token =
    tokenResult.token;

  const separator =
    url.includes("?") ? "&" : "?";

  const authenticatedUrl =
    `${url}${separator}token=${encodeURIComponent(token)}`;

  const headers = {
    ...browserHeaders(DEMO_URL),
    ...(options.headers || {})
  };

  let response;

  try {
    response = await fetch(
      authenticatedUrl,
      {
        ...options,
        headers
      }
    );
  } catch (error) {
    return {
      ok: false,
      status: 502,
      networkError: true,
      error:
        error?.message || String(error)
    };
  }

  // Если token успел протухнуть,
  // получаем новый и пробуем ещё раз.

  if (response.status === 403) {
    const retryToken =
      await getNowcastToken();

    if (retryToken.ok) {
      const retryUrl =
        `${url}?token=${encodeURIComponent(
          retryToken.token
        )}`;

      try {
        response = await fetch(
          retryUrl,
          {
            ...options,
            headers: {
              ...browserHeaders(DEMO_URL),
              ...(options.headers || {})
            }
          }
        );
      } catch (error) {
        return {
          ok: false,
          status: 502,
          networkError: true,
          error:
            error?.message || String(error)
        };
      }
    }
  }

  return response;
}



// ============================================================
// GETCAPABILITIES / TIMES
// ============================================================

async function getNowcastTimes() {
  const started = Date.now();

  const url =
    `${WMS_URL}` +
    `?SERVICE=WMS` +
    `&VERSION=1.1.1` +
    `&REQUEST=GetCapabilities`;

  const response =
    await nowcastFetch(url);

  // nowcastFetch может вернуть объект ошибки
  if (!response || typeof response.text !== "function") {
    return {
      ok: false,
      httpStatus:
        response?.status || 502,
      error:
        response?.tokenError
          ? "Could not obtain Nowcast token"
          : "Could not request Nowcast",
      details: response,
      durationMs:
        Date.now() - started
    };
  }

  const text =
    await response.text();

  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      error:
        "Nowcast GetCapabilities failed",
      nowcastStatus:
        response.status,
      contentType:
        response.headers.get("content-type"),
      bodyPreview:
        text.slice(0, 3000),
      durationMs:
        Date.now() - started
    };
  }

  const times =
    extractTimes(text);

  return {
    ok: true,
    source: "nowcast",
    layer: "bufr_dbz1",
    status: response.status,
    count: times.length,
    times,
    durationMs:
      Date.now() - started
  };
}



// ============================================================
// RADAR IMAGE / GetMap
// ============================================================

async function getNowcastImage(req, res) {
  const time =
    req.query.time;

  if (!time) {
    return res.status(400).json({
      ok: false,
      error:
        "Missing time parameter",
      example:
        "/api/radar?action=nowcast-image&time=2026-09-13T12:00:00Z"
    });
  }

  const bbox =
    String(
      req.query.bbox ||
      "20,40,180,82"
    );

  const width =
    clamp(
      Number(req.query.width || 1200),
      256,
      2048
    );

  const height =
    clamp(
      Number(req.query.height || 800),
      256,
      2048
    );


  const params =
    new URLSearchParams({
      SERVICE: "WMS",
      VERSION: "1.1.1",
      REQUEST: "GetMap",

      // Именно отражаемость
      LAYERS:
        "bufr_dbz1",

      STYLES: "",

      SRS:
        "EPSG:4326",

      BBOX:
        bbox,

      WIDTH:
        String(width),

      HEIGHT:
        String(height),

      FORMAT:
        "image/png",

      TRANSPARENT:
        "true",

      TIME:
        String(time)
    });


  const url =
    `${WMS_URL}?${params.toString()}`;


  const response =
    await nowcastFetch(url);


  if (
    !response ||
    typeof response.arrayBuffer !== "function"
  ) {
    return res.status(502).json({
      ok: false,
      error:
        "Could not request Nowcast image",
      details:
        response
    });
  }


  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );


  const contentType =
    response.headers.get(
      "content-type"
    ) || "";


  if (!response.ok) {
    return res.status(502).json({
      ok: false,
      error:
        "Nowcast GetMap failed",
      nowcastStatus:
        response.status,
      contentType,
      bodyPreview:
        buffer
          .toString("utf8")
          .slice(0, 3000)
    });
  }


  if (
    !contentType.includes("image/png") &&
    !isPng(buffer)
  ) {
    return res.status(502).json({
      ok: false,
      error:
        "Nowcast returned non-PNG",
      nowcastStatus:
        response.status,
      contentType,
      bodyPreview:
        buffer
          .toString("utf8")
          .slice(0, 1500)
    });
  }


  res.statusCode = 200;

  res.setHeader(
    "Content-Type",
    "image/png"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  return res.end(buffer);
}



// ============================================================
// VECTOR
// ============================================================

async function getNowcastVector(req) {
  const time =
    req.query.time ||
    new Date().toISOString();

  const title =
    req.query.title ||
    "bufr_dbz1";


  const params =
    new URLSearchParams({
      time:
        String(time),

      title:
        String(title)
    });


  const url =
    `${VECTOR_URL}?${params.toString()}`;


  const response =
    await nowcastFetch(url);


  if (
    !response ||
    typeof response.text !== "function"
  ) {
    return {
      ok: false,
      httpStatus: 502,
      error:
        "Could not request Nowcast vector",
      details:
        response
    };
  }


  const text =
    await response.text();


  if (!response.ok) {
    return {
      ok: false,
      httpStatus:
        response.status,
      error:
        "Nowcast vector request failed",
      status:
        response.status,
      contentType:
        response.headers.get(
          "content-type"
        ),
      bodyPreview:
        text.slice(0, 3000)
    };
  }


  let json;

  try {
    json =
      JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      httpStatus: 502,
      error:
        "Nowcast returned invalid JSON",
      bodyPreview:
        text.slice(0, 3000)
    };
  }


  const points =
    extractRawPoints(json);


  return {
    ok: true,
    source: "nowcast",
    layer: title,
    time,
    count:
      points.length,
    maximum:
      calculateMaximum(points),
    stats:
      calculateStats(points),
    cells:
      detectCells(points),
    points
  };
}



// ============================================================
// DIAGNOSTIC
// ============================================================

async function diagnostic() {
  const started =
    Date.now();

  const report = {
    ok: false,
    service:
      "CLOrad → Nowcast token diagnostic",

    nowcast:
      NOWCAST,

    requests: []
  };


  // ----------------------------------------------------------
  // 1. Homepage
  // ----------------------------------------------------------

  await diagnosticRequest(
    report,
    "homepage",
    HOME_URL()
  );


  // ----------------------------------------------------------
  // 2. demo.html
  // ----------------------------------------------------------

  await diagnosticRequest(
    report,
    "demo",
    DEMO_URL
  );


  // ----------------------------------------------------------
  // 3. /get_token
  // ----------------------------------------------------------

  const tokenResult =
    await getNowcastToken();


  report.requests.push({
    name:
      "get_token",

    url:
      TOKEN_URL,

    status:
      tokenResult.status,

    ok:
      tokenResult.ok,

    durationMs:
      tokenResult.durationMs,

    tokenReceived:
      Boolean(tokenResult.token),

    tokenLength:
      tokenResult.token
        ? tokenResult.token.length
        : 0,

    error:
      tokenResult.error || null,

    body:
      tokenResult.body || null
  });


  // ----------------------------------------------------------
  // 4. GetCapabilities WITH token
  // ----------------------------------------------------------

  const capabilitiesUrl =
    `${WMS_URL}` +
    `?SERVICE=WMS` +
    `&VERSION=1.1.1` +
    `&REQUEST=GetCapabilities`;


  if (tokenResult.ok) {
    await diagnosticAuthenticatedRequest(
      report,
      "GetCapabilities_with_token",
      capabilitiesUrl,
      tokenResult.token
    );
  } else {
    report.requests.push({
      name:
        "GetCapabilities_with_token",

      skipped:
        true,

      reason:
        "Token could not be obtained"
    });
  }


  // ----------------------------------------------------------
  // 5. VECTOR WITH TOKEN
  // ----------------------------------------------------------

  if (tokenResult.ok) {
    const vectorUrl =
      `${VECTOR_URL}` +
      `?time=${encodeURIComponent(
        new Date().toISOString()
      )}` +
      `&title=bufr_dbz1`;

    await diagnosticAuthenticatedRequest(
      report,
      "vector_with_token",
      vectorUrl,
      tokenResult.token
    );
  }


  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------

  const failed =
    report.requests.filter(
      request =>
        request.ok === false &&
        !request.skipped
    );


  report.ok =
    failed.length === 0;


  report.summary = {
    durationMs:
      Date.now() - started,

    totalRequests:
      report.requests.length,

    failedRequests:
      failed.length,

    statuses:
      report.requests.map(
        request => ({
          name:
            request.name,

          status:
            request.status ?? null,

          ok:
            request.ok ?? null,

          skipped:
            request.skipped || false
        })
      )
  };


  return report;
}



// ============================================================
// DIAGNOSTIC REQUEST
// ============================================================

async function diagnosticRequest(
  report,
  name,
  url
) {
  const started =
    Date.now();

  const entry = {
    name,
    url,
    method: "GET",
    status: null,
    ok: false,
    contentType: null,
    bodyPreview: null,
    durationMs: null,
    error: null
  };


  try {
    const response =
      await fetch(url, {
        headers:
          browserHeaders(url)
      });


    entry.status =
      response.status;

    entry.ok =
      response.ok;

    entry.contentType =
      response.headers.get(
        "content-type"
      );


    const text =
      await response.text();


    entry.bodyPreview =
      text
        .slice(0, 1500)
        .replace(/\s+/g, " ")
        .trim();

  } catch (error) {
    entry.error =
      error?.message ||
      String(error);
  }


  entry.durationMs =
    Date.now() - started;


  report.requests.push(entry);

  return entry;
}



// ============================================================
// AUTHENTICATED DIAGNOSTIC
// ============================================================

async function diagnosticAuthenticatedRequest(
  report,
  name,
  url,
  token
) {
  const started =
    Date.now();


  const authenticatedUrl =
    `${url}&token=${encodeURIComponent(token)}`;


  const entry = {
    name,
    url: authenticatedUrl
      .replace(
        /token=[^&]+/,
        "token=***"
      ),
    method: "GET",
    status: null,
    ok: false,
    contentType: null,
    bodyPreview: null,
    durationMs: null,
    error: null,
    tokenUsed: true
  };


  try {
    const response =
      await fetch(
        authenticatedUrl,
        {
          headers:
            browserHeaders(DEMO_URL)
        }
      );


    entry.status =
      response.status;

    entry.ok =
      response.ok;

    entry.contentType =
      response.headers.get(
        "content-type"
      );


    const text =
      await response.text();


    entry.bodyPreview =
      text
        .slice(0, 1500)
        .replace(/\s+/g, " ")
        .trim();

  } catch (error) {
    entry.error =
      error?.message ||
      String(error);
  }


  entry.durationMs =
    Date.now() - started;


  report.requests.push(entry);

  return entry;
}



// ============================================================
// TIMES PARSER
// ============================================================

function extractTimes(xml) {
  const times = [];

  const regex =
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;


  const matches =
    xml.match(regex) || [];


  for (const value of matches) {
    if (!times.includes(value)) {
      times.push(value);
    }
  }


  return times.sort();
}



// ============================================================
// PNG
// ============================================================

function isPng(buffer) {
  if (
    !buffer ||
    buffer.length < 8
  ) {
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



// ============================================================
// MISC
// ============================================================

function clamp(
  value,
  min,
  max
) {
  if (
    !Number.isFinite(value)
  ) {
    return min;
  }

  return Math.max(
    min,
    Math.min(max, value)
  );
}


function number(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function normalizePoint(point) {
  if (Array.isArray(point)) {
    return {
      lat:
        number(point[0]),

      lon:
        number(point[1]),

      value:
        number(point[2]),

      direction:
        number(point[3])
    };
  }


  if (
    point &&
    typeof point === "object"
  ) {
    return {
      lat:
        number(
          point.lat ??
          point.latitude
        ),

      lon:
        number(
          point.lon ??
          point.lng ??
          point.longitude
        ),

      value:
        number(
          point.value ??
          point.dbz ??
          point.reflectivity
        ),

      direction:
        number(
          point.direction ??
          point.dir
        )
    };
  }


  return null;
}



// ============================================================
// VECTOR PARSER
// ============================================================

function extractRawPoints(data) {
  const result = [];


  function walk(value) {
    if (Array.isArray(value)) {
      const point =
        normalizePoint(value);


      if (
        point &&
        point.lat !== null &&
        point.lon !== null &&
        point.value !== null
      ) {
        result.push(point);
        return;
      }


      for (
        const item of value
      ) {
        walk(item);
      }

      return;
    }


    if (
      value &&
      typeof value === "object"
    ) {
      const point =
        normalizePoint(value);


      if (
        point &&
        point.lat !== null &&
        point.lon !== null &&
        point.value !== null
      ) {
        result.push(point);
        return;
      }


      for (
        const item of Object.values(value)
      ) {
        walk(item);
      }
    }
  }


  walk(data);

  return result;
}



// ============================================================
// STATISTICS
// ============================================================

function calculateMaximum(points) {
  if (!points.length) {
    return null;
  }


  return points.reduce(
    (max, point) =>
      point.value > max.value
        ? point
        : max,
    points[0]
  );
}


function calculateStats(points) {
  if (!points.length) {
    return {
      count: 0,
      min: null,
      max: null,
      average: null
    };
  }


  const values =
    points
      .map(
        point => point.value
      )
      .filter(
        Number.isFinite
      );


  if (!values.length) {
    return {
      count:
        points.length,

      min: null,
      max: null,
      average: null
    };
  }


  const min =
    Math.min(...values);

  const max =
    Math.max(...values);


  const average =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / values.length;


  return {
    count:
      points.length,

    min,
    max,
    average
  };
}



// ============================================================
// CELLS
// ============================================================

function detectCells(points) {
  return points
    .filter(
      point =>
        point.value !== null &&
        point.value >= 40
    )
    .sort(
      (a, b) =>
        b.value - a.value
    )
    .slice(0, 100);
}



// ============================================================
// HOME URL
// ============================================================

function HOME_URL() {
  return NOWCAST + "/";
}
