// ============================================================
// CLOrad — Meteoinfo GIF Radar API
// GIF → очистка → геопривязка → Web Mercator →
// заполнение мелких дыр → строгая палитра CLOrad → PNG
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


  if(
    saturation < 0.15
  ){

    return false;

  }


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


  if(
    sx <= 145 &&
    sy <= 365
  ){

    return true;

  }


  if(
    sy <= 58
  ){

    return true;

  }


  if(
    sx <= 160 &&
    sy >= 965
  ){

    return true;

  }


  if(
    sy >= 1105
  ){

    return true;

  }


  if(
    sx >= 760 &&
    sy >= 1060
  ){

    return true;

  }


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


  let mask =
    new Uint8Array(
      pixelCount
    );


  for(
    let i = 0;
    i < pixelCount;
    i++
  ){

    const p =
      i * 4;


    if(
      buffer[p + 3] > 0 &&
      isRadarPixel(
        buffer[p],
        buffer[p + 1],
        buffer[p + 2]
      )
    ){

      mask[i] =
        1;

    }

  }


  const passes =
    2;


  for(
    let pass = 0;
    pass < passes;
    pass++
  ){

    const additions = [];


    for(
      let y = 1;
      y < height - 1;
      y++
    ){

      for(
        let x = 1;
        x < width - 1;
        x++
      ){

        const index =
          y *
          width +
          x;


        if(
          mask[index]
        ){

          continue;

        }


        const neighbours = [];


        for(
          let dy = -1;
          dy <= 1;
          dy++
        ){

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


            const nx =
              x + dx;

            const ny =
              y + dy;


            const ni =
              ny *
              width +
              nx;


            if(
              mask[ni]
            ){

              neighbours.push(
                ni
              );

            }

          }

        }


        if(
          neighbours.length < 6
        ){

          continue;

        }


        let bestSource =
          -1;

        let bestCount =
          0;


        for(
          const candidate
          of neighbours
        ){

          const cp =
            candidate * 4;


          const cr =
            buffer[cp];

          const cg =
            buffer[cp + 1];

          const cb =
            buffer[cp + 2];


          let count =
            0;


          for(
            const other
            of neighbours
          ){

            const op =
              other * 4;


            const dr =
              Math.abs(
                buffer[op] -
                cr
              );

            const dg =
              Math.abs(
                buffer[op + 1] -
                cg
              );

            const db =
              Math.abs(
                buffer[op + 2] -
                cb
              );


            if(
              dr <= 18 &&
              dg <= 18 &&
              db <= 18
            ){

              count++;

            }

          }


          if(
            count > bestCount
          ){

            bestCount =
              count;

            bestSource =
              candidate;

          }

        }


        if(
          bestSource < 0 ||
          bestCount < 4
        ){

          continue;

        }


        additions.push([
          index,
          bestSource
        ]);

      }

    }


    for(
      const addition
      of additions
    ){

      const target =
        addition[0];

      const source =
        addition[1];


      const tp =
        target * 4;

      const sp =
        source * 4;


      buffer[tp] =
        buffer[sp];

      buffer[tp + 1] =
        buffer[sp + 1];

      buffer[tp + 2] =
        buffer[sp + 2];

      buffer[tp + 3] =
        buffer[sp + 3];


      mask[target] =
        1;

    }


    if(
      additions.length === 0
    ){

      break;

    }

  }

}


// ============================================================
// FIND NEAREST CLOrad COLOR
// ============================================================

function nearestCLOradColor(
  r,
  g,
  b
){

  let best =
    0;

  let bestDistance =
    Infinity;


  for(
    let i = 0;
    i < CLORAD_PALETTE.length;
    i++
  ){

    const color =
      CLORAD_PALETTE[i];


    const dr =
      r -
      color[0];

    const dg =
      g -
      color[1];

    const db =
      b -
      color[2];


    const distance =
      dr * dr +
      dg * dg +
      db * db;


    if(
      distance <
      bestDistance
    ){

      bestDistance =
        distance;

      best =
        i;

    }

  }


  return best;

}


