/* =========================================================
   CLOrad — Meteoinfo GIF Radar API
   ========================================================= */

const sharp = require("sharp");

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";

/* =========================================================
   CACHE
   ========================================================= */

let gifCache = null;
let gifCacheTime = 0;

const GIF_CACHE_MS = 30000;

const frameCache = new Map();

const MAX_FRAME_CACHE = 12;

/* =========================================================
   CLOrad PALETTE
   ========================================================= */

const PALETTE = [
  [185, 193, 199],
  [169, 199, 244],
  [99, 237, 165],
  [67, 207, 137],
  [77, 184, 78],
  [255, 248, 156],
  [117, 166, 239],
  [82, 121, 237],
  [80, 74, 155],
  [255, 192, 168],
  [250, 130, 160],
  [255, 77, 77],
  [219, 146, 72],
  [173, 117, 68],
  [146, 75, 72],
  [242, 170, 240],
  [232, 90, 231],
  [202, 60, 199],
  [119, 124, 145]
];

/* =========================================================
   ORIGINAL GIF GEOMETRY
   ========================================================= */

const GIF_WIDTH = 1122;
const GIF_HEIGHT = 1136;

/* =========================================================
   WEB MERCATOR BOUNDS
   ========================================================= */

const GIF_BOUNDS = {
  south: 38.2155955810,
  north: 69.6543707199,
  west: 14.9892981264,
  east: 72.9237642948
};

/* =========================================================
   OLD CALIBRATION
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

const UC_MERC = 1.159140403966;
const US_MERC = 0.080017466461;

const UC = 42.7295125;
const US = 11.984477282034;

/* =========================================================
   MERCATOR
   ========================================================= */

function mercatorY(lat) {
  const r = lat * Math.PI / 180;

  return Math.log(
    Math.tan(
      Math.PI / 4 + r / 2
    )
  );
}

/* =========================================================
   GEO → SOURCE PIXEL
   ========================================================= */

function geoToSource(lat, lon) {

  const m = mercatorY(lat);

  const u =
    (lon - UC) / UC_MERC;

  const v =
    (m - US) / US_MERC;

  const u2 = u * u;
  const v2 = v * v;
  const uv = u * v;

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

  return [x, y];
}

/* =========================================================
   SERVICE GRAPHICS FILTER
   ========================================================= */

function isServicePixel(x, y) {

  if (
    x <= 145 &&
    y <= 365
  ) {
    return true;
  }

  if (
    y <= 58
  ) {
    return true;
  }

  if (
    x <= 160 &&
    y >= 965
  ) {
    return true;
  }

  if (
    y >= 1105
  ) {
    return true;
  }

  if (
    x >= 760 &&
    y >= 1060
  ) {
    return true;
  }

  if (
    x >= 735 &&
    y <= 65
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   RADAR PIXEL
   ========================================================= */

function isRadarPixel(r, g, b, a) {

  if (a < 100) {
    return false;
  }

  /*
     Серый/белый фон и подписи
  */

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  if (
    max > 245 &&
    min > 235
  ) {
    return false;
  }

  /*
     Почти чёрный фон
  */

  if (
    r < 18 &&
    g < 18 &&
    b < 18
  ) {
    return false;
  }

  /*
     Сохраняем цветные радарные области.
  */

  return true;
}

/* =========================================================
   PALETTE LOOKUP
   ========================================================= */

function paletteColor(r, g, b) {

  let best = 0;
  let bestDistance = Infinity;

  for (
    let i = 0;
    i < PALETTE.length;
    i++
  ) {

    const p = PALETTE[i];

    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];

    const d =
      dr * dr +
      dg * dg +
      db * db;

    if (
      d < bestDistance
    ) {

      bestDistance = d;
      best = i;

    }

  }

  return PALETTE[best];
}

/* =========================================================
   LOAD GIF
   ========================================================= */

async function getGIF() {

  const now = Date.now();

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
            "Mozilla/5.0",
          "Accept":
            "image/gif,image/*,*/*",
          "Referer":
            "https://meteoinfo.ru/radanim"
        }
      }
    );

  if (
    !response.ok
  ) {

    throw new Error(
      "Meteoinfo GIF HTTP " +
      response.status
    );

  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  gifCache = buffer;
  gifCacheTime = now;

  /*
     Новый GIF →
     старые обработанные кадры
     больше не нужны.
  */

  frameCache.clear();

  return buffer;
}

