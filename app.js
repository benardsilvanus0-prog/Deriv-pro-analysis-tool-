// ========================================
// DERIV DIGIT ANALYZER PRO
// FIXED WEBSOCKET VERSION
// ANALYSIS ONLY
// ========================================

let ws = null;

let tickData = [];

let maxTicks = 1000;

let currentSymbol = null;

let symbolPipSize = 2;

let validSymbols = [];

let isConnecting = false;


// ========================================
// ELEMENTS
// ========================================

const $ = (id) => document.getElementById(id);

const marketSelect = $("marketSelect");

const tickCountSelect = $("tickCount");

const barrierSelect = $("barrier");

const thresholdSelect = $("threshold");

const connectBtn = $("connectBtn");


// ========================================
// CREATE BARRIERS
// ========================================

for (let i = 0; i <= 9; i++) {

    const option = document.createElement("option");

    option.value = i;

    option.textContent = i;

    if (i === 5) {

        option.selected = true;

    }

    barrierSelect.appendChild(option);

}


// ========================================
// STATUS
// ========================================

function setStatus(message) {

    $("connectionStatus").textContent = message;

}


// ========================================
// SEND API MESSAGE
// ========================================

function send(request) {

    if (!ws) return false;

    if (ws.readyState !== WebSocket.OPEN) {

        return false;

    }

    ws.send(JSON.stringify(request));

    console.log("SENT:", request);

    return true;

}


// ========================================
// CONNECT TO DERIV
// ========================================

function connectDeriv() {

    if (isConnecting) return;


    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        setStatus("🟢 Connected");

        return;

    }


    isConnecting = true;

    connectBtn.disabled = true;

    connectBtn.textContent = "Connecting...";

    setStatus("🟡 Connecting to Deriv...");


    // Official public WebSocket endpoint

    ws = new WebSocket(

        "wss://ws.binaryws.com/websockets/v3"

    );


    // ====================================
    // CONNECTION OPEN
    // ====================================

    ws.onopen = function () {

        console.log("CONNECTED TO DERIV");

        isConnecting = false;

        connectBtn.disabled = false;

        connectBtn.textContent = "🟢 Connected";


        setStatus(

            "🟢 Connected — Loading markets..."

        );


        // Get active symbols

        send({

            active_symbols: "brief",

            req_id: 1

        });

    };


    // ====================================
    // RECEIVE MESSAGES
    // ====================================

    ws.onmessage = function (event) {

        let data;

        try {

            data = JSON.parse(event.data);

        }

        catch (error) {

            console.error("JSON ERROR:", error);

            return;

        }


        console.log("RECEIVED:", data);


        // API ERROR

        if (data.error) {

            console.error(

                "DERIV API ERROR:",

                data.error

            );


            setStatus(

                "🔴 API Error: " +

                data.error.message

            );

            return;

        }


        // ACTIVE SYMBOLS

        if (
            data.msg_type === "active_symbols"
        ) {

            loadMarkets(

                data.active_symbols

            );

            return;

        }


        // TICK HISTORY

        if (
            data.msg_type === "history"
        ) {

            loadHistory(

                data.history

            );

            return;

        }


        // LIVE TICK

        if (
            data.msg_type === "tick"
        ) {

            handleTick(

                data.tick

            );

            return;

        }

    };


    // ====================================
    // ERROR
    // ====================================

    ws.onerror = function (error) {

        console.error(

            "WEBSOCKET ERROR:",

            error

        );


        setStatus(

            "🔴 WebSocket connection error"

        );


        isConnecting = false;

        connectBtn.disabled = false;

        connectBtn.textContent = "🔌 Connect";

    };


    // ====================================
    // CLOSE
    // ====================================

    ws.onclose = function () {

        console.log("DISCONNECTED");

        isConnecting = false;

        connectBtn.disabled = false;

        connectBtn.textContent = "🔌 Connect";

        setStatus("🔴 Disconnected");

    };

}


// ========================================
// LOAD MARKETS
// ========================================

