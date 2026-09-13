// api/radar.js

const NOWCAST = "https://www.nowcast.ru";

const WMS_URL =
  `${NOWCAST}/baltrad_wsgi`;

const TOKEN_URL =
  `${NOWCAST}/get_token`;

// Это точное значение пункта
// "Отражаемость 1км BUFR" из Nowcast demo.
const RADAR_LAYER =
  "bufr_dbz1,bufr_novosib_dbz1,bufr_vlad_dbz1";

const DEMO_URL =
  "https://www.nowcast.ru/demo/demo.html";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",

  "Referer":
    DEMO_URL,

  "Origin":
    NOWCAST
};


// -----------------------------------------------------
// CORS
// -----------------------------------------------------

function cors(res) {

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
    "*"
  );
}


// -----------------------------------------------------
// TOKEN CACHE
// -----------------------------------------------------

let cachedToken = null;
let tokenExpires = 0;


async function getToken() {

  // Используем один token примерно 25 секунд.
  // У Nowcast он живёт около 30 секунд.

  if (
    cachedToken &&
    Date.now() < tokenExpires
  ) {

    return cachedToken;
  }


  const response =
    await fetch(
      TOKEN_URL,
      {
        method: "GET",

        headers: {
          ...HEADERS,
          "Accept":
            "application/json"
        },

        redirect: "follow"
      }
    );


  if (!response.ok) {

    throw new Error(
      `Nowcast /get_token HTTP ${response.status}`
    );
  }


  const data =
    await response.json();


  if (!data.token) {

    throw new Error(
      "Nowcast не вернул token"
    );
  }


  cachedToken =
    data.token;

  tokenExpires =
    Date.now() + 25000;


  return cachedToken;
}


// -----------------------------------------------------
// ADD TOKEN
// -----------------------------------------------------

function withToken(url, token) {

  const u =
    new URL(url);

  u.searchParams.set(
    "token",
    token
  );

  return u.toString();
}


// -----------------------------------------------------
// FETCH NOWCAST
// -----------------------------------------------------

async function fetchNowcast(
  url,
  options = {}
) {

  let token =
    await getToken();


  let response =
    await fetch(
      withToken(url, token),
      {
        ...options,

        headers: {
          ...HEADERS,
          ...(options.headers || {})
        },

        redirect:
          "follow"
      }
    );


  // Token мог протухнуть.
  // Получаем новый и повторяем запрос.

  if (
    response.status === 403
  ) {

    cachedToken = null;
    tokenExpires = 0;

    token =
      await getToken();


    response =
      await fetch(
        withToken(url, token),
        {
          ...options,

          headers: {
            ...HEADERS,
            ...(options.headers || {})
          },

          redirect:
            "follow"
        }
      );
  }


  return response;
}


// -----------------------------------------------------
// GET CAPABILITIES
// -----------------------------------------------------

async function getCapabilities() {

  const url =
    WMS_URL +
    "?SERVICE=WMS" +
    "&VERSION=1.1.1" +
    "&REQUEST=GetCapabilities";


  const response =
    await fetchNowcast(url);


  const text =
    await response.text();


  if (!response.ok) {

    throw new Error(
      `GetCapabilities HTTP ${response.status}`
    );
  }


  return text;
}


// -----------------------------------------------------
// EXTRACT TIMES
// -----------------------------------------------------

function extractTimes(xml) {

  const matches =
    xml.match(
      /20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
    ) || [];


  return [
    ...new Set(matches)
  ].sort();
}


// -----------------------------------------------------
// CURRENT TIME
// -----------------------------------------------------

async function getCurrentTime() {

  const xml =
    await getCapabilities();


  const times =
    extractTimes(xml);


  if (!times.length) {

    throw new Error(
      "Nowcast не вернул TIME"
    );
  }


  const now =
    Date.now();


  /*
   * Берём последний timestamp,
   * который уже наступил.
   *
   * Небольшой запас 15 минут оставлен
   * на расхождение часов.
   */

  let selected =
    null;


  for (
    const time of times
  ) {

    const ms =
      Date.parse(time);


    if (
      !Number.isFinite(ms)
    ) {
      continue;
    }


    if (
      ms <=
      now + 15 * 60 * 1000
    ) {

      selected =
        time;
    }
  }


  /*
   * Если сервер Nowcast живёт
   * с сильно отличающимися часами,
   * используем последний timestamp.
   */

  if (!selected) {

    selected =
      times[times.length - 1];
  }


  return selected;
}


// -----------------------------------------------------
// WMS PROXY
// -----------------------------------------------------

