// ============================================================
// CLOrad — Meteoinfo GIF radar API
// Server-side:
// GIF -> frame -> Web Mercator -> radar mask -> hole filling
// -> transparent PNG
// ============================================================

const sharp = require("sharp");

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";

const CACHE_TTL = 30 * 1000;

// ------------------------------------------------------------
// RAM CACHE
// ------------------------------------------------------------

let gifBuffer = null;
let gifLoadedAt = 0;

const frameCache = new Map();
const FRAME_CACHE_MAX = 12;

// ------------------------------------------------------------
// SOURCE IMAGE
// ------------------------------------------------------------

async function getGif() {
  const now = Date.now();

  if (gifBuffer && now - gifLoadedAt < CACHE_TTL) {
    return gifBuffer;
  }

  const response = await fetch(SOURCE_GIF, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; CLOrad radar renderer)",
      "Accept": "image/gif,image/*,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Meteoinfo GIF HTTP ${response.status}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  gifBuffer = Buffer.from(arrayBuffer);
  gifLoadedAt = now;

  // Старые обработанные кадры больше не нужны:
  frameCache.clear();

  return gifBuffer;
}

// ------------------------------------------------------------
// SOURCE -> WEB MERCATOR CALIBRATION
// ------------------------------------------------------------
//
// Polynomial calibration obtained from control points:
// Moscow / Ufa / SPb / Minsk / Kyiv / Yekaterinburg /
// Kazan / Samara.
//
// basis:
// [1, x, y, x², x*y, y²]
//
// x = source pixel X
// y = source pixel Y
// ------------------------------------------------------------

const UC = [
  42.7295125,
  1.159140403966
];

const US = [
  11.984477282034,
  0.080017466461
];

const XCOEF = [
  614.702787260693,
  213.524267491052,
  86.865800553715,
  17.052995641967,
  -18.94108199837,
  -3.466637383242
];

const YCOEF = [
  548.709828924571,
  231.245550214358,
  -80.613999910294,
  -23.817051905972,
  -12.895624928117,
  3.365220370149
];

// ------------------------------------------------------------
// GEOGRAPHIC EXTENT
// ------------------------------------------------------------

const WEST = 14.9892981264;
const EAST = 72.9237642948;

const SOUTH = 38.2155955810;
const NORTH = 69.6543707199;

// ------------------------------------------------------------
// SERVICE AREAS ON THE ORIGINAL METEOINFO IMAGE
// ------------------------------------------------------------
//
// These areas contain title, legend, logo, timestamps,
// copyright etc. They must never become radar data.
// ------------------------------------------------------------

function isServiceArea(x, y, width, height) {
  const sx = x / width;
  const sy = y / height;

  // Left legend
  if (sx < 0.135 && sy < 0.34) {
    return true;
  }

  // Top title
  if (
    sx > 0.145 &&
    sx < 0.48 &&
    sy < 0.075
  ) {
    return true;
  }

  // Top-right timestamp
  if (
    sx > 0.67 &&
    sy < 0.075
  ) {
    return true;
  }

  // Bottom-left logo / Roshydromet / CAO
  if (
    sx < 0.17 &&
    sy > 0.86
  ) {
    return true;
  }

  // Bottom copyright
  if (
    sy > 0.975
  ) {
    return true;
  }

  // Bottom-right timestamp
  if (
    sx > 0.70 &&
    sy > 0.94
  ) {
    return true;
  }

  return false;
}

// ------------------------------------------------------------
// RADAR PIXEL CLASSIFICATION
// ------------------------------------------------------------
//
// The background/seas on Meteoinfo are mostly low-chroma gray.
// Real radar echoes have substantially higher chroma/saturation.
//
// We deliberately keep this conservative so that weak radar
// echoes aren't destroyed.
// ------------------------------------------------------------

function radarPixel(r, g, b, a) {
  if (a < 80) return false;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  const chroma = max - min;

  if (max < 70) return false;
  if (chroma < 30) return false;

  const saturation =
    max === 0 ? 0 : chroma / max;

  if (saturation < 0.15) {
    return false;
  }

  return true;
}