/* =========================================================
   GIF METADATA
   ========================================================= */

async function getMetadata(buffer) {

  const meta =
    await sharp(buffer, {
      animated: true
    }).metadata();

  const frames =
    Number(meta.pages || 1);

  const delay =
    meta.delay || [];

  const delays = [];

  for (
    let i = 0;
    i < frames;
    i++
  ) {

    delays.push(
      Number(delay[i]) > 0
        ? Number(delay[i])
        : 700
    );

  }

  return {
    width:
      meta.width || GIF_WIDTH,

    height:
      meta.height || GIF_HEIGHT,

    frames,

    delays
  };
}

/* =========================================================
   FILL SMALL HOLES
   ========================================================= */

function fillSmallRadarHoles(
  rgba,
  width,
  height
) {

  for (
    let pass = 0;
    pass < 2;
    pass++
  ) {

    const copy =
      Buffer.from(rgba);

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

        const pos =
          (y * width + x) * 4;

        if (
          copy[pos + 3] !== 0
        ) {
          continue;
        }

        const colors = [];

        const neighbours = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
          [x - 1, y - 1],
          [x + 1, y - 1],
          [x - 1, y + 1],
          [x + 1, y + 1]
        ];

        for (
          const [nx, ny]
          of neighbours
        ) {

          const np =
            (ny * width + nx) * 4;

          if (
            copy[np + 3] === 0
          ) {
            continue;
          }

          colors.push([
            copy[np],
            copy[np + 1],
            copy[np + 2]
          ]);

        }

        if (
          colors.length < 6
        ) {
          continue;
        }

        const counts =
          new Map();

        for (
          const c of colors
        ) {

          const key =
            c.join(",");

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

            bestCount = count;
            bestKey = key;

          }

        }

        if (
          bestKey &&
          bestCount >= 5
        ) {

          const c =
            bestKey
              .split(",")
              .map(Number);

          rgba[pos] =
            c[0];

          rgba[pos + 1] =
            c[1];

          rgba[pos + 2] =
            c[2];

          rgba[pos + 3] =
            255;

        }

      }

    }

    rgba.set(copy);
  }

  return rgba;
}

/* =========================================================
   RENDER FRAME
   ========================================================= */

