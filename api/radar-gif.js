// ============================================================
// CLOrad — Meteoinfo GIF Radar API
// ============================================================

const SOURCE_GIF =
  "https://meteoinfo.ru/hmc-output/rmap/phenomena.gif";

export default async function handler(req, res) {
  try {
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
      return res.status(502).json({
        error: "Meteoinfo HTTP " + response.status
      });
    }

    const arrayBuffer = await response.arrayBuffer();

    const buffer = Buffer.from(arrayBuffer);

    if (!buffer.length) {
      return res.status(502).json({
        error: "Meteoinfo вернул пустой GIF"
      });
    }

    res.setHeader(
      "Content-Type",
      "image/gif"
    );

    res.setHeader(
      "Content-Length",
      String(buffer.length)
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
      "Pragma",
      "no-cache"
    );

    res.setHeader(
      "Expires",
      "0"
    );

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    return res.status(200).send(buffer);

  } catch (error) {

    console.error(
      "CLOrad radar-gif error:",
      error
    );

    return res.status(500).json({
      error: "GIF API error",
      message:
        error?.message ||
        String(error)
    });
  }
}
