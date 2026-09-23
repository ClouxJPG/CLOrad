// ============================================================
// CLOrad — Meteoinfo GIF Radar API
// Server-side GIF decoding via Sharp
// ============================================================

import sharp from "sharp";


const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";


/*
   Небольшой серверный кэш.

   Он нужен, чтобы при запросе нескольких кадров
   Vercel не скачивал один и тот же GIF заново
   для каждого кадра.
*/

const GIF_CACHE_MS =
  30000;


let cachedGIF =
  null;


let cachedAt =
  0;


let loadingGIF =
  null;


/* ============================================================
   GET SOURCE GIF
============================================================ */

async function getGIF(){

  const now =
    Date.now();


  /*
     GIF уже есть в памяти
  */

  if(
    cachedGIF &&
    now - cachedAt <
      GIF_CACHE_MS
  ){

    return cachedGIF;

  }


  /*
     Другой запрос уже скачивает GIF.
  */

  if(
    loadingGIF
  ){

    return loadingGIF;

  }


  loadingGIF =
    (async () => {

      const response =
        await fetch(
          SOURCE_GIF,
          {
            method:"GET",

            headers:{
              "User-Agent":
                "Mozilla/5.0",

              "Accept":
                "image/gif,*/*",

              "Referer":
                "https://meteoinfo.ru/radanim"
            },

            cache:"no-store"
          }
        );


      if(
        !response.ok
      ){

        throw new Error(
          "Meteoinfo HTTP " +
          response.status
        );

      }


      const arrayBuffer =
        await response.arrayBuffer();


      const buffer =
        Buffer.from(
          arrayBuffer
        );


      if(
        !buffer.length
      ){

        throw new Error(
          "Meteoinfo вернул пустой GIF"
        );

      }


      cachedGIF =
        buffer;


      cachedAt =
        Date.now();


      return buffer;

    })();


  try{

    return await loadingGIF;

  }finally{

    loadingGIF =
      null;

  }

}


/* ============================================================
   CORS
============================================================ */

function setCORS(
  res
){

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

}


/* ============================================================
   CACHE
============================================================ */

function setCache(
  res,
  browserSeconds = 5,
  edgeSeconds = 30
){

  res.setHeader(
    "Cache-Control",

    `public, max-age=${browserSeconds}, ` +
    `s-maxage=${edgeSeconds}, ` +
    `stale-while-revalidate=60`
  );

}


/* ============================================================
   HANDLER
============================================================ */

export default async function handler(
  req,
  res
){

  try{

    const mode =
      String(
        req.query?.mode ||
        ""
      );


    const requestedFrame =
      Number(
        req.query?.frame
      );


    /*
       Получаем исходный GIF.
    */

    const gif =
      await getGIF();


    /* ========================================================
       METADATA
    ======================================================== */

    if(
      mode === "meta"
    ){

      const metadata =
        await sharp(
          gif,
          {
            animated:true
          }
        ).metadata();


      const frames =
        Number(
          metadata.pages ||
          1
        );


      const width =
        Number(
          metadata.width ||
          0
        );


      const height =
        Number(
          metadata.pageHeight ||
          metadata.height ||
          0
        );


      const delays =
        Array.isArray(
          metadata.delay
        )
          ? metadata.delay
          : [];


      setCORS(
        res
      );


      setCache(
        res,
        5,
        30
      );


      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );


      return res
        .status(200)
        .json({

          ok:true,

          frames,

          width,

          height,

          delays

        });

    }


    /* ========================================================
       FRAME NUMBER
    ======================================================== */

    if(
      !Number.isInteger(
        requestedFrame
      )
    ){

      setCORS(
        res
      );


      return res
        .status(400)
        .json({
          error:
            "Укажи номер кадра: ?frame=0"
        });

    }


    /* ========================================================
       READ GIF METADATA
    ======================================================== */

    const metadata =
      await sharp(
        gif,
        {
          animated:true
        }
      ).metadata();


    const pages =
      Number(
        metadata.pages ||
        1
      );


    /*
       Ограничиваем номер кадра,
       чтобы нельзя было запросить
       несуществующую страницу.
    */

    const frame =
      Math.max(
        0,

        Math.min(
          requestedFrame,
          pages - 1
        )
      );


    /* ========================================================
       GIF FRAME → PNG
    ======================================================== */

    const png =
      await sharp(
        gif,
        {
          animated:true,

          page:frame,

          pages:1
        }
      )
      .png({
        /*
           Без потерь.

           Compression 0 нужен прежде всего
           для быстрой серверной подготовки кадра.
        */

        compressionLevel:0,

        adaptiveFiltering:false,

        palette:false
      })
      .toBuffer();


    /* ========================================================
       RESPONSE
    ======================================================== */

    setCORS(
      res
    );


    setCache(
      res,
      5,
      30
    );


    res.setHeader(
      "Content-Type",
      "image/png"
    );


    res.setHeader(
      "Content-Length",
      String(
        png.length
      )
    );


    return res
      .status(200)
      .send(
        png
      );


  }catch(error){

    console.error(
      "CLOrad radar-gif error:",
      error
    );


    setCORS(
      res
    );


    return res
      .status(500)
      .json({

        error:
          "GIF API error",

        message:
          error?.message ||
          String(error)

      });

  }

}
