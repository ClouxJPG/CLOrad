// api/radar.js

const NOWCAST = "https://www.nowcast.ru";
const DEMO_URL = `${NOWCAST}/demo/demo.html`;
const HOME_URL = `${NOWCAST}/`;

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
    if (action === "diagnostic") {
      const result = await diagnostic();
      return res.status(result.httpStatus || 200).json(result);
    }

    if (action === "nowcast-times") {
      const result = await getNowcastTimes();
      return res.status(result.httpStatus || 200).json(result);
    }

    if (action === "nowcast-image") {
      return await getNowcastImage(req, res);
    }

    if (action === "nowcast") {
      const result = await getNowcastVector(req);
      return res.status(result.httpStatus || 200).json(result);
    }

    if (action === "status") {
      return res.status(200).json({
        ok: true,
        service: "CLOrad radar API",
        nowcast: true,
        diagnostic: "/api/radar?action=diagnostic",
        times: "/api/radar?action=nowcast-times",
        image: "/api/radar?action=nowcast-image&time=YYYY-MM-DDTHH:mm:ssZ"
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Unknown action",
      action,
      available: [
        "status",
        "diagnostic",
        "nowcast-times",
        "nowcast",
        "nowcast-image"
      ]
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


/* =========================================================
   DIAGNOSTICS
   ========================================================= */

async function diagnostic() {
  const started = Date.now();

  const report = {
    ok: false,
    service: "CLOrad → Nowcast diagnostic",
    startedAt: new Date().toISOString(),
    nowcast: NOWCAST,
    requests: [],
    summary: null
  };

  // -------------------------------------------------------
  // 1. Главная страница
  // -------------------------------------------------------

  await diagnosticFetch(
    report,
    "homepage",
    HOME_URL,
    {
      headers: browserHeaders(HOME_URL)
    }
  );

  // -------------------------------------------------------
  // 2. demo.html
  // -------------------------------------------------------

  await diagnosticFetch(
    report,
    "demo",
    DEMO_URL,
    {
      headers: browserHeaders(DEMO_URL)
    }
  );

  // -------------------------------------------------------
  // 3. GetCapabilities БЕЗ cookies
  // -------------------------------------------------------

  const capabilitiesUrl =
    `${NOWCAST}/baltrad_wsgi` +
    `?SERVICE=WMS` +
    `&VERSION=1.1.1` +
    `&REQUEST=GetCapabilities`;

  await diagnosticFetch(
    report,
    "GetCapabilities_without_session",
    capabilitiesUrl,
    {
      headers: browserHeaders(DEMO_URL)
    }
  );

  // -------------------------------------------------------
  // 4. Создаём сессию
  // -------------------------------------------------------

  const session = await createNowcastSession(report);

  report.session = {
    cookieCount: session.cookies.length,
    cookies: session.cookies.map(maskCookie),
    cookieHeaderLength: session.cookieHeader.length
  };

  // -------------------------------------------------------
  // 5. GetCapabilities С cookies
  // -------------------------------------------------------

  await diagnosticFetch(
    report,
    "GetCapabilities_with_session",
    capabilitiesUrl,
    {
      headers: {
        ...browserHeaders(DEMO_URL),
        Cookie: session.cookieHeader
      }
    }
  );

  // -------------------------------------------------------
  // Итог
  // -------------------------------------------------------

  const failed = report.requests.filter(
    x => x.status >= 400 || x.error
  );

  report.ok = failed.length === 0;

  report.summary = {
    durationMs: Date.now() - started,
    totalRequests: report.requests.length,
    failedRequests: failed.length,
    first403: report.requests.find(x => x.status === 403)?.name || null,
    statuses: report.requests.map(x => ({
      name: x.name,
      status: x.status,
      ok: x.ok
    }))
  };

  return report;
}


/* =========================================================
   DIAGNOSTIC FETCH
   ========================================================= */

async function diagnosticFetch(report, name, url, options = {}) {
  const started = Date.now();

  const entry = {
    name,
    url,
    method: options.method || "GET",
    startedAt: new Date().toISOString(),
    status: null,
    ok: false,
    contentType: null,
    contentLength: null,
    durationMs: null,
    location: null,
    setCookie: null,
    bodyPreview: null,
    error: null
  };

  try {
    const response = await fetch(url, {
      redirect: "manual",
      ...options
    });

    entry.status = response.status;
    entry.ok = response.ok;
    entry.contentType =
      response.headers.get("content-type");

    entry.contentLength =
      response.headers.get("content-length");

    entry.location =
      response.headers.get("location");

    entry.setCookie =
      getSetCookieArray(response.headers)
        .map(maskCookie);

    const text = await response.text();

    entry.bodyPreview = text
      .slice(0, 1500)
      .replace(/\s+/g, " ")
      .trim();

  } catch (error) {
    entry.error =
      error?.message || String(error);
  }

  entry.durationMs = Date.now() - started;

  report.requests.push(entry);

  return entry;
}


/* =========================================================
   NOWCAST SESSION
   ========================================================= */

async function createNowcastSession(report = null) {
  const cookies = new Map();

  const pages = [
    {
      name: "session_homepage",
      url: HOME_URL
    },
    {
      name: "session_demo",
      url: DEMO_URL
    }
  ];

  for (const page of pages) {
    try {
      const response = await fetch(page.url, {
        redirect: "follow",
        headers: browserHeaders(page.url)
      });

      const setCookies =
        getSetCookieArray(response.headers);

      for (const cookie of setCookies) {
        const parsed = parseCookie(cookie);

        if (parsed) {
          cookies.set(parsed.name, parsed.value);
        }
      }

      if (report) {
        report.requests.push({
          name: page.name,
          url: page.url,
          method: "GET",
          status: response.status,
          ok: response.ok,
          contentType:
            response.headers.get("content-type"),
          contentLength:
            response.headers.get("content-length"),
          setCookie:
            setCookies.map(maskCookie),
          cookieNames:
            Array.from(cookies.keys()),
          durationMs: null
        });
      }

      // Не нужно читать всю HTML-страницу.
      // Просто закрываем body.
      try {
        await response.body?.cancel();
      } catch (_) {}

    } catch (error) {
      if (report) {
        report.requests.push({
          name: page.name,
          url: page.url,
          status: null,
          ok: false,
          error:
            error?.message || String(error)
        });
      }
    }
  }

  const cookieHeader = Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  return {
    cookies: Array.from(cookies.entries()).map(
      ([name, value]) => `${name}=${value}`
    ),
    cookieHeader
  };
}


/* =========================================================
   NOWCAST FETCH
   ========================================================= */

async function nowcastFetch(url, options = {}) {
  const session = await createNowcastSession();

  const headers = {
    ...browserHeaders(DEMO_URL),
    ...(options.headers || {})
  };

  if (session.cookieHeader) {
    headers.Cookie = session.cookieHeader;
  }

  let response = await fetch(url, {
    ...options,
    headers
  });

  // Повторяем один раз при 403.
  if (response.status === 403) {
    const retrySession = await createNowcastSession();

    const retryHeaders = {
      ...browserHeaders(DEMO_URL),
      ...(options.headers || {})
    };

    if (retrySession.cookieHeader) {
      retryHeaders.Cookie =
        retrySession.cookieHeader;
    }

    response = await fetch(url, {
      ...options,
      headers: retryHeaders
    });
  }

  return response;
}


/* =========================================================
   NOWCAST TIMES
   ========================================================= */

async function getNowcastTimes() {
  const url =
    `${NOWCAST}/baltrad_wsgi` +
    `?SERVICE=WMS` +
    `&VERSION=1.1.1` +
    `&REQUEST=GetCapabilities`;

  const response = await nowcastFetch(url);

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      error: "Nowcast GetCapabilities failed",
      status: response.status,
      contentType:
        response.headers.get("content-type"),
      bodyPreview: text.slice(0, 3000)
    };
  }

  const times = extractTimes(text);

  return {
    ok: true,
    source: "nowcast",
    status: response.status,
    count: times.length,
    times
  };
}


/* =========================================================
   NOWCAST IMAGE
   ========================================================= */

async function getNowcastImage(req, res) {
  const time = req.query.time;

  if (!time) {
    return res.status(400).json({
      ok: false,
      error: "Missing time parameter"
    });
  }

  const bbox = String(
    req.query.bbox ||
    "20,40,180,82"
  );

  const width = clamp(
    Number(req.query.width || 1200),
    256,
    2048
  );

  const height = clamp(
    Number(req.query.height || 800),
    256,
    2048
  );

  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: "bufr_dbz1",
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX: bbox,
    WIDTH: String(width),
    HEIGHT: String(height),
    FORMAT: "image/png",
    TRANSPARENT: "true",
    TIME: String(time)
  });

  const url =
    `${NOWCAST}/baltrad_wsgi?${params}`;

  const response = await nowcastFetch(url);

  const buffer =
    Buffer.from(await response.arrayBuffer());

  const contentType =
    response.headers.get("content-type") || "";

  if (!response.ok) {
    return res.status(502).json({
      ok: false,
      error: "Nowcast GetMap failed",
      nowcastStatus: response.status,
      contentType,
      bodyPreview:
        buffer.toString("utf8").slice(0, 3000)
    });
  }

  if (
    !contentType.includes("image/png") &&
    !isPng(buffer)
  ) {
    return res.status(502).json({
      ok: false,
      error: "Nowcast returned non-PNG",
      nowcastStatus: response.status,
      contentType,
      bodyPreview:
        buffer.toString("utf8").slice(0, 1000)
    });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");

  return res.end(buffer);
}


