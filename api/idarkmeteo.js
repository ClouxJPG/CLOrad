// =========================================================
// CLOrad — Idarkmeteo proxy
// Ключ API никогда не попадает в браузер.
// =========================================================

const UPSTREAM =
  "https://idarkmeteo.host/api/v1/";


const ALLOWED = [

  /^frames\/(rain|cloudphase|smoke|satrain)\/[a-z]+\.json$/,

  /^data\/(rain|cloudphase|smoke|satrain)\/[a-z]+\/[0-9]{8}\/[0-9]{4}\.png$/

];


export default async function handler(
  req,
  res
){

  try{

    if(req.method !== "GET"){

      res
        .status(405)
        .json({
          ok:false,
          error:"Method not allowed"
        });

      return;

    }


    const url =
      new URL(
        req.url,
        "http://localhost"
      );


    const rawPath =
      url.searchParams.get(
        "path"
      ) || "";


    const path =
      rawPath
        .replace(/^\/+/, "");


    /*
       Разрешаем только известные
       Idarkmeteo endpoints.
    */

    if(
      !ALLOWED.some(
        rule =>
          rule.test(path)
      )
    ){

      res
        .status(400)
        .json({
          ok:false,
          error:"Invalid path"
        });

      return;

    }


    const key =
      process.env.IDARKMETEO_API_KEY;


    if(!key){

      res
        .status(500)
        .json({
          ok:false,
          error:
            "IDARKMETEO_API_KEY is not configured"
        });

      return;

    }


    const upstream =
      await fetch(
        UPSTREAM + path,
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


    const contentType =
      upstream.headers.get(
        "content-type"
      ) ||
      (
        path.endsWith(".json")
          ? "application/json"
          : "image/png"
      );


    res.status(
      upstream.status
    );


    res.setHeader(
      "Content-Type",
      contentType
    );


    /*
       PNG можно немного кэшировать,
       JSON всегда берём свежий.
    */

    if(
      path.endsWith(".png")
    ){

      res.setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=300"
      );

    }else{

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

    }


    const data =
      await upstream.arrayBuffer();


    res.send(
      Buffer.from(data)
    );


  }catch(error){

    console.error(
      "CLOrad Idarkmeteo proxy:",
      error
    );


    res
      .status(500)
      .json({
        ok:false,
        error:
          "Idarkmeteo proxy error"
      });

  }

}
