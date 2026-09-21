// ============================================================
// CLOrad — Meteoinfo GIF Radar API
// Server-side GIF frame extraction via Sharp
// ============================================================

import sharp from "sharp";

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";

async function getGIF() {

  const response = await fetch(SOURCE_GIF, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "image/gif,*/*",
      "Referer": "https://meteoinfo.ru/radanim"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      "Meteoinfo HTTP " + response.status
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

  return buffer;
}


export default async function handler(req, res) {

  try {

    const mode =
      String(req.query?.mode || "");

    const requestedFrame =
      Number(req.query?.frame);

    const gif =
      await getGIF();


    // ==========================================================
    // METADATA
    // ==========================================================

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
        "public, s-maxage=30, stale-while-revalidate=120"
      );


      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );


      return res.status(200).json({

        ok: true,

        frames:
          pages,

        width,

        height,

        delays

      });

    }


    // ==========================================================
    // FRAME
    // ==========================================================

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


    const png =
      await sharp(
        gif,
        {
          animated: true,
          page: frame,
          pages: 1
        }
      )
        .png()
        .toBuffer();


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


    res.setHeader(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120"
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