// ============================================================
// FINAL STRICT PALETTE
// ============================================================
//
// ВАЖНО:
//
// Здесь буфер фактически пересобирается по палитре.
//
// После этой функции невозможно получить, например:
//
// #fff89c
// #f9f097
// #fff69a
//
// Все жёлтые пиксели будут буквально:
//
// 255, 248, 156
//
// ============================================================

function enforceStrictPalette(
  buffer,
  width,
  height
){

  const pixelCount =
    width *
    height;


  for(
    let i = 0;
    i < pixelCount;
    i++
  ){

    const p =
      i * 4;


    // --------------------------------------------------------
    // ПРОЗРАЧНЫЙ ПИКСЕЛЬ
    // --------------------------------------------------------

    if(
      buffer[p + 3] === 0
    ){

      continue;

    }


    const r =
      buffer[p];

    const g =
      buffer[p + 1];

    const b =
      buffer[p + 2];


    // --------------------------------------------------------
    // ЕСЛИ ЭТО НЕ РАДАР — УДАЛЯЕМ.
    // --------------------------------------------------------

    if(
      !isRadarPixel(
        r,
        g,
        b
      )
    ){

      buffer[p + 3] =
        0;

      continue;

    }


    // --------------------------------------------------------
    // ВЫБИРАЕМ БЛИЖАЙШИЙ ЦВЕТ.
    // --------------------------------------------------------

    const paletteIndex =
      nearestCLOradColor(
        r,
        g,
        b
      );


    const color =
      CLORAD_PALETTE[
        paletteIndex
      ];


    // --------------------------------------------------------
    // ЗАПИСЫВАЕМ КОНСТАНТНЫЕ RGB.
    // --------------------------------------------------------

    buffer[p] =
      color[0];

    buffer[p + 1] =
      color[1];

    buffer[p + 2] =
      color[2];

    buffer[p + 3] =
      255;

  }

}


// ============================================================
// FINAL PALETTE VALIDATION
// ============================================================
//
// Дополнительная страховка.
//
// Если какой-либо непрозрачный пиксель по какой-либо причине
// не совпадает с одним из 19 цветов — он принудительно
// переводится в ближайший допустимый цвет.
//
// ============================================================

function validateStrictPalette(
  buffer,
  width,
  height
){

  const pixelCount =
    width *
    height;


  for(
    let i = 0;
    i < pixelCount;
    i++
  ){

    const p =
      i * 4;


    if(
      buffer[p + 3] === 0
    ){

      continue;

    }


    let valid =
      false;


    for(
      let j = 0;
      j < CLORAD_PALETTE.length;
      j++
    ){

      const color =
        CLORAD_PALETTE[j];


      if(
        buffer[p] === color[0] &&
        buffer[p + 1] === color[1] &&
        buffer[p + 2] === color[2]
      ){

        valid =
          true;

        break;

      }

    }


    if(
      valid
    ){

      continue;

    }


    const paletteIndex =
      nearestCLOradColor(
        buffer[p],
        buffer[p + 1],
        buffer[p + 2]
      );


    const color =
      CLORAD_PALETTE[
        paletteIndex
      ];


    buffer[p] =
      color[0];

    buffer[p + 1] =
      color[1];

    buffer[p + 2] =
      color[2];

    buffer[p + 3] =
      255;

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


  // ==========================================================
  // HOLE FILL
  // ==========================================================

  fillSmallRadarHoles(
    output,
    width,
    height
  );


  // ==========================================================
  // STRICT PALETTE
  // ==========================================================

  enforceStrictPalette(
    output,
    width,
    height
  );


  // ==========================================================
  // FINAL VALIDATION
  // ==========================================================

  validateStrictPalette(
    output,
    width,
    height
  );


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
