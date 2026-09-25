// ============================================================
// CLOrad — Meteoinfo GIF Radar API
// GIF → очистка → геопривязка → Web Mercator →
// определение интенсивности → строгая палитра CLOrad → PNG
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
// CLOrad PALETTE
// ============================================================

const CLORAD_PALETTE = [

  [185, 193, 199], // l1
  [169, 199, 244], // l2
  [99,  237, 165], // l3
  [67,  207, 137], // l4
  [77,  184, 78 ], // l5
  [255, 248, 156], // l6
  [117, 166, 239], // l7
  [82,  121, 237], // l8
  [80,  74,  155], // l9
  [255, 192, 168], // l10
  [250, 130, 160], // l11
  [255, 77,  77 ], // l12
  [219, 146, 72 ], // l13
  [173, 117, 68 ], // l14
  [146, 75,  72 ], // l15
  [242, 170, 240], // l16
  [232, 90, 231], // l17
  [202, 60, 199], // l18
  [119, 124, 145]  // l19

];


// ============================================================
// COLOR / INTENSITY HELPERS
// ============================================================
//
// ВАЖНО:
//
// Мы больше НЕ используем обычное RGB-distance
// до палитры CLOrad.
//
// Иначе слабый цвет Meteoinfo может оказаться
// ближе к одному из крайних цветов CLOrad.
//
// Вместо этого сначала оценивается "сила" исходного
// радарного цвета, а затем эта сила переводится
// непосредственно в индекс 0..18.
// ============================================================


function clamp(
  value,
  min,
  max
){

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );

}


// ============================================================
// HSV
// ============================================================

function rgbToHSV(
  r,
  g,
  b
){

  r /= 255;
  g /= 255;
  b /= 255;


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


  const d =
    max -
    min;


  let h =
    0;


  if(
    d !== 0
  ){

    if(
      max === r
    ){

      h =
        (
          (g - b) /
          d
        ) %
        6;

    }else if(
      max === g
    ){

      h =
        (
          (b - r) /
          d
        ) +
        2;

    }else{

      h =
        (
          (r - g) /
          d
        ) +
        4;

    }


    h *= 60;


    if(
      h < 0
    ){

      h += 360;

    }

  }


  const s =
    max === 0
      ? 0
      : d / max;


  const v =
    max;


  return {
    h,
    s,
    v
  };

}


