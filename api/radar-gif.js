import sharp from "sharp";


/* =========================================================
   CLOrad — Meteoinfo GIF Radar
   REAL RADAR REPROJECTION
   ========================================================= */


/* =========================================================
   SOURCE
========================================================= */

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";


/* =========================================================
   CACHE
========================================================= */

let gifCache = null;

let gifCacheTime = 0;

const GIF_CACHE_MS =
  30 * 1000;


const processedFrames =
  new Map();

const MAX_PROCESSED_FRAMES =
  12;


/* =========================================================
   SOURCE / CALIBRATION SIZE
========================================================= */

const SOURCE_WIDTH =
  1200;

const SOURCE_HEIGHT =
  1200;


/*
 * Контрольные точки измерялись
 * на изображении 1122 × 1136.
 *
 * Поэтому реальные 1200 × 1200
 * координаты сначала переводятся
 * обратно в систему калибровки.
 */

const CALIBRATION_WIDTH =
  1122;

const CALIBRATION_HEIGHT =
  1136;


/* =========================================================
   CONTROL-POINT GEOGRAPHY
========================================================= */

/*
 * Обратная калибровка:
 *
 * pixel X/Y -> longitude
 * pixel X/Y -> WebMercator Y
 *
 * Контрольные точки:
 *
 * Москва
 * Уфа
 * Санкт-Петербург
 * Минск
 * Киев
 * Екатеринбург
 * Казань
 * Самара
 */


/*
 * lon =
 *
 * a
 * + b*x
 * + c*y
 * + d*x²
 * + e*x*y
 * + f*y²
 */

const LON_COEF = [
  14.98929812639779,
  0.0102952150,
  0.0335153132,
  0.00000752017763,
  0.0000109901938,
 -0.0000117058138
];


/*
 * mercatorY =
 *
 * a
 * + b*x
 * + c*y
 * + d*x²
 * + e*x*y
 * + f*y²
 */

const MERC_COEF = [
  0.992404855,
  0.000621648749,
 -0.000164715385,
  0.0000000227981213,
 -0.000000336199981,
 -0.0000000641834479
];


/* =========================================================
   OUTPUT GEOGRAPHIC EXTENT
========================================================= */

/*
 * Получено из фактической обратной
 * калибровки контрольных точек.
 *
 * Эти bounds соответствуют
 * существующему gif-radar.js.
 */

const GEO = {

  west:
    14.9892981264,

  east:
    72.9237642948,

  south:
    38.2155955810,

  north:
    69.6543707199

};


/* =========================================================
   CLOrad PALETTE
========================================================= */

const CLORAD_PALETTE = [

  [185,193,199],
  [169,199,244],
  [99,237,165],
  [67,207,137],
  [77,184,78],
  [255,248,156],
  [117,166,239],
  [82,121,237],
  [80,74,155],
  [255,192,168],
  [250,130,160],
  [255,77,77],
  [219,146,72],
  [173,117,68],
  [146,75,72],
  [242,170,240],
  [232,90,231],
  [202,60,199],
  [119,124,145]

];


/* =========================================================
   MERCATOR
========================================================= */

function mercatorY(
  lat
){

  const r =
    lat *
    Math.PI /
    180;


  return Math.log(
    Math.tan(
      Math.PI / 4 +
      r / 2
    )
  );

}


/* =========================================================
   INVERSE CALIBRATION
========================================================= */

function quadratic(
  coef,
  x,
  y
){

  return (

    coef[0] +

    coef[1] * x +

    coef[2] * y +

    coef[3] * x * x +

    coef[4] * x * y +

    coef[5] * y * y

  );

}


/* =========================================================
   SOURCE PIXEL -> GEO
========================================================= */

function sourcePixelToGeo(
  sourceX,
  sourceY
){

  /*
   * Реальный GIF:
   * 1200 × 1200
   *
   * Калибровка:
   * 1122 × 1136
   */

  const x =
    sourceX *
    CALIBRATION_WIDTH /
    SOURCE_WIDTH;


  const y =
    sourceY *
    CALIBRATION_HEIGHT /
    SOURCE_HEIGHT;


  const lon =
    quadratic(
      LON_COEF,
      x,
      y
    );


  const my =
    quadratic(
      MERC_COEF,
      x,
      y
    );


  /*
   * WebMercator Y -> latitude
   */

  const lat =
    (
      2 *
      Math.atan(
        Math.exp(my)
      ) -
      Math.PI / 2
    ) *
    180 /
    Math.PI;


  return {
    lon,
    lat,
    mercY: my
  };

}


