// ============================================================
// CLOrad — Meteoinfo GIF Radar API
// Server-side GIF decoding + transparent background
// ============================================================

import sharp from "sharp";


// ============================================================
// SOURCE
// ============================================================

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";


// ============================================================
// CACHE
// ============================================================

const GIF_CACHE_MS =
  30000;

let cachedGIF =
  null;

let cachedAt =
  0;

let loadingGIF =
  null;


// Обработанные PNG-кадры.
// Хранятся только в памяти текущего Vercel instance.
const processedFrameCache =
  new Map();


// ============================================================
// DOWNLOAD SOURCE GIF
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


      /*
         Новый GIF получен.

         Старые обработанные PNG больше
         не относятся к новой анимации.
      */

      processedFrameCache.clear();


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
// CORS
// ============================================================

function setCORS(
  res
){

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

}


// ============================================================
// CACHE HEADERS
// ============================================================

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


// ============================================================
// COLOR HELPERS
// ============================================================

/*
   Возвращает насыщенность RGB в диапазоне 0..1.

   Серый фон карты:
       R ≈ G ≈ B
       saturation ≈ 0

   Радар:
       зелёный
       голубой
       синий
       жёлтый
       оранжевый
       красный

   имеет заметно большую насыщенность.
*/

function saturation(
  r,
  g,
  b
){

  const max =
    Math.max(
      r,
      g,
      b
    );


  const min =
    Math.min(
      r,
      g,
      b
    );


  if(
    max === 0
  ){

    return 0;

  }


  return (
    max - min
  ) / max;

}


// ============================================================
// REMOVE MAP BACKGROUND
// ============================================================

function makeRadarTransparent(
  rawBuffer,
  info
){

  const channels =
    info.channels;


  /*
     На входе ожидаем RGBA.

     Sharp ниже принудительно добавляет alpha.
  */

  if(
    channels !== 4
  ){

    throw new Error(
      "Ожидался RGBA raster"
    );

  }


  const output =
    Buffer.from(
      rawBuffer
    );


  /*
     Порог нейтральных цветов.

     Важно:

     Мы НЕ меняем RGB цветных пикселей.

     Мы только делаем нейтральную
     картографическую подложку прозрачной.
  */

  const SATURATION_LIMIT =
    0.12;


  /*
     Дополнительный фильтр для почти белых
     и почти чёрных нейтральных элементов.
  */

  const NEUTRAL_DISTANCE =
    18;


  for(
    let i = 0;
    i < output.length;
    i += 4
  ){

    const r =
      output[i];

    const g =
      output[i + 1];

    const b =
      output[i + 2];


    const currentAlpha =
      output[i + 3];


    if(
      currentAlpha === 0
    ){

      continue;

    }


    const max =
      Math.max(
        r,
        g,
        b
      );


    const min =
      Math.min(
        r,
        g,
        b
      );


    const sat =
      saturation(
        r,
        g,
        b
      );


    const neutral =
      max - min;


    /*
       Нейтральные серые цвета:

       дороги
       границы
       фон
       подписи
       серые области карты
    */

    if(
      sat <= SATURATION_LIMIT &&
      neutral <= NEUTRAL_DISTANCE
    ){

      output[i + 3] =
        0;

      continue;

    }


    /*
       Очень светлый серый/белый фон.
    */

    if(
      sat <= 0.08 &&
      max >= 220
    ){

      output[i + 3] =
        0;

      continue;

    }


    /*
       Очень тёмный нейтральный текст
       и элементы карты.

       Цветные радарные пиксели сюда
       обычно не попадают.
    */

    if(
      sat <= 0.06 &&
      max <= 70
    ){

      output[i + 3] =
        0;

    }

  }


  return output;

}


// ============================================================
// FRAME → TRANSPARENT PNG
// ============================================================

async function renderFrame(
  gif,
  frame
){

  const cacheKey =
    String(frame);


  if(
    processedFrameCache.has(
      cacheKey
    )
  ){

    return processedFrameCache.get(
      cacheKey
    );

  }


  /*
     Сначала декодируем конкретный
     GIF frame в RGBA raw raster.
  */

  const decoded =
    await sharp(
      gif,
      {
        animated:true,

        page:frame,

        pages:1
      }
    )
    .ensureAlpha()
    .raw()
    .toBuffer({
      resolveWithObject:true
    });


  const processed =
    makeRadarTransparent(
      decoded.data,
      decoded.info
    );


  /*
     Собираем обратно PNG.

     RGB остаётся исходным.
     Меняется только alpha канала
     для фоновых пикселей.
  */

  const png =
    await sharp(
      processed,
      {
        raw:{
          width:
            decoded.info.width,

          height:
            decoded.info.height,

          channels:4
        }
      }
    )
    .png({
      compressionLevel:3,
      adaptiveFiltering:false,
      palette:false
    })
    .toBuffer();


  processedFrameCache.set(
    cacheKey,
    png
  );


  /*
     Не даём кэшу бесконечно расти.
  */

  if(
    processedFrameCache.size >
    12
  ){

    const firstKey =
      processedFrameCache
        .keys()
        .next()
        .value;


    if(
      firstKey !== undefined
    ){

      processedFrameCache.delete(
        firstKey
      );

    }

  }


  return png;

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
    // METADATA
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
        )
        .metadata();


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


    // ========================================================
    // CHECK FRAME
    // ========================================================

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


    // ========================================================
    // METADATA
    // ========================================================

    const metadata =
      await sharp(
        gif,
        {
          animated:true
        }
      )
      .metadata();


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
    // RENDER FRAME
    // ========================================================

    const png =
      await renderFrame(
        gif,
        frame
      );


    // ========================================================
    // RESPONSE
    // ========================================================

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
