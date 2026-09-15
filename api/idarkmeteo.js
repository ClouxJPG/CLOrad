export default async function handler(req) {

  const UPSTREAM =
    "https://idarkmeteo.host/api/v1/";

  const key =
    process.env.IDARKMETEO_KEY;


  /* =========================================================
     RESPONSE HEADERS
  ========================================================= */

  const baseHeaders = {

    "Access-Control-Allow-Origin":"*",

    "Access-Control-Allow-Methods":
      "GET, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, X-API-Key",

    "Cache-Control":
      "no-store, no-cache, must-revalidate",

    "Pragma":"no-cache"

  };


  /* =========================================================
     OPTIONS
  ========================================================= */

  if(req.method === "OPTIONS") {

    return new Response(
      null,
      {
        status:204,
        headers:baseHeaders
      }
    );

  }


  /* =========================================================
     API KEY
  ========================================================= */

  if(!key) {

    console.error(
      "CLOrad Idarkmeteo: IDARKMETEO_KEY отсутствует"
    );

    return new Response(
      JSON.stringify({

        ok:false,

        error:
          "IDARKMETEO_KEY is not configured"

      }),
      {
        status:500,

        headers:{
          ...baseHeaders,

          "Content-Type":
            "application/json; charset=utf-8"
        }
      }
    );

  }


  /* =========================================================
     PATH
  ========================================================= */

  const requestUrl =
    new URL(req.url);

  const requestedPath =
    requestUrl.searchParams.get("path");


  if(!requestedPath) {

    return new Response(
      JSON.stringify({

        ok:false,

        error:
          "Missing path"

      }),
      {
        status:400,

        headers:{
          ...baseHeaders,

          "Content-Type":
            "application/json; charset=utf-8"
        }
      }
    );

  }


  /* =========================================================
     SECURITY
  ========================================================= */

  if(
    requestedPath.startsWith("/") ||
    requestedPath.includes("..") ||
    requestedPath.includes("\\") ||
    requestedPath.includes("\0")
  ) {

    return new Response(
      JSON.stringify({

        ok:false,

        error:
          "Invalid Idarkmeteo path",

        path:
          requestedPath

      }),
      {
        status:400,

        headers:{
          ...baseHeaders,

          "Content-Type":
            "application/json; charset=utf-8"
        }
      }
    );

  }


  /* =========================================================
     ALLOWED PATHS
  ========================================================= */

  const isFrameJson =
    /^frames\/[a-z]+\/[a-z0-9_-]+\.json$/i
      .test(requestedPath);


  const isPng =
    /^(data|latest|archive|day)\/[a-z]+\/[a-z0-9_-]+\/.+\.png$/i
      .test(requestedPath);


  const isRdr =
    /^data\/[a-z]+\/[a-z0-9_-]+\/\d{8}\/\d{4}\.rdr$/i
      .test(requestedPath);


  if(
    !isFrameJson &&
    !isPng &&
    !isRdr
  ) {

    return new Response(
      JSON.stringify({

        ok:false,

        error:
          "Invalid Idarkmeteo path",

        path:
          requestedPath

      }),
      {
        status:400,

        headers:{
          ...baseHeaders,

          "Content-Type":
            "application/json; charset=utf-8"
        }
      }
    );

  }


  /* =========================================================
     UPSTREAM URL
  ========================================================= */

  const target =
    UPSTREAM +
    requestedPath;


  console.log(
    "CLOrad Idarkmeteo REQUEST:",
    target
  );


  /* =========================================================
     FETCH
  ========================================================= */

  let response;

  try {

    response =
      await fetch(
        target,
        {
          method:"GET",

          headers:{
            "X-API-Key":
              key,

            "Accept":
              isFrameJson
                ? "application/json"
                : "image/png"
          },

          cache:"no-store"
        }
      );

  } catch(error) {

    console.error(
      "CLOrad Idarkmeteo FETCH ERROR:",
      error
    );

    return new Response(
      JSON.stringify({

        ok:false,

        error:
          "Upstream fetch failed",

        path:
          requestedPath,

        message:
          error?.message ||
          String(error)

      }),
      {
        status:502,

        headers:{
          ...baseHeaders,

          "Content-Type":
            "application/json; charset=utf-8"
        }
      }
    );

  }


  /* =========================================================
     UPSTREAM ERROR
  ========================================================= */

  if(!response.ok) {

    let body = "";

    try {

      body =
        await response.text();

    } catch(error) {

      body = "";

    }


    console.error(
      "CLOrad Idarkmeteo UPSTREAM ERROR:",
      response.status,
      requestedPath,
      body
    );


    return new Response(
      JSON.stringify({

        ok:false,

        error:
          "Idarkmeteo upstream error",

        status:
          response.status,

        path:
          requestedPath,

        message:
          body ||
          (
            "HTTP " +
            response.status
          )

      }),
      {
        status:
          response.status,

        headers:{
          ...baseHeaders,

          "Content-Type":
            "application/json; charset=utf-8"
        }
      }
    );

  }


  /* =========================================================
     SUCCESS
  ========================================================= */

  const contentType =
    response.headers.get(
      "content-type"
    );


  const headers =
    new Headers(
      baseHeaders
    );


  headers.set(
    "Content-Type",

    contentType ||
    (
      isFrameJson
        ? "application/json"
        : "image/png"
    )
  );


  console.log(
    "CLOrad Idarkmeteo OK:",
    requestedPath,
    response.status,
    contentType
  );


  /* =========================================================
     RESPONSE
  ========================================================= */

  if(isFrameJson) {

    const text =
      await response.text();

    return new Response(
      text,
      {
        status:200,
        headers
      }
    );

  }


  const buffer =
    await response.arrayBuffer();


  return new Response(
    buffer,
    {
      status:200,
      headers
    }
  );

}
