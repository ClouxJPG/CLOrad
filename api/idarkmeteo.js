// ============================================================
// CLOrad — iDarkMeteo API proxy
// ============================================================
//
// Vercel Environment Variable:
//
// IDARKMETEO_KEY
//
// Upstream:
//
// https://idarkmeteo.host/api/v1/
//
// API key is NEVER exposed to browser.
// ============================================================

export default async function handler(req, res) {
  // ----------------------------------------------------------
  // CORS
  // ----------------------------------------------------------

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, HEAD, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-API-Key, Content-Type, Range, If-None-Match"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "ETag, Cache-Control, Content-Length, Content-Range, Retry-After"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (
    req.method !== "GET" &&
    req.method !== "HEAD"
  ) {
    return res.status(405).json({
      error: "method_not_allowed"
    });
  }

  // ----------------------------------------------------------
  // KEY
  // ----------------------------------------------------------

  const key = process.env.IDARKMETEO_KEY;

  if (!key) {
    console.error(
      "[CLOrad] IDARKMETEO_KEY is missing"
    );

    return res.status(500).json({
      error: "IDARKMETEO_KEY is not configured"
    });
  }

  // ----------------------------------------------------------
  // PATH
  // ----------------------------------------------------------

  let path = req.query?.path;

  if (!path || typeof path !== "string") {
    return res.status(400).json({
      error: "missing_path"
    });
  }

  try {
    path = decodeURIComponent(path);
  } catch {
    return res.status(400).json({
      error: "invalid_path"
    });
  }

  // ----------------------------------------------------------
  // SECURITY
  // ----------------------------------------------------------

  if (
    path.includes("://") ||
    path.startsWith("//") ||
    path.includes("\0") ||
    path.includes("..")
  ) {
    return res.status(400).json({
      error: "invalid_path"
    });
  }

  if (!path.startsWith("/")) {
    path = "/" + path;
  }

  // ----------------------------------------------------------
  // REAL IDARKMETEO API
  // ----------------------------------------------------------

  const API_ROOT =
    "https://idarkmeteo.host/api/v1";

  const target =
    API_ROOT + path;

  // ----------------------------------------------------------
  // REQUEST HEADERS
  // ----------------------------------------------------------

  const headers = {
    "X-API-Key": key,
    "Accept":
      "application/octet-stream,application/json,*/*",
    "User-Agent":
      "CLOrad/1.0"
  };

  // Forward Range for .rdr files.
  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  // Forward conditional requests.
  if (req.headers["if-none-match"]) {
    headers["If-None-Match"] =
      req.headers["if-none-match"];
  }

  // ----------------------------------------------------------
  // FETCH
  // ----------------------------------------------------------

  let response;

  try {
    response = await fetch(target, {
      method: req.method,
      headers,
      redirect: "follow"
    });
  } catch (error) {
    console.error(
      "[CLOrad] iDarkMeteo connection error:",
      error
    );

    return res.status(502).json({
      error: "upstream_connection_failed",
      detail: String(
        error?.message || error
      )
    });
  }

  // ----------------------------------------------------------
  // COPY IMPORTANT HEADERS
  // ----------------------------------------------------------

  const contentType =
    response.headers.get(
      "content-type"
    );

  const contentLength =
    response.headers.get(
      "content-length"
    );

  const etag =
    response.headers.get("etag");

  const cacheControl =
    response.headers.get(
      "cache-control"
    );

  const contentRange =
    response.headers.get(
      "content-range"
    );

  const retryAfter =
    response.headers.get(
      "retry-after"
    );

  if (contentType) {
    res.setHeader(
      "Content-Type",
      contentType
    );
  }

  if (contentLength) {
    res.setHeader(
      "Content-Length",
      contentLength
    );
  }

  if (etag) {
    res.setHeader(
      "ETag",
      etag
    );
  }

  if (cacheControl) {
    res.setHeader(
      "Cache-Control",
      cacheControl
    );
  }

  if (contentRange) {
    res.setHeader(
      "Content-Range",
      contentRange
    );
  }

  if (retryAfter) {
    res.setHeader(
      "Retry-After",
      retryAfter
    );
  }

  // ----------------------------------------------------------
  // ERRORS FROM IDARKMETEO
  // ----------------------------------------------------------

  if (!response.ok) {
    let body = "";

    try {
      body = await response.text();

      if (body.length > 2000) {
        body =
          body.slice(0, 2000);
      }
    } catch {}

    console.error(
      "[CLOrad] iDarkMeteo HTTP",
      response.status,
      body
    );

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    return res.status(
      response.status
    ).json({
      error:
        "idarkmeteo_http_" +
        response.status,
      upstream: body
    });
  }

  // ----------------------------------------------------------
  // HEAD
  // ----------------------------------------------------------

  if (req.method === "HEAD") {
    return res.status(
      response.status
    ).end();
  }

  // ----------------------------------------------------------
  // BINARY DATA
  //
  // IMPORTANT:
  // .rdr passes through unchanged.
  // No PNG conversion.
  // No TIFF conversion.
  // No decompression on server.
  // ----------------------------------------------------------

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  return res
    .status(response.status)
    .send(buffer);
}
