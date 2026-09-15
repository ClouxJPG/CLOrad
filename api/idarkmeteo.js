export default async function handler(req) {

  const UPSTREAM =
    "https://idarkmeteo.host/api/v1/";

  const key =
    process.env.IDARKMETEO_KEY;


  /* =========================================================
     RESPONSE HEADERS
  ========================================================= */

  const baseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate"
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
        error:"IDARKMETEO_KEY is not configured"
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

  const url =
    new URL(req.url);

  const requestedPath =
    url.searchParams.get("path");


  if(!requestedPath) {

    return new Response(
      JSON.stringify({
        ok:false,
        error:"Missing path"
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
        error:"Invalid Idarkmeteo path"
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


  /*
   * Пока разрешаем .rdr только для диагностики.
   * Никаких преобразований .rdr → .png здесь нет.
   */

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
        error:"Invalid Idarkmeteo path",
        path:requestedPath
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
    requestedPath
  );


  /* =========================================================
     TIMEOUT
  ========================================================= */

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      function(){

        controller.abort();

      },
      15000
    );


  /* =========================================================
     FETCH
  ========================================================= */

  try {

    const upstreamResponse =
      await fetch(
        target,
        {
          method:"GET",

          headers:{
            "X-API-Key":
              key,

            "Accept":
              requestedPath.endsWith(".json")
                ? "application/json"
                : "image/png"
          },

          cache:"no-store",

          signal:
            controller.signal
        }
      );


    clearTimeout(
      timeout
    );


    /* =======================================================
       UPSTREAM ERROR
    ======================================================= */

    if(!upstreamResponse.ok) {

      const text =
        await upstreamResponse
          .text()
          .catch(
            () => ""
          );


      console.error(
        "CLOrad Idarkmeteo UPSTREAM ERROR:",
        upstreamResponse.status,
        requestedPath,
        text
      );


      return new Response(
        JSON.stringify({

          ok:false,

          error:
            "Idarkmeteo upstream error",

          status:
            upstreamResponse.status,

          path:
            requestedPath,

          message:
            text ||
            (
              "HTTP " +
              upstreamResponse.status
            )

        }),
        {
          status:
            upstreamResponse.status,

          headers:{
            ...baseHeaders,
            "Content-Type":
              "application/json; charset=utf-8"
          }
        }
      );

    }


    /* =======================================================
       SUCCESS
    ======================================================= */

    const contentType =
      upstreamResponse.headers.get(
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
        requestedPath.endsWith(".json")
          ? "application/json"
          : "image/png"
      )
    );


    console.log(
      "CLOrad Idarkmeteo OK:",
      requestedPath,
      upstreamResponse.status,
      contentType
    );


    return new Response(
      upstreamResponse.body,
      {
        status:200,
        headers
      }
    );


  } catch(error) {

    clearTimeout(
      timeout
    );


    /* =======================================================
       TIMEOUT
    ======================================================= */

    if(
      error &&
      error.name === "AbortError"
    ) {

      console.error(
        "CLOrad Idarkmeteo TIMEOUT:",
        requestedPath
      );


      return new Response(
        JSON.stringify({

          ok:false,

          error:
            "Idarkmeteo request timeout",

          timeout:
            15000,

          path:
            requestedPath

        }),
        {
          status:504,

          headers:{
            ...baseHeaders,
            "Content-Type":
              "application/json; charset=utf-8"
          }
        }
      );

    }


    /* =======================================================
       OTHER FETCH ERROR
    ======================================================= */

    console.error(
      "CLOrad Idarkmeteo FETCH ERROR:",
      requestedPath,
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

}