/* =========================================================
   GEO -> OUTPUT PIXEL
========================================================= */

function geoToOutputPixel(
  lon,
  mercY
){

  const west =
    GEO.west;

  const east =
    GEO.east;

  const south =
    GEO.south;

  const north =
    GEO.north;


  const northMerc =
    mercatorY(
      north
    );


  const southMerc =
    mercatorY(
      south
    );


  const x =
    (
      lon -
      west
    ) /
    (
      east -
      west
    ) *
    (
      SOURCE_WIDTH - 1
    );


  /*
   * В WebMercator север
   * находится выше.
   */

  const y =
    (
      northMerc -
      mercY
    ) /
    (
      northMerc -
      southMerc
    ) *
    (
      SOURCE_HEIGHT - 1
    );


  return {
    x,
    y
  };

}


/* =========================================================
   COLOR DISTANCE
========================================================= */

function colorDistance(
  r,
  g,
  b,
  c
){

  const dr =
    r - c[0];

  const dg =
    g - c[1];

  const db =
    b - c[2];


  return (
    dr * dr +
    dg * dg +
    db * db
  );

}


/* =========================================================
   SOURCE COLOR -> CLOrad
========================================================= */

function sourceColorToLevel(
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


  /*
   * Прозрачный/тёмный фон.
   */

  if (
    max < 70
  ){

    return -1;

  }


  /*
   * Почти серые служебные
   * элементы не являются радаром.
   */

  if (
    chroma < 28
  ){

    return -1;

  }


  let best =
    -1;

  let bestDistance =
    Infinity;


  for (
    let i = 0;
    i < CLORAD_PALETTE.length;
    i++
  ){

    const d =
      colorDistance(
        r,
        g,
        b,
        CLORAD_PALETTE[i]
      );


    if (
      d <
      bestDistance
    ){

      bestDistance =
        d;

      best =
        i;

    }

  }


  /*
   * Слишком далёкий цвет —
   * не считаем радаром.
   */

  if (
    bestDistance >
    15000
  ){

    return -1;

  }


  return best;

}


/* =========================================================
   RADAR PIXEL FILTER
========================================================= */

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


  if (
    max < 70
  ){

    return false;

  }


  if (
    chroma < 30
  ){

    return false;

  }


  /*
   * Белый/серый текст,
   * подписи и элементы интерфейса.
   */

  if (
    max > 238 &&
    chroma < 45
  ){

    return false;

  }


  return true;

}


/* =========================================================
   SERVICE AREA
========================================================= */

function isServiceArea(
  sourceX,
  sourceY
){

  /*
   * Сначала возвращаемся
   * в систему координат
   * исходного скриншота.
   */

  const x =
    sourceX *
    CALIBRATION_WIDTH /
    SOURCE_WIDTH;


  const y =
    sourceY *
    CALIBRATION_HEIGHT /
    SOURCE_HEIGHT;


  /*
   * Левая легенда.
   */

  if (
    x <= 145 &&
    y <= 365
  ){

    return true;

  }


  /*
   * Верхняя служебная область.
   */

  if (
    y <= 58
  ){

    return true;

  }


  /*
   * Нижний левый логотип.
   */

  if (
    x <= 160 &&
    y >= 965
  ){

    return true;

  }


  /*
   * Нижняя служебная линия.
   */

  if (
    y >= 1105
  ){

    return true;

  }


  /*
   * Нижний правый timestamp.
   */

  if (
    x >= 760 &&
    y >= 1060
  ){

    return true;

  }


  /*
   * Верхний правый timestamp.
   */

  if (
    x >= 735 &&
    y <= 65
  ){

    return true;

  }


  return false;

}


/* =========================================================
   DOWNLOAD GIF
========================================================= */

async function getGIF(){

  const now =
    Date.now();


  if (
    gifCache &&
    now -
      gifCacheTime <
      GIF_CACHE_MS
  ){

    return gifCache;

  }


  const response =
    await fetch(
      SOURCE_GIF,
      {

        headers: {

          "User-Agent":
            "Mozilla/5.0 (compatible; CLOrad/1.0)",

          "Accept":
            "image/gif,image/*,*/*",

          "Referer":
            "https://meteoinfo.ru/radanim"

        }

      }
    );


  if (
    !response.ok
  ){

    throw new Error(
      `Meteoinfo GIF HTTP ${response.status}`
    );

  }


  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );


  /*
   * При новом GIF старые
   * обработанные кадры удаляются.
   */

  if (
    !gifCache ||
    !gifCache.equals(
      buffer
    )
  ){

    processedFrames.clear();

  }


  gifCache =
    buffer;

  gifCacheTime =
    now;


  return gifCache;

}


