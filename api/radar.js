// api/radar.js

export default async function handler(req, res) {
  try {
    const url = new URL(
      "https://www.nowcast.ru/baltrad_wsgi"
    );

    // Передаём все параметры от index.html
    for (const [key, value] of new URL(req.url, "http://localhost").searchParams) {
      url.searchParams.set(key, value);
    }

    // API-ключ будет добавлен сюда,
    // когда ты дашь рабочий ключ и способ его передачи.
    const API_KEY = process.env.NOWCAST_API_KEY;

    if (API_KEY) {
      url.searchParams.set("token", API_KEY);
    }

    const response = await fetch(url);

    const type =
      response.headers.get("content-type") ||
      "application/octet-stream";

    res.status(response.status);
    res.setHeader("Content-Type", type);

    const data = await response.arrayBuffer();

    res.send(Buffer.from(data));

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Radar proxy error"
    });
  }
}
