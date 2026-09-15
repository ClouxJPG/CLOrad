// =========================================================
// CLOrad — Idarkmeteo proxy
// =========================================================

const UPSTREAM =
  "https://idarkmeteo.host/api/v1/";

const ALLOWED = [

  /^frames\/(rain|cloudphase|smoke|satrain)\/(wide|fine|swath|coarse)\.json$/,

  /^data\/(rain|cloudphase|smoke|satrain)\/(wide|fine|swath|coarse)\/[0-9]{8}\/[0-9]{4}\.(png|rdr)$/,

  /^latest\/(rain|cloudphase|smoke|satrain)\/(wide|fine|swath|coarse)\.png$/,

  /^palettes\.json$/

];


export default async function handler(req,res){

  try{

    if(req.method !== "GET"){

      return res
        .status(405)
        .setHeader("Allow","GET")
        .json({
          ok:false,
          error:"Method not allowed"
        });

    }


    const url =
      new URL(
        req.url,
        "http://localhost"
      );


    const path =
      (
        url.searchParams.get("path") || ""
      ).replace(/^\/+/,"");


    if(
      !ALLOWED.some(
        rule => rule.test(path)
      )
    ){

      return res
        .status(400)
        .json({
          ok:false,
          error:"Invalid Idarkmeteo path"
        });

    }


    const key =
      process.env.IDARKMETEO_API_KEY;


    if(!key){

      return res
        .status(500)
        .json({
          ok:false,
          error:
            "IDARKMETEO_API_KEY is not configured"
        });

    }


    async function requestUpstream(
      upstreamPath
    ){

      return fetch(
        UPSTREAM + upstreamPath,
        {
          method:"GET",

          headers:{
            "X-API-Key":key,
            "Accept":
              upstreamPath.endsWith(".json")
                ? "application/json"
                : "*/*"
          },

          cache:"no-store"
        }
      );

    }


    /*
      ВАЖНО:

      Если metadata вернула .rdr,
      браузеру .rdr НЕ отдаём.

      Сразу запрашиваем соответствующий PNG.
    */

    let upstreamPath = path;

    if(path.endsWith(".rdr")){

      upstreamPath =
        path.slice(0,-4) + ".png";

    }


    const upstream =
      await requestUpstream(
        upstreamPath
      );


    if(!upstream.ok){

      const text =
        await upstream.text();

      console.error(
        "CLOrad Idarkmeteo:",
        upstream.status,
        upstreamPath,
        text.slice(0,500)
      );

      return res
        .status(upstream.status)
        .json({
          ok:false,
          error:
            "Idarkmeteo upstream error",
          status:
            upstream.status,
          path:
            upstreamPath
        });

    }


    const type =
      (
        upstream.headers.get(
          "content-type"
        ) || ""
      ).toLowerCase();


    const data =
      Buffer.from(
        await upstream.arrayBuffer()
      );


    /*
      JSON
    */

    if(
      upstreamPath.endsWith(".json")
    ){

      return res
        .status(200)
        .setHeader(
          "Content-Type",
          "application/json; charset=utf-8"
        )
        .setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate"
        )
        .send(data);

    }


    /*
      Проверка PNG-сигнатуры.
    */

    const isPng =
      data.length >= 8 &&

      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a;


    if(!isPng){

      console.error(
        "CLOrad: Idarkmeteo PNG check failed",
        upstreamPath,
        type
      );

      return res
        .status(502)
        .json({
          ok:false,
          error:
            "Idarkmeteo did not return PNG",
          path:
            upstreamPath,
          contentType:
            type
        });

    }


    /*
      Настоящий PNG.
    */

    return res
      .status(200)

      .setHeader(
        "Content-Type",
        "image/png"
      )

      .setHeader(
        "Content-Length",
        String(data.length)
      )

      .setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=300"
      )

      .send(data);


  }catch(error){

    console.error(
      "CLOrad Idarkmeteo proxy error:",
      error
    );

    return res
      .status(500)
      .json({
        ok:false,
        error:
          "Idarkmeteo proxy error"
      });

  }

}
