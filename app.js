let ws = null;

let ticks = [];

let maxTicks = 1000;

/* =========================
GET HTML ELEMENTS
========================= */

const $ = (id) => document.getElementById(id);

const marketSelect = $("marketSelect");

const tickCountSelect = $("tickCount");

const barrierSelect = $("barrier");

const thresholdSelect = $("threshold");

const connectBtn = $("connectBtn");

/* =========================
CREATE BARRIERS
========================= */

for (let i = 0; i <= 9; i++) {

```
const option = document.createElement("option");

option.value = i;

option.textContent = i;


if (i === 5) {

    option.selected = true;

}


barrierSelect.appendChild(option);
```

}

/* =========================
CONNECTION STATUS
========================= */

function setStatus(message) {

```
$("connectionStatus").textContent = message;
```

}

/* =========================
SEND WEBSOCKET MESSAGE
========================= */

function send(data) {

```
if (
    ws &&
    ws.readyState === WebSocket.OPEN
) {

    ws.send(
        JSON.stringify(data)
    );

}
```

}

/* =========================
CONNECT TO DERIV
========================= */

function connectDeriv() {

```
if (
    ws &&
    ws.readyState === WebSocket.OPEN
) {

    subscribeMarket();

    return;

}


setStatus("🟡 Connecting...");


ws = new WebSocket(

    "wss://ws.derivws.com/websockets/v3?app_id=1089"

);


ws.onopen = () => {

    setStatus(
        "🟢 Connected — Loading markets..."
    );


    send({

        active_symbols: "brief"

    });

};


ws.onmessage = (event) => {

    const data =
        JSON.parse(event.data);


    /* API ERROR */

    if (data.error) {

        console.error(
            data.error
        );


        setStatus(

            "🔴 " +
            data.error.message

        );

        return;

    }


    /* ACTIVE SYMBOLS */

    if (
        data.msg_type ===
        "active_symbols"
    ) {

        loadMarkets(
            data.active_symbols || []
        );

    }


    /* HISTORY */

    if (
        data.msg_type ===
        "history"
    ) {

        loadHistory(
            data.history
        );

    }


    /* LIVE TICK */

    if (
        data.msg_type ===
        "tick"
    ) {

        handleTick(
            data.tick
        );

    }

};


ws.onerror = () => {

    setStatus(
        "🔴 Connection Error"
    );

};


ws.onclose = () => {

    setStatus(
        "🔴 Disconnected"
    );

};
```

}

/* =========================
LOAD MARKETS
========================= */

function loadMarkets(symbols) {

```
/*
  Prefer Synthetic Markets
*/

const preferredMarkets =
    symbols.filter(symbol => {


        const text =

            (
                (symbol.display_name || "") +
                " " +
                (symbol.market || "")
            ).toLowerCase();


        return (

            text.includes("volatility") ||
            text.includes("synthetic") ||
            text.includes("crash") ||
            text.includes("boom") ||
            text.includes("jump") ||
            text.includes("step")

        );

    });


const markets =

    preferredMarkets.length > 0

        ? preferredMarkets

        : symbols;


marketSelect.innerHTML = "";


if (!markets.length) {

    const option =
        document.createElement("option");

    option.textContent =
        "No markets returned";


    marketSelect.appendChild(option);


    setStatus(
        "🔴 No markets available"
    );

    return;

}


markets.sort((a, b) =>

    (a.display_name || "")
        .localeCompare(
            b.display_name || ""
        )

);


markets.forEach(symbol => {


    const option =
        document.createElement("option");


    option.value =
        symbol.symbol;


    option.textContent =

        symbol.display_name +
        " (" +
        symbol.symbol +
        ")";


    marketSelect.appendChild(option);

});


subscribeMarket();
```

}

/* =========================
SUBSCRIBE TO MARKET
========================= */

function subscribeMarket() {

```
if (

    !ws ||

    ws.readyState !==
    WebSocket.OPEN ||

    !marketSelect.value

) {

    return;

}


maxTicks =
    Number(
        tickCountSelect.value
    );


ticks = [];


setStatus(

    "🟡 Loading " +
    maxTicks +
    " ticks..."

);


/*
  Remove old subscriptions
*/

send({

    forget_all: "ticks"

});


/*
  GET TICK HISTORY
*/

send({

    ticks_history:
        marketSelect.value,

    count:
        maxTicks,

    end:
        "latest",

    style:
        "ticks"

});


/*
  SUBSCRIBE TO LIVE TICKS
*/

send({

    ticks:
        marketSelect.value,

    subscribe:
        1

});
```

}

