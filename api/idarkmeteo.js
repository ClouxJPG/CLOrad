// =========================================================
// CLOrad — Idarkmeteo proxy
// API-ключ никогда не попадает в браузер.
// =========================================================

const UPSTREAM =
  "https://idarkmeteo.host/api/v1/";


/* =========================================================
   РАЗРЕШЁННЫЕ ПУТИ
========================================================= */

const ALLOWED = [

  /^frames\/(rain|cloudphase|smoke|satrain)\/(wide|fine|swath|coarse)\.json$/,

  /^data\/(rain|cloudphase|smoke|satrain)\/(wide|fine|swath|coarse)\/[0-9]{8}\/[0-9]{4}\.png$/

];


/* =========================================================
   HANDLER
========================================================= */

export default async function handler(
  req,
  res
){

  try{

    if(
      req.method !== "GET"
    ){

      res
        .status(405)
        .setHeader(
          "Allow",
          "GET"
        )
        .json({
          ok:false,
          error:"Method not allowed"
        });

      return;

    }


    /* =====================================================
       ПОЛУЧАЕМ PATH
    ===================================================== */

    const requestUrl =
      new URL(
        req.url,
        "http://localhost"
      );


    const rawPath =
      requestUrl.searchParams.get(
        "path"
      ) || "";


    /*
       Убираем начальные /
    */

    const path =
      rawPath
        .replace(/^\/+/, "");


    /* =====================================================
       ПРОВЕРКА PATH
    ===================================================== */

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
          error:"Invalid Idarkmeteo path"
        });

      return;

    }


    /* =====================================================
       API KEY
    ===================================================== */

    const key =
      process.env.IDARKMETEO_API_KEY;


    if(!key){

      console.error(
        "CLOrad: IDARKMETEO_API_KEY отсутствует"
      );


      res
        .status(500)
        .json({
          ok:false,
          error:
            "IDARKMETEO_API_KEY is not configured"
        });

      return;

    }


    /* =====================================================
       UPSTREAM URL
    ===================================================== */

    const upstreamUrl =
      UPSTREAM +
      path;


    console.log(
      "CLOrad Idarkmeteo proxy:",
      path
    );


    /* =====================================================
       ЗАПРОС К IDARKMETEO
    ===================================================== */

    const upstream =
      await fetch(
        upstreamUrl,
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


    /* =====================================================
       CONTENT TYPE
    ===================================================== */

    const upstreamType =
      upstream.headers.get(
        "content-type"
      ) || "";


    const isJson =
      path.endsWith(".json");


    const isPng =
      path.endsWith(".png");


    /* =====================================================
       ОШИБКА UPSTREAM
    ===================================================== */

    if(!upstream.ok){

      const errorText =
        await upstream.text();


      console.error(
        "CLOrad Idarkmeteo upstream:",
        upstream.status,
        errorText.slice(
          0,
          500
        )
      );


      res
        .status(
          upstream.status
        )
        .setHeader(
          "Content-Type",
          "application/json; charset=utf-8"
        )
        .json({
          ok:false,

          error:
            "Idarkmeteo upstream error",

          status:
            upstream.status,

          path:path
        });

      return;

    }


    /* =====================================================
       ЧИТАЕМ ОТВЕТ
    ===================================================== */

    const buffer =
      Buffer.from(
        await upstream.arrayBuffer()
      );


    /* =====================================================
       JSON
    ===================================================== */

    if(isJson){

      /*
         Не отдаём случайный HTML/текст
         как JSON.
      */

      if(
        upstreamType &&
        !upstreamType
          .toLowerCase()
          .includes("json")
      ){

        console.warn(
          "CLOrad: JSON endpoint вернул:",
          upstreamType
        );

      }


      res
        .status(200)
        .setHeader(
          "Content-Type",
          "application/json; charset=utf-8"
        )
        .setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate"
        )
        .send(
          buffer
        );


      return;

    }


    /* =====================================================
       PNG
    ===================================================== */

    if(isPng){

      /*
         Очень важная проверка:
         если вместо PNG пришёл текст/JSON,
         не отдаём его браузеру как картинку.
      */

      if(
        upstreamType &&
        !upstreamType
          .toLowerCase()
          .includes("image/png") &&
        !upstreamType
          .toLowerCase()
          .includes("image/")
      ){

        const text =
          buffer
            .toString(
              "utf-8"
            )
            .slice(
              0,
              500
            );


        console.error(
          "CLOrad: вместо PNG получен:",
          upstreamType,
          text
        );


        res
          .status(502)
          .setHeader(
            "Content-Type",
            "application/json; charset=utf-8"
          )
          .json({
            ok:false,

            error:
              "Idarkmeteo did not return PNG",

            contentType:
              upstreamType
          });


        return;

      }


      /*
         Проверяем сигнатуру PNG.

         Настоящий PNG начинается:
         89 50 4E 47
      */

      const isPngSignature =
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0D &&
        buffer[5] === 0x0A &&
        buffer[6] === 0x1A &&
        buffer[7] === 0x0A;


      if(!isPngSignature){

        console.error(
          "CLOrad: ответ не является PNG"
        );


        res
          .status(502)
          .setHeader(
            "Content-Type",
            "application/json; charset=utf-8"
          )
          .json({
            ok:false,
            error:
              "Invalid PNG returned by Idarkmeteo"
          });


        return;

      }


      /*
         Отдаём настоящий PNG.
      */

      res
        .status(200)
        .setHeader(
          "Content-Type",
          "image/png"
        )
        .setHeader(
          "Content-Length",
          String(
            buffer.length
          )
        )
        .setHeader(
          "Cache-Control",
          "public, max-age=300, s-maxage=300"
        )
        .send(
          buffer
        );


      return;

    }


    /* =====================================================
       НЕИЗВЕСТНЫЙ ТИП
    ===================================================== */

    res
      .status(400)
      .json({
        ok:false,
        error:"Unsupported file type"
      });


  }catch(error){

    console.error(
      "CLOrad Idarkmeteo proxy error:",
      error
    );


    res
      .status(500)
      .setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      )
      .json({
        ok:false,
        error:
          "Idarkmeteo proxy error"
      });

  }

}
