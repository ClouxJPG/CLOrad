// ============================================================
// CLOrad — iDarkMeteo binary/raster proxy
//
// Vercel Environment Variable:
// IDARKMETEO_KEY
//
// IMPORTANT:
// .rdr НЕ конвертируется здесь.
// Бинарные данные передаются клиенту без изменения.
// ============================================================

export default async function handler(req, res) {
  // ----------------------------------------------------------
  // CORS
  // ----------------------------------------------------------

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  // ----------------------------------------------------------
  // API KEY
  // ----------------------------------------------------------

  const key = process.env.IDARKMETEO_KEY;

  if (!key) {
    console.error(
      "[CLOrad] IDARKMETEO_KEY is missing"
    );

    return res.status(500).json({
      ok: false,
      error: "IDARKMETEO_KEY is not configured"
    });
  }

  // ----------------------------------------------------------
  // PATH
  // ----------------------------------------------------------

  let path = req.query?.path;

  if (!path || typeof path !== "string") {
    return res.status(400).json({
      ok: false,
      error: "Missing path"
    });
  }

  try {
    path = decodeURIComponent(path);
  } catch {
    return res.status(400).json({
      ok: false,
      error: "Invalid encoded path"
    });
  }

  // ----------------------------------------------------------
  // SECURITY
  // ----------------------------------------------------------

  if (
    path.includes("://") ||
    path.startsWith("//") ||
    path.includes("\0")
  ) {
    return res.status(400).json({
      ok: false,
      error: "Invalid path"
    });
  }

  if (!path.startsWith("/")) {
    path = "/" + path;
  }

  // ----------------------------------------------------------
  // UPSTREAM
  //
  // Put the REAL Idarkmeteo API base URL here.
  //
  // Do NOT add .png here.
  // Do NOT modify .rdr.
  // ----------------------------------------------------------

  const BASE_URL =
    process.env.IDARKMETEO_BASE_URL;

  if (!BASE_URL) {
    console.error(
      "[CLOrad] IDARKMETEO_BASE_URL is missing"
    );

    return res.status(500).json({
      ok: false,
      error:
        "IDARKMETEO_BASE_URL is not configured"
    });
  }

  // ----------------------------------------------------------
  // BUILD URL
  // ----------------------------------------------------------

  let target;

  try {
    target = new URL(path, BASE_URL);
  } catch (error) {
    console.error(
      "[CLOrad] Invalid upstream URL:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Invalid Idarkmeteo URL"
    });
  }

  // ----------------------------------------------------------
  // COPY QUERY PARAMETERS
  //
  // Everything except "path" is forwarded.
  // This allows CLOrad to use:
  //
  // ?path=...
  // ?time=...
  // ?product=...
  // ?width=...
  // ?height=...
  // etc.
  // ----------------------------------------------------------

  for (const [name, value] of Object.entries(
    req.query || {}
  )) {
    if (name === "path") continue;

    if (Array.isArray(value)) {
      for (const v of value) {
        target.searchParams.append(
          name,
          String(v)
        );
      }
    } else if (value !== undefined) {
      target.searchParams.set(
        name,
        String(value)
      );
    }
  }

  // ----------------------------------------------------------
  // AUTHENTICATION
  //
  // The key stays server-side.
  //
  // Current implementation sends it as:
  // ?key=...
  //
  // If iDarkMeteo expects another parameter/header,
  // only this section needs changing.
  // ----------------------------------------------------------

  target.searchParams.set("key", key);

  // ----------------------------------------------------------
  // REQUEST
  // ----------------------------------------------------------

  console.log(
    "[CLOrad] Idarkmeteo request:",
    target.pathname
  );

  let response;

  try {
    response = await fetch(target.toString(), {
      method: "GET",
      headers: {
        "Accept":
          "application/octet-stream,image/png,image/tiff,*/*",
        "User-Agent":
          "CLOrad/1.0"
      },
      redirect: "follow"
    });
  } catch (error) {
    console.error(
      "[CLOrad] Upstream connection failed:",
      error
    );

    return res.status(502).json({
      ok: false,
      error: "Idarkmeteo upstream connection failed",
      detail: String(error?.message || error)
    });
  }

  // ----------------------------------------------------------
  // UPSTREAM ERROR
  // ----------------------------------------------------------

  if (!response.ok) {
    const contentType =
      response.headers.get("content-type") || "";

    let detail = "";

    if (
      contentType.includes("json") ||
      contentType.includes("text")
    ) {
      try {
        detail = await response.text();

        // Prevent gigantic error responses.
        if (detail.length > 2000) {
          detail = detail.slice(0, 2000);
        }
      } catch {}
    }

    console.error(
      "[CLOrad] Idarkmeteo HTTP",
      response.status,
      detail
    );

    return res.status(response.status).json({
      ok: false,
      error:
        "Idarkmeteo returned HTTP " +
        response.status,
      detail
    });
  }

  // ----------------------------------------------------------
  // BINARY RESPONSE
  // ----------------------------------------------------------

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  const contentType =
    response.headers.get("content-type") ||
    "application/octet-stream";

  // ----------------------------------------------------------
  // CACHE
  // ----------------------------------------------------------

  res.setHeader(
    "Cache-Control",
    "public, max-age=10, s-maxage=10"
  );

  res.setHeader(
    "Content-Type",
    contentType
  );

  res.setHeader(
    "Content-Length",
    String(buffer.length)
  );

  // ----------------------------------------------------------
  // DEBUG HEADERS
  // ----------------------------------------------------------

  res.setHeader(
    "X-CLOrad-Upstream",
    "iDarkMeteo"
  );

  res.setHeader(
    "X-CLOrad-Bytes",
    String(buffer.length)
  );

  // ----------------------------------------------------------
  // SEND ORIGINAL BINARY DATA
  // ----------------------------------------------------------

  return res.status(200).send(buffer);
}