// ============================================================
// RADAR COLOR FILTER
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
    max -
    min;


  /*
     Полностью тёмные пиксели
     не являются радаром.
  */

  if(
    max < 70
  ){

    return false;

  }


  /*
     Серый фон / море / служебные
     области.
  */

  if(
    chroma < 30
  ){

    return false;

  }


  const saturation =
    chroma /
    max;


  if(
    saturation < 0.15
  ){

    return false;

  }


  /*
     Почти белые служебные элементы.
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
// RADAR INTENSITY
// ============================================================
//
// Возвращает число 0..18.
//
// Это НЕ nearest-color.
//
// Здесь используются характеристики самого исходного
// цвета Meteoinfo.
//
// Основная идея:
//
// - голубые/синие слабые оттенки → низкие уровни
// - зелёные → средние
// - жёлтые → повышенные
// - оранжевые/красные → высокие
// - пурпурные → самые высокие
//
// Внутри каждого цветового семейства используется
// яркость/насыщенность, чтобы не превращать всё семейство
// сразу в максимальный уровень.
// ============================================================

function getRadarIntensity(
  r,
  g,
  b
){

  const {
    h,
    s,
    v
  } =
    rgbToHSV(
      r,
      g,
      b
    );


  /*
     HSV brightness.

     Нормируем небольшую часть диапазона,
     чтобы очень яркие служебные цвета не улетали
     автоматически в максимум.
  */

  let strength =
    0;


  // ----------------------------------------------------------
  // BLUE / CYAN
  // ----------------------------------------------------------

  if(
    h >= 170 &&
    h < 260
  ){

    const huePart =
      (
        h -
        170
      ) /
      90;


    strength =
      0.08 +
      huePart *
      0.18 +
      s *
      0.12 +
      v *
      0.18;

  }


  // ----------------------------------------------------------
  // BLUE → GREEN
  // ----------------------------------------------------------

  else if(
    h >= 110 &&
    h < 170
  ){

    const huePart =
      (
        170 -
        h
      ) /
      60;


    strength =
      0.20 +
      huePart *
      0.20 +
      s *
      0.15 +
      v *
      0.18;

  }


  // ----------------------------------------------------------
  // GREEN
  // ----------------------------------------------------------

  else if(
    h >= 70 &&
    h < 110
  ){

    const huePart =
      (
        110 -
        h
      ) /
      40;


    strength =
      0.34 +
      huePart *
      0.18 +
      s *
      0.18 +
      v *
      0.16;

  }


  // ----------------------------------------------------------
  // YELLOW
  // ----------------------------------------------------------

  else if(
    h >= 40 &&
    h < 70
  ){

    const huePart =
      (
        70 -
        h
      ) /
      30;


    strength =
      0.52 +
      huePart *
      0.12 +
      s *
      0.18 +
      v *
      0.12;

  }


  // ----------------------------------------------------------
  // ORANGE
  // ----------------------------------------------------------

  else if(
    h >= 15 &&
    h < 40
  ){

    const huePart =
      (
        40 -
        h
      ) /
      25;


    strength =
      0.64 +
      huePart *
      0.14 +
      s *
      0.16 +
      v *
      0.10;

  }


  // ----------------------------------------------------------
  // RED
  // ----------------------------------------------------------

  else if(
    h >= 0 &&
    h < 15
  ){

    strength =
      0.78 +
      s *
      0.12 +
      v *
      0.10;

  }


  // ----------------------------------------------------------
  // MAGENTA / PURPLE
  // ----------------------------------------------------------

  else if(
    h >= 260 &&
    h < 345
  ){

    const huePart =
      (
        h -
        260
      ) /
      85;


    strength =
      0.78 +
      huePart *
      0.12 +
      s *
      0.08 +
      v *
      0.10;

  }


  // ----------------------------------------------------------
  // RED → MAGENTA
  // ----------------------------------------------------------

  else{

    strength =
      0.86 +
      s *
      0.08 +
      v *
      0.06;

  }


  strength =
    clamp(
      strength,
      0,
      1
    );


  /*
     Квантизация в 19 уровней.

     Никакого случайного выбора крайнего цвета.
  */

  let level =
    Math.floor(
      strength *
      CLORAD_PALETTE.length
    );


  level =
    clamp(
      level,
      0,
      CLORAD_PALETTE.length - 1
    );


  return level;

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
    1122 /
    width;


  const sy =
    y *
    1136 /
    height;


  // Левая легенда
  if(
    sx <= 145 &&
    sy <= 365
  ){

    return true;

  }


  // Верхняя служебная область
  if(
    sy <= 58
  ){

    return true;

  }


  // Нижний логотип
  if(
    sx <= 160 &&
    sy >= 965
  ){

    return true;

  }


  // Нижняя строка
  if(
    sy >= 1105
  ){

    return true;

  }


  // Нижний правый timestamp
  if(
    sx >= 760 &&
    sy >= 1060
  ){

    return true;

  }


  // Верхний правый timestamp
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
    now -
      cachedAt <
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
// SMALL RADAR HOLE FILLER
// ============================================================
//
// ВАЖНО:
//
// Дырка получает не RGB соседа,
// а именно его LEVEL.
//
// Это предотвращает случайное повышение
// интенсивности из-за различий RGB.
// ============================================================

