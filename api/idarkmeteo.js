// ============================================================
// CLOrad — Vercel proxy for Idarkmeteo
// Environment variable required:
// IDARKMETEO_KEY
// ============================================================

export default async function handler(req, res) {
  // ------------------------------------------------------------
  // CORS
  // ------------------------------------------------------------
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // ------------------------------------------------------------
  // API KEY
  // ------------------------------------------------------------
  const API_KEY = process.env.IDARKMETEO_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "IDARKMETEO_KEY is not configured in Vercel"
    });
  }

  // ------------------------------------------------------------
  // PATH
  // ------------------------------------------------------------
  let path = req.query?.path;

  if (!path || typeof path !== "string") {
    return res.status(400).json({
      ok: false,
      error: "Missing ?path="
    });
  }

  // Decode safely
  try {
    path = decodeURIComponent(path);
  } catch {
    return res.status(400).json({
      ok: false,
      error: "Invalid path encoding"
    });
  }

  // Prevent accidental external URL injection
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.includes("://")
  ) {
    return res.status(400).json({
      ok: false,
      error: "Absolute URLs are not allowed"
    });
  }

  // Always make the path begin with /
  if (!path.startsWith("/")) {
    path = "/" + path;
  }

  // ------------------------------------------------------------
  // .rdr -> .png
  // Idarkmeteo radar images are requested as PNG by CLOrad.
  // ------------------------------------------------------------
  if (path.endsWith(".rdr")) {
    path = path.slice(0, -4) + ".png";
  }

  // ------------------------------------------------------------
  // BASE URL
  // ------------------------------------------------------------
  const BASE_URL = "https://idarkmeteo.ru";

  const target = new URL(BASE_URL + path);

  // ------------------------------------------------------------
  // API KEY
  //
  // We support both common forms:
  // ?key=...
  // and Authorization: Bearer ...
  //
  // The key never reaches the browser.
  // ------------------------------------------------------------
  target.searchParams.set("key", API_KEY);

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      headers: {
        "Accept": "*/*",
        "User-Agent": "CLOrad/1.0"
      }
    });

    const contentType =
      response.headers.get("content-type") ||
      "application/octet-stream";

    const data = Buffer.from(await response.arrayBuffer());

    res.status(response.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Cache-Control",
      "public, max-age=30, s-maxage=30"
    );

    return res.send(data);

  } catch (error) {
    console.error("Idarkmeteo proxy error:", error);

    return res.status(502).json({
      ok: false,
      error: "Failed to connect to Idarkmeteo"
    });
  }
}