function loadMarkets(symbols) {

    console.log(

        "ACTIVE SYMBOLS:",

        symbols

    );


    marketSelect.innerHTML = "";


    if (
        !Array.isArray(symbols) ||
        symbols.length === 0
    ) {

        console.log(

            "No symbols returned. Using fallback."

        );


        addFallbackMarket();

        return;

    }


    validSymbols = [];


    symbols.forEach(function (item) {


        // Support new and old API formats

        const symbol =

            item.underlying_symbol ||

            item.symbol;


        const name =

            item.underlying_symbol_name ||

            item.display_name ||

            symbol;


        const pipSize =

            item.pip_size ||

            item.pip ||

            2;


        if (!symbol) return;


        validSymbols.push({

            symbol: symbol,

            name: name,

            market: item.market || "",

            pipSize: pipSize

        });

    });


    // Filter for synthetic indices

    let syntheticMarkets =

        validSymbols.filter(function (item) {


            const text =

                (
                    item.name +

                    " " +

                    item.market +

                    " " +

                    item.symbol
                )

                .toLowerCase();


            return (

                text.includes("volatility") ||

                text.includes("synthetic") ||

                text.includes("jump") ||

                text.includes("step")

            );

        });


    // If filter finds nothing use all

    if (
        syntheticMarkets.length === 0
    ) {

        syntheticMarkets = validSymbols;

    }


    // Sort

    syntheticMarkets.sort(

        (a, b) =>

            a.name.localeCompare(

                b.name

            )

    );


    // Create dropdown

    syntheticMarkets.forEach(

        function (item) {


            const option =

                document.createElement(

                    "option"

                );


            option.value = item.symbol;


            option.textContent =

                item.name;


            option.dataset.pipSize =

                item.pipSize;


            marketSelect.appendChild(

                option

            );

        }

    );


    // IMPORTANT:
    // Only subscribe if we have
    // a real valid symbol

    if (
        marketSelect.options.length > 0
    ) {

        currentSymbol =

            marketSelect.value;


        const selected =

            marketSelect.options[
                marketSelect.selectedIndex
            ];


        symbolPipSize =

            Number(

                selected.dataset.pipSize

            ) || 2;


        setStatus(

            "🟢 Markets loaded"

        );


        subscribeMarket();

    }

    else {

        addFallbackMarket();

    }

}


// ========================================
// FALLBACK MARKET
// ========================================

function addFallbackMarket() {


    marketSelect.innerHTML = "";


    const option =

        document.createElement(

            "option"

        );


    // Official example symbol

    option.value = "1HZ100V";

    option.textContent =

        "Volatility 100 (1s)";


    option.dataset.pipSize = "2";


    marketSelect.appendChild(option);


    currentSymbol = "1HZ100V";

    symbolPipSize = 2;


    setStatus(

        "🟡 Using fallback market"

    );


    subscribeMarket();

}


// ========================================
// SUBSCRIBE TO MARKET
// ========================================

function subscribeMarket() {


    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
    ) {

        setStatus(

            "🔴 Connect first"

        );

        return;

    }


    const symbol =

        marketSelect.value;


    // VERY IMPORTANT

    if (
        !symbol ||
        symbol === "No markets received" ||
        symbol.length < 2
    ) {

        setStatus(

            "🔴 Invalid market symbol"

        );

        return;

    }


    currentSymbol = symbol;


    maxTicks =

        Number(

            tickCountSelect.value

        );


    tickData = [];


    const selected =

        marketSelect.options[
            marketSelect.selectedIndex
        ];


    if (selected) {

        symbolPipSize =

            Number(

                selected.dataset.pipSize

            ) || 2;

    }


    setStatus(

        "🟡 Loading " +

        maxTicks +

        " ticks..."

    );


    // Remove previous subscriptions

    send({

        forget_all: "ticks"

    });


    // Get historical ticks

    send({

        ticks_history:

            currentSymbol,

        count:

            maxTicks,

        end:

            "latest",

        style:

            "ticks",

        req_id:

            2

    });


    // Subscribe to live ticks

    send({

        ticks:

            currentSymbol,

        subscribe:

            1,

        req_id:

            3

    });

}


// ========================================
// LOAD HISTORY
// ========================================

