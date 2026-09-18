/* =========================================================
   CLOrad — Vercel API proxy
   iDarkMeteo binary/API proxy
   ========================================================= */

const API_ROOT =
  "https://idarkmeteo.host/api/v1";

export default async function handler(
  req,
  res
) {
  try {
    // -------------------------------------------------------
    // API key
    // -------------------------------------------------------

    const key =
      process.env.IDARKMETEO_KEY;

    if (!key) {
      return res.status(500).json({
        error:
          "IDARKMETEO_KEY is not configured"
      });
    }

    // -------------------------------------------------------
    // Path
    // -------------------------------------------------------

    const rawPath =
      req.query?.path;

    if (
      typeof rawPath !== "string" ||
      !rawPath
    ) {
      return res.status(400).json({
        error:
          "Missing path"
      });
    }

    // Prevent path traversal.
    const path =
      rawPath
        .replace(/^\/+/, "")
        .replace(/\.\./g, "");

    if (
      !path ||
      path.includes("\\")
    ) {
      return res.status(400).json({
        error:
          "Invalid path"
      });
    }

    // -------------------------------------------------------
    // Build upstream URL
    // -------------------------------------------------------

    const url =
      API_ROOT +
      "/" +
      path;

    // -------------------------------------------------------
    // Forward useful headers
    // -------------------------------------------------------

    const headers =
      new Headers();

    headers.set(
      "X-API-Key",
      key
    );

    if (
      req.headers?.range
    ) {
      headers.set(
        "Range",
        req.headers.range
      );
    }

    if (
      req.headers?.["if-none-match"]
    ) {
      headers.set(
        "If-None-Match",
        req.headers[
          "if-none-match"
        ]
      );
    }

    // -------------------------------------------------------
    // Upstream request
    // -------------------------------------------------------

    const response =
      await fetch(
        url,
        {
          method: "GET",
          headers
        }
      );

    // -------------------------------------------------------
    // 304
    // -------------------------------------------------------

    if (
      response.status === 304
    ) {
      return res
        .status(304)
        .end();
    }

    // -------------------------------------------------------
    // Copy important headers
    // -------------------------------------------------------

    const contentType =
      response.headers.get(
        "content-type"
      );

    const contentLength =
      response.headers.get(
        "content-length"
      );

    const etag =
      response.headers.get(
        "etag"
      );

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

    // -------------------------------------------------------
    // Error responses
    // -------------------------------------------------------

    if (!response.ok) {
      const text =
        await response.text();

      return res
        .status(response.status)
        .send(text);
    }

    // -------------------------------------------------------
    // Binary response
    // -------------------------------------------------------

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    return res
      .status(response.status)
      .send(buffer);

  } catch (error) {
    console.error(
      "iDarkMeteo proxy error:",
      error
    );

    return res.status(502).json({
      error:
        "iDarkMeteo proxy failed",
      message:
        error?.message ||
        String(error)
    });
  }
}
