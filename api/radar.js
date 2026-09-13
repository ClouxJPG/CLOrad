export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const action = url.searchParams.get("action") || "";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    /*
     * NOWCAST
     */

    if (action === "nowcast-times") {
      const capabilitiesUrl =
        "https://www.nowcast.ru/baltrad_wsgi" +
        "?SERVICE=WMS" +
        "&VERSION=1.1.1" +
        "&REQUEST=GetCapabilities";

      const response = await fetch(capabilitiesUrl, {
        headers: {
          "User-Agent": "CLOrad/1.0"
        }
      });

      if (!response.ok) {
        throw new Error(`Nowcast GetCapabilities HTTP ${response.status}`);
      }

      const xml = await response.text();

      const times = new Set();

      /*
       * Основной вариант:
       * <Dimension name="time">...</Dimension>
       * <Extent name="time">...</Extent>
       */
      const timeTags = xml.match(
        /<(?:Dimension|Extent)[^>]*name=["']time["'][^>]*>[\s\S]*?<\/(?:Dimension|Extent)>/gi
      ) || [];

      for (const tag of timeTags) {
        const matches = tag.match(
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
        ) || [];

        for (const t of matches) {
          times.add(t);
        }
      }

      /*
       * Запасной поиск ISO-времени по всему XML.
       */
      const allTimes =
        xml.match(
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
        ) || [];

      for (const t of allTimes) {
        times.add(t);
      }

      let result = Array.from(times)
        .map(t => new Date(t))
        .filter(d => !Number.isNaN(d.getTime()))
        .sort((a, b) => a - b)
        .map(d => d.toISOString());

      /*
       * Если сервер не отдал времена,
       * создаём запасную шкалу из последних 144 кадров
       * с шагом 10 минут.
       */
      if (!result.length) {
        const now = Date.now();

        result = [];

        for (let i = 143; i >= 0; i--) {
          result.push(
            new Date(now - i * 10 * 60 * 1000).toISOString()
          );
        }
      }

      return res.status(200).json({
        ok: true,
        source: "nowcast",
        times: result
      });
    }

    /*
     * NOWCAST REFLECTIVITY
     */

    if (action === "nowcast") {
      const time = url.searchParams.get("time");

      if (!time) {
        return res.status(400).json({
          ok: false,
          error: "missing_time"
        });
      }

      const vectorUrl =
        "https://www.nowcast.ru/vector_wsgi" +
        "?time=" +
        encodeURIComponent(time) +
        "&title=bufr_dbz1";

      const response = await fetch(vectorUrl, {
        headers: {
          "User-Agent": "CLOrad/1.0"
        }
      });

      if (!response.ok) {
        throw new Error(`Nowcast vector HTTP ${response.status}`);
      }

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        return res.status(502).json({
          ok: false,
          error: "invalid_json",
          raw: text.slice(0, 500)
        });
      }

      return res.status(200).json({
        ok: true,
        source: "nowcast",
        time,
        data
      });
    }

    /*
     * ЗАГОТОВКА ПОД IDARKMETEO
     *
     * Позже сюда добавим:
     *
     * if (action === "idark-...") {
     *    ...
     * }
     *
     * Ключ IDARKMETEO_KEY уже можно оставить
     * в Vercel Environment Variables.
     */

    if (action === "status") {
      return res.status(200).json({
        ok: true,
        nowcast: true,
        idarkmeteo: Boolean(process.env.IDARKMETEO_KEY)
      });
    }

    return res.status(400).json({
      ok: false,
      error: "unknown_action",
      action
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: error?.message || String(error)
    });
  }
}
