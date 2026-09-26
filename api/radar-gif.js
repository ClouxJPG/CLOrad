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
  [185, 193, 199], // l1
  [169, 199, 244], // l2
  [99, 237, 165],  // l3
  [67, 207, 137],  // l4
  [77, 184, 78],   // l5
  [255, 248, 156], // l6
  [117, 166, 239], // l7
  [82, 121, 237],  // l8
  [80, 74, 155],   // l9
  [255, 192, 168], // l10
  [250, 130, 160], // l11
  [255, 77, 77],   // l12
  [219, 146, 72],  // l13
  [173, 117, 68],  // l14
  [146, 75, 72],   // l15
  [242, 170, 240], // l16
  [232, 90, 231],  // l17
  [202, 60, 199],  // l18
  [119, 124, 145]  // l19
];


/* =========================================================
   COLOR MAPPING
========================================================= */

function colorDistance(r, g, b, c) {
  const dr = r - c[0];
  const dg = g - c[1];
  const db = b - c[2];

  return (
    dr * dr +
    dg * dg +
    db * db
  );
}


function sourceColorToLevel(r, g, b) {

  const max =
    Math.max(r, g, b);

  const min =
    Math.min(r, g, b);

  const chroma =
    max - min;

  /*
   * Прозрачный/тёмный фон
   */
  if (max < 70) {
    return -1;
  }

  /*
   * Почти серый фон
   */
  if (chroma < 28) {
    return -1;
  }

  /*
   * Белые подписи/служебная графика
   */
  if (
    max > 235 &&
    chroma < 45
  ) {
    return -1;
  }

  let best =
    -1;

  let bestDist =
    Infinity;

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

  /*
   * Слишком далёкие цвета
   * не считаем радаром.
   */
  if (
    best < 0 ||
    bestDist > 15000
  ) {
    return -1;
  }

  return best;
}


/* =========================================================
   RADAR PIXEL FILTER
========================================================= */

function isRadarPixel(r, g, b) {

  const max =
    Math.max(r, g, b);

  const min =
    Math.min(r, g, b);

  const chroma =
    max - min;

  if (max < 70) {
    return false;
  }

  if (chroma < 30) {
    return false;
  }

  const saturation =
    chroma /
    Math.max(max, 1);

  if (saturation < 0.15) {
    return false;
  }

  if (
    max > 238 &&
    saturation < 0.20
  ) {
    return false;
  }

  return true;
}


/* =========================================================
   SERVICE AREAS
========================================================= */

function isServiceArea(x, y, width, height) {

  /*
   * Левая легенда.
   *
   * Координаты рассчитаны относительно
   * оригинального 1122×1136 изображения.
   *
   * Масштабируем автоматически,
   * если реальный GIF имеет другой размер.
   */

  const sx =
    x * 1122 / width;

  const sy =
    y * 1136 / height;


  /* Левая легенда */
  if (
    sx <= 145 &&
    sy <= 365
  ) {
    return true;
  }


  /* Верхняя служебная область */
  if (sy <= 58) {
    return true;
  }


  /* Нижний логотип */
  if (
    sx <= 160 &&
    sy >= 965
  ) {
    return true;
  }


  /* Нижняя строка */
  if (sy >= 1105) {
    return true;
  }


  /* Нижний правый timestamp */
  if (
    sx >= 760 &&
    sy >= 1060
  ) {
    return true;
  }


  /* Верхний правый timestamp */
  if (
    sx >= 735 &&
    sy <= 65
  ) {
    return true;
  }


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

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);


  /*
   * Если GIF изменился,
   * старые PNG удаляем из памяти.
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

async function getMetadata(gif) {

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
   SMALL HOLE FILL
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


  /*
   * Маска существующих
   * радарных пикселей.
   */
  for (
    let i = 0;
    i < width * height;
    i++
  ) {

    const p =
      i * 4;

    if (
      pixels[p + 3] > 0
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

        if (mask[idx]) {
          continue;
        }


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


        const neighbors = [];


        for (
          const n of positions
        ) {

          if (!mask[n]) {
            continue;
          }

          const p =
            n * 4;

          neighbors.push([
            result[p],
            result[p + 1],
            result[p + 2]
          ]);
        }


        /*
         * Заполняем только маленькие
         * дырки внутри поля.
         */
        if (
          neighbors.length < 6
        ) {
          continue;
        }


        const counts =
          new Map();


        for (
          const c of neighbors
        ) {

          const key =
            `${c[0]},${c[1]},${c[2]}`;

          counts.set(
            key,
            (counts.get(key) || 0) + 1
          );
        }


        let bestKey =
          null;

        let bestCount =
          0;


        for (
          const [
            key,
            count
          ] of counts
        ) {

          if (
            count > bestCount
          ) {
            bestCount =
              count;

            bestKey =
              key;
          }
        }


        if (
          !bestKey ||
          bestCount < 4
        ) {
          continue;
        }


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


        mask[idx] =
          1;
      }
    }
  }


  return result;
}


