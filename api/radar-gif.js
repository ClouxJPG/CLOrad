// ============================================================
// CLOrad — Meteoinfo GIF Radar API
// GIF → очистка → геопривязка → Web Mercator → PNG
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

let cachedMetadata =
  null;


const processedFrameCache =
  new Map();


// ============================================================
// CALIBRATION
// ============================================================

const UC_LON =
  42.7295125;

const UC_MERC =
  1.159140403966;

const US_LON =
  11.984477282034;

const US_MERC =
  0.080017466461;


// source X
const PX = [
   614.702787260693,
   213.524267491052,
    86.865800553715,
    17.052995641967,
   -18.941081998370,
    -3.466637383242
];


// source Y
const PY = [
   548.709828924571,
   231.245550214358,
   -80.613999910294,
   -23.817051905972,
   -12.895624928117,
     3.365220370149
];


// ============================================================
// WEB MERCATOR BOUNDS
// ============================================================

const GIF_BOUNDS = {

  south:
    38.2155955810,

  north:
    69.6543707199,

  west:
    14.9892981264,

  east:
    72.9237642948

};


// ============================================================
// ORIGINAL IMAGE SIZE
// ============================================================

const CALIBRATION_WIDTH =
  1122;

const CALIBRATION_HEIGHT =
  1136;


// ============================================================
// MERCATOR
// ============================================================

function mercatorY(
  lat
){

  const rad =
    lat *
    Math.PI /
    180;

  return Math.log(
    Math.tan(
      Math.PI / 4 +
      rad / 2
    )
  );

}


// ============================================================
// GEO → SOURCE PIXEL
// ============================================================

function geoToSource(
  lon,
  mercY
){

  const x =
    (lon - UC_LON) /
    US_LON;

  const y =
    (mercY - UC_MERC) /
    US_MERC;


  const basis = [

    1,

    x,

    y,

    x * x,

    x * y,

    y * y

  ];


  let sx =
    0;

  let sy =
    0;


  for(
    let i = 0;
    i < 6;
    i++
  ){

    sx +=
      PX[i] *
      basis[i];

    sy +=
      PY[i] *
      basis[i];

  }


  return [
    sx,
    sy
  ];

}


// ============================================================
// RADAR COLOR FILTER
// ============================================================
//
// Здесь специально НЕ используется просто "цветной пиксель".
//
// Убираем:
//
// - моря
// - океаны
// - серую подложку
// - серые зоны покрытия
// - чёрные подписи
// - чёрные линии
// - серые границы
// - служебную графику
//
// Оставляем цветные радарные поля.
// ============================================================

function isRadarPixel(
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

  const chroma =
    max - min;


  if(
    max < 70
  ){

    return false;

  }


  if(
    chroma < 30
  ){

    return false;

  }


  const saturation =
    chroma /
    max;


  /*
     В исходной картинке море/океан
     и серые зоны имеют примерно
     S < 0.12.

     У радарных цветов S значительно выше.
  */

  if(
    saturation < 0.15
  ){

    return false;

  }


  /*
     Почти белые картографические
     элементы.
  */

  if(
    max > 238 &&
    saturation < 0.20
  ){

    return false;

  }


  return true;

}


// ============================================================
// SERVICE AREAS
// ============================================================

function isServiceArea(
  x,
  y,
  width,
  height
){

  const sx =
    x *
    CALIBRATION_WIDTH /
    width;

  const sy =
    y *
    CALIBRATION_HEIGHT /
    height;


  // ------------------------------------------
  // ЛЕГЕНДА
  // ------------------------------------------

  if(
    sx <= 145 &&
    sy <= 365
  ){

    return true;

  }


  // ------------------------------------------
  // ВЕРХНИЙ ЗАГОЛОВОК
  // ------------------------------------------

  if(
    sy <= 58
  ){

    return true;

  }


  // ------------------------------------------
  // РОСГИДРОМЕТ / ЦАО
  // ------------------------------------------

  if(
    sx <= 160 &&
    sy >= 965
  ){

    return true;

  }


  // ------------------------------------------
  // НИЖНИЙ COPYRIGHT
  // ------------------------------------------

  if(
    sy >= 1105
  ){

    return true;

  }


  // ------------------------------------------
  // НИЖНИЕ ЧАСЫ
  // ------------------------------------------

  if(
    sx >= 760 &&
    sy >= 1060
  ){

    return true;

  }


  // ------------------------------------------
  // ВЕРХНИЕ ЧАСЫ
  // ------------------------------------------

  if(
    sx >= 735 &&
    sy <= 65
  ){

    return true;

  }


  return false;

}


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

            method:
              "GET",

            headers:{
              "User-Agent":
                "Mozilla/5.0",

              "Accept":
                "image/gif,*/*",

              "Referer":
                "https://meteoinfo.ru/radanim"

            },

            cache:
              "no-store"

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
         Новый GIF.

         Старые обработанные кадры
         полностью выбрасываем из RAM.
      */

      processedFrameCache.clear();

      cachedMetadata =
        null;


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
// METADATA
// ============================================================

