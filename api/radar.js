export default async function handler(req, res) {

  const url = new URL(
    req.url,
    `https://${req.headers.host || "localhost"}`
  );

  const action =
    url.searchParams.get("action") || "";


  /*
  =========================================================
  CORS
  =========================================================
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

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );


  if(req.method === "OPTIONS"){
    return res.status(200).end();
  }


  /*
  =========================================================
  CONSTANTS
  =========================================================
  */

  const NOWCAST =
    "https://www.nowcast.ru";

  const DEMO_URL =
    "https://www.nowcast.ru/demo/demo.html";

  const CAPABILITIES_URL =
    NOWCAST +
    "/baltrad_wsgi" +
    "?SERVICE=WMS" +
    "&VERSION=1.1.1" +
    "&REQUEST=GetCapabilities";


  /*
  =========================================================
  HELPERS
  =========================================================
  */

  function number(value){

    const n = Number(value);

    return Number.isFinite(n)
      ? n
      : null;

  }


  /*
  ---------------------------------------------------------
  Extract cookies
  ---------------------------------------------------------
  */

  function extractCookies(response){

    try{

      if(
        response.headers &&
        typeof response.headers.getSetCookie === "function"
      ){

        const cookies =
          response.headers.getSetCookie();

        if(
          Array.isArray(cookies) &&
          cookies.length
        ){

          return cookies
            .map(
              cookie =>
                cookie.split(";")[0]
            )
            .join("; ");

        }

      }

    }catch(error){

      console.error(
        "Cookie extraction error:",
        error
      );

    }


    try{

      const raw =
        response.headers.get(
          "set-cookie"
        );

      if(raw){

        return raw
          .split(/,(?=[^;,]+=)/)
          .map(
            cookie =>
              cookie.split(";")[0]
          )
          .join("; ");

      }

    }catch(error){

      console.error(
        "Fallback cookie extraction error:",
        error
      );

    }


    return "";

  }


  /*
  ---------------------------------------------------------
  Browser-like headers
  ---------------------------------------------------------
  */

  function browserHeaders(extra = {}){

    return {

      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",

      "Accept-Language":
        "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",

      "Accept":
        "*/*",

      "Referer":
        DEMO_URL,

      "Origin":
        NOWCAST,

      "Sec-Fetch-Site":
        "same-origin",

      "Sec-Fetch-Mode":
        "cors",

      "Sec-Fetch-Dest":
        "empty",

      ...extra

    };

  }


  /*
  =========================================================
  NOWCAST SESSION
  =========================================================
  */

  async function createNowcastSession(){

    let cookies = "";


    /*
    -------------------------------------------------------
    demo.html
    -------------------------------------------------------
    */

    try{

      const demoResponse =
        await fetch(
          DEMO_URL,
          {
            method:"GET",

            headers:
              browserHeaders({
                "Accept":
                  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
              }),

            redirect:"follow"
          }
        );


      const demoCookies =
        extractCookies(
          demoResponse
        );


      if(demoCookies){

        cookies =
          demoCookies;

      }

    }catch(error){

      console.error(
        "demo.html session error:",
        error
      );

    }


    /*
    -------------------------------------------------------
    Главная страница
    -------------------------------------------------------
    */

    try{

      const homeResponse =
        await fetch(
          NOWCAST + "/",
          {
            method:"GET",

            headers:
              browserHeaders({
                "Accept":
                  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

                "Referer":
                  DEMO_URL
              }),

            redirect:"follow"
          }
        );


      const homeCookies =
        extractCookies(
          homeResponse
        );


      if(homeCookies){

        if(cookies){

          cookies =
            cookies +
            "; " +
            homeCookies;

        }else{

          cookies =
            homeCookies;

        }

      }

    }catch(error){

      console.error(
        "nowcast homepage session error:",
        error
      );

    }


    return cookies;

  }


  /*
  =========================================================
  NOWCAST FETCH
  =========================================================
  */

  async function nowcastFetch(
    targetUrl,
    extraHeaders = {}
  ){

    let cookies =
      await createNowcastSession();


    let headers =
      browserHeaders(
        extraHeaders
      );


    if(cookies){

      headers.Cookie =
        cookies;

    }


    /*
    -------------------------------------------------------
    Первый запрос
    -------------------------------------------------------
    */

    let response =
      await fetch(
        targetUrl,
        {
          method:"GET",
          headers,
          redirect:"follow"
        }
      );


    /*
    -------------------------------------------------------
    При 403 полностью пересоздаём сессию
    -------------------------------------------------------
    */

    if(response.status === 403){

      cookies =
        await createNowcastSession();


      headers =
        browserHeaders(
          extraHeaders
        );


      if(cookies){

        headers.Cookie =
          cookies;

      }


      response =
        await fetch(
          targetUrl,
          {
            method:"GET",

            headers,

            redirect:"follow"
          }
        );

    }


    return response;

  }


  /*
  =========================================================
  NORMALIZE POINT
  =========================================================
  */

  function normalizePoint(item){

    if(Array.isArray(item)){

      if(item.length < 3){
        return null;
      }


      let lat =
        number(item[0]);

      let lon =
        number(item[1]);

      let dbz =
        number(item[2]);

      let direction =
        number(item[3]);


      if(
        lat === null ||
        lon === null ||
        dbz === null
      ){

        return null;

      }


      /*
      Иногда координаты могут идти
      как lon / lat.
      */

      if(
        Math.abs(lat) > 90 &&
        Math.abs(lon) <= 90
      ){

        const tmp =
          lat;

        lat =
          lon;

        lon =
          tmp;

      }


      if(
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ){

        return null;

      }


      return {

        lat,
        lon,
        dbz,
        direction

      };

    }


    if(
      item &&
      typeof item === "object"
    ){

      let lat =
        number(
          item.lat ??
          item.latitude ??
          item.y
        );


      let lon =
        number(
          item.lon ??
          item.lng ??
          item.longitude ??
          item.x
        );


      let dbz =
        number(
          item.dbz ??
          item.value ??
          item.reflectivity ??
          item.z
        );


      let direction =
        number(
          item.direction ??
          item.dir
        );


      if(
        lat === null ||
        lon === null ||
        dbz === null
      ){

        return null;

      }


      if(
        Math.abs(lat) > 90 &&
        Math.abs(lon) <= 90
      ){

        const tmp =
          lat;

        lat =
          lon;

        lon =
          tmp;

      }


      if(
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ){

        return null;

      }


      return {

        lat,
        lon,
        dbz,
        direction

      };

    }


    return null;

  }


  /*
  =========================================================
  EXTRACT POINTS
  =========================================================
  */

  function extractRawPoints(raw){

    if(Array.isArray(raw)){

      /*
      Одна точка:
      [lat, lon, dbz, direction]
      */

      if(
        raw.length >= 3 &&
        typeof raw[0] !== "object"
      ){

        const point =
          normalizePoint(
            raw
          );


        return point
          ? [point]
          : [];

      }


      const result =
        [];


      for(
        const item
        of raw
      ){

        const point =
          normalizePoint(
            item
          );


        if(point){

          result.push(
            point
          );

        }

      }


      return result;

    }


    if(
      raw &&
      typeof raw === "object"
    ){

      if(
        Array.isArray(
          raw.data
        )
      ){

        return extractRawPoints(
          raw.data
        );

      }


      if(
        raw.data &&
        typeof raw.data === "object"
      ){

        if(
          Array.isArray(
            raw.data.data
          )
        ){

          return extractRawPoints(
            raw.data.data
          );

        }

      }


      if(
        Array.isArray(
          raw.features
        )
      ){

        return extractRawPoints(
          raw.features
        );

      }

    }


    return [];

  }


  /*
  =========================================================
  MAXIMUM
  =========================================================
  */

  function calculateMaximum(points){

    if(!points.length){

      return {

        dbz:null,
        lat:null,
        lon:null,
        direction:null

      };

    }


    let best =
      points[0];


    for(
      const point
      of points
    ){

      if(
        point.dbz >
        best.dbz
      ){

        best =
          point;

      }

    }


    return {

      dbz:
        Number(
          best.dbz.toFixed(1)
        ),

      lat:
        Number(
          best.lat.toFixed(5)
        ),

      lon:
        Number(
          best.lon.toFixed(5)
        ),

      direction:
        best.direction === null
          ? null
          : Number(
              best.direction.toFixed(1)
            )

    };

  }


  /*
  =========================================================
  STATS
  =========================================================
  */

  function calculateStats(points){

    if(!points.length){

      return {

        pixels:0,
        validPixels:0,

        minDbz:null,
        maxDbz:null,
        meanDbz:null,

        above20:0,
        above30:0,
        above40:0,
        above45:0,
        above50:0,
        above55:0,
        above60:0

      };

    }


    let min =
      Infinity;

    let max =
      -Infinity;

    let sum =
      0;


    let above20 = 0;
    let above30 = 0;
    let above40 = 0;
    let above45 = 0;
    let above50 = 0;
    let above55 = 0;
    let above60 = 0;


    for(
      const point
      of points
    ){

      const dbz =
        point.dbz;


      if(dbz < min){
        min = dbz;
      }


      if(dbz > max){
        max = dbz;
      }


      sum +=
        dbz;


      if(dbz >= 20) above20++;
      if(dbz >= 30) above30++;
      if(dbz >= 40) above40++;
      if(dbz >= 45) above45++;
      if(dbz >= 50) above50++;
      if(dbz >= 55) above55++;
      if(dbz >= 60) above60++;

    }


    return {

      pixels:
        points.length,

      validPixels:
        points.length,

      minDbz:
        Number(
          min.toFixed(1)
        ),

      maxDbz:
        Number(
          max.toFixed(1)
        ),

      meanDbz:
        Number(
          (
            sum /
            points.length
          ).toFixed(1)
        ),

      above20,
      above30,
      above40,
      above45,
      above50,
      above55,
      above60

    };

  }


  /*
  =========================================================
  CELL DETECTION
  =========================================================
  */

  function detectCells(points){

    const threshold =
      40;


    const strong =
      points.filter(
        p =>
          p.dbz >= threshold
      );


    if(!strong.length){

      return [];

    }


    const GRID =
      0.02;


    const buckets =
      new Map();


    function keyFor(point){

      const x =
        Math.floor(
          point.lon /
          GRID
        );


      const y =
        Math.floor(
          point.lat /
          GRID
        );


      return `${x}:${y}`;

    }


    for(
      const point
      of strong
    ){

      const key =
        keyFor(point);


      if(
        !buckets.has(key)
      ){

        buckets.set(
          key,
          []
        );

      }


      buckets
        .get(key)
        .push(point);

    }


    const visited =
      new Set();


    const cells =
      [];


    function parseKey(key){

      const parts =
        key.split(":");


      return {

        x:
          Number(parts[0]),

        y:
          Number(parts[1])

      };

    }


    function neighbors(key){

      const {
        x,
        y
      } =
        parseKey(key);


      const result =
        [];


      for(
        let dx = -1;
        dx <= 1;
        dx++
      ){

        for(
          let dy = -1;
          dy <= 1;
          dy++
        ){

          if(
            dx === 0 &&
            dy === 0
          ){

            continue;

          }


          result.push(
            `${x + dx}:${y + dy}`
          );

        }

      }


      return result;

    }


    for(
      const startKey
      of buckets.keys()
    ){

      if(
        visited.has(
          startKey
        )
      ){

        continue;

      }


      const queue =
        [startKey];


      visited.add(
        startKey
      );


      const cellPoints =
        [];


      while(
        queue.length
      ){

        const key =
          queue.shift();


        const bucket =
          buckets.get(key);


        if(bucket){

          for(
            const point
            of bucket
          ){

            cellPoints.push(
              point
            );

          }

        }


        for(
          const next
          of neighbors(key)
        ){

          if(
            visited.has(next)
          ){

            continue;

          }


          if(
            buckets.has(next)
          ){

            visited.add(
              next
            );

            queue.push(
              next
            );

          }

        }

      }


      if(
        cellPoints.length < 2
      ){

        continue;

      }


      let maxDbz =
        -Infinity;

      let sumDbz =
        0;

      let sumLat =
        0;

      let sumLon =
        0;


      let minLat =
        Infinity;

      let maxLat =
        -Infinity;

      let minLon =
        Infinity;

      let maxLon =
        -Infinity;


      for(
        const point
        of cellPoints
      ){

        if(
          point.dbz >
          maxDbz
        ){

          maxDbz =
            point.dbz;

        }


        sumDbz +=
          point.dbz;

        sumLat +=
          point.lat;

        sumLon +=
          point.lon;


        minLat =
          Math.min(
            minLat,
            point.lat
          );


        maxLat =
          Math.max(
            maxLat,
            point.lat
          );


        minLon =
          Math.min(
            minLon,
            point.lon
          );


        maxLon =
          Math.max(
            maxLon,
            point.lon
          );

      }


      const centerLat =
        sumLat /
        cellPoints.length;


      const centerLon =
        sumLon /
        cellPoints.length;


      const latKm =
        (
          maxLat -
          minLat
        ) * 111;


      const lonKm =
        (
          maxLon -
          minLon
        ) *
        111 *
        Math.cos(
          centerLat *
          Math.PI /
          180
        );


      const areaKm2 =
        Math.max(
          0,
          latKm *
          lonKm
        );


      cells.push({

        id:
          cells.length + 1,

        pixels:
          cellPoints.length,

        threshold,

        maxDbz:
          Number(
            maxDbz.toFixed(1)
          ),

        meanDbz:
          Number(
            (
              sumDbz /
              cellPoints.length
            ).toFixed(1)
          ),

        center:{

          lat:
            Number(
              centerLat.toFixed(5)
            ),

          lon:
            Number(
              centerLon.toFixed(5)
            )

        },

        areaKm2:
          Number(
            areaKm2.toFixed(1)
          ),

        bounds:{

          north:
            Number(
              maxLat.toFixed(5)
            ),

          south:
            Number(
              minLat.toFixed(5)
            ),

          east:
            Number(
              maxLon.toFixed(5)
            ),

          west:
            Number(
              minLon.toFixed(5)
            )

        }

      });

    }


    cells.sort(
      (a,b) =>
        b.maxDbz -
        a.maxDbz
    );


    cells.forEach(
      (cell,index) => {

        cell.id =
          index + 1;

      }
    );


    return cells;

  }


  /*
  =========================================================
  NOWCAST TIMES
  =========================================================
  */

  if(
    action === "nowcast-times"
  ){

    try{

      const response =
        await nowcastFetch(
          CAPABILITIES_URL,
          {
            "Accept":
              "application/xml,text/xml,text/plain,*/*"
          }
        );


      const text =
        await response.text();


      if(!response.ok){

        return res.status(502).json({

          ok:false,

          error:
            "nowcast_capabilities_http",

          status:
            response.status,

          body:
            text.slice(
              0,
              3000
            )

        });

      }


      const times =
        new Set();


      /*
      ISO timestamps
      */

      const matches =
        text.match(
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
        ) || [];


      for(
        const time
        of matches
      ){

        times.add(
          time
        );

      }


      /*
      Timestamp без Z
      */

      const matchesNoZ =
        text.match(
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?/g
        ) || [];


      for(
        const time
        of matchesNoZ
      ){

        try{

          const date =
            new Date(
              time + "Z"
            );


          if(
            !Number.isNaN(
              date.getTime()
            )
          ){

            times.add(
              date.toISOString()
            );

          }

        }catch(error){

          // ignore

        }

      }


      const result =
        Array.from(
          times
        )
        .map(
          x =>
            new Date(x)
        )
        .filter(
          x =>
            !Number.isNaN(
              x.getTime()
            )
        )
        .sort(
          (a,b) =>
            a.getTime() -
            b.getTime()
        )
        .map(
          x =>
            x.toISOString()
        );


      return res.status(200).json({

        ok:true,

        source:
          "nowcast",

        count:
          result.length,

        times:
          result

      });

    }catch(error){

      console.error(
        "CLOrad nowcast-times error:",
        error
      );


      return res.status(500).json({

        ok:false,

        error:
          "nowcast_times_exception",

        message:
          error?.message ||
          String(error)

      });

    }

  }


  /*
  =========================================================
  NOWCAST REFLECTIVITY IMAGE
  =========================================================
  */

  if(
    action === "nowcast-image"
  ){

    const time =
      url.searchParams.get(
        "time"
      );


    if(!time){

      return res.status(400).json({

        ok:false,

        error:
          "missing_time"

      });

    }


    /*
    -------------------------------------------------------
    BBOX
    -------------------------------------------------------
    */

    const bboxParam =
      url.searchParams.get(
        "bbox"
      );


    let bbox =
      [
        20,
        40,
        180,
        82
      ];


    if(bboxParam){

      const parts =
        bboxParam
          .split(",")
          .map(
            Number
          );


      if(
        parts.length === 4 &&
        parts.every(
          Number.isFinite
        )
      ){

        bbox =
          parts;

      }

    }


    /*
    -------------------------------------------------------
    SIZE
    -------------------------------------------------------
    */

    let width =
      Number(
        url.searchParams.get(
          "width"
        )
      );


    let height =
      Number(
        url.searchParams.get(
          "height"
        )
      );


    if(
      !Number.isFinite(width) ||
      width <= 0
    ){

      width =
        1200;

    }


    if(
      !Number.isFinite(height) ||
      height <= 0
    ){

      height =
        800;

    }


    /*
    Не позволяем запрашивать
    огромные изображения.
    */

    width =
      Math.min(
        2048,
        Math.max(
          256,
          Math.round(width)
        )
      );


    height =
      Math.min(
        2048,
        Math.max(
          256,
          Math.round(height)
        )
      );


    try{

      /*
      -----------------------------------------------------
      WMS GetMap
      -----------------------------------------------------
      */

      const params =
        new URLSearchParams({

          SERVICE:
            "WMS",

          VERSION:
            "1.1.1",

          REQUEST:
            "GetMap",

          LAYERS:
            "bufr_dbz1",

          STYLES:
            "",

          SRS:
            "EPSG:4326",

          BBOX:
            bbox.join(","),

          WIDTH:
            String(width),

          HEIGHT:
            String(height),

          FORMAT:
            "image/png",

          TRANSPARENT:
            "true",

          TIME:
            new Date(
              time
            ).toISOString()

        });


      const imageUrl =
        NOWCAST +
        "/baltrad_wsgi?" +
        params.toString();


      const response =
        await nowcastFetch(
          imageUrl,
          {
            "Accept":
              "image/png,image/*,*/*"
          }
        );


      /*
      -----------------------------------------------------
      Получили ошибку
      -----------------------------------------------------
      */

      if(!response.ok){

        const body =
          await response.text();


        return res.status(502).json({

          ok:false,

          error:
            "nowcast_image_http",

          status:
            response.status,

          time,

          url:
            imageUrl,

          body:
            body.slice(
              0,
              3000
            )

        });

      }


      /*
      -----------------------------------------------------
      Проверяем Content-Type
      -----------------------------------------------------
      */

      const contentType =
        (
          response.headers.get(
            "content-type"
          ) || ""
        ).toLowerCase();


      /*
      -----------------------------------------------------
      Получаем бинарный PNG
      -----------------------------------------------------
      */

      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );


      if(!buffer.length){

        return res.status(502).json({

          ok:false,

          error:
            "nowcast_image_empty",

          time

        });

      }


      /*
      -----------------------------------------------------
      Если WMS неожиданно вернул XML/HTML,
      не отдаём его как PNG.
      -----------------------------------------------------
      */

      const looksLikePng =
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0D &&
        buffer[5] === 0x0A &&
        buffer[6] === 0x1A &&
        buffer[7] === 0x0A;


      if(
        !looksLikePng &&
        !contentType.includes(
          "image/"
        )
      ){

        const text =
          buffer
            .toString(
              "utf8"
            )
            .slice(
              0,
              3000
            );


        return res.status(502).json({

          ok:false,

          error:
            "nowcast_image_not_png",

          time,

          contentType,

          body:
            text

        });

      }


      /*
      -----------------------------------------------------
      PNG
      -----------------------------------------------------
      */

      res.setHeader(
        "Content-Type",
        "image/png"
      );

      res.setHeader(
        "Content-Length",
        String(
          buffer.length
        )
      );

      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
      );

      res.setHeader(
        "Content-Disposition",
        "inline; filename=\"nowcast-bufr_dbz1.png\""
      );


      return res
        .status(200)
        .send(
          buffer
        );

    }catch(error){

      console.error(
        "CLOrad nowcast-image error:",
        error
      );


      return res.status(500).json({

        ok:false,

        error:
          "nowcast_image_exception",

        time,

        message:
          error?.message ||
          String(error)

      });

    }

  }


  /*
  =========================================================
  NOWCAST REFLECTIVITY VECTOR
  =========================================================
  */

  if(
    action === "nowcast"
  ){

    const time =
      url.searchParams.get(
        "time"
      );


    if(!time){

      return res.status(400).json({

        ok:false,

        error:
          "missing_time"

      });

    }


    try{

      const vectorUrl =
        NOWCAST +
        "/vector_wsgi" +
        "?time=" +
        encodeURIComponent(
          time
        ) +
        "&title=bufr_dbz1";


      const response =
        await nowcastFetch(
          vectorUrl,
          {
            "Accept":
              "application/json,text/plain,*/*"
          }
        );


      const text =
        await response.text();


      if(!response.ok){

        return res.status(502).json({

          ok:false,

          error:
            "nowcast_vector_http",

          status:
            response.status,

          time,

          url:
            vectorUrl,

          body:
            text.slice(
              0,
              3000
            )

        });

      }


      let data;


      try{

        data =
          JSON.parse(
            text
          );

      }catch(error){

        return res.status(502).json({

          ok:false,

          error:
            "nowcast_vector_invalid_json",

          time,

          contentType:
            response.headers.get(
              "content-type"
            ),

          body:
            text.slice(
              0,
              3000
            )

        });

      }


      const pixels =
        extractRawPoints(
          data
        );


      const maximum =
        calculateMaximum(
          pixels
        );


      const stats =
        calculateStats(
          pixels
        );


      const cells =
        detectCells(
          pixels
        );


      return res.status(200).json({

        ok:true,

        source:
          "nowcast",

        time,

        count:
          pixels.length,

        pixels,

        max:
          maximum,

        stats,

        cells,

        data

      });

    }catch(error){

      console.error(
        "CLOrad nowcast error:",
        error
      );


      return res.status(500).json({

        ok:false,

        error:
          "nowcast_exception",

        time,

        message:
          error?.message ||
          String(error)

      });

    }

  }


  /*
  =========================================================
  STATUS
  =========================================================
  */

  if(
    action === "status"
  ){

    return res.status(200).json({

      ok:true,

      nowcast:true,

      idarkmeteo:
        Boolean(
          process.env.IDARKMETEO_KEY
        )

    });

  }


  /*
  =========================================================
  UNKNOWN ACTION
  =========================================================
  */

  return res.status(400).json({

    ok:false,

    error:
      "unknown_action",

    action

  });

}