/* =========================================================
   VECTOR
   ========================================================= */

async function getNowcastVector(req) {
  const time =
    req.query.time ||
    new Date().toISOString();

  const url =
    `${NOWCAST}/vector_wsgi` +
    `?time=${encodeURIComponent(time)}` +
    `&title=bufr_dbz1`;

  const response =
    await nowcastFetch(url);

  const text =
    await response.text();

  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      error: "Nowcast vector request failed",
      status: response.status,
      contentType:
        response.headers.get("content-type"),
      bodyPreview: text.slice(0, 3000)
    };
  }

  let json;

  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      httpStatus: 502,
      error: "Nowcast returned invalid JSON",
      bodyPreview: text.slice(0, 3000)
    };
  }

  const points =
    extractRawPoints(json);

  return {
    ok: true,
    source: "nowcast",
    time,
    count: points.length,
    maximum: calculateMaximum(points),
    stats: calculateStats(points),
    cells: detectCells(points),
    points
  };
}


/* =========================================================
   HELPERS
   ========================================================= */

function browserHeaders(referer = DEMO_URL) {
  return {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
      "Version/18.0 Mobile/15E148 Safari/604.1",

    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9," +
      "image/avif,image/webp,image/apng,*/*;q=0.8",

    "Accept-Language":
      "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",

    "Referer": referer,

    "Origin": NOWCAST,

    "Sec-Fetch-Site": "same-origin",

    "Sec-Fetch-Mode": "cors",

    "Sec-Fetch-Dest": "empty",

    "Connection": "keep-alive"
  };
}


