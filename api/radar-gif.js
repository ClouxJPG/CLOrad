import sharp from "sharp";

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";

/* =========================================================
   CACHE
========================================================= */

let gifCache = null;
let gifCacheTime = 0;

const GIF_CACHE_MS = 30 * 1000;

const processedFrames = new Map();
const MAX_PROCESSED_FRAMES = 12;


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
   GIF / CALIBRATION SIZES
========================================================= */

/*
 * Контрольные точки были измерены
 * на изображении 1122 × 1136.
 *
 * Реальный GIF:
 * 1200 × 1200.
 */

const CALIBRATION_WIDTH = 1122;
const CALIBRATION_HEIGHT = 1136;

const SOURCE_WIDTH = 1200;
const SOURCE_HEIGHT = 1200;


/*
 * Масштаб между скриншотом,
 * по которому строилась калибровка,
 * и настоящей GIF.
 */

const SCALE_X =
  SOURCE_WIDTH / CALIBRATION_WIDTH;

const SCALE_Y =
  SOURCE_HEIGHT / CALIBRATION_HEIGHT;


/* =========================================================
   ORIGINAL CALIBRATION
========================================================= */

const PX = [
   614.702787260693,
   213.524267491052,
    86.865800553715,
    17.052995641967,
   -18.941081998370,
    -3.466637383242
];

const PY = [
   548.709828924571,
   231.245550214358,
   -80.613999910294,
   -23.817051905972,
   -12.895624928117,
     3.365220370149
];

const UC_MERC =
  1.159140403966;

const US_MERC =
  0.080017466461;


/* =========================================================
   LEAFLET BOUNDS
========================================================= */

/*
 * ВАЖНО:
 * эти bounds оставляем теми же,
 * которые уже используются в gif-radar.js.
 */

const GIF_BOUNDS = {
  west: 14.9892981264,
  east: 72.9237642948,
  south: 38.2155955810,
  north: 69.6543707199
};


/* =========================================================
   MERCATOR
========================================================= */

function mercatorY(lat) {

  const r =
    lat * Math.PI / 180;

  return Math.log(
    Math.tan(
      Math.PI / 4 +
      r / 2
    )
  );
}


/* =========================================================
   GEO -> CALIBRATION PIXEL
========================================================= */

function geoToCalibrationPixel(
  lon,
  lat
) {

  const lonRad =
    lon * Math.PI / 180;

  const mercY =
    mercatorY(lat);


  const u =
    lonRad -
    UC_MERC;

  const v =
    mercY -
    US_MERC;


  const u2 =
    u * u;

  const uv =
    u * v;

  const v2 =
    v * v;


  const x =
    PX[0] +
    PX[1] * u +
    PX[2] * v +
    PX[3] * u2 +
    PX[4] * uv +
    PX[5] * v2;


  const y =
    PY[0] +
    PY[1] * u +
    PY[2] * v +
    PY[3] * u2 +
    PY[4] * uv +
    PY[5] * v2;


  return [
    x,
    y
  ];
}


/* =========================================================
   GEO -> REAL 1200×1200 GIF PIXEL
========================================================= */

function geoToSourcePixel(
  lon,
  lat
) {

  const [
    calibrationX,
    calibrationY
  ] =
    geoToCalibrationPixel(
      lon,
      lat
    );


  /*
   * КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ:
   *
   * калибровка была сделана
   * на 1122×1136,
   * а настоящий GIF 1200×1200.
   */

  return [
    calibrationX * SCALE_X,
    calibrationY * SCALE_Y
  ];
}


/* =========================================================
   COLOR DISTANCE
========================================================= */

function colorDistance(
  r,
  g,
  b,
  c
) {

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
) {

  const max =
    Math.max(r,g,b);

  const min =
    Math.min(r,g,b);

  const chroma =
    max - min;


  if (max < 70)
    return -1;

  if (chroma < 28)
    return -1;

  if (
    max > 235 &&
    chroma < 45
  )
    return -1;


  let best = -1;
  let bestDist = Infinity;


  for (
    let i = 0;
    i < CLORAD_PALETTE.length;
    i++
  ) {

    const d =
      colorDistance(
        r,
        g,
        b,
        CLORAD_PALETTE[i]
      );


    if (d < bestDist) {

      bestDist = d;
      best = i;
    }
  }


  if (
    best < 0 ||
    bestDist > 15000
  )
    return -1;


  return best;
}


