// ============================================================
// CLOrad — Meteoinfo GIF Radar API
// Server-side GIF decoding via Sharp
//
// Быстрая схема:
//
// Meteoinfo GIF
//      ↓
// Vercel memory cache
//      ↓
// Sharp
//      ↓
// PNG frame
//      ↓
// Leaflet
//
// GIF НЕ сохраняется на диск.
// После смены исходного GIF старый buffer исчезает
// из памяти при обновлении cache.
// ============================================================

import sharp from "sharp";

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";


// ============================================================
// SERVER MEMORY CACHE
// ============================================================

let gifCache = null;

let gifCacheTime = 0;

let gifLoading = null;


// GIF держим в памяти максимум 60 секунд.
// Это НЕ постоянное хранилище.
const GIF_CACHE_MS = 60 * 1000;


// ============================================================
// СКАЧИВАНИЕ GIF
// ============================================================

async function downloadGIF() {

  const now = Date.now();

  // Есть свежий GIF в памяти
  if (
    gifCache &&
    now - gifCacheTime < GIF_CACHE_MS
  ) {
    return gifCache;
  }


  // Если другой запрос уже скачивает GIF —
  // ждём его, а не создаём второй запрос.
  if (gifLoading) {
    return gifLoading;
  }


  gifLoading = (async () => {

    const response = await fetch(
      SOURCE_GIF,
      {
        method: "GET",

        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept":
            "image/gif,image/*,*/*",
          "Referer":
            "https://meteoinfo.ru/radanim"
        },

        cache: "no-store"
      }
    );


    if (!response.ok) {

      throw new Error(
        "Meteoinfo HTTP " +
        response.status
      );

    }


    const arrayBuffer =
      await response.arrayBuffer();


    const buffer =
      Buffer.from(arrayBuffer);


    if (!buffer.length) {
      throw new Error(
        "Meteoinfo вернул пустой GIF"
      );
    }


    // Новый GIF заменяет старый.
    gifCache = buffer;
    gifCacheTime = Date.now();


    return buffer;

  })();


  try {

    return await gifLoading;

  } finally {

    gifLoading = null;

  }

}


// ============================================================
// HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {

  try {

    const mode =
      String(
        req.query?.mode || ""
      );


    const requestedFrame =
      Number(
        req.query?.frame
      );


    const gif =
      await downloadGIF();


    // ========================================================
    // META
    // ========================================================

    if (mode === "meta") {

      const metadata =
        await sharp(
          gif,
          {
            animated: true
          }
        ).metadata();


      const pages =
        Number(
          metadata.pages || 1
        );


      const width =
        Number(
          metadata.width || 0
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


      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );


      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=30, stale-while-revalidate=120"
      );


      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );


      return res.status(200).json({

        ok: true,

        frames: pages,

        width,

        height,

        delays

      });

    }


    // ========================================================
    // FRAME
    // ========================================================

    if (
      !Number.isInteger(
        requestedFrame
      )
    ) {

      return res.status(400).json({

        error:
          "Укажи номер кадра: ?frame=0"

      });

    }


    const metadata =
      await sharp(
        gif,
        {
          animated: true
        }
      ).metadata();


    const pages =
      Number(
        metadata.pages || 1
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
    // DECODE FRAME
    // ========================================================

    const png =
      await sharp(
        gif,
        {
          animated: true,

          page: frame,

          pages: 1
        }
      )

      // Без изменения размеров.
      // Никакого ресайза.
      //
      // compressionLevel 0:
      // максимально быстрая упаковка PNG.
      .png({
        compressionLevel: 0,
        adaptiveFiltering: false
      })

      .toBuffer();


    // ========================================================
    // RESPONSE
    // ========================================================

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


    // Кэшируем конкретный кадр.
    //
    // Это сильно ускоряет повторное переключение
    // по timeline.
    res.setHeader(
      "Cache-Control",
      "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
    );


    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );


    return res
      .status(200)
      .send(png);


  } catch (error) {

    console.error(
      "CLOrad radar-gif error:",
      error
    );


    return res.status(500).json({

      error:
        "GIF API error",

      message:
        error?.message ||
        String(error)

    });

  }

}