/* =========================================================
   METADATA
========================================================= */

async function getMetadata(
  gif
){

  const metadata =
    await sharp(
      gif,
      {
        animated: true
      }
    )
    .metadata();


  return {

    frames:
      metadata.pages || 1,

    width:
      metadata.width || 1200,

    height:
      metadata.height || 1200,

    delays:
      metadata.delay || []

  };

}


/* =========================================================
   HOLE FILL
========================================================= */

function fillSmallRadarHoles(
  pixels,
  width,
  height
){

  const mask =
    new Uint8Array(
      width *
      height
    );


  for (
    let i = 0;
    i < width * height;
    i++
  ){

    if (
      pixels[
        i * 4 + 3
      ] > 0
    ){

      mask[i] =
        1;

    }

  }


  const result =
    Buffer.from(
      pixels
    );


  for (
    let pass = 0;
    pass < 2;
    pass++
  ){

    for (
      let y = 1;
      y < height - 1;
      y++
    ){

      for (
        let x = 1;
        x < width - 1;
        x++
      ){

        const index =
          y * width + x;


        if (
          mask[index]
        ){

          continue;

        }


        const neighbors = [

          index - width,
          index + width,
          index - 1,
          index + 1,

          index -
            width -
            1,

          index -
            width +
            1,

          index +
            width -
            1,

          index +
            width +
            1

        ];


        const colors =
          new Map();


        let count =
          0;


        for (
          const n
          of neighbors
        ){

          if (
            !mask[n]
          ){

            continue;

          }


          const p =
            n * 4;


          const key =
            `${result[p]},${result[p + 1]},${result[p + 2]}`;


          colors.set(
            key,
            (
              colors.get(key) ||
              0
            ) + 1
          );


          count++;

        }


        if (
          count < 6
        ){

          continue;

        }


        let bestKey =
          null;

        let bestCount =
          0;


        for (
          const [
            key,
            value
          ]
          of colors
        ){

          if (
            value >
            bestCount
          ){

            bestCount =
              value;

            bestKey =
              key;

          }

        }


        if (
          !bestKey ||
          bestCount < 4
        ){

          continue;

        }


        const rgb =
          bestKey
            .split(",")
            .map(Number);


        const p =
          index * 4;


        result[p] =
          rgb[0];

        result[p + 1] =
          rgb[1];

        result[p + 2] =
          rgb[2];

        result[p + 3] =
          255;


        mask[index] =
          1;

      }

    }

  }


  return result;

}


/* =========================================================
   RENDER FRAME
========================================================= */

