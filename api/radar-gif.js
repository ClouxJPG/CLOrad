// ============================================================
// CLOrad — Meteoinfo GIF Radar API
// Server-side GIF -> PNG
// ============================================================

import sharp from "sharp";


// ============================================================
// SOURCE
// ============================================================

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";


// ============================================================
// SERVER CACHE
//
// Не скачиваем один и тот же GIF заново на каждый кадр.
// ============================================================

const GIF_CACHE_MS =
  30000;


let cachedGIF =
  null;


let cachedAt =
  0;


let loadingGIF =
  null;


// ============================================================
// GET GIF
// ============================================================

async function getGIF(){

  const now =
    Date.now();


  if(
    cachedGIF &&
    now - cachedAt <
      GIF_CACHE_MS
  ){

    return cachedGIF;

  }


  /*
   * Если другой запрос уже скачивает GIF,
   * ждём именно его.
   */

  if(loadingGIF){

    return loadingGIF;

  }


  loadingGIF =
    (async function(){

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


// ============================================================
// HEADERS
// ============================================================

function setCORS(res){

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

}


function setCache(
  res
){

  /*
   * Браузер может держать кадр 5 секунд.
   * Vercel Edge/CDN — 30 секунд.
   */

  res.setHeader(
    "Cache-Control",
    "public, max-age=5, s-maxage=30, stale-while-revalidate=60"
  );

}


// ============================================================
// HANDLER
// ============================================================

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


    // ========================================================
    // GET GIF
    // ========================================================

    const gif =
      await getGIF();


    // ========================================================
    // META
    // ========================================================

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


      setCORS(res);

      setCache(res);


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


    // ========================================================
    // FRAME NUMBER
    // ========================================================

    if(
      !Number.isInteger(
        requestedFrame
      )
    ){

      setCORS(res);

      return res
        .status(400)
        .json({

          error:
            "Укажи номер кадра: ?frame=0"

        });

    }


    // ========================================================
    // META FOR FRAME LIMIT
    // ========================================================

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


    const frame =
      Math.max(
        0,

        Math.min(
          requestedFrame,
          pages - 1
        )
      );


    // ========================================================
    // EXTRACT FRAME
    // ========================================================

    /*
     * ВАЖНО:
     *
     * palette:false
     * -> не превращаем результат обратно
     *    в ограниченную PNG-палитру.
     *
     * compressionLevel:0
     * -> минимальная работа CPU,
     *    PNG остаётся lossless.
     *
     * adaptiveFiltering:false
     * -> не добавляем дополнительную
     *    обработку изображения.
     */

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

          compressionLevel:0,

          adaptiveFiltering:false,

          palette:false

        })
        .toBuffer();


    // ========================================================
    // RESPONSE
    // ========================================================

    setCORS(res);

    setCache(res);


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


    setCORS(res);


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
