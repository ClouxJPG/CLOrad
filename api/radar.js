export default async function handler(req, res) {

  const url = new URL(
    req.url,
    `https://${req.headers.host || "localhost"}`
  );

  const action =
    url.searchParams.get("action") || "";

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

  if(req.method === "OPTIONS"){
    return res.status(200).end();
  }

  try{

    /*
    =====================================================
    NOWCAST — СПИСОК ВРЕМЁН
    =====================================================
    */

    if(action === "nowcast-times"){

      const capabilitiesUrl =
        "https://www.nowcast.ru/baltrad_wsgi" +
        "?SERVICE=WMS" +
        "&VERSION=1.1.1" +
        "&REQUEST=GetCapabilities";

      const response =
        await fetch(
          capabilitiesUrl,
          {
            headers:{
              "User-Agent":"CLOrad/1.0"
            }
          }
        );

      if(!response.ok){

        throw new Error(
          "Nowcast GetCapabilities HTTP " +
          response.status
        );

      }

      const xml =
        await response.text();

      const times =
        new Set();

      /*
      Ищем timestamp внутри Dimension/Extent.
      */

      const blocks =
        xml.match(
          /<(?:Dimension|Extent)[^>]*name=["']time["'][^>]*>[\s\S]*?<\/(?:Dimension|Extent)>/gi
        ) || [];

      for(const block of blocks){

        const found =
          block.match(
            /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
          ) || [];

        for(const time of found){
          times.add(time);
        }

      }

      /*
      Запасной поиск ISO-времени
      по всему XML.
      */

      const all =
        xml.match(
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
        ) || [];

      for(const time of all){
        times.add(time);
      }

      let result =
        Array.from(times)
          .map(
            x => new Date(x)
          )
          .filter(
            x => !Number.isNaN(x.getTime())
          )
          .sort(
            (a,b) =>
              a.getTime() -
              b.getTime()
          )
          .map(
            x => x.toISOString()
          );

      /*
      Если GetCapabilities не дал список,
      делаем временный fallback.
      */

      if(!result.length){

        const now =
          Date.now();

        result = [];

        for(
          let i=143;
          i>=0;
          i--
        ){

          result.push(
            new Date(
              now -
              i * 10 * 60 * 1000
            ).toISOString()
          );

        }

      }

      return res.status(200).json({

        ok:true,

        source:"nowcast",

        times:result

      });

    }


    /*
    =====================================================
    NOWCAST — REFLECTIVITY
    =====================================================
    */

    if(action === "nowcast"){

      const time =
        url.searchParams.get("time");

      if(!time){

        return res.status(400).json({

          ok:false,

          error:"missing_time"

        });

      }

      const vectorUrl =
        "https://www.nowcast.ru/vector_wsgi" +
        "?time=" +
        encodeURIComponent(time) +
        "&title=bufr_dbz1";

      const response =
        await fetch(
          vectorUrl,
          {
            headers:{
              "User-Agent":"CLOrad/1.0"
            }
          }
        );

      if(!response.ok){

        throw new Error(
          "Nowcast vector HTTP " +
          response.status
        );

      }

      const text =
        await response.text();

      let data;

      try{

        data =
          JSON.parse(text);

      }catch(error){

        return res.status(502).json({

          ok:false,

          error:"invalid_json",

          raw:text.slice(0,1000)

        });

      }

      return res.status(200).json({

        ok:true,

        source:"nowcast",

        time,

        data

      });

    }


    /*
    =====================================================
    STATUS
    =====================================================
    */

    if(action === "status"){

      return res.status(200).json({

        ok:true,

        nowcast:true,

        idarkmeteo:
          Boolean(
            process.env.IDARKMETEO_KEY
          )

      });

    }


    return res.status(400).json({

      ok:false,

      error:"unknown_action",

      action

    });

  }catch(error){

    console.error(
      "CLOrad API error:",
      error
    );

    return res.status(500).json({

      ok:false,

      error:"server_error",

      message:
        error?.message ||
        String(error)

    });

  }

}
