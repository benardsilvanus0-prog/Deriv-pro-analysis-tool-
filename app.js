let ws = null;

let ticks = [];

let currentSymbol = null;

let maxTicks = 1000;


// ELEMENTS

const marketSelect = document.getElementById("marketSelect");

const tickCountSelect = document.getElementById("tickCount");

const barrierSelect = document.getElementById("barrier");

const connectBtn = document.getElementById("connectBtn");

const connectionStatus = document.getElementById("connectionStatus");

const livePrice = document.getElementById("livePrice");

const lastDigitElement = document.getElementById("lastDigit");

const digitGrid = document.getElementById("digitGrid");

const recentDigits = document.getElementById("recentDigits");


// CONNECT BUTTON

connectBtn.addEventListener("click", () => {

    if (ws && ws.readyState === WebSocket.OPEN) {

        subscribeMarket();

    } else {

        connectDeriv();

    }

});


// CONNECT TO DERIV

function connectDeriv() {

    connectionStatus.textContent = "🟡 Connecting...";

    /*
      Public Deriv WebSocket connection.

      Replace app_id later with your own registered
      Deriv application ID for production use.
    */

    ws = new WebSocket(
        "wss://ws.derivws.com/websockets/v3?app_id=1089"
    );


    ws.onopen = () => {

        connectionStatus.textContent = "🟢 Connected";

        getMarkets();

    };


    ws.onmessage = (event) => {

        const data = JSON.parse(event.data);

        handleMessage(data);

    };


    ws.onerror = () => {

        connectionStatus.textContent = "🔴 API Error";

    };


    ws.onclose = () => {

        connectionStatus.textContent = "🔴 Disconnected";

    };

}


// GET ACTIVE MARKETS

function getMarkets() {

    ws.send(JSON.stringify({

        active_symbols: "brief",

        product_type: "basic",

        req_id: 1

    }));

}


// HANDLE API RESPONSES

function handleMessage(data) {

    // API ERROR

    if (data.error) {

        console.error(data.error);

        connectionStatus.textContent =
            "🔴 Error: " + data.error.message;

        return;

    }


    // ACTIVE SYMBOLS

    if (data.msg_type === "active_symbols") {

        loadMarkets(data.active_symbols);

    }


    // TICK HISTORY

    if (data.msg_type === "history") {

        loadHistory(data.history);

    }


    // LIVE TICK

    if (data.msg_type === "tick") {

        handleTick(data.tick);

    }

}


// LOAD MARKETS

function loadMarkets(symbols) {

    marketSelect.innerHTML = "";

    /*
      Show available symbols.

      You can later filter this list
      specifically for Synthetic Indices.
    */

    symbols.forEach(symbol => {

        const option = document.createElement("option");

        option.value = symbol.symbol;

        option.textContent =
            symbol.display_name + " (" + symbol.symbol + ")";

        marketSelect.appendChild(option);

    });


    currentSymbol = marketSelect.value;

    subscribeMarket();

}


// MARKET CHANGE

marketSelect.addEventListener("change", () => {

    currentSymbol = marketSelect.value;

    ticks = [];

    subscribeMarket();

});


// TICK COUNT CHANGE

tickCountSelect.addEventListener("change", () => {

    maxTicks = Number(tickCountSelect.value);

    ticks = [];

    subscribeMarket();

});


// BARRIER CHANGE

barrierSelect.addEventListener("change", () => {

    updateAnalysis();

});


// SUBSCRIBE MARKET

function subscribeMarket() {

    if (!ws || ws.readyState !== WebSocket.OPEN) {

        return;

    }


    currentSymbol = marketSelect.value;

    maxTicks = Number(tickCountSelect.value);


    connectionStatus.textContent =
        "🟡 Loading " + maxTicks + " ticks...";


    /*
      GET HISTORICAL TICKS
    */

    ws.send(JSON.stringify({

        ticks_history: currentSymbol,

        count: maxTicks,

        end: "latest",

        style: "ticks",

        req_id: 2

    }));


    /*
      SUBSCRIBE TO LIVE TICKS
    */

    ws.send(JSON.stringify({

        ticks: currentSymbol,

        subscribe: 1,

        req_id: 3

    }));


    connectionStatus.textContent = "🟢 Live";

}


// LOAD HISTORY

function loadHistory(history) {

    ticks = [];


    if (!history || !history.prices) {

        return;

    }


    history.prices.forEach(price => {

        ticks.push(Number(price));

    });


    updateAnalysis();

}


// HANDLE LIVE TICK

function handleTick(tick) {

    const price = Number(tick.quote);

    livePrice.textContent = price;


    const digit = getLastDigit(price);

    lastDigitElement.textContent = digit;


    ticks.push(price);


    if (ticks.length > maxTicks) {

        ticks.shift();

    }


    updateAnalysis();

}


// GET LAST DIGIT

