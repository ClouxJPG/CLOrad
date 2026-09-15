export default async function handler(req) {

  const upstream =
    "https://idarkmeteo.host/api/v1/";

  const key =
    process.env.IDARKMETEO_KEY;

  if (!key) {
    return new Response(
      "IDARKMETEO_KEY is not configured",
      {
        status:500,
        headers:{
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      }
    );
  }

  const url =
    new URL(req.url);

  const originalPath =
    url.searchParams.get("path");

  if (!originalPath) {
    return new Response(
      "Missing path",
      {
        status:400
      }
    );
  }

  /*
   * =========================================================
   * SECURITY
   * =========================================================
   */

  if (
    originalPath.startsWith("/") ||
    originalPath.includes("..") ||
    originalPath.includes("\\")
  ) {
    return new Response(
      "Invalid Idarkmeteo path",
      {
        status:400
      }
    );
  }

  /*
   * =========================================================
   * FRAMES JSON
   * =========================================================
   *
   * Например:
   *
   * frames/rain/wide.json
   *
   */

  const isFramesJson =
    /^frames\/[a-z]+\/[a-z0-9_-]+\.json$/i
      .test(originalPath);

  /*
   * =========================================================
   * Обычные PNG
   * =========================================================
   */

  const isPng =
    /^(data|latest|archive|day)\/[a-z]+\/[a-z0-9_-]+\/.+\.png$/i
      .test(originalPath);

  /*
   * =========================================================
   * RDR → ARCHIVE PNG
   * =========================================================
   *
   * Живой frames.json сейчас может отдавать:
   *
   * data/rain/wide/20260915/0700.rdr
   *
   * Для отображения превращаем его в:
   *
   * archive/rain/wide/20260915/0700.png
   *
   */

  let path =
    originalPath;

  const rdrMatch =
    originalPath.match(
      /^data\/([a-z]+)\/([a-z0-9_-]+)\/(\d{8})\/(\d{4})\.rdr$/i
    );

  if (rdrMatch) {

    const product =
      rdrMatch[1];

    const mosaic =
      rdrMatch[2];

    const date =
      rdrMatch[3];

    const time =
      rdrMatch[4];

    path =
      `archive/${product}/${mosaic}/${date}/${time}.png`;
  }

  /*
   * После преобразования проверяем,
   * что путь действительно разрешён.
   */

  const allowed =
    isFramesJson ||
    isPng ||
    rdrMatch !== null;

  if (!allowed) {

    return new Response(
      "Invalid Idarkmeteo path",
      {
        status:400,
        headers:{
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      }
    );
  }

  /*
   * =========================================================
   * REQUEST
   * =========================================================
   */

  const target =
    upstream +
    path;

  try {

    const response =
      await fetch(
        target,
        {
          method:"GET",

          headers:{
            "X-API-Key":
              key,

            "Accept":
              path.endsWith(".json")
                ? "application/json"
                : "image/png"
          },

          cache:"no-store"
        }
      );

    /*
     * =======================================================
     * UPSTREAM ERROR
     * =======================================================
     */

    if (!response.ok) {

      const text =
        await response.text();

      return new Response(
        text ||
        "Upstream error",
        {
          status:
            response.status,

          headers:{
            "Content-Type":
              response.headers.get(
                "content-type"
              ) ||
              "text/plain; charset=utf-8"
          }
        }
      );
    }

    /*
     * =========================================================
     * RESPONSE
     * =========================================================
     */

    const headers =
      new Headers();

    headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    headers.set(
      "Access-Control-Allow-Origin",
      "*"
    );

    headers.set(
      "Content-Type",
      response.headers.get(
        "content-type"
      ) ||
      (
        path.endsWith(".json")
          ? "application/json"
          : "image/png"
      )
    );

    return new Response(
      response.body,
      {
        status:200,
        headers
      }
    );

  } catch(error) {

    console.error(
      "Idarkmeteo proxy:",
      error
    );

    return new Response(
      "Upstream fetch failed",
      {
        status:502,
        headers:{
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      }
    );
  }
}