function getSetCookieArray(headers) {
  try {
    if (typeof headers.getSetCookie === "function") {
      return headers.getSetCookie() || [];
    }
  } catch (_) {}

  const raw =
    headers.get("set-cookie");

  if (!raw) return [];

  return raw
    .split(/,(?=[^;,]+=)/)
    .map(x => x.trim())
    .filter(Boolean);
}


function parseCookie(cookie) {
  const first = cookie.split(";")[0];

  const index = first.indexOf("=");

  if (index <= 0) {
    return null;
  }

  return {
    name: first.slice(0, index).trim(),
    value: first.slice(index + 1).trim()
  };
}


function maskCookie(cookie) {
  const parsed =
    parseCookie(cookie);

  if (!parsed) {
    return "***";
  }

  return `${parsed.name}=***`;
}


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


function isPng(buffer) {
  if (!buffer || buffer.length < 8) {
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


function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}


function number(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function normalizePoint(point) {
  if (Array.isArray(point)) {
    return {
      lat: number(point[0]),
      lon: number(point[1]),
      value: number(point[2]),
      direction: number(point[3])
    };
  }

  if (point && typeof point === "object") {
    return {
      lat: number(
        point.lat ??
        point.latitude
      ),

      lon: number(
        point.lon ??
        point.lng ??
        point.longitude
      ),

      value: number(
        point.value ??
        point.dbz ??
        point.reflectivity
      ),

      direction: number(
        point.direction ??
        point.dir
      )
    };
  }

  return null;
}


function extractRawPoints(data) {
  const result = [];

  function walk(value) {
    if (Array.isArray(value)) {
      const p =
        normalizePoint(value);

      if (
        p &&
        p.lat !== null &&
        p.lon !== null &&
        p.value !== null
      ) {
        result.push(p);
        return;
      }

      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (
      value &&
      typeof value === "object"
    ) {
      const p =
        normalizePoint(value);

      if (
        p &&
        p.lat !== null &&
        p.lon !== null &&
        p.value !== null
      ) {
        result.push(p);
        return;
      }

      for (const item of Object.values(value)) {
        walk(item);
      }
    }
  }

  walk(data);

  return result;
}


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
      .map(p => p.value)
      .filter(Number.isFinite);

  if (!values.length) {
    return {
      count: points.length,
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
      (sum, value) => sum + value,
      0
    ) / values.length;

  return {
    count: points.length,
    min,
    max,
    average
  };
}


function detectCells(points) {
  return points
    .filter(
      p =>
        p.value !== null &&
        p.value >= 40
    )
    .sort(
      (a, b) =>
        b.value - a.value
    )
    .slice(0, 100);
}
