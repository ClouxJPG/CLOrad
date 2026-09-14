(() => {
  "use strict";

  /*
  ============================================================
  CLOrad — RISKS
  Источники:
    EMS — рабочий источник рисков/предупреждений
    CSF — пока заглушка
  ============================================================
  */

  const nav = document.getElementById("nav");

  if (!nav) {
    console.error("[CLOrad Risks] Навигация не найдена");
    return;
  }

  const warningButton = [...nav.querySelectorAll(".n")]
    .find(button =>
      button.textContent.trim().toLowerCase() === "предупр."
    );

  if (!warningButton) {
    console.error("[CLOrad Risks] Кнопка «Предупр.» не найдена");
    return;
  }


  /*
  ============================================================
  ПАНЕЛЬ
  ============================================================
  */

  const panel = document.createElement("div");

  panel.id = "risksSourcePanel";

  panel.innerHTML = `
    <div class="risksSources">

      <button
        type="button"
        class="risksSourceButton active"
        data-source="EMS"
      >
        EMS
      </button>

      <button
        type="button"
        class="risksSourceButton"
        data-source="CSF"
      >
        CSF
      </button>

    </div>

    <div class="risksToggleRow">

      <button
        type="button"
        class="risksToggle on"
        aria-label="Риски и предупреждения"
        aria-pressed="true"
      >
        <span class="risksToggleKnob"></span>
      </button>

    </div>
  `;

  document.body.appendChild(panel);


  /*
  ============================================================
  СТИЛИ
  ============================================================
  */

  const style = document.createElement("style");

  style.textContent = `

    #risksSourcePanel{
      position:fixed;

      z-index:25;

      display:flex;

      flex-direction:column;

      align-items:center;

      gap:0;

      padding:5px;

      width:max-content;

      /* Основная высота панели */
      height:80px;

      background:#182028f7;

      border:1px solid #3d4851;

      border-radius:9px;

      box-shadow:0 5px 16px #0004;

      opacity:0;

      pointer-events:none;

      transform:translateY(-5px);

      transition:
        opacity .20s ease,
        transform .20s ease;
    }


    #risksSourcePanel.open{
      opacity:1;

      pointer-events:auto;

      transform:translateY(0);
    }


    /*
    ============================================================
    КНОПКИ ИСТОЧНИКОВ
    ============================================================
    */

    #risksSourcePanel .risksSources{
      display:flex;

      align-items:center;

      gap:5px;
    }


    .risksSourceButton{
      height:32px;

      min-width:60px;

      padding:0 14px;

      border:1px solid transparent;

      border-radius:7px;

      background:transparent;

      color:#aeb7bd;

      font-size:13px;

      font-weight:700;

      display:flex;

      align-items:center;

      justify-content:center;

      transition:
        background .16s ease,
        color .16s ease,
        border-color .16s ease,
        transform .10s ease;
    }


    .risksSourceButton.active{
      background:#263139;

      border-color:#3e4a53;

      color:#53e39b;
    }


    .risksSourceButton:active{
      transform:scale(.96);
    }


    /*
    ============================================================
    ПЕРЕКЛЮЧАТЕЛЬ
    ============================================================
    */

    #risksSourcePanel .risksToggleRow{
      width:100%;

      display:flex;

      align-items:center;

      justify-content:center;

      margin-top:5px;

      padding-top:5px;

      border-top:1px solid #3d485155;
    }


    #risksSourcePanel .risksToggle{
      position:relative;

      width:42px;

      height:20px;

      padding:0;

      border:1px solid #46535c;

      border-radius:999px;

      background:#202a31;

      appearance:none;

      -webkit-appearance:none;

      cursor:pointer;

      transition:
        background .16s ease,
        border-color .16s ease;
    }


    .risksToggleKnob{
      position:absolute;

      width:14px;

      height:14px;

      left:2px;

      top:2px;

      border-radius:50%;

      background:#8b969d;

      box-shadow:0 1px 4px #0006;

      transition:
        transform .16s ease,
        background .16s ease;
    }


    #risksSourcePanel .risksToggle.on{
      background:#263b32;

      border-color:#416354;
    }


    #risksSourcePanel .risksToggle.on .risksToggleKnob{
      transform:translateX(20px);

      background:#53e39b;
    }


    /*
    ============================================================
    СВЕТЛАЯ ТЕМА
    ============================================================
    */

    body.light #risksSourcePanel{
      background:#f6f8f9ee;

      border-color:#c9d0d5;

      box-shadow:0 5px 16px #0002;
    }


    body.light .risksSourceButton{
      color:#687177;
    }


    body.light .risksSourceButton.active{
      background:#e1e6e9;

      border-color:#c6ced3;

      color:#168453;
    }


    body.light #risksSourcePanel .risksToggleRow{
      border-top-color:#c9d0d566;
    }


    body.light #risksSourcePanel .risksToggle{
      background:#e3e7e9;

      border-color:#c4ccd0;
    }


    body.light #risksSourcePanel .risksToggleKnob{
      background:#879197;
    }


    body.light #risksSourcePanel .risksToggle.on{
      background:#d7e9df;

      border-color:#9fc6b0;
    }


    body.light #risksSourcePanel .risksToggle.on .risksToggleKnob{
      background:#168453;
    }


    /*
    ============================================================
    МОБИЛЬНАЯ ВЕРСИЯ
    ============================================================
    */

    @media(max-width:600px){

      #risksSourcePanel{
        height:78px;

        padding:4px;
      }


      .risksSourceButton{
        height:32px;

        min-width:58px;

        padding:0 13px;

        font-size:13px;
      }


      #risksSourcePanel .risksToggleRow{
        margin-top:4px;

        padding-top:4px;
      }

    }

  `;

  document.head.appendChild(style);


  /*
  ============================================================
  ПОЗИЦИОНИРОВАНИЕ
  ============================================================
  */

  function positionPanel(){

    const rect =
      warningButton.getBoundingClientRect();

    const panelWidth =
      panel.offsetWidth || 140;

    const panelHeight =
      panel.offsetHeight || 80;

    let left =
      rect.left +
      rect.width / 2 -
      panelWidth / 2;

    const margin = 8;

    left =
      Math.max(
        margin,
        Math.min(
          left,
          window.innerWidth -
          panelWidth -
          margin
        )
      );

    let top =
      rect.bottom + 9;

    if(
      top + panelHeight >
      window.innerHeight - 8
    ){

      top =
        rect.top -
        panelHeight -
        9;
    }

    panel.style.left =
      `${Math.round(left)}px`;

    panel.style.top =
      `${Math.round(top)}px`;
  }


  /*
  ============================================================
  ОТКРЫТИЕ / ЗАКРЫТИЕ
  ============================================================
  */

  let opened = false;


  function openPanel(){

    positionPanel();

    panel.classList.add("open");

    opened = true;

    requestAnimationFrame(() => {
      positionPanel();
    });
  }


  function closePanel(){

    panel.classList.remove("open");

    opened = false;
  }


  function togglePanel(){

    if(opened){
      closePanel();
    }else{
      openPanel();
    }

  }


  /*
  ============================================================
  КНОПКА «ПРЕДУПР.»
  ============================================================
  */

  warningButton.addEventListener(
    "click",
    event => {

      event.stopPropagation();

      togglePanel();

    },
    true
  );


  /*
  ============================================================
  ИСТОЧНИКИ EMS / CSF
  ============================================================
  */

  const sourceButtons =
    [...panel.querySelectorAll(".risksSourceButton")];

  let currentSource = "EMS";


  sourceButtons.forEach(button => {

    button.addEventListener(
      "click",
      event => {

        event.preventDefault();

        event.stopPropagation();


        const source =
          button.dataset.source;


        currentSource =
          source;


        sourceButtons.forEach(item => {

          item.classList.toggle(
            "active",
            item === button
          );

        });


        /*
        Передаём выбранный источник
        загрузчику, если он существует.
        */

        if(
          window.CLOradRisksLoader &&
          typeof window.CLOradRisksLoader.setSource === "function"
        ){

          window.CLOradRisksLoader.setSource(
            source
          );

        }


        window.dispatchEvent(
          new CustomEvent(
            "clorad:risks-source",
            {
              detail:{
                source:currentSource
              }
            }
          )
        );


        /*
        После выбора источник остаётся
        активным при следующем открытии.
        */

        closePanel();

      }
    );

  });


  /*
  ============================================================
  ПЕРЕКЛЮЧАТЕЛЬ РИСКОВ
  ============================================================
  */

  const risksToggle =
    panel.querySelector(".risksToggle");

  let risksEnabled = true;


  function setRisksEnabled(enabled){

    risksEnabled =
      !!enabled;


    risksToggle.classList.toggle(
      "on",
      risksEnabled
    );


    risksToggle.setAttribute(
      "aria-pressed",
      risksEnabled
        ? "true"
        : "false"
    );


    /*
    Управляем слоем карты,
    если он уже создан.
    */

    const layer =
      window.CLOradRisksLayer;


    if(
      layer &&
      window.map &&
      typeof layer.addTo === "function"
    ){

      if(risksEnabled){

        layer.addTo(
          window.map
        );

      }else{

        window.map.removeLayer(
          layer
        );

      }

    }


    /*
    Передаём состояние загрузчику.
    */

    if(
      window.CLOradRisksLoader &&
      typeof window.CLOradRisksLoader.setEnabled === "function"
    ){

      window.CLOradRisksLoader.setEnabled(
        risksEnabled
      );

    }


    window.dispatchEvent(
      new CustomEvent(
        "clorad:risks-toggle",
        {
          detail:{
            enabled:risksEnabled,

            source:currentSource
          }
        }
      )
    );

  }


  risksToggle.addEventListener(
    "click",
    event => {

      event.preventDefault();

      event.stopPropagation();


      setRisksEnabled(
        !risksEnabled
      );

    }
  );


  /*
  ============================================================
  ЗАКРЫТИЕ ПО КЛИКУ ВНЕ ПАНЕЛИ
  ============================================================
  */

  document.addEventListener(
    "click",
    event => {

      if(!opened) return;


      if(
        event.target.closest(
          "#risksSourcePanel"
        ) ||
        event.target.closest(".n")
      ){

        return;
      }


      closePanel();

    }
  );


  /*
  ============================================================
  ЗАКРЫТИЕ ПРИ СВОРАЧИВАНИИ NAV
  ============================================================
  */

  const navObserver =
    new MutationObserver(() => {

      if(
        nav.classList.contains("closed")
      ){

        closePanel();

      }

    });


  navObserver.observe(
    nav,
    {
      attributes:true,

      attributeFilter:[
        "class"
      ]
    }
  );


  /*
  ============================================================
  АДАПТАЦИЯ К РАЗМЕРУ ОКНА
  ============================================================
  */

  window.addEventListener(
    "resize",
    () => {

      if(opened){

        positionPanel();

      }

    }
  );


  window.addEventListener(
    "orientationchange",
    () => {

      setTimeout(() => {

        if(opened){

          positionPanel();

        }

      },100);

    }
  );


  nav.addEventListener(
    "scroll",
    () => {

      if(opened){

        positionPanel();

      }

    },
    {
      passive:true
    }
  );


  /*
  ============================================================
  ПУБЛИЧНЫЙ API
  ============================================================
  */

  window.CLOradRisks = {

    open(){

      openPanel();

    },


    close(){

      closePanel();

    },


    toggle(){

      togglePanel();

    },


    setSource(source){

      if(
        source !== "EMS" &&
        source !== "CSF"
      ){

        return;

      }


      currentSource =
        source;


      sourceButtons.forEach(button => {

        button.classList.toggle(
          "active",
          button.dataset.source === source
        );

      });

    },


    getSource(){

      return currentSource;

    },


    setEnabled(enabled){

      setRisksEnabled(
        enabled
      );

    },


    getEnabled(){

      return risksEnabled;

    },


    isOpen(){

      return opened;

    }

  };


  console.log(
    "[CLOrad Risks] Загружен"
  );

})();
