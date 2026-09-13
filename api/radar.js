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

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if(req.method === "OPTIONS"){
    return res.status(200).end();
  }


  /*
  =========================================================
  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  =========================================================
  */


  function number(value){

    const n =
      Number(value);

    return Number.isFinite(n)
      ? n
      : null;

  }


  function normalizePoint(item){

    /*
    Ожидаемый Nowcast формат:

    [lat, lon, value, direction]

    Но дополнительно поддерживаем
    несколько объектных вариантов.
    */

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
      Иногда координаты могут оказаться
      в порядке lon/lat.
      */

      if(
        Math.abs(lat) > 90 &&
        Math.abs(lon) <= 90
      ){

        const tmp = lat;

        lat = lon;
        lon = tmp;

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

        const tmp = lat;

        lat = lon;
        lon = tmp;

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


  function extractRawPoints(raw){

    /*
    Поддерживаем:

    [
      [lat,lon,dbz,...],
      ...
    ]

    {
      data:[...]
    }

    {
      data:{
        data:[...]
      }
    }
    */

    let source =
      raw;

    if(
      source &&
      !Array.isArray(source) &&
      typeof source === "object"
    ){

      if(
        Array.isArray(source.data)
      ){

        source =
          source.data;

      }else if(
        source.data &&
        Array.isArray(source.data.data)
      ){

        source =
          source.data.data;

      }

    }


    if(!Array.isArray(source)){
      return [];
    }


    /*
    Иногда весь массив может быть
    одной точкой [lat,lon,value].
    */

    if(
      source.length >= 3 &&
      typeof source[0] !== "object"
    ){

      const point =
        normalizePoint(source);

      return point
        ? [point]
        : [];

    }


    const points = [];

    for(const item of source){

      const point =
        normalizePoint(item);

      if(point){
        points.push(point);
      }

    }

    return points;

  }


  /*
  =========================================================
  ПОИСК МАКСИМУМА
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

    for(const point of points){

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
  СТАТИСТИКА
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


    for(const point of points){

      const dbz =
        point.dbz;

      if(dbz < min){
        min = dbz;
      }

      if(dbz > max){
        max = dbz;
      }

      sum += dbz;

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
  ГРУППИРОВКА ПИКСЕЛЕЙ В ЯЧЕЙКИ
  =========================================================

  Для определения грозовых ячеек используем
  порог 40 dBZ.

  Соседними считаются точки,
  находящиеся рядом в координатной сетке.
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


    /*
    Размер пространственной ячейки.

    0.02° ≈ 2 км по широте.

    Используем немного более крупную
    сетку, чтобы соседние радарные
    пиксели объединялись.
    */

    const GRID =
      0.02;


    const buckets =
      new Map();


    function keyFor(point){

      const x =
        Math.floor(
          point.lon / GRID
        );

      const y =
        Math.floor(
          point.lat / GRID
        );

      return (
        x +
        ":" +
        y
      );

    }


    for(const point of strong){

      const key =
        keyFor(point);

      if(!buckets.has(key)){
        buckets.set(
          key,
          []
        );
      }

      buckets
        .get(key)
        .push(point);

    }


    /*
    Соединяем соседние клетки сетки.

    Используем BFS.
    */

    const visited =
      new Set();

    const cells = [];


    function parseKey(key){

      const parts =
        key.split(":");

      return {
        x:Number(parts[0]),
        y:Number(parts[1])
      };

    }


    function neighbors(key){

      const {
        x,
        y
      } =
        parseKey(key);


      const result = [];

      for(
        let dx=-1;
        dx<=1;
        dx++
      ){

        for(
          let dy=-1;
          dy<=1;
          dy++
        ){

          if(
            dx === 0 &&
            dy === 0
          ){
            continue;
          }

          result.push(
            (
              x + dx
            ) +
            ":" +
            (
              y + dy
            )
          );

        }

      }

      return result;

    }


    for(const startKey of buckets.keys()){

      if(
        visited.has(startKey)
      ){
        continue;
      }


      const queue =
        [startKey];

      visited.add(
        startKey
      );


      const cellPoints = [];


      while(queue.length){

        const key =
          queue.shift();


        const bucket =
          buckets.get(key);


        if(bucket){

          for(const point of bucket){

            cellPoints.push(point);

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

            visited.add(next);

            queue.push(next);

          }

        }

      }


      /*
      Маленькие одиночные группы
      не считаем полноценной ячейкой.
      */

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

      for(const point of cellPoints){

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

        if(
          point.lat <
          minLat
        ){
          minLat =
            point.lat;
        }

        if(
          point.lat >
          maxLat
        ){
          maxLat =
            point.lat;
        }

        if(
          point.lon <
          minLon
        ){
          minLon =
            point.lon;
        }

        if(
          point.lon >
          maxLon
        ){
          maxLon =
            point.lon;
        }

      }


      /*
      Очень приблизительная площадь.

      Это площадь bounding box.
      Она нужна как ориентировочный
      параметр, пока у нас нет
      полноценной геометрии радарной сетки.
      */

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
          (
            (
              minLat +
              maxLat
            ) / 2
          ) *
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
              (
                sumLat /
                cellPoints.length
              ).toFixed(5)
            ),

          lon:
            Number(
              (
                sumLon /
                cellPoints.length
              ).toFixed(5)
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


    /*
    Сначала самые сильные ячейки.
    */

    cells.sort(
      (a,b) =>
        b.maxDbz -
        a.maxDbz
    );


    /*
    Перенумеровываем после сортировки.
    */

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
  NOWCAST — СПИСОК ВРЕМЁН
  =========================================================
  */


  if(
    action === "nowcast-times"
  ){

    try{

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
              "User-Agent":
                "CLOrad/1.0"
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


      const blocks =
        xml.match(
          /<(?:Dimension|Extent)[^>]*name=["']time["'][^>]*>[\s\S]*?<\/(?:Dimension|Extent)>/gi
        ) || [];


      for(
        const block
        of blocks
      ){

        const found =
          block.match(
            /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
          ) || [];


        for(
          const time
          of found
        ){

          times.add(time);

        }

      }


      const all =
        xml.match(
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
        ) || [];


      for(
        const time
        of all
      ){

        times.add(time);

      }


      let result =
        Array.from(times)
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
              i *
              10 *
              60 *
              1000
            ).toISOString()
          );

        }

      }


      return res.status(200).json({

        ok:true,

        source:"nowcast",

        times:result

      });

    }catch(error){

      console.error(
        "CLOrad times error:",
        error
      );


      return res.status(500).json({

        ok:false,

        error:
          "nowcast_times_error",

        message:
          error?.message ||
          String(error)

      });

    }

  }


  /*
  =========================================================
  NOWCAST — REFLECTIVITY
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
            "User-Agent":
              "CLOrad/1.0"
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

        error:
          "invalid_json",

        raw:
          text.slice(
            0,
            1000
          )

      });

    }


    /*
    Получаем нормальные пиксели.
    */

    const pixels =
      extractRawPoints(data);


    /*
    Максимальный dBZ.
    */

    const maximum =
      calculateMaximum(
        pixels
      );


    /*
    Общая статистика.
    */

    const stats =
      calculateStats(
        pixels
      );


    /*
    Грозовые ячейки.
    */

    const cells =
      detectCells(
        pixels
      );


    /*
    Возвращаем и сырые данные,
    и обработанные.
    */

    return res.status(200).json({

      ok:true,

      source:"nowcast",

      time,

      count:
        pixels.length,


      /*
      Нормализованные радарные пиксели.
      */

      pixels,


      /*
      Максимальный dBZ.
      */

      max:
        maximum,


      /*
      Статистика.
      */

      stats,


      /*
      Найденные ячейки.
      */

      cells,


      /*
      Оригинальный ответ Nowcast.
      Оставляем для совместимости.
      */

      data

    });

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