function fillSmallRadarHoles(
  buffer,
  width,
  height
){

  if(
    width < 3 ||
    height < 3
  ){

    return;

  }


  const pixelCount =
    width *
    height;


  const mask =
    new Uint8Array(
      pixelCount
    );


  const levels =
    new Uint8Array(
      pixelCount
    );


  // ----------------------------------------------------------
  // BUILD MASK + LEVELS
  // ----------------------------------------------------------

  for(
    let i = 0;
    i < pixelCount;
    i++
  ){

    const p =
      i *
      4;


    if(
      buffer[p + 3] > 0
    ){

      mask[i] =
        1;


      /*
         Для уже существующего цвета ищем
         точный индекс CLOrad palette.

         Поскольку цвета были записаны сервером,
         совпадение будет точным.
      */

      let level =
        0;


      for(
        let k = 0;
        k < CLORAD_PALETTE.length;
        k++
      ){

        const color =
          CLORAD_PALETTE[k];


        if(
          buffer[p] === color[0] &&
          buffer[p + 1] === color[1] &&
          buffer[p + 2] === color[2]
        ){

          level =
            k;

          break;

        }

      }


      levels[i] =
        level;

    }

  }


  // ----------------------------------------------------------
  // TWO PASSES
  // ----------------------------------------------------------

  for(
    let pass = 0;
    pass < 2;
    pass++
  ){

    const additions = [];


    for(
      let y = 1;
      y < height - 1;
      y++
    ){

      const row =
        y *
        width;


      for(
        let x = 1;
        x < width - 1;
        x++
      ){

        const index =
          row +
          x;


        if(
          mask[index]
        ){

          continue;

        }


        let count =
          0;


        const neighbourLevels =
          new Uint8Array(
            8
          );


        let n =
          0;


        for(
          let dy = -1;
          dy <= 1;
          dy++
        ){

          const neighbourRow =
            (
              y +
              dy
            ) *
            width;


          for(
            let dx = -1;
            dx <= 1;
            dx++
          ){

            if(
              dx === 0 &&
              dy === 0
            ){

              continue;

            }


            const ni =
              neighbourRow +
              x +
              dx;


            if(
              mask[ni]
            ){

              neighbourLevels[n++] =
                levels[ni];

              count++;

            }

          }

        }


        /*
           Не заполняем границы.
        */

        if(
          count < 6
        ){

          continue;

        }


        /*
           Находим медианный уровень.

           Это значительно безопаснее,
           чем копировать случайного соседа.
        */

        const sorted =
          Array.from(
            neighbourLevels
              .subarray(
                0,
                n
              )
          )
          .sort(
            (a,b) =>
              a - b
          );


        const median =
          sorted[
            Math.floor(
              sorted.length / 2
            )
          ];


        /*
           Проверяем, что большинство соседей
           находится недалеко от медианы.

           Это запрещает растягивать резкий
           красный/пурпурный пиксель далеко
           в слабую область.
        */

        let closeCount =
          0;


        for(
          let i = 0;
          i < sorted.length;
          i++
        ){

          if(
            Math.abs(
              sorted[i] -
              median
            ) <= 1
          ){

            closeCount++;

          }

        }


        if(
          closeCount < 4
        ){

          continue;

        }


        additions.push(
          index,
          median
        );

      }

    }


    // --------------------------------------------------------
    // APPLY
    // --------------------------------------------------------

    for(
      let i = 0;
      i < additions.length;
      i += 2
    ){

      const target =
        additions[i];

      const level =
        additions[i + 1];


      const color =
        CLORAD_PALETTE[
          level
        ];


      const p =
        target *
        4;


      buffer[p] =
        color[0];

      buffer[p + 1] =
        color[1];

      buffer[p + 2] =
        color[2];

      buffer[p + 3] =
        255;


      mask[target] =
        1;


      levels[target] =
        level;

    }


    if(
      additions.length === 0
    ){

      break;

    }

  }

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
  // MERCATOR
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
      y *
      mercStep;


    for(
      let x = 0;
      x < width;
      x++
    ){

      const lon =
        west +
        x *
        lonStep;


      const sourcePoint =
        geoToSource(
          lon,
          mercY
        );


      const sourceX =
        Math.round(
          sourcePoint[0] *
          width /
          1122
        );


      const sourceY =
        Math.round(
          sourcePoint[1] *
          height /
          1136
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
        ) *
        4;


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


      // ------------------------------------------------------
      // FILTER FIRST
      // ------------------------------------------------------

      if(
        !isRadarPixel(
          r,
          g,
          b
        )
      ){

        continue;

      }


      // ------------------------------------------------------
      // DETERMINE ORIGINAL RADAR INTENSITY
      // ------------------------------------------------------

      const level =
        getRadarIntensity(
          r,
          g,
          b
        );


      const color =
        CLORAD_PALETTE[
          level
        ];


      const outputIndex =
        (
          y *
          width +
          x
        ) *
        4;


      // ------------------------------------------------------
      // STRICT CLOrad COLOR
      // ------------------------------------------------------

      output[outputIndex] =
        color[0];

      output[outputIndex + 1] =
        color[1];

      output[outputIndex + 2] =
        color[2];

      output[outputIndex + 3] =
        255;

    }

  }


  // ==========================================================
  // HOLES
  // ==========================================================

  fillSmallRadarHoles(
    output,
    width,
    height
  );


  // ==========================================================
  // PNG
  // ==========================================================

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


  // ==========================================================
  // CACHE
  // ==========================================================

  processedFrameCache.set(
    cacheKey,
    png
  );


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


    // --------------------------------------------------------
    // SOURCE
    // --------------------------------------------------------

    const gif =
      await getGIF();


    // --------------------------------------------------------
    // METADATA
    // --------------------------------------------------------

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


      res.status(
        200
      ).json({

        frames,

        width,

        height,

        delays

      });


      return;

    }


    // ========================================================
    // FRAME
    // ========================================================

    const totalFrames =
      Number(
        metadata.pages ||
        1
      );


    let frame =
      Number.isFinite(
        requestedFrame
      )
        ? Math.floor(
            requestedFrame
          )
        : totalFrames - 1;


    if(
      frame < 0
    ){

      frame =
        0;

    }


    if(
      frame >= totalFrames
    ){

      frame =
        totalFrames - 1;

    }


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


    res.status(
      200
    );


    res.end(
      png
    );

  }catch(error){

    console.error(
      "CLOrad radar-gif:",
      error
    );


    setCORS(
      res
    );


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    res.status(
      500
    ).json({

      error:
        "Radar GIF processing failed",

      message:
        error?.message ||
        String(error)

    });

  }

}