async function proxyWMS(
  req,
  res
) {

  /*
   * ВАЖНО:
   *
   * Мы НЕ создаём BBOX сами.
   *
   * Leaflet создаёт его для каждого тайла.
   *
   * Мы просто передаём его в Nowcast.
   */

  const params =
    new URLSearchParams();


  /*
   * Передаём только WMS параметры.
   */

  const allowed = [
    "SERVICE",
    "VERSION",
    "REQUEST",
    "LAYERS",
    "STYLES",
    "SRS",
    "CRS",
    "BBOX",
    "WIDTH",
    "HEIGHT",
    "FORMAT",
    "TRANSPARENT",
    "TIME",
    "EXCEPTIONS",
    "DPI",
    "FORMAT_OPTIONS"
  ];


  for (
    const key of allowed
  ) {

    const value =
      req.query[key.toLowerCase()] ??
      req.query[key];


    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {

      params.set(
        key,
        String(value)
      );
    }
  }


  /*
   * Leaflet будет использовать 1.1.1.
   */

  if (
    !params.has("SERVICE")
  ) {

    params.set(
      "SERVICE",
      "WMS"
    );
  }


  if (
    !params.has("VERSION")
  ) {

    params.set(
      "VERSION",
      "1.1.1"
    );
  }


  if (
    !params.has("REQUEST")
  ) {

    params.set(
      "REQUEST",
      "GetMap"
    );
  }


  /*
   * Именно радарный слой Nowcast.
   */

  params.set(
    "LAYERS",
    RADAR_LAYER
  );


  if (
    !params.has("STYLES")
  ) {

    params.set(
      "STYLES",
      ""
    );
  }


  if (
    !params.has("FORMAT")
  ) {

    params.set(
      "FORMAT",
      "image/png"
    );
  }


  /*
   * Критично:
   * радар должен быть прозрачным.
   */

  params.set(
    "TRANSPARENT",
    "TRUE"
  );


  const url =
    WMS_URL +
    "?" +
    params.toString();


  const response =
    await fetchNowcast(
      url
    );


  const contentType =
    response.headers.get(
      "content-type"
    ) ||
    "image/png";


  const body =
    Buffer.from(
      await response.arrayBuffer()
    );


  if (!response.ok) {

    res.status(
      response.status
    );

    res.setHeader(
      "Content-Type",
      "text/plain; charset=utf-8"
    );

    res.end(
      body.toString(
        "utf8"
      )
    );

    return;
  }


  cors(res);


  res.status(200);

  res.setHeader(
    "Content-Type",
    contentType
  );

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  res.end(body);
}


// -----------------------------------------------------
// HANDLER
// -----------------------------------------------------

export default async function handler(
  req,
  res
) {

  cors(res);


  if (
    req.method ===
    "OPTIONS"
  ) {

    res.status(204).end();

    return;
  }


  try {

    const action =
      String(
        req.query.action ||
        ""
      ).toLowerCase();


    // -------------------------------------------------
    // CURRENT TIME
    // -------------------------------------------------

    if (
      action ===
      "time"
    ) {

      const time =
        await getCurrentTime();


      res.status(200);

      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );

      res.end(
        JSON.stringify({
          ok: true,

          time,

          layer:
            RADAR_LAYER
        })
      );

      return;
    }


    // -------------------------------------------------
    // TIMES
    // -------------------------------------------------

    if (
      action ===
      "times"
    ) {

      const xml =
        await getCapabilities();


      const times =
        extractTimes(xml);


      res.status(200);

      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );

      res.end(
        JSON.stringify({
          ok: true,

          count:
            times.length,

          times
        })
      );

      return;
    }


    // -------------------------------------------------
    // WMS
    // -------------------------------------------------

    if (
      action ===
      "wms"
    ) {

      await proxyWMS(
        req,
        res
      );

      return;
    }


    // -------------------------------------------------
    // DEFAULT
    // -------------------------------------------------

    res.status(200);

    res.setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    );

    res.end(
      JSON.stringify({
        ok: true,

        service:
          "CLOrad → Nowcast WMS",

        layer:
          RADAR_LAYER,

        endpoints: {
          time:
            "/api/radar?action=time",

          times:
            "/api/radar?action=times",

          wms:
            "/api/radar?action=wms"
        }
      })
    );

  } catch (error) {

    console.error(
      "CLOrad Nowcast:",
      error
    );


    cors(res);

    res.status(500);

    res.setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    );

    res.end(
      JSON.stringify({
        ok: false,

        error:
          error.message ||
          String(error)
      })
    );
  }
}