/* =========================
LOAD HISTORY
========================= */

function loadHistory(history) {

```
if (

    !history ||

    !Array.isArray(
        history.prices
    )

) {

    return;

}


ticks =

    history.prices

        .map(Number)

        .filter(
            Number.isFinite
        )

        .slice(-maxTicks);


setStatus(
    "🟢 Live"
);


updateAnalysis();
```

}

/* =========================
HANDLE LIVE TICK
========================= */

function handleTick(tick) {

```
if (!tick) {

    return;

}


const price =
    Number(tick.quote);


$("livePrice").textContent =
    price;


const digit =
    getLastDigit(price);


$("lastDigit").textContent =
    digit;


ticks.push(price);


if (
    ticks.length >
    maxTicks
) {

    ticks.shift();

}


updateAnalysis();
```

}

/* =========================
GET LAST DIGIT
========================= */

function getLastDigit(value) {

```
const text =
    String(value);


const match =
    text.match(
        /(\d)(?!.*\d)/
    );


if (match) {

    return Number(
        match[1]
    );

}


return 0;
```

}

/* =========================
MAIN ANALYSIS
========================= */

function updateAnalysis() {

```
if (ticks.length < 20) {

    return;

}


const digits =

    ticks.map(
        getLastDigit
    );


const frequency =
    Array(10).fill(0);


digits.forEach(digit => {

    frequency[digit]++;

});


/* BEST DIGIT */

const bestDigit =

    frequency.indexOf(

        Math.max(
            ...frequency
        )

    );


/* COLD DIGIT */

const coldDigit =

    frequency.indexOf(

        Math.min(
            ...frequency
        )

    );


/* BARRIER */

const barrier =
    Number(
        barrierSelect.value
    );


/* MATCH SCORE */

const matchConfidence =

    (
        frequency[bestDigit] /
        digits.length
    ) * 100;


/* OVER */

const overCount =

    digits.filter(
        digit =>
            digit > barrier
    ).length;


const overConfidence =

    (
        overCount /
        digits.length
    ) * 100;


/* UNDER */

const underCount =

    digits.filter(
        digit =>
            digit < barrier
    ).length;


const underConfidence =

    (
        underCount /
        digits.length
    ) * 100;


/* EVEN */

const evenCount =

    digits.filter(

        digit =>
            digit % 2 === 0

    ).length;


const evenConfidence =

    (
        evenCount /
        digits.length
    ) * 100;


/* ODD */

const oddCount =

    digits.filter(

        digit =>
            digit % 2 === 1

    ).length;


const oddConfidence =

    (
        oddCount /
        digits.length
    ) * 100;


/* UPDATE MATCH */

$("matchDigit").textContent =
    bestDigit;


$("matchConfidence").textContent =

    matchConfidence.toFixed(1) +
    "%";


/* UPDATE OVER */

$("overLabel").textContent =
    "OVER " + barrier;


$("overConfidence").textContent =

    overConfidence.toFixed(1) +
    "%";


/* UPDATE UNDER */

$("underLabel").textContent =
    "UNDER " + barrier;


$("underConfidence").textContent =

    underConfidence.toFixed(1) +
    "%";


/* UPDATE EVEN */

$("evenConfidence").textContent =

    evenConfidence.toFixed(1) +
    "%";


/* UPDATE ODD */

$("oddConfidence").textContent =

    oddConfidence.toFixed(1) +
    "%";


/* HOT DIGIT */

const recentDigits =
    digits.slice(-50);


const recentFrequency =
    Array(10).fill(0);


recentDigits.forEach(digit => {

    recentFrequency[digit]++;

});


const hotDigit =

    recentFrequency.indexOf(

        Math.max(
            ...recentFrequency
        )

    );


$("hotDigit").textContent =
    hotDigit;


$("hotInfo").textContent =

    recentFrequency[hotDigit] +

    " appearances in last " +

    recentDigits.length;


/* COLD DIGIT */

$("coldDigit").textContent =
    coldDigit;


$("coldInfo").textContent =

    frequency[coldDigit] +

    " appearances in " +

    digits.length;


/* TOTAL TICKS */

$("tickTotal").textContent =
    digits.length;


/* MOMENTUM */

$("momentumInfo").textContent =
    "LIVE";


/* GAP */

const lastIndex =

    digits.lastIndexOf(
        bestDigit
    );


const gap =

    digits.length -
    1 -
    lastIndex;


$("matchGap").textContent =

    "Gap: " +
    gap +
    " ticks";


/* RENDER */

renderDigitDistribution(
    frequency,
    digits
);


renderRecentDigits(
    digits
);


determineBestSignal({

    bestDigit,

    matchConfidence,

    barrier,

    overConfidence,

    underConfidence,

    evenConfidence,

    oddConfidence

});
```

}