// ------------------------------------------------------------
// SOURCE -> GEO
// ------------------------------------------------------------

function lonToMercatorX(lon) {
  return lon;
}

function latToMercatorY(lat) {
  const rad = lat * Math.PI / 180;

  return (
    Math.log(
      Math.tan(Math.PI / 4 + rad / 2)
    )
  );
}

// ------------------------------------------------------------
// SOURCE COORDINATE
// ------------------------------------------------------------

function geoToSource(
  lon,
  lat,
  sourceWidth,
  sourceHeight
) {
  const x0 =
    (lonToMercatorX(lon) - UC[0]) /
    US[0];

  const y0 =
    (latToMercatorY(lat) - UC[1]) /
    US[1];

  const basis = [
    1,
    x0,
    y0,
    x0 * x0,
    x0 * y0,
    y0 * y0
  ];

  let sx = 0;
  let sy = 0;

  for (let i = 0; i < 6; i++) {
    sx += XCOEF[i] * basis[i];
    sy += YCOEF[i] * basis[i];
  }

  return [
    sx,
    sy
  ];
}

// ------------------------------------------------------------
// HOLE FILLING
// ------------------------------------------------------------
//
// IMPORTANT:
//
// We don't interpolate arbitrary RGB values.
//
// Only transparent pixels that are surrounded by real radar
// pixels are filled.
//
// The replacement color is ALWAYS taken from an existing
// radar pixel.
//
// This prevents artificial colors from appearing.
// ------------------------------------------------------------

function fillSmallRadarHoles(
  rgba,
  width,
  height
) {
  const size = width * height;

  // 1 = real radar pixel
  // 0 = transparent/background
  const mask = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const p = i * 4;

    if (
      rgba[p + 3] >= 80 &&
      radarPixel(
        rgba[p],
        rgba[p + 1],
        rgba[p + 2],
        rgba[p + 3]
      )
    ) {
      mask[i] = 1;
    }
  }

  // ----------------------------------------------------------
  // Only small enclosed holes are candidates.
  //
  // We perform at most 3 passes.
  // This allows:
  //
  //   1px hole
  //   2px hole
  //   3px small broken region
  //
  // to close, but prevents large background regions from
  // gradually turning into radar.
  // ----------------------------------------------------------

  const MAX_PASSES = 3;

  for (
    let pass = 0;
    pass < MAX_PASSES;
    pass++
  ) {
    const additions = [];

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
        const index =
          y * width + x;

        if (mask[index]) {
          continue;
        }

        // ----------------------------------------------------
        // Gather the 8 neighbours.
        // ----------------------------------------------------

        const neighbours = [];

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (
              dx === 0 &&
              dy === 0
            ) {
              continue;
            }

            const nx = x + dx;
            const ny = y + dy;

            const ni =
              ny * width + nx;

            if (mask[ni]) {
              neighbours.push(ni);
            }
          }
        }

        // Need a strong local enclosure.
        if (neighbours.length < 5) {
          continue;
        }

        // ----------------------------------------------------
        // Count existing colors.
        //
        // Quantization groups practically identical palette
        // colors together without creating new colors.
        // ----------------------------------------------------

        const colors = new Map();

        for (const ni of neighbours) {
          const p = ni * 4;

          const r = rgba[p];
          const g = rgba[p + 1];
          const b = rgba[p + 2];

          const qr =
            Math.round(r / 8) * 8;
          const qg =
            Math.round(g / 8) * 8;
          const qb =
            Math.round(b / 8) * 8;

          const key =
            `${qr},${qg},${qb}`;

          const old =
            colors.get(key);

          if (old) {
            old.count++;
            old.indices.push(ni);
          } else {
            colors.set(key, {
              count: 1,
              indices: [ni]
            });
          }
        }

        let dominant = null;

        for (const value of colors.values()) {
          if (
            !dominant ||
            value.count > dominant.count
          ) {
            dominant = value;
          }
        }

        // At least 3 neighbouring pixels must agree
        // on approximately the same existing radar color.
        if (
          !dominant ||
          dominant.count < 3
        ) {
          continue;
        }

        // ----------------------------------------------------
        // Choose the actual pixel closest to the center of
        // the hole from the dominant color group.
        // ----------------------------------------------------

        let bestIndex =
          dominant.indices[0];

        let bestDistance =
          Infinity;

        for (
          const ni of dominant.indices
        ) {
          const ny =
            Math.floor(ni / width);

          const nx =
            ni - ny * width;

          const dx =
            nx - x;

          const dy =
            ny - y;

          const distance =
            dx * dx + dy * dy;

          if (
            distance <
            bestDistance
          ) {
            bestDistance =
              distance;

            bestIndex = ni;
          }
        }

        additions.push({
          index,
          source: bestIndex
        });
      }
    }

    if (!additions.length) {
      break;
    }

    // --------------------------------------------------------
    // Apply additions only after scanning the whole pass.
    // This prevents one newly filled pixel from immediately
    // propagating through a large background region.
    // --------------------------------------------------------

    for (const item of additions) {
      const dst =
        item.index * 4;

      const src =
        item.source * 4;

      rgba[dst] =
        rgba[src];

      rgba[dst + 1] =
        rgba[src + 1];

      rgba[dst + 2] =
        rgba[src + 2];

      rgba[dst + 3] =
        rgba[src + 3];

      mask[item.index] = 1;
    }
  }

  return rgba;
}

