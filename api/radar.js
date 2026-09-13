// api/radar.js

const API =
  "https://idarkmeteo.host/api/v1";

export default async function handler(req, res) {

  /*
   * CORS
   * Разрешаем GitHub Pages обращаться
   * к этой Vercel Function.
   */

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  /*
   * Preflight
   */

  if (req.method === "OPTIONS") {

    res.status(204).end();

    return;
  }

  /*
   * Разрешаем только GET
   */

  if (req.method !== "GET") {

    res.status(405).json({
      error: "method_not_allowed"
    });

    return;
  }

  /*
   * Секретный ключ Vercel.
   *
   * НЕ прописываем ключ непосредственно
   * в исходнике.
   */

  const KEY =
    process.env.IDARKMETEO_KEY;

  if (!KEY) {

    res.status(500).json({
      error: "server_config_error",
      message:
        "IDARKMETEO_KEY is not configured"
    });

    return;
  }

  /*
   * Какой endpoint запрашивает сайт.
   *
   * Примеры:
   *
   * /api/radar?action=frames
   * /api/radar?action=rain
   * /api/radar?action=phenomena
   * /api/radar?action=dbz
   * /api/radar?action=palette
   * /api/radar?action=latest
   */

  const action =
    String(
      req.query?.action || "frames"
    ).toLowerCase();

  /*
   * Белый список.
   *
   * Нельзя передавать произвольный URL
   * через этот proxy.
   */

  const endpoints = {

    frames:
      "/frames.json",

    rain:
      "/frames/rain/wide.json",

    rainFine:
      "/frames/rain/fine.json",

    phenomena:
      "/frames/phenomena/dmrl.json",

    palette:
      "/palettes.json",

    latest:
      "/latest.json",

    manifest:
      "/manifest.json"

  };

  /*
   * Отдельно обрабатываем dbz.
   *
   * У dbz нет live frames endpoint.
   * Его архив запрашивается с конкретной
   * датой / временем / охватом.
   *
   * Например:
   *
   * /api/radar?action=dbz
   *   &scope=wide
   *   &date=20260906
   *   &time=1850
   */

  if (action === "dbz") {

    const scope =
      String(
        req.query?.scope || "wide"
      );

    const date =
      String(
        req.query?.date || ""
      );

    const time =
      String(
        req.query?.time || ""
      );

    const allowedScopes = [
      "wide",
      "fine",
      "coarse"
    ];

    if (
      !allowedScopes.includes(scope)
    ) {

      res.status(400).json({
        error: "invalid_scope"
      });

      return;
    }

    /*
     * Если дата/время не переданы,
     * отдаём список дней отражаемости.
     */

    if (!date || !time) {

      const url =
        `${API}/days.json`;

      try {

        const response =
          await fetch(url, {
            method: "GET",
            headers: {
              "X-API-Key": KEY,
              "Accept":
                "application/json"
            }
          });

        const text =
          await response.text();

        res.status(
          response.status
        );

        res.setHeader(
          "Content-Type",
          response.headers.get(
            "content-type"
          ) ||
          "application/json"
        );

        res.send(text);

        return;

      } catch (error) {

        console.error(
          "DBZ days error:",
          error
        );

        res.status(502).json({
          error:
            "upstream_unavailable"
        });

        return;
      }
    }

    /*
     * Проверяем формат даты:
     * YYYYMMDD
     */

    if (
      !/^\d{8}$/.test(date)
    ) {

      res.status(400).json({
        error: "invalid_date"
      });

      return;
    }

    /*
     * Проверяем формат времени:
     * HHMM
     */

    if (
      !/^\d{4}$/.test(time)
    ) {

      res.status(400).json({
        error: "invalid_time"
      });

      return;
    }

    /*
     * Получаем архивный PNG.
     */

    const path =
      `/archive/dbz/${scope}/${date}/${time}.png`;

    const url =
      `${API}${path}`;

    try {

      const response =
        await fetch(url, {
          method: "GET",
          headers: {
            "X-API-Key": KEY
          }
        });

      if (!response.ok) {

        const text =
          await response.text();

        res.status(
          response.status
        );

        res.setHeader(
          "Content-Type",
          response.headers.get(
            "content-type"
          ) ||
          "application/json"
        );

        res.send(text);

        return;
      }

      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );

      res.status(200);

      res.setHeader(
        "Content-Type",
        "image/png"
      );

      /*
       * Архивные кадры неизменяемы.
       */

      res.setHeader(
        "Cache-Control",
        "public, max-age=31536000, immutable"
      );

      res.send(buffer);

      return;

    } catch (error) {

      console.error(
        "DBZ image error:",
        error
      );

      res.status(502).json({
        error:
          "upstream_unavailable"
      });

      return;
    }
  }

  /*
   * Проверяем обычный endpoint.
   */

  const path =
    endpoints[action];

  if (!path) {

    res.status(400).json({
      error: "unknown_action",
      available: Object.keys(
        endpoints
      )
    });

    return;
  }

  const url =
    `${API}${path}`;

  try {

    const response =
      await fetch(url, {

        method: "GET",

        headers: {

          "X-API-Key": KEY,

          "Accept":
            "application/json"

        }

      });

    /*
     * Передаём код ответа API
     * без изменения.
     */

    const contentType =
      response.headers.get(
        "content-type"
      );

    const text =
      await response.text();

    res.status(
      response.status
    );

    if (contentType) {

      res.setHeader(
        "Content-Type",
        contentType
      );

    } else {

      res.setHeader(
        "Content-Type",
        "application/json"
      );

    }

    /*
     * Не кэшируем списки надолго:
     * документация говорит, что списки
     * живут около минуты.
     */

    res.setHeader(
      "Cache-Control",
      "public, max-age=30, s-maxage=30"
    );

    res.send(text);

  } catch (error) {

    console.error(
      "Radar API error:",
      error
    );

    res.status(502).json({

      error:
        "upstream_unavailable",

      message:
        "idarkmeteo.host is temporarily unavailable"

    });

  }
}
