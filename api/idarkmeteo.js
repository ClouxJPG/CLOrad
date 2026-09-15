export default async function handler(req) {
  const UPSTREAM = "https://idarkmeteo.host/api/v1/";
  const key = process.env.IDARKMETEO_KEY;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache"
  };

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers
    });
  }

  // API key
  if (!key) {
    console.error("CLOrad: IDARKMETEO_KEY is missing");

    return new Response(
      JSON.stringify({
        ok: false,
        error: "IDARKMETEO_KEY is not configured"
      }),
      {
        status: 500,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  // Read requested path
  const url = new URL(req.url);
  const path = url.searchParams.get("path");

  if (!path) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing path"
      }),
      {
        status: 400,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  // Basic path protection
  if (
    path.startsWith("/") ||
    path.includes("..") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid Idarkmeteo path",
        path
      }),
      {
        status: 400,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  // Allowed endpoints
  const isFrameJson =
    /^frames\/[a-z]+\/[a-z0-9_-]+\.json$/i.test(path);

  const isPng =
    /^(data|latest|archive|day)\/[a-z]+\/[a-z0-9_-]+\/.+\.png$/i.test(path);

  const isRdr =
    /^data\/[a-z]+\/[a-z0-9_-]+\/\d{8}\/\d{4}\.rdr$/i.test(path);

  if (!isFrameJson && !isPng && !isRdr) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid Idarkmeteo path",
        path
      }),
      {
        status: 400,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  const target = UPSTREAM + path;

  console.log("CLOrad Idarkmeteo request:", target);

  let response;

  try {
    response = await fetch(target, {
      method: "GET",

      headers: {
        "X-API-Key": key,
        "Accept": isFrameJson
          ? "application/json"
          : "*/*"
      },

      cache: "no-store"
    });
  } catch (error) {
    console.error(
      "CLOrad Idarkmeteo fetch error:",
      error
    );

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Upstream fetch failed",
        path,
        message: error?.message || String(error)
      }),
      {
        status: 502,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  // Upstream returned an error
  if (!response.ok) {
    let body = "";

    try {
      body = await response.text();
    } catch (_) {
      body = "";
    }

    console.error(
      "CLOrad Idarkmeteo upstream error:",
      response.status,
      path,
      body
    );

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Idarkmeteo upstream error",
        status: response.status,
        path,
        message: body || `HTTP ${response.status}`
      }),
      {
        status: response.status,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  // Preserve upstream content type
  const contentType =
    response.headers.get("content-type") ||
    (isFrameJson
      ? "application/json"
      : "application/octet-stream");

  const responseHeaders = new Headers(headers);

  responseHeaders.set(
    "Content-Type",
    contentType
  );

  // JSON metadata
  if (isFrameJson) {
    const text = await response.text();

    return new Response(text, {
      status: 200,
      headers: responseHeaders
    });
  }

  // PNG / RDR / binary data
  const buffer = await response.arrayBuffer();

  return new Response(buffer, {
    status: 200,
    headers: responseHeaders
  });
}
