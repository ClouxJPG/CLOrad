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
          "Content-Type":"text/plain; charset=utf-8"
        }
      }
    );
  }

  const url =
    new URL(req.url);

  const path =
    url.searchParams.get("path");

  if (!path) {
    return new Response(
      "Missing path",
      {status:400}
    );
  }

  /*
     Разрешаем только файлы внутри API.
  */

  if (
    path.startsWith("/") ||
    path.includes("..") ||
    path.includes("\\") ||
    !/^(frames|data|latest|archive|day)\/[a-z]+\/[a-z0-9_-]+\/.+\.(json|png)$/i.test(path)
  ) {
    return new Response(
      "Invalid Idarkmeteo path",
      {status:400}
    );
  }

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
            "X-API-Key":key,
            "Accept":
              path.endsWith(".json")
                ? "application/json"
                : "image/png"
          },
          cache:"no-store"
        }
      );

    if (!response.ok) {

      const text =
        await response.text();

      return new Response(
        text || "Upstream error",
        {
          status:response.status,
          headers:{
            "Content-Type":
              response.headers.get(
                "content-type"
              ) ||
              "text/plain"
          }
        }
      );

    }

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