/* =========================================================
   RENDER FRAME
========================================================= */

/*
 * КЛЮЧЕВОЕ ИЗМЕНЕНИЕ:
 *
 * Здесь НЕТ:
 *
 *   geoToSource()
 *   GIF_BOUNDS
 *   mercatorY()
 *   PX / PY
 *
 * Мы больше НЕ ПЕРЕПРОЕЦИРУЕМ GIF.
 *
 * Исходная геометрия изображения полностью сохраняется.
 */

async function renderFrame(
  gif,
  frame
) {

  const cacheKey =
    String(frame);


  if (
    processedFrames.has(
      cacheKey
    )
  ) {
    return processedFrames.get(
      cacheKey
    );
  }


  /*
   * Получаем только нужный
   * кадр исходной GIF.
   */
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


  const width =
    source.info.width;

  const height =
    source.info.height;

  const src =
    source.data;


  /*
   * Выходной PNG имеет ТОЧНО
   * тот же размер, что и GIF.
   */
  const output =
    Buffer.alloc(
      width *
      height *
      4
    );


  /*
   * Каждый пиксель:
   *
   * 1. берём из исходной GIF;
   * 2. проверяем, не служебный ли он;
   * 3. проверяем, похож ли он на радар;
   * 4. переводим в CLOrad palette.
   *
   * НИКАКОГО географического
   * пересчёта здесь нет.
   */

  for (
    let y = 0;
    y < height;
    y++
  ) {

    for (
      let x = 0;
      x < width;
      x++
    ) {

      if (
        isServiceArea(
          x,
          y,
          width,
          height
        )
      ) {
        continue;
      }


      const p =
        (
          y *
          width +
          x
        ) * 4;


      const r =
        src[p];

      const g =
        src[p + 1];

      const b =
        src[p + 2];

      const a =
        src[p + 3];


      if (a < 30) {
        continue;
      }


      if (
        !isRadarPixel(
          r,
          g,
          b
        )
      ) {
        continue;
      }


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
      ) {
        continue;
      }


      const color =
        CLORAD_PALETTE[
          level
        ];


      output[p] =
        color[0];

      output[p + 1] =
        color[1];

      output[p + 2] =
        color[2];

      output[p + 3] =
        255;
    }
  }


  /*
   * Небольшое заполнение
   * дыр внутри радарных областей.
   */
  const filled =
    fillSmallRadarHoles(
      output,
      width,
      height
    );


  /*
   * PNG без изменения
   * геометрии.
   */
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


  /*
   * Кэш только ограниченного
   * количества обработанных кадров.
   */
  processedFrames.set(
    cacheKey,
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
   VERCEL HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  try {

    const gif =
      await getGIF();


    /* =====================================
       META
    ===================================== */

    if (
      req.query.mode === "meta"
    ) {

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
        .json(metadata);
    }


    /* =====================================
       FRAME
    ===================================== */

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