// ------------------------------------------------------------
// REPROJECT FRAME
// ------------------------------------------------------------

async function processFrame(
  gif,
  frame
) {
  const metadata =
    await sharp(gif, {
      animated: true,
      page: frame,
      pages: 1
    }).metadata();

  const sourceWidth =
    metadata.width;

  const sourceHeight =
    metadata.pageHeight ||
    metadata.height;

  if (
    !sourceWidth ||
    !sourceHeight
  ) {
    throw new Error(
      "Cannot determine GIF frame dimensions"
    );
  }

  // ----------------------------------------------------------
  // Read source frame as raw RGBA.
  // ----------------------------------------------------------

  const sourceRaw =
    await sharp(gif, {
      animated: true,
      page: frame,
      pages: 1
    })
      .ensureAlpha()
      .raw()
      .toBuffer();

  // ----------------------------------------------------------
  // Output resolution.
  //
  // Same aspect ratio as the geographic rectangle.
  // High enough for sharp radar without enormous Vercel
  // memory consumption.
  // ----------------------------------------------------------

  const outWidth = 1024;

  const lonSpan =
    EAST - WEST;

  const latSpan =
    NORTH - SOUTH;

  const outHeight =
    Math.round(
      outWidth *
      latSpan /
      lonSpan
    );

  const output =
    Buffer.alloc(
      outWidth *
      outHeight *
      4,
      0
    );

  // ----------------------------------------------------------
  // Reprojection.
  // ----------------------------------------------------------

  for (
    let y = 0;
    y < outHeight;
    y++
  ) {
    const t =
      y /
      (outHeight - 1);

    const lat =
      NORTH -
      t * (
        NORTH - SOUTH
      );

    for (
      let x = 0;
      x < outWidth;
      x++
    ) {
      const u =
        x /
        (outWidth - 1);

      const lon =
        WEST +
        u * (
          EAST - WEST
        );

      const [
        sxFloat,
        syFloat
      ] = geoToSource(
        lon,
        lat,
        sourceWidth,
        sourceHeight
      );

      const sx =
        Math.round(sxFloat);

      const sy =
        Math.round(syFloat);

      if (
        sx < 0 ||
        sy < 0 ||
        sx >= sourceWidth ||
        sy >= sourceHeight
      ) {
        continue;
      }

      // ------------------------------------------------------
      // Never allow Meteoinfo UI/service pixels into radar.
      // ------------------------------------------------------

      if (
        isServiceArea(
          sx,
          sy,
          sourceWidth,
          sourceHeight
        )
      ) {
        continue;
      }

      const sourceIndex =
        (
          sy *
          sourceWidth +
          sx
        ) * 4;

      const r =
        sourceRaw[sourceIndex];

      const g =
        sourceRaw[
          sourceIndex + 1
        ];

      const b =
        sourceRaw[
          sourceIndex + 2
        ];

      const a =
        sourceRaw[
          sourceIndex + 3
        ];

      if (
        !radarPixel(
          r,
          g,
          b,
          a
        )
      ) {
        continue;
      }

      const outputIndex =
        (
          y *
          outWidth +
          x
        ) * 4;

      output[
        outputIndex
      ] = r;

      output[
        outputIndex + 1
      ] = g;

      output[
        outputIndex + 2
      ] = b;

      output[
        outputIndex + 3
      ] = 255;
    }
  }

  // ----------------------------------------------------------
  // CLOSE SMALL HOLES.
  // ----------------------------------------------------------

  fillSmallRadarHoles(
    output,
    outWidth,
    outHeight
  );

  // ----------------------------------------------------------
  // PNG
  // ----------------------------------------------------------

  return sharp(output, {
    raw: {
      width: outWidth,
      height: outHeight,
      channels: 4
    }
  })
    .png({
      compressionLevel: 6,
      adaptiveFiltering: false,
      palette: false
    })
    .toBuffer();
}

