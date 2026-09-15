export default async function handler(req) {
  const UPSTREAM = "https://idarkmeteo.host/api/v1/";
  const key = process.env.IDARKMETEO_KEY;

  const responseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  };

  if (!key) {
    return new Response(
      "IDARKMETEO_KEY is not configured",
      {
        status: 500,
        headers: {
          ...responseHeaders,
          "Content-Type": "text/plain; charset=utf-8"
        }
      }
    );
  }

  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...responseHeaders,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  const requestedPath =
    url.searchParams.get("path");

  if (!requestedPath) {
    return new Response(
      "Missing path",
      {
        status: 400,
        headers: {
          ...responseHeaders,
          "Content-Type": "text/plain; charset=utf-8"
        }
      }
    );
  }

  /*
   * ---------------------------------------------------------
   * SECURITY
   * ---------------------------------------------------------
   */

  if (
    requestedPath.startsWith("/") ||
    requestedPath.includes("..") ||
    requestedPath.includes("\\") ||
    requestedPath.includes("\0")
  ) {
    return new Response(
      "Invalid Idarkmeteo path",
      {
        status: 400,
        headers: {
          ...responseHeaders,
          "Content-Type": "text/plain; charset=utf-8"
        }
      }
    );
  }

  /*
   * ---------------------------------------------------------
   * Разрешённые metadata-файлы
   *
   * frames/rain/wide.json
   * frames/phenomena/dmrl.json
   * frames/cloudphase/swath.json
   * frames/smoke/swath.json
   * frames/satrain/coarse.json
   * ---------------------------------------------------------
   */

  const isFrameIndex =
    /^frames\/[a-z]+\/[a-z0-9_-]+\.json$/i
      .test(requestedPath);

  /*
   * ---------------------------------------------------------
   * Обычные PNG
   * ---------------------------------------------------------
   */

  const isPng =
    /^(data|latest|archive|day)\/[a-z]+\/[a-z0-9_-]+\/.+\.png$/i
      .test(requestedPath);

  /*
   * ---------------------------------------------------------
   * Живой frames.json может содержать .rdr:
   *
   * data/rain/wide/20260915/0700.rdr
   *
   * Для отображения используем соответствующий
   * архивный PNG:
   *
   * archive/rain/wide/20260915/0700.png
   * ---------------------------------------------------------
   */

  const rdrMatch =
    requestedPath.match(
      /^data\/([a-z]+)\/([a-z0-9_-]+)\/(\d{8})\/(\d{4})\.rdr$/i
    );

  let upstreamPath =
    requestedPath;

  if (rdrMatch) {
    upstreamPath =
      "archive/" +
      rdrMatch[1] +
      "/" +
      rdrMatch[2] +
      "/" +
      rdrMatch[3] +
      "/" +
      rdrMatch[4] +
      ".png";
  }

  const allowed =
    isFrameIndex ||
    isPng ||
    !!rdrMatch;

  if (!allowed) {
    return new Response(
      "Invalid Idarkmeteo path",
      {
        status: 400,
        headers: {
          ...responseHeaders,
          "Content-Type": "text/plain; charset=utf-8"
        }
      }
    );
  }

  const target =
    UPSTREAM +
    upstreamPath;

  console.log(
    "Idarkmeteo:",
    requestedPath,
    "=>",
    upstreamPath
  );

  try {
    const upstreamResponse =
      await fetch(
        target,
        {
          method: "GET",
          headers: {
            "X-API-Key": key,
            "Accept":
              upstreamPath.endsWith(".json")
                ? "application/json"
                : "image/png"
          },
          cache: "no-store"
        }
      );

    if (!upstreamResponse.ok) {
      const text =
        await upstreamResponse.text();

      console.error(
        "Idarkmeteo upstream error:",
        upstreamResponse.status,
        requestedPath,
        upstreamPath,
        text
      );

      return new Response(
        text ||
          (
            "Idarkmeteo HTTP " +
            upstreamResponse.status
          ),
        {
          status:
            upstreamResponse.status,

          headers: {
            ...responseHeaders,
            "Content-Type":
              upstreamResponse.headers.get(
                "content-type"
              ) ||
              "text/plain; charset=utf-8"
          }
        }
      );
    }

    const headers =
      new Headers(
        responseHeaders
      );

    headers.set(
      "Content-Type",
      upstreamResponse.headers.get(
        "content-type"
      ) ||
      (
        upstreamPath.endsWith(".json")
          ? "application/json"
          : "image/png"
      )
    );

    return new Response(
      upstreamResponse.body,
      {
        status: 200,
        headers
      }
    );

  } catch (error) {

    console.error(
      "Idarkmeteo proxy failed:",
      error
    );

    return new Response(
      "Upstream fetch failed",
      {
        status: 502,
        headers: {
          ...responseHeaders,
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      }
    );
  }
}