async function renderFrame(
  buffer,
  frame,
  resolution
) {

  const meta =
    await getMetadata(buffer);

  const width =
    meta.width;

  const height =
    meta.height;

  const scale =
    Math.max(
      1,
      Number(resolution) || 1
    );

  const outWidth =
    Math.floor(
      width / scale
    );

  const outHeight =
    Math.floor(
      height / scale
    );

  /*
     Декодируем конкретный
     GIF frame.
  */

  const decoded =
    await sharp(buffer, {
      animated: true,
      page: frame,
      pages: 1
    })
    .ensureAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true
    });

  const src =
    decoded.data;

  const output =
    Buffer.alloc(
      outWidth *
      outHeight *
      4
    );

  for (
    let oy = 0;
    oy < outHeight;
    oy++
  ) {

    /*
       Web Mercator latitude.
       Центр каждого выходного пикселя.
    */

    const lat =
      GIF_BOUNDS.south +
      (
        oy + 0.5
      ) /
      outHeight *
      (
        GIF_BOUNDS.north -
        GIF_BOUNDS.south
      );

    for (
      let ox = 0;
      ox < outWidth;
      ox++
    ) {

      const lon =
        GIF_BOUNDS.west +
        (
          ox + 0.5
        ) /
        outWidth *
        (
          GIF_BOUNDS.east -
          GIF_BOUNDS.west
        );

      const [
        sxFloat,
        syFloat
      ] =
        geoToSource(
          lat,
          lon
        );

      const sx =
        Math.round(
          sxFloat
        );

      const sy =
        Math.round(
          syFloat
        );

      const outPos =
        (
          oy *
          outWidth +
          ox
        ) * 4;

      if (
        sx < 0 ||
        sy < 0 ||
        sx >= width ||
        sy >= height
      ) {

        output[outPos + 3] =
          0;

        continue;

      }

      if (
        isServicePixel(
          sx,
          sy
        )
      ) {

        output[outPos + 3] =
          0;

        continue;

      }

      const srcPos =
        (
          sy *
          width +
          sx
        ) * 4;

      const r =
        src[srcPos];

      const g =
        src[srcPos + 1];

      const b =
        src[srcPos + 2];

      const a =
        src[srcPos + 3];

      if (
        !isRadarPixel(
          r,
          g,
          b,
          a
        )
      ) {

        output[outPos + 3] =
          0;

        continue;

      }

      const color =
        paletteColor(
          r,
          g,
          b
        );

      output[outPos] =
        color[0];

      output[outPos + 1] =
        color[1];

      output[outPos + 2] =
        color[2];

      output[outPos + 3] =
        255;

    }

  }

  /*
     Убираем мелкие дырки,
     но не создаём новые
     радарные области.
  */

  fillSmallRadarHoles(
    output,
    outWidth,
    outHeight
  );

  return sharp(
    output,
    {
      raw: {
        width:
          outWidth,

        height:
          outHeight,

        channels: 4
      }
    }
  )
  .png()
  .toBuffer();
}

/* =========================================================
   HANDLER
   ========================================================= */

module.exports =
  async function handler(
    req,
    res
  ) {

    try {

      const buffer =
        await getGIF();

      const mode =
        String(
          req.query?.mode || ""
        );

      /*
         META
      */

      if (
        mode === "meta"
      ) {

        const meta =
          await getMetadata(
            buffer
          );

        res.status(200).json({
          ok: true,
          frames:
            meta.frames,
          width:
            meta.width,
          height:
            meta.height,
          delays:
            meta.delays
        });

        return;

      }

      /*
         FRAME
      */

      const frame =
        Math.max(
          0,
          Number(
            req.query?.frame || 0
          )
        );

      const resolution =
        [1, 2, 4].includes(
          Number(
            req.query?.resolution
          )
        )
          ? Number(
              req.query.resolution
            )
          : 1;

      const key =
        `${gifCacheTime}:${frame}:${resolution}`;

      if (
        frameCache.has(key)
      ) {

        const cached =
          frameCache.get(key);

        res.setHeader(
          "Content-Type",
          "image/png"
        );

        res.setHeader(
          "Cache-Control",
          "public, max-age=30"
        );

        res.status(200).send(
          cached
        );

        return;

      }

      const meta =
        await getMetadata(
          buffer
        );

      if (
        frame >= meta.frames
      ) {

        res.status(400).json({
          ok: false,
          error:
            "Кадр вне диапазона"
        });

        return;

      }

      const png =
        await renderFrame(
          buffer,
          frame,
          resolution
        );

      frameCache.set(
        key,
        png
      );

      while (
        frameCache.size >
        MAX_FRAME_CACHE
      ) {

        const firstKey =
          frameCache.keys().next()
            .value;

        frameCache.delete(
          firstKey
        );

      }

      res.setHeader(
        "Content-Type",
        "image/png"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=30"
      );

      res.status(200).send(
        png
      );

    } catch (error) {

      console.error(
        "CLOrad radar-gif API:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error?.message ||
          "Ошибка обработки GIF"
      });

    }

  };