/* =========================
DIGIT DISTRIBUTION
========================= */

function renderDigitDistribution(
frequency,
digits
) {

```
const grid =
    $("digitGrid");


grid.innerHTML = "";


for (
    let digit = 0;
    digit < 10;
    digit++
) {


    const card =
        document.createElement(
            "div"
        );


    card.className =
        "digit-card";


    const percentage =

        (
            frequency[digit] /
            digits.length
        ) * 100;


    const lastIndex =

        digits.lastIndexOf(
            digit
        );


    const gap =

        digits.length -
        1 -
        lastIndex;


    card.innerHTML = `

        <div class="digit-number">
            ${digit}
        </div>

        <div>
            ${frequency[digit]} ticks
        </div>

        <strong>
            ${percentage.toFixed(1)}%
        </strong>

        <small>
            Gap: ${gap}
        </small>

    `;


    grid.appendChild(card);

}
```

}

/* =========================
RECENT DIGITS
========================= */

function renderRecentDigits(
digits
) {

```
const container =
    $("recentDigits");


container.innerHTML = "";


const recent =
    digits.slice(-30);


recent.forEach(digit => {


    const element =
        document.createElement(
            "div"
        );


    element.className =
        "recent-digit";


    element.textContent =
        digit;


    container.appendChild(
        element
    );

});
```

}

/* =========================
BEST SIGNAL
========================= */

function determineBestSignal(
data
) {

```
const signals = [

    {

        strategy:
            "DIGIT MATCH",

        value:
            data.bestDigit,

        confidence:
            data.matchConfidence

    },


    {

        strategy:
            "DIGIT OVER",

        value:
            "OVER " +
            data.barrier,

        confidence:
            data.overConfidence

    },


    {

        strategy:
            "DIGIT UNDER",

        value:
            "UNDER " +
            data.barrier,

        confidence:
            data.underConfidence

    },


    {

        strategy:
            "EVEN",

        value:
            "EVEN",

        confidence:
            data.evenConfidence

    },


    {

        strategy:
            "ODD",

        value:
            "ODD",

        confidence:
            data.oddConfidence

    }

];


signals.sort(

    (a, b) =>

        b.confidence -
        a.confidence

);


const best =
    signals[0];


$("bestStrategy").textContent =
    best.strategy;


$("bestDigit").textContent =
    best.value;


$("bestConfidence").textContent =

    best.confidence.toFixed(1) +
    "%";


const threshold =
    Number(
        thresholdSelect.value
    );


if (
    best.confidence >=
    threshold
) {

    $("entryStatus").textContent =

        "🟢 ENTRY CONDITIONS MET — Statistical Signal";

}

else if (

    best.confidence >=
    threshold - 8

) {

    $("entryStatus").textContent =

        "🟡 WATCH — Wait for stronger confirmation";

}

else {

    $("entryStatus").textContent =

        "🔴 WAIT — Weak statistical conditions";

}
```

}

/* =========================
EVENT LISTENERS
========================= */

connectBtn.addEventListener(

```
"click",

connectDeriv
```

);

marketSelect.addEventListener(

```
"change",

subscribeMarket
```

);

tickCountSelect.addEventListener(

```
"change",

subscribeMarket
```

);

barrierSelect.addEventListener(

```
"change",

updateAnalysis
```

);

thresholdSelect.addEventListener(

```
"change",

updateAnalysis
```

);