function loadHistory(history) {

    if (
        !history ||
        !Array.isArray(history.prices)
    ) {

        return;

    }


    tickData =

        history.prices

            .map(function (price) {

                return formatPrice(

                    Number(price)

                );

            })

            .slice(-maxTicks);


    $("tickTotal").textContent =

        tickData.length;


    setStatus(

        "🟢 LIVE — Receiving ticks"

    );


    updateAnalysis();

}


// ========================================
// FORMAT PRICE
// ========================================

function formatPrice(price) {

    if (!Number.isFinite(price)) {

        return "0";

    }


    return price.toFixed(

        symbolPipSize

    );

}


// ========================================
// HANDLE LIVE TICK
// ========================================

function handleTick(tick) {

    if (!tick) return;


    const pipSize =

        Number(tick.pip_size);


    if (Number.isFinite(pipSize)) {

        symbolPipSize = pipSize;

    }


    const price =

        Number(tick.quote);


    if (!Number.isFinite(price)) {

        return;

    }


    const formattedPrice =

        formatPrice(price);


    // Display price

    $("livePrice").textContent =

        formattedPrice;


    // Display digit

    const digit =

        getLastDigit(

            formattedPrice

        );


    $("lastDigit").textContent =

        digit;


    // Store formatted tick

    tickData.push(

        formattedPrice

    );


    // Keep selected history size

    if (
        tickData.length >
        maxTicks
    ) {

        tickData.shift();

    }


    $("tickTotal").textContent =

        tickData.length;


    updateAnalysis();

}


// ========================================
// GET LAST DIGIT
// ========================================

function getLastDigit(price) {


    const text =

        String(price);


    const digits =

        text.match(/\d/g);


    if (
        !digits ||
        digits.length === 0
    ) {

        return 0;

    }


    return Number(

        digits[digits.length - 1]

    );

}


// ========================================
// ANALYZE DIGITS
// ========================================

function updateAnalysis() {


    if (
        tickData.length < 20
    ) {

        return;

    }


    const digits =

        tickData.map(

            getLastDigit

        );


    const frequency =

        Array(10).fill(0);


    digits.forEach(

        function (digit) {

            frequency[digit]++;

        }

    );


    // HOT DIGIT

    const hotDigit =

        frequency.indexOf(

            Math.max(...frequency)

        );


    // COLD DIGIT

    const coldDigit =

        frequency.indexOf(

            Math.min(...frequency)

        );


    const barrier =

        Number(

            barrierSelect.value

        );


    const total =

        digits.length;


    // MATCH RATE

    const matchRate =

        frequency[hotDigit] /

        total *

        100;


    // OVER

    const overCount =

        digits.filter(

            d => d > barrier

        ).length;


    const overRate =

        overCount /

        total *

        100;


    // UNDER

    const underCount =

        digits.filter(

            d => d < barrier

        ).length;


    const underRate =

        underCount /

        total *

        100;


    // EVEN

    const evenCount =

        digits.filter(

            d => d % 2 === 0

        ).length;


    const evenRate =

        evenCount /

        total *

        100;


    // ODD

    const oddCount =

        digits.filter(

            d => d % 2 !== 0

        ).length;


    const oddRate =

        oddCount /

        total *

        100;


    // UPDATE MATCH

    $("matchDigit").textContent =

        hotDigit;


    $("matchConfidence").textContent =

        matchRate.toFixed(1) + "%";


    // GAP

    const lastIndex =

        digits.lastIndexOf(

            hotDigit

        );


    const gap =

        total -

        1 -

        lastIndex;


    $("matchGap").textContent =

        "Gap: " +

        gap +

        " ticks";


    // UPDATE OVER

    $("overLabel").textContent =

        "OVER " + barrier;


    $("overConfidence").textContent =

        overRate.toFixed(1) + "%";


    // UPDATE UNDER

    $("underLabel").textContent =

        "UNDER " + barrier;


    $("underConfidence").textContent =

        underRate.toFixed(1) + "%";


    // EVEN / ODD

    $("evenConfidence").textContent =

        evenRate.toFixed(1) + "%";


    $("oddConfidence").textContent =

        oddRate.toFixed(1) + "%";


    // HOT / COLD

    $("hotDigit").textContent =

        hotDigit;


    $("hotInfo").textContent =

        frequency[hotDigit] +

        " appearances";


    $("coldDigit").textContent =

        coldDigit;


    $("coldInfo").textContent =

        frequency[coldDigit] +

        " appearances";


    // MOMENTUM

    const recent =

        digits.slice(-50);


    const recentCount =

        recent.filter(

            d => d === hotDigit

        ).length;


    const recentRate =

        recentCount /

        recent.length;


    const normalRate =

        frequency[hotDigit] /

        total;


    if (

        recentRate >

        normalRate + 0.03

    ) {

        $("momentumInfo").textContent =

            "📈 RISING";

    }

    else if (

        recentRate <

        normalRate - 0.03

    ) {

        $("momentumInfo").textContent =

            "📉 FALLING";

    }

    else {

        $("momentumInfo").textContent =

            "➡️ STABLE";

    }


    // RENDER

    renderDigitDistribution(

        frequency,

        digits

    );


    renderRecentDigits(

        digits

    );


    // BEST SIGNAL

    updateBestSignal({

        hotDigit,

        matchRate,

        barrier,

        overRate,

        underRate,

        evenRate,

        oddRate

    });

}