/* =========================================================
   RADAR PIXEL FILTER
========================================================= */

function isRadarPixel(
  r,
  g,
  b
) {

  const max =
    Math.max(r,g,b);

  const min =
    Math.min(r,g,b);

  const chroma =
    max - min;


  if (max < 70)
    return false;

  if (chroma < 30)
    return false;


  const saturation =
    chroma /
    Math.max(max,1);


  if (saturation < 0.15)
    return false;


  if (
    max > 238 &&
    saturation < 0.20
  )
    return false;


  return true;
}


/* =========================================================
   SERVICE GRAPHICS
========================================================= */

function isServiceArea(
  x,
  y,
  width,
  height
) {

  /*
   * Координаты служебных элементов
   * тоже были определены на 1122×1136.
   */

  const sx =
    x *
    CALIBRATION_WIDTH /
    width;

  const sy =
    y *
    CALIBRATION_HEIGHT /
    height;


  if (
    sx <= 145 &&
    sy <= 365
  )
    return true;


  if (sy <= 58)
    return true;


  if (
    sx <= 160 &&
    sy >= 965
  )
    return true;


  if (sy >= 1105)
    return true;


  if (
    sx >= 760 &&
    sy >= 1060
  )
    return true;


  if (
    sx >= 735 &&
    sy <= 65
  )
    return true;


  return false;
}


/* =========================================================
   DOWNLOAD GIF
========================================================= */

