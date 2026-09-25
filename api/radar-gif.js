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
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;

  if (max < 70) return -1;
  if (chroma < 28) return -1;

  if (
    max > 235 &&
    chroma < 45
  ) {
    return -1;
  }

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
  ) {
    return -1;
  }

  return best;
}


/* =========================================================
   СТАРАЯ ГЕОПРИВЯЗКА
   НЕ МЕНЯТЬ
========================================================= */

const UC = 42.7295125;
const US = 11.984477282034;

const UC_MERC = 1.159140403966;
const US_MERC = 0.080017466461;

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


/* =========================================================
   СТАРЫЙ MERCATOR
========================================================= */

function mercatorY(lat) {
  const rad =
    lat * Math.PI / 180;

  return Math.log(
    Math.tan(
      Math.PI / 4 +
      rad / 2
    )
  );
}


/* =========================================================
   СТАРОЕ GEO → SOURCE
========================================================= */

function geoToSource(lat, lon) {

  const u =
    lon - UC;

  const v =
    mercatorY(lat) -
    UC_MERC;

  const x =
    PX[0] +
    PX[1] * u +
    PX[2] * v +
    PX[3] * u * u +
    PX[4] * u * v +
    PX[5] * v * v;

  const y =
    PY[0] +
    PY[1] * u +
    PY[2] * v +
    PY[3] * u * u +
    PY[4] * u * v +
    PY[5] * v * v;

  return [x, y];
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
    chroma / Math.max(max, 1);

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

function isServiceArea(sx, sy) {

  // Левая легенда
  if (
    sx <= 145 &&
    sy <= 365
  ) {
    return true;
  }

  // Верхняя служебная область
  if (sy <= 58) {
    return true;
  }

  // Нижний логотип
  if (
    sx <= 160 &&
    sy >= 965
  ) {
    return true;
  }

  // Нижняя строка
  if (sy >= 1105) {
    return true;
  }

  // Нижний правый timestamp
  if (
    sx >= 760 &&
    sy >= 1060
  ) {
    return true;
  }

  // Верхний правый timestamp
  if (
    sx >= 735 &&
    sy <= 65
  ) {
    return true;
  }

  return false;
}


/* =========================================================
   DOWNLOAD SOURCE GIF
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
   * Новый GIF:
   * старые PNG-кадры больше не нужны.
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
   HOLE FILL
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

        const neighbors = [];

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

        let bestKey = null;
        let bestCount = 0;

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

        mask[idx] = 1;
      }
    }
  }

  return result;
}


/* =========================================================
   RENDER FRAME
   ГЕОМЕТРИЯ ВОССТАНОВЛЕНА:
   НЕ ИСПОЛЬЗУЕМ GIF_BOUNDS ДЛЯ ПЕРЕСКАЛИРОВАНИЯ.
========================================================= */

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
   * Получаем реальный размер
   * исходного GIF.
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
   * ВАЖНО:
   * выход остаётся точно такого же
   * размера, как исходный GIF.
   *
   * Никакого дополнительного
   * географического растягивания.
   */
  const output =
    Buffer.alloc(
      width *
      height *
      4
    );

  /*
   * Старый алгоритм:
   *
   * каждый выходной пиксель
   * переводим через старую
   * geoToSource().
   *
   * Для этого сначала получаем
   * географическую координату
   * этого пикселя из старой
   * калибровки.
   *
   * Важно: географическая сетка
   * строится в тех же пределах,
   * под которые была рассчитана
   * PX/PY.
   */

  const south =
    38.2155955810;

  const north =
    69.6543707199;

  const west =
    14.9892981264;

  const east =
    72.9237642948;

  for (
    let y = 0;
    y < height;
    y++
  ) {

    const lat =
      south +
      (
        y /
        (height - 1)
      ) *
      (
        north - south
      );

    for (
      let x = 0;
      x < width;
      x++
    ) {

      const lon =
        west +
        (
          x /
          (width - 1)
        ) *
        (
          east - west
        );

      const [
        sxRaw,
        syRaw
      ] =
        geoToSource(
          lat,
          lon
        );

      const sx =
        Math.round(
          sxRaw
        );

      const sy =
        Math.round(
          syRaw
        );

      if (
        sx < 0 ||
        sy < 0 ||
        sx >= width ||
        sy >= height
      ) {
        continue;
      }

      if (
        isServiceArea(
          sx,
          sy
        )
      ) {
        continue;
      }

      const sp =
        (
          sy *
          width +
          sx
        ) * 4;

      const r =
        src[sp];

      const g =
        src[sp + 1];

      const b =
        src[sp + 2];

      const a =
        src[sp + 3];

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

      const dp =
        (
          y *
          width +
          x
        ) * 4;

      output[dp] =
        color[0];

      output[dp + 1] =
        color[1];

      output[dp + 2] =
        color[2];

      output[dp + 3] =
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

    /* -----------------------------------------
       META
    ----------------------------------------- */

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

    /* -----------------------------------------
       FRAME
    ----------------------------------------- */

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