// ========================================
// BEST SIGNAL
// ========================================

function updateBestSignal(data) {


    const signals = [

        {

            name: "DIGIT MATCH",

            value: data.hotDigit,

            score: data.matchRate

        },

        {

            name: "DIGIT OVER",

            value:

                "OVER " +

                data.barrier,

            score: data.overRate

        },

        {

            name: "DIGIT UNDER",

            value:

                "UNDER " +

                data.barrier,

            score: data.underRate

        },

        {

            name: "EVEN",

            value: "EVEN",

            score: data.evenRate

        },

        {

            name: "ODD",

            value: "ODD",

            score: data.oddRate

        }

    ];


    signals.sort(

        (a, b) =>

            b.score - a.score

    );


    const best =

        signals[0];


    $("bestStrategy").textContent =

        best.name;


    $("bestDigit").textContent =

        best.value;


    $("bestConfidence").textContent =

        best.score.toFixed(1) + "%";


    const threshold =

        Number(

            thresholdSelect.value

        );


    if (

        best.score >= threshold

    ) {

        $("entryStatus").textContent =

            "🟢 STRONG STATISTICAL SIGNAL";

    }

    else {

        $("entryStatus").textContent =

            "🟡 WAIT FOR MORE CONFIRMATION";

    }

}


// ========================================
// DIGIT DISTRIBUTION
// ========================================

function renderDigitDistribution(

    frequency,

    digits

) {


    const grid =

        $("digitGrid");


    grid.innerHTML = "";


    for (

        let digit = 0;

        digit < 10;

        digit++

    ) {


        const count =

            frequency[digit];


        const percentage =

            count /

            digits.length *

            100;


        const lastIndex =

            digits.lastIndexOf(

                digit

            );


        const gap =

            lastIndex === -1

                ? digits.length

                : digits.length -

                  1 -

                  lastIndex;


        const card =

            document.createElement(

                "div"

            );


        card.className =

            "digit-card";


        card.innerHTML = `

            <div class="digit-number">

                ${digit}

            </div>

            <div class="digit-count">

                ${count} ticks

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

}


// ========================================
// RECENT DIGITS
// ========================================

function renderRecentDigits(digits) {


    const container =

        $("recentDigits");


    container.innerHTML = "";


    digits

        .slice(-30)

        .forEach(

            function (digit) {


                const item =

                    document.createElement(

                        "div"

                    );


                item.className =

                    "recent-digit";


                item.textContent =

                    digit;


                container.appendChild(

                    item

                );

            }

        );

}


// ========================================
// EVENTS
// ========================================

connectBtn.addEventListener(

    "click",

    connectDeriv

);


marketSelect.addEventListener(

    "change",

    subscribeMarket

);


tickCountSelect.addEventListener(

    "change",

    subscribeMarket

);


barrierSelect.addEventListener(

    "change",

    updateAnalysis

);


thresholdSelect.addEventListener(

    "change",

    updateAnalysis

);