async function getGIF() {

  const now =
    Date.now();


  if (
    gifCache &&
    now - gifCacheTime <
      GIF_CACHE_MS
  ) {

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


  if (!response.ok) {

    throw new Error(
      `Meteoinfo GIF HTTP ${response.status}`
    );
  }


  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );


  /*
   * Новый GIF =
   * старые обработанные кадры больше
   * не нужны.
   */

  if (
    !gifCache ||
    !gifCache.equals(buffer)
  ) {

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
) {

  const metadata =
    await sharp(
      gif,
      {
        animated: true
      }
    ).metadata();


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
   SMALL RADAR HOLES
========================================================= */

function fillSmallRadarHoles(
  pixels,
  width,
  height
) {

  const mask =
    new Uint8Array(
      width * height
    );


  for (
    let i = 0;
    i < width * height;
    i++
  ) {

    if (
      pixels[i * 4 + 3] > 0
    ) {

      mask[i] = 1;
    }
  }


  const result =
    Buffer.from(pixels);


  for (
    let pass = 0;
    pass < 2;
    pass++
  ) {

    for (
      let y = 1;
      y < height - 1;
      y++
    ) {

      for (
        let x = 1;
        x < width - 1;
        x++
      ) {

        const idx =
          y * width + x;


        if (mask[idx])
          continue;


        const positions = [
          idx - width,
          idx + width,
          idx - 1,
          idx + 1,
          idx - width - 1,
          idx - width + 1,
          idx + width - 1,
          idx + width + 1
        ];


        const colors = [];


        for (
          const n of positions
        ) {

          if (!mask[n])
            continue;


          const p =
            n * 4;


          colors.push([
            result[p],
            result[p + 1],
            result[p + 2]
          ]);
        }


        if (
          colors.length < 6
        )
          continue;


        const counts =
          new Map();


        for (
          const c of colors
        ) {

          const key =
            `${c[0]},${c[1]},${c[2]}`;


          counts.set(
            key,
            (counts.get(key) || 0) + 1
          );
        }


        let bestKey = null;
        let bestCount = 0;


        for (
          const [key,count]
          of counts
        ) {

          if (
            count > bestCount
          ) {

            bestCount = count;
            bestKey = key;
          }
        }


        if (
          !bestKey ||
          bestCount < 4
        )
          continue;


        const rgb =
          bestKey
            .split(",")
            .map(Number);


        const p =
          idx * 4;


        result[p] =
          rgb[0];

        result[p + 1] =
          rgb[1];

        result[p + 2] =
          rgb[2];

        result[p + 3] =
          255;


        mask[idx] = 1;
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
) {

  const key =
    String(frame);


  if (
    processedFrames.has(key)
  ) {

    return processedFrames.get(key);
  }


  const source =
    await sharp(
      gif,
      {
        animated: true,
        page: frame,
        pages: 1
      }
    )
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject: true
      });


  const srcWidth =
    source.info.width;

  const srcHeight =
    source.info.height;

  const src =
    source.data;


  /*
   * ВЫХОД ВСЕГДА 1200×1200.
   *
   * Это принципиально:
   * gif-radar.js уже знает именно
   * эти bounds и этот формат.
   */

  const width = 1200;
  const height = 1200;


  const output =
    Buffer.alloc(
      width *
      height *
      4
    );


  /*
   * Leaflet bounds задают географический
   * прямоугольник.
   *
   * Для каждого выходного пикселя
   * получаем lon/lat.
   */

  for (
    let y = 0;
    y < height;
    y++
  ) {

    const lat =
      GIF_BOUNDS.north -
      (
        y /
        (height - 1)
      ) *
      (
        GIF_BOUNDS.north -
        GIF_BOUNDS.south
      );


    for (
      let x = 0;
      x < width;
      x++
    ) {

      const lon =
        GIF_BOUNDS.west +
        (
          x /
          (width - 1)
        ) *
        (
          GIF_BOUNDS.east -
          GIF_BOUNDS.west
        );


      const [
        sx,
        sy
      ] =
        geoToSourcePixel(
          lon,
          lat
        );


      if (
        sx < 0 ||
        sy < 0 ||
        sx >= srcWidth ||
        sy >= srcHeight
      ) {
        continue;
      }


      const ix =
        Math.round(sx);

      const iy =
        Math.round(sy);


      if (
        ix < 0 ||
        iy < 0 ||
        ix >= srcWidth ||
        iy >= srcHeight
      ) {
        continue;
      }


      if (
        isServiceArea(
          ix,
          iy,
          srcWidth,
          srcHeight
        )
      ) {
        continue;
      }


      const sp =
        (
          iy *
          srcWidth +
          ix
        ) * 4;


      const r =
        src[sp];

      const g =
        src[sp + 1];

      const b =
        src[sp + 2];

      const a =
        src[sp + 3];


      if (a < 30)
        continue;


      if (
        !isRadarPixel(
          r,
          g,
          b
        )
      )
        continue;


      const level =
        sourceColorToLevel(
          r,
          g,
          b
        );


      if (
        level < 0 ||
        level >=
          CLORAD_PALETTE.length
      )
        continue;


      const color =
        CLORAD_PALETTE[level];


      const op =
        (
          y *
          width +
          x
        ) * 4;


      output[op] =
        color[0];

      output[op + 1] =
        color[1];

      output[op + 2] =
        color[2];

      output[op + 3] =
        255;
    }
  }


  const filled =
    fillSmallRadarHoles(
      output,
      width,
      height
    );


  const png =
    await sharp(
      filled,
      {
        raw: {
          width,
          height,
          channels: 4
        }
      }
    )
      .png({
        compressionLevel: 6,
        adaptiveFiltering: false
      })
      .toBuffer();


  processedFrames.set(
    key,
    png
  );


  while (
    processedFrames.size >
    MAX_PROCESSED_FRAMES
  ) {

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
   API
========================================================= */

export default async function handler(
  req,
  res
) {

  try {

    const gif =
      await getGIF();


    /* ---------- META ---------- */

    if (
      req.query.mode === "meta"
    ) {

      const metadata =
        await getMetadata(gif);


      res.setHeader(
        "Cache-Control",
        "no-store"
      );


      return res
        .status(200)
        .json(metadata);
    }


    /* ---------- FRAME ---------- */

    let frame =
      Number(
        req.query.frame
      );


    if (
      !Number.isFinite(frame)
    ) {

      frame = 0;
    }


    const metadata =
      await getMetadata(gif);


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
      String(png.length)
    );


    return res
      .status(200)
      .send(png);

  } catch (error) {

    console.error(
      "radar-gif error:",
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