function getLastDigit(price) {

    /*
      Convert the tick quote to string
      and take the final numeric character.
    */

    const value = String(price);

    const numbers = value.match(/\d/g);

    if (!numbers) return 0;

    return Number(numbers[numbers.length - 1]);

}


// MAIN ANALYSIS

function updateAnalysis() {

    if (ticks.length < 20) {

        return;

    }


    const digits = ticks.map(price => {

        return getLastDigit(price);

    });


    // DIGIT FREQUENCY

    const frequency = Array(10).fill(0);


    digits.forEach(digit => {

        frequency[digit]++;

    });


    // BEST MATCH DIGIT

    const bestDigit = frequency.indexOf(

        Math.max(...frequency)

    );


    const matchConfidence =

        (frequency[bestDigit] / digits.length) * 100;


    // OVER / UNDER

    const barrier = Number(barrierSelect.value);


    const overCount = digits.filter(d => d > barrier).length;

    const underCount = digits.filter(d => d < barrier).length;


    const overConfidence =

        (overCount / digits.length) * 100;


    const underConfidence =

        (underCount / digits.length) * 100;


    // EVEN / ODD

    const evenCount = digits.filter(

        d => d % 2 === 0

    ).length;


    const oddCount = digits.length - evenCount;


    const evenConfidence =

        (evenCount / digits.length) * 100;


    const oddConfidence =

        (oddCount / digits.length) * 100;


    // UPDATE SCREEN

    document.getElementById("matchDigit")
        .textContent = bestDigit;


    document.getElementById("matchConfidence")
        .textContent = matchConfidence.toFixed(1) + "%";


    document.getElementById("overBarrier")
        .textContent = barrier;


    document.getElementById("underBarrier")
        .textContent = barrier;


    document.getElementById("overConfidence")
        .textContent = overConfidence.toFixed(1) + "%";


    document.getElementById("underConfidence")
        .textContent = underConfidence.toFixed(1) + "%";


    document.getElementById("evenConfidence")
        .textContent = evenConfidence.toFixed(1) + "%";


    document.getElementById("oddConfidence")
        .textContent = oddConfidence.toFixed(1) + "%";


    renderDigitDistribution(

        frequency,

        digits.length

    );


    renderRecentDigits(digits);


    determineBestSignal({

        bestDigit,

        matchConfidence,

        barrier,

        overConfidence,

        underConfidence,

        evenConfidence,

        oddConfidence

    });

}


// RENDER DIGIT DISTRIBUTION

function renderDigitDistribution(frequency, total) {

    digitGrid.innerHTML = "";


    for (let i = 0; i < 10; i++) {

        const percentage =

            (frequency[i] / total) * 100;


        const card = document.createElement("div");

        card.className = "digit-card";


        card.innerHTML = `

            <div class="digit-number">

                ${i}

            </div>

            <div>

                ${frequency[i]} ticks

            </div>

            <strong>

                ${percentage.toFixed(1)}%

            </strong>

        `;


        digitGrid.appendChild(card);

    }

}


// RECENT DIGITS

function renderRecentDigits(digits) {

    recentDigits.innerHTML = "";


    const latest = digits.slice(-30);


    latest.forEach(digit => {

        const element = document.createElement("div");

        element.className = "recent-digit";

        element.textContent = digit;

        recentDigits.appendChild(element);

    });

}


// DETERMINE BEST SIGNAL

function determineBestSignal(data) {

    const signals = [

        {

            strategy: "DIGIT MATCH",

            value: data.bestDigit,

            confidence: data.matchConfidence

        },

        {

            strategy: "DIGIT OVER",

            value: "OVER " + data.barrier,

            confidence: data.overConfidence

        },

        {

            strategy: "DIGIT UNDER",

            value: "UNDER " + data.barrier,

            confidence: data.underConfidence

        },

        {

            strategy: "EVEN",

            value: "EVEN",

            confidence: data.evenConfidence

        },

        {

            strategy: "ODD",

            value: "ODD",

            confidence: data.oddConfidence

        }

    ];


    const best = signals.reduce(

        (a, b) =>

            a.confidence > b.confidence

                ? a

                : b

    );


    document.getElementById("bestStrategy")
        .textContent = best.strategy;


    document.getElementById("bestDigit")
        .textContent = best.value;


    document.getElementById("bestConfidence")
        .textContent = best.confidence.toFixed(1) + "%";


    // ENTRY STATUS

    const entryStatus =

        document.getElementById("entryStatus");


    if (best.confidence >= 70) {

        entryStatus.textContent =
            "🟢 STRONG STATISTICAL SIGNAL";

    }

    else if (best.confidence >= 55) {

        entryStatus.textContent =
            "🟡 MODERATE SIGNAL";

    }

    else {

        entryStatus.textContent =
            "🔴 WEAK SIGNAL — WAIT";

    }

}