// ------------------------------------------------------------
// FRAME CACHE
// ------------------------------------------------------------

function getCachedFrame(
  frame
) {
  const item =
    frameCache.get(frame);

  if (!item) {
    return null;
  }

  // Refresh LRU position.
  frameCache.delete(frame);
  frameCache.set(frame, item);

  return item;
}

function setCachedFrame(
  frame,
  buffer
) {
  if (
    frameCache.has(frame)
  ) {
    frameCache.delete(frame);
  }

  frameCache.set(
    frame,
    buffer
  );

  while (
    frameCache.size >
    FRAME_CACHE_MAX
  ) {
    const first =
      frameCache.keys()
        .next()
        .value;

    frameCache.delete(first);
  }
}

// ------------------------------------------------------------
// HANDLER
// ------------------------------------------------------------

module.exports = async function handler(
  req,
  res
) {
  try {
    const mode =
      req.query?.mode;

    // --------------------------------------------------------
    // META
    // --------------------------------------------------------

    if (mode === "meta") {
      const gif =
        await getGif();

      const metadata =
        await sharp(gif, {
          animated: true
        }).metadata();

      const pages =
        metadata.pages || 1;

      const delays =
        metadata.delay || [];

      res.setHeader(
        "Cache-Control",
        "public, max-age=10, s-maxage=30"
      );

      return res.status(200).json({
        ok: true,
        frames: pages,
        width: metadata.width,
        height:
          metadata.pageHeight ||
          metadata.height,
        delays,
        bounds: [
          [
            SOUTH,
            WEST
          ],
          [
            NORTH,
            EAST
          ]
        ]
      });
    }

    // --------------------------------------------------------
    // FRAME
    // --------------------------------------------------------

    let frame =
      Number(
        req.query?.frame
      );

    if (
      !Number.isFinite(frame) ||
      frame < 0
    ) {
      frame = 0;
    }

    frame =
      Math.floor(frame);

    const gif =
      await getGif();

    const metadata =
      await sharp(gif, {
        animated: true
      }).metadata();

    const pages =
      metadata.pages || 1;

    if (frame >= pages) {
      frame =
        pages - 1;
    }

    // --------------------------------------------------------
    // CACHE HIT
    // --------------------------------------------------------

    const cached =
      getCachedFrame(frame);

    if (cached) {
      res.setHeader(
        "Content-Type",
        "image/png"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=60"
      );

      res.setHeader(
        "X-CLOrad-Cache",
        "HIT"
      );

      return res.status(200).send(
        cached
      );
    }

    // --------------------------------------------------------
    // PROCESS
    // --------------------------------------------------------

    const png =
      await processFrame(
        gif,
        frame
      );

    setCachedFrame(
      frame,
      png
    );

    res.setHeader(
      "Content-Type",
      "image/png"
    );

    res.setHeader(
      "Cache-Control",
      "public, max-age=30, s-maxage=60"
    );

    res.setHeader(
      "X-CLOrad-Cache",
      "MISS"
    );

    return res.status(200).send(
      png
    );

  } catch (error) {
    console.error(
      "CLOrad radar-gif error:",
      error
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Radar GIF processing failed"
    });
  }
};