async function getMetadata(
  gif
){

  if(
    cachedMetadata
  ){

    return cachedMetadata;

  }


  cachedMetadata =
    await sharp(
      gif,
      {
        animated:
          true
      }
    )
    .metadata();


  return cachedMetadata;

}


// ============================================================
// HEADERS
// ============================================================

function setCORS(
  res
){

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

}


function setCache(
  res
){

  res.setHeader(
    "Cache-Control",
    "public, max-age=5, s-maxage=30, stale-while-revalidate=60"
  );

}


// ============================================================
// FRAME
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


  // ----------------------------------------------------------
  // DECODE
  // ----------------------------------------------------------

  const decoded =
    await sharp(
      gif,
      {

        animated:
          true,

        page:
          frame,

        pages:
          1

      }
    )
    .ensureAlpha()
    .raw()
    .toBuffer({
      resolveWithObject:
        true
    });


  const width =
    decoded.info.width;

  const height =
    decoded.info.height;

  const source =
    decoded.data;


  // ----------------------------------------------------------
  // OUTPUT
  // ----------------------------------------------------------

  const output =
    Buffer.alloc(
      width *
      height *
      4
    );


  // ----------------------------------------------------------
  // MERCATOR EXTENT
  // ----------------------------------------------------------

  const west =
    GIF_BOUNDS.west;

  const east =
    GIF_BOUNDS.east;

  const southMerc =
    mercatorY(
      GIF_BOUNDS.south
    );

  const northMerc =
    mercatorY(
      GIF_BOUNDS.north
    );


  const lonStep =
    (
      east -
      west
    ) /
    Math.max(
      1,
      width - 1
    );


  const mercStep =
    (
      northMerc -
      southMerc
    ) /
    Math.max(
      1,
      height - 1
    );


  // ----------------------------------------------------------
  // REPROJECTION
  // ----------------------------------------------------------

  for(
    let y = 0;
    y < height;
    y++
  ){

    const mercY =
      northMerc -
      y * mercStep;


    for(
      let x = 0;
      x < width;
      x++
    ){

      const lon =
        west +
        x * lonStep;


      const sourcePoint =
        geoToSource(
          lon,
          mercY
        );


      const sourceX =
        Math.round(
          sourcePoint[0] *
          width /
          CALIBRATION_WIDTH
        );


      const sourceY =
        Math.round(
          sourcePoint[1] *
          height /
          CALIBRATION_HEIGHT
        );


      if(
        sourceX < 0 ||
        sourceX >= width ||
        sourceY < 0 ||
        sourceY >= height
      ){

        continue;

      }


      if(
        isServiceArea(
          sourceX,
          sourceY,
          width,
          height
        )
      ){

        continue;

      }


      const sourceIndex =
        (
          sourceY *
          width +
          sourceX
        ) * 4;


      const r =
        source[sourceIndex];

      const g =
        source[sourceIndex + 1];

      const b =
        source[sourceIndex + 2];

      const a =
        source[sourceIndex + 3];


      if(
        !a
      ){

        continue;

      }


      if(
        !isRadarPixel(
          r,
          g,
          b
        )
      ){

        continue;

      }


      const outputIndex =
        (
          y *
          width +
          x
        ) * 4;


      output[outputIndex] =
        r;

      output[outputIndex + 1] =
        g;

      output[outputIndex + 2] =
        b;

      output[outputIndex + 3] =
        255;

    }

  }


  // ----------------------------------------------------------
  // PNG
  // ----------------------------------------------------------

  const png =
    await sharp(
      output,
      {
        raw:{
          width,
          height,
          channels:4
        }
      }
    )
    .png({
      compressionLevel:
        3,

      adaptiveFiltering:
        false,

      palette:
        false
    })
    .toBuffer();


  // ----------------------------------------------------------
  // RAM CACHE
  // ----------------------------------------------------------

  processedFrameCache.set(
    cacheKey,
    png
  );


  /*
     Максимум 12 кадров
     одновременно в RAM.
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
      firstKey !==
      undefined
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


    const gif =
      await getGIF();


    const metadata =
      await getMetadata(
        gif
      );


    // ========================================================
    // META
    // ========================================================

    if(
      mode ===
      "meta"
    ){

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
        res
      );


      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );


      return res
        .status(200)
        .json({

          ok:
            true,

          frames,

          width,

          height,

          delays

        });

    }


    // ========================================================
    // FRAME CHECK
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
    // RENDER
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
      res
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
