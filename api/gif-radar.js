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
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "image/gif,image/*,*/*;q=0.8",
        "Referer": "https://meteoinfo.ru/radanim"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      res.status(response.status).json({
        error: "Meteoinfo returned HTTP " + response.status
      });
      return;
    }

    const contentType =
      response.headers.get("content-type") || "image/gif";

    const arrayBuffer = await response.arrayBuffer();

    const buffer = Buffer.from(arrayBuffer);

    res.status(200);

    res.setHeader(
      "Content-Type",
      contentType.includes("gif")
        ? "image/gif"
        : "image/gif"
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
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

    res.send(buffer);

  } catch (error) {
    console.error("CLOrad GIF API error:", error);

    res.status(500).json({
      error: "Не удалось получить GIF Meteoinfo",
      message: error?.message || String(error)
    });
  }
}