async function renderFrame(
  gif,
  frame
){

  const cacheKey =
    String(frame);


  if (
    processedFrames.has(
      cacheKey
    )
  ){

    return processedFrames.get(
      cacheKey
    );

  }


  /*
   * Получаем один кадр
   * настоящей GIF.
   */

  const source =
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


  const srcWidth =
    source.info.width;

  const srcHeight =
    source.info.height;

  const src =
    source.data;


  /*
   * Защита.
   */

  if (
    srcWidth !== SOURCE_WIDTH ||
    srcHeight !== SOURCE_HEIGHT
  ){

    throw new Error(
      `Неожиданный размер GIF: ${srcWidth}×${srcHeight}`
    );

  }


  /*
   * Web Mercator PNG.
   *
   * Остаётся 1200×1200,
   * поэтому gif-radar.js
   * менять не требуется.
   */

  const output =
    Buffer.alloc(
      SOURCE_WIDTH *
      SOURCE_HEIGHT *
      4
    );


  /*
   * Для каждого исходного пикселя:
   *
   * 1. читаем его цвет;
   * 2. переводим его x/y
   *    в географию;
   * 3. переводим географию
   *    в Web Mercator;
   * 4. кладём цвет в правильное
   *    место итогового PNG.
   */

  for (
    let sy = 0;
    sy < SOURCE_HEIGHT;
    sy++
  ){

    for (
      let sx = 0;
      sx < SOURCE_WIDTH;
      sx++
    ){

      const sourceIndex =
        (
          sy *
          srcWidth +
          sx
        ) * 4;


      const alpha =
        src[
          sourceIndex + 3
        ];


      if (
        alpha < 30
      ){

        continue;

      }


      /*
       * Убираем служебные
       * элементы исходной GIF.
       */

      if (
        isServiceArea(
          sx,
          sy
        )
      ){

        continue;

      }


      const r =
        src[
          sourceIndex
        ];

      const g =
        src[
          sourceIndex + 1
        ];

      const b =
        src[
          sourceIndex + 2
        ];


      if (
        !isRadarPixel(
          r,
          g,
          b
        )
      ){

        continue;

      }


      const level =
        sourceColorToLevel(
          r,
          g,
          b
        );


      if (
        level < 0
      ){

        continue;

      }


      /*
       * Реальная географическая
       * позиция исходного пикселя.
       */

      const geo =
        sourcePixelToGeo(
          sx,
          sy
        );


      /*
       * Отсекаем явно вышедшие
       * за область карты точки.
       */

      if (
        geo.lon <
          GEO.west - 1 ||
        geo.lon >
          GEO.east + 1 ||
        geo.lat <
          GEO.south - 1 ||
        geo.lat >
          GEO.north + 1
      ){

        continue;

      }


      const target =
        geoToOutputPixel(
          geo.lon,
          geo.mercY
        );


      const tx =
        Math.round(
          target.x
        );

      const ty =
        Math.round(
          target.y
        );


      if (
        tx < 0 ||
        ty < 0 ||
        tx >= SOURCE_WIDTH ||
        ty >= SOURCE_HEIGHT
      ){

        continue;

      }


      const targetIndex =
        (
          ty *
          SOURCE_WIDTH +
          tx
        ) * 4;


      const color =
        CLORAD_PALETTE[
          level
        ];


      output[
        targetIndex
      ] =
        color[0];

      output[
        targetIndex + 1
      ] =
        color[1];

      output[
        targetIndex + 2
      ] =
        color[2];

      output[
        targetIndex + 3
      ] =
        255;

    }

  }


  /*
   * Заполняем только маленькие
   * отверстия, появившиеся
   * из-за перепроекции.
   */

  const filled =
    fillSmallRadarHoles(
      output,
      SOURCE_WIDTH,
      SOURCE_HEIGHT
    );


  /*
   * PNG.
   */

  const png =
    await sharp(
      filled,
      {

        raw: {

          width:
            SOURCE_WIDTH,

          height:
            SOURCE_HEIGHT,

          channels:
            4

        }

      }
    )
    .png({

      compressionLevel:
        6,

      adaptiveFiltering:
        false

    })
    .toBuffer();


  processedFrames.set(
    cacheKey,
    png
  );


  /*
   * Ограничиваем память.
   */

  while (
    processedFrames.size >
    MAX_PROCESSED_FRAMES
  ){

    const first =
      processedFrames
        .keys()
        .next()
        .value;


    processedFrames.delete(
      first
    );

  }


  return png;

}


/* =========================================================
   API HANDLER
========================================================= */

export default async function handler(
  req,
  res
){

  try {

    const gif =
      await getGIF();


    /* =====================================================
       META
    ===================================================== */

    if (
      req.query.mode ===
      "meta"
    ){

      const metadata =
        await getMetadata(
          gif
        );


      res.setHeader(
        "Cache-Control",
        "no-store"
      );


      return res
        .status(200)
        .json(
          metadata
        );

    }


    /* =====================================================
       FRAME
    ===================================================== */

    let frame =
      Number(
        req.query.frame
      );


    if (
      !Number.isFinite(
        frame
      )
    ){

      frame =
        0;

    }


    const metadata =
      await getMetadata(
        gif
      );


    frame =
      Math.max(
        0,
        Math.min(
          metadata.frames - 1,
          Math.floor(frame)
        )
      );


    const png =
      await renderFrame(
        gif,
        frame
      );


    res.setHeader(
      "Content-Type",
      "image/png"
    );


    res.setHeader(
      "Cache-Control",
      "public, max-age=30, stale-while-revalidate=60"
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


  } catch (
    error
  ){

    console.error(
      "CLOrad radar-gif:",
      error
    );


    return res
      .status(500)
      .json({

        error:
          "Radar frame loading failed",

        message:
          error?.message ||
          String(error)

      });

  }

}
