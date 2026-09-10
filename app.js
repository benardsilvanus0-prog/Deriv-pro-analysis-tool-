"use strict";

/*
=========================================================
DERIV PRO SIGNAL SCANNER
ANALYSIS ONLY - NO AUTOMATIC TRADING

Uses Deriv public WebSocket market data.

IMPORTANT:
The confidence value is a statistical/technical
signal-quality score. It is NOT a guaranteed probability
of winning the next contract.
=========================================================
*/


/* =====================================================
   CONFIG
===================================================== */

const DERIV_WS =
    "wss://api.derivws.com/trading/v1/options/ws/public";

const DEFAULT_TICK_COUNT = 1000;
const MAX_TICK_COUNT = 5000;
const RECONNECT_DELAY = 5000;


/*
=========================================================
ANALYSIS ENGINE CONFIGURATION
=========================================================
*/

const ANALYSIS_CONFIG = {

    /*
    Analysis windows.
    */

    LONG_WINDOW: 1000,

    MEDIUM_WINDOW: 100,

    SHORT_WINDOW: 30,


    /*
    Weight recent data more heavily.
    */

    LONG_WEIGHT: 0.20,

    MEDIUM_WEIGHT: 0.30,

    SHORT_WEIGHT: 0.50,


    /*
    Minimum data required before analysis.
    */

    MIN_ANALYSIS_TICKS: 30,

    /*
    Stronger minimum for an actual entry signal.
    */

    MIN_ENTRY_TICKS: 100,


    /*
    Never allow an entry below this score,
    even if the user UI threshold is lower.
    */

    MIN_ENTRY_CONFIDENCE: 60,


    /*
    Quality requirements.
    */

    MIN_CONSISTENCY: 50,

    MIN_AGREEMENT: 66.7,

    MIN_EVIDENCE_Z: 1.5,


    /*
    Maximum displayed confidence.
    */

    MAX_CONFIDENCE: 95
};


/*
Fallback markets.

Used only if active_symbols returns no usable markets.
*/

const FALLBACK_MARKETS = [

    {
        symbol: "1HZ10V",
        name: "Volatility 10 (1s)",
        pip: 2
    },

    {
        symbol: "1HZ25V",
        name: "Volatility 25 (1s)",
        pip: 2
    },

    {
        symbol: "1HZ50V",
        name: "Volatility 50 (1s)",
        pip: 2
    },

    {
        symbol: "1HZ75V",
        name: "Volatility 75 (1s)",
        pip: 2
    },

    {
        symbol: "1HZ100V",
        name: "Volatility 100 (1s)",
        pip: 2
    },

    {
        symbol: "R_10",
        name: "Volatility 10",
        pip: 3
    },

    {
        symbol: "R_25",
        name: "Volatility 25",
        pip: 3
    },

    {
        symbol: "R_50",
        name: "Volatility 50",
        pip: 4
    },

    {
        symbol: "R_75",
        name: "Volatility 75",
        pip: 4
    },

    {
        symbol: "R_100",
        name: "Volatility 100",
        pip: 2
    }
];


/* =====================================================
   STATE
===================================================== */

let ws = null;

let connected = false;

let connecting = false;

let manualDisconnect = false;

let reconnectTimer = null;

let pingTimer = null;

let autoScanTimer = null;

let requestId = 1;

let currentSymbol = "";

let currentMarket = null;

let currentSubscriptionId = null;

let pipSize = 0.01;

let ticks = [];

let currentMode = "match";

let currentType = "MATCH";


/* =====================================================
   DOM
===================================================== */

const $ = id =>
    document.getElementById(id);


const marketSelect =
    $("marketSelect");

const tickCount =
    $("tickCount");

const threshold =
    $("threshold");

const barrier =
    $("barrier");

const connectBtn =
    $("connectBtn");

const scanBtn =
    $("scanBtn");

const autoScan =
    $("autoScan");

const connectionDot =
    $("connectionDot");

const statusText =
    $("statusText");

const liveBadge =
    $("liveBadge");

const signalTitle =
    $("signalTitle");

const bestDigit =
    $("bestDigit");

const bestConfidence =
    $("bestConfidence");

const confidenceBar =
    $("confidenceBar");

const signalExplanation =
    $("signalExplanation");

const entryStatus =
    $("entryStatus");

const tickStatus =
    $("tickStatus");

const livePrice =
    $("livePrice");

const lastDigit =
    $("lastDigit");

const marketName =
    $("marketName");

const digitGrid =
    $("digitGrid");

const recentDigits =
    $("recentDigits");


/* =====================================================
   BASIC HELPERS
===================================================== */

function setText(
    element,
    value
) {

    if (element) {

        element.textContent =
            value;
    }
}


function number(
    value,
    fallback = 0
) {

    const n =
        Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;
}


function nextRequestId() {

    return requestId++;
}


function clamp(
    value,
    min,
    max
) {

    return Math.max(
        min,
        Math.min(
            max,
            value
        )
    );
}


function mapRange(
    value,
    inMin,
    inMax,
    outMin,
    outMax
) {

    if (
        inMax === inMin
    ) {

        return outMin;
    }

    const ratio =
        (
            value - inMin
        ) /
        (
            inMax - inMin
        );

    return (
        outMin +
        ratio *
        (
            outMax - outMin
        )
    );
}


function getTickLimit() {

    const value =
        number(
            tickCount?.value,
            DEFAULT_TICK_COUNT
        );

    return Math.max(
        10,
        Math.min(
            MAX_TICK_COUNT,
            Math.floor(value)
        )
    );
}


function getThreshold() {

    return Math.max(
        0,
        Math.min(
            100,
            number(
                threshold?.value,
                60
            )
        )
    );
}


function getBarrier() {

    return Math.max(
        0,
        Math.min(
            9,
            Math.round(
                number(
                    barrier?.value,
                    5
                )
            )
        )
    );
}


/* =====================================================
   PIP / PRICE
===================================================== */

function decimalPlacesFromPip(
    pip
) {

    const p =
        Number(pip);

    if (
        !Number.isFinite(p) ||
        p <= 0
    ) {

        return 2;
    }


    if (p >= 1) {

        return 0;
    }


    return Math.max(
        0,
        Math.round(
            -Math.log10(p)
        )
    );
}


function formatPrice(
    price
) {

    const places =
        decimalPlacesFromPip(
            pipSize
        );

    return Number(price).toFixed(
        places
    );
}


/*
=========================================================
LAST DIGIT
=========================================================
*/

function getLastDigit(
    price,
    suppliedPip = null
) {

    const usablePip =
        Number(suppliedPip) > 0
            ? Number(suppliedPip)
            : pipSize;


    const places =
        decimalPlacesFromPip(
            usablePip
        );


    const formatted =
        Number(price).toFixed(
            places
        );


    const decimal =
        formatted.split(".")[1];


    if (!decimal) {

        const integer =
            formatted.replace(
                /\D/g,
                ""
            );


        return integer
            ? Number(
                integer[
                    integer.length - 1
                ]
            )
            : null;
    }


    return Number(
        decimal[
            decimal.length - 1
        ]
    );
}


/* =====================================================
   CONNECTION UI
===================================================== */

function updateConnectionUI(
    state,
    message
) {

    if (connectionDot) {

        connectionDot.classList.remove(
            "online",
            "offline",
            "connecting"
        );


        if (
            state === "online"
        ) {

            connectionDot.classList.add(
                "online"
            );

        } else if (
            state === "connecting"
        ) {

            connectionDot.classList.add(
                "connecting"
            );

        } else {

            connectionDot.classList.add(
                "offline"
            );
        }
    }


    if (liveBadge) {

        liveBadge.textContent =
            state === "online"
                ? "LIVE"
                : state === "connecting"
                    ? "CONNECTING"
                    : "OFFLINE";
    }


    setText(
        statusText,
        message ||
        (
            state === "online"
                ? "Connected"
                : state === "connecting"
                    ? "Connecting..."
                    : "Disconnected"
        )
    );
}


/* =====================================================
   SEND MESSAGE
===================================================== */

function send(data) {

    if (
        !ws ||
        ws.readyState !==
            WebSocket.OPEN
    ) {

        console.warn(
            "WebSocket not open:",
            data
        );

        return false;
    }


    try {

        ws.send(
            JSON.stringify(data)
        );

        return true;

    } catch (error) {

        console.error(
            "Send error:",
            error
        );

        return false;
    }
}


/* =====================================================
   CONNECT
===================================================== */

function connectDeriv() {

    if (
        connecting ||
        connected
    ) {

        return;
    }


    manualDisconnect = false;

    connecting = true;


    updateConnectionUI(
        "connecting",
        "Connecting to Deriv..."
    );


    setText(
        signalTitle,
        "Connecting..."
    );


    setText(
        signalExplanation,
        "Connecting to Deriv public market data..."
    );


    if (connectBtn) {

        connectBtn.disabled =
            true;

        connectBtn.textContent =
            "⏳ Connecting...";
    }


    console.log(
        "Opening Deriv WebSocket:",
        DERIV_WS
    );


    try {

        ws =
            new WebSocket(
                DERIV_WS
            );


        ws.addEventListener(
            "open",
            handleOpen
        );


        ws.addEventListener(
            "message",
            handleMessage
        );


        ws.addEventListener(
            "error",
            handleError
        );


        ws.addEventListener(
            "close",
            handleClose
        );

    } catch (error) {

        console.error(
            "WebSocket creation failed:",
            error
        );


        connecting = false;


        updateConnectionUI(
            "offline",
            "Connection failed"
        );


        resetConnectButton();
    }
}


/* =====================================================
   OPEN
===================================================== */

function handleOpen() {

    console.log(
        "CONNECTED:",
        DERIV_WS
    );


    connected = true;

    connecting = false;


    updateConnectionUI(
        "online",
        "Connected to Deriv"
    );


    if (connectBtn) {

        connectBtn.disabled =
            false;

        connectBtn.textContent =
            "🔌 Disconnect";
    }


    setText(
        signalTitle,
        "Loading markets..."
    );


    setText(
        signalExplanation,
        "Requesting available Deriv markets..."
    );


    startPing();


    send({

        active_symbols:
            "brief",

        req_id:
            nextRequestId()
    });
}


/* =====================================================
   PING
===================================================== */

function startPing() {

    stopPing();


    pingTimer =
        setInterval(
            () => {

                if (
                    ws &&
                    ws.readyState ===
                        WebSocket.OPEN
                ) {

                    send({
                        ping: 1
                    });
                }

            },
            12000
        );
}


function stopPing() {

    if (pingTimer) {

        clearInterval(
            pingTimer
        );

        pingTimer = null;
    }
}


/* =====================================================
   MESSAGE
===================================================== */

function handleMessage(
    event
) {

    let data;


    try {

        data =
            JSON.parse(
                event.data
            );

    } catch (error) {

        console.error(
            "Invalid JSON:",
            event.data
        );

        return;
    }


    console.log(
        "Deriv:",
        data
    );


    /* -----------------------------------------
       API ERROR
    ----------------------------------------- */

    if (data.error) {

        handleApiError(
            data
        );

        return;
    }


    /* -----------------------------------------
       ACTIVE SYMBOLS
    ----------------------------------------- */

    if (
        data.msg_type ===
        "active_symbols"
    ) {

        handleActiveSymbols(
            data
        );

        return;
    }


    /* -----------------------------------------
       HISTORY
    ----------------------------------------- */

    if (
        data.msg_type ===
        "history"
    ) {

        processHistory(
            data
        );

        return;
    }


    /* -----------------------------------------
       TICK
    ----------------------------------------- */

    if (
        data.msg_type ===
        "tick"
    ) {

        processTick(
            data
        );

        return;
    }


    /* -----------------------------------------
       PING
    ----------------------------------------- */

    if (
        data.msg_type ===
        "ping"
    ) {

        return;
    }


    /*
    Subscription information.
    */

    if (
        data.subscription &&
        data.subscription.id
    ) {

        currentSubscriptionId =
            data.subscription.id;


        console.log(
            "Subscription ID:",
            currentSubscriptionId
        );
    }
}


/* =====================================================
   API ERROR
===================================================== */

function handleApiError(
    data
) {

    console.error(
        "DERIV API ERROR:",
        data.error
    );


    const errorCode =
        data.error.code ||
        "API_ERROR";


    const errorMessage =
        data.error.message ||
        "Deriv API error";


    setText(
        statusText,
        `${errorCode}: ${errorMessage}`
    );


    setText(
        signalExplanation,
        `${errorCode}: ${errorMessage}`
    );


    /*
    Use fallback only if market request failed.
    */

    if (
        data.echo_req &&
        data.echo_req.active_symbols
    ) {

        loadFallbackMarkets();
    }
}


/* =====================================================
   ACTIVE SYMBOLS
===================================================== */

function handleActiveSymbols(
    data
) {

    const symbols =
        Array.isArray(
            data.active_symbols
        )
            ? data.active_symbols
            : [];


    console.log(
        "Markets received:",
        symbols.length
    );


    if (!symbols.length) {

        console.warn(
            "Deriv returned zero active markets."
        );


        loadFallbackMarkets();

        return;
    }


    loadMarkets(
        symbols
    );
}


/* =====================================================
   NORMALIZE MARKET
===================================================== */

function normalizeMarket(
    item
) {

    if (!item) {

        return null;
    }


    const symbol =
        item.underlying_symbol ||
        item.symbol ||
        "";


    if (!symbol) {

        return null;
    }


    const name =
        item.underlying_symbol_name ||
        item.display_name ||
        symbol;


    const type =
        item.underlying_symbol_type ||
        item.symbol_type ||
        "";


    const pip =
        item.pip_size ??
        item.pip ??
        0;


    return {

        symbol:
            String(symbol),

        name:
            String(name),

        type:
            String(type),

        pip:
            Number(pip) || 0,

        market:
            item.market || "",

        subgroup:
            item.subgroup || "",

        submarket:
            item.submarket || ""
    };
}


/* =====================================================
   LOAD MARKETS
===================================================== */

function loadMarkets(
    symbols
) {

    const normalized =
        symbols
            .map(
                normalizeMarket
            )
            .filter(Boolean);


    console.log(
        "Normalized markets:",
        normalized.length
    );


    let markets =
        normalized.filter(
            market => {

                const symbol =
                    market.symbol.toUpperCase();


                const type =
                    market.type.toLowerCase();


                return (

                    type.includes(
                        "synthetic"
                    ) ||

                    /^R_\d+/i.test(
                        symbol
                    ) ||

                    /^1HZ\d+/i.test(
                        symbol
                    ) ||

                    /^BOOM/i.test(
                        symbol
                    ) ||

                    /^CRASH/i.test(
                        symbol
                    )
                );
            }
        );


    /*
    If no synthetic markets were detected,
    display all returned markets.
    */

    if (!markets.length) {

        markets =
            normalized;
    }


    if (!markets.length) {

        loadFallbackMarkets();

        return;
    }


    markets.sort(
        (a, b) =>
            a.name.localeCompare(
                b.name
            )
    );


    populateMarketSelect(
        markets,
        false
    );
}


/* =====================================================
   FALLBACK
===================================================== */

function loadFallbackMarkets() {

    console.warn(
        "Using fallback markets."
    );


    const markets =
        FALLBACK_MARKETS.map(
            item => ({

                symbol:
                    item.symbol,

                name:
                    item.name,

                type:
                    "synthetic_index",

                pip:
                    item.pip
            })
        );


    populateMarketSelect(
        markets,
        true
    );
}


/* =====================================================
   MARKET SELECT
===================================================== */

function populateMarketSelect(
    markets,
    fallback
) {

    if (!marketSelect) {

        return;
    }


    marketSelect.innerHTML =
        "";


    const placeholder =
        document.createElement(
            "option"
        );


    placeholder.value =
        "";


    placeholder.textContent =
        fallback
            ? "Select synthetic market"
            : "Select market";


    marketSelect.appendChild(
        placeholder
    );


    markets.forEach(
        market => {

            const option =
                document.createElement(
                    "option"
                );


            option.value =
                market.symbol;


            option.textContent =
                `${market.name} (${market.symbol})`;


            option.dataset.name =
                market.name;


            option.dataset.pip =
                market.pip || "";


            marketSelect.appendChild(
                option
            );
        }
    );


    const count =
        marketSelect.options.length -
        1;


    console.log(
        "Markets loaded:",
        count
    );


    setText(
        statusText,
        `${count} markets loaded`
    );


    if (count === 0) {

        setText(
            signalTitle,
            "No markets"
        );

        return;
    }


    setText(
        signalTitle,
        "Select a market"
    );


    setText(
        signalExplanation,
        fallback
            ? "Deriv returned no market list. Testing fallback synthetic markets."
            : "Choose a market to begin analysis."
    );


    /*
    Automatically select first market.
    */

    marketSelect.selectedIndex =
        1;


    handleMarketChange();
}


/* =====================================================
   MARKET CHANGE
===================================================== */

function handleMarketChange() {

    if (!marketSelect) {

        return;
    }


    const symbol =
        marketSelect.value;


    if (!symbol) {

        return;
    }


    currentSymbol =
        symbol;


    const option =
        marketSelect.options[
            marketSelect.selectedIndex
        ];


    const name =
        option?.dataset?.name ||
        symbol;


    const selectedPip =
        Number(
            option?.dataset?.pip
        );


    currentMarket = {

        symbol:
            symbol,

        name:
            name
    };


    if (
        Number.isFinite(
            selectedPip
        ) &&
        selectedPip > 0
    ) {

        pipSize =
            selectedPip;
    }


    ticks = [];


    clearAnalysis();


    setText(
        marketName,
        name
    );


    setText(
        signalTitle,
        name
    );


    setText(
        signalExplanation,
        `Requesting tick history for ${symbol}...`
    );


    setText(
        statusText,
        `Loading ${symbol}...`
    );


    subscribeToMarket(
        symbol
    );
}


/* =====================================================
   SUBSCRIBE
===================================================== */

function subscribeToMarket(
    symbol
) {

    if (
        !connected ||
        !ws ||
        ws.readyState !==
            WebSocket.OPEN
    ) {

        console.warn(
            "Cannot subscribe: not connected."
        );

        return;
    }


    /*
    Forget previous subscription.
    */

    if (
        currentSubscriptionId
    ) {

        send({

            forget:
                currentSubscriptionId,

            req_id:
                nextRequestId()
        });


        currentSubscriptionId =
            null;
    }


    ticks = [];


    const count =
        getTickLimit();


    /*
    HISTORY
    */

    const historyRequest = {

        ticks_history:
            symbol,

        count:
            count,

        end:
            "latest",

        style:
            "ticks",

        req_id:
            nextRequestId()
    };


    console.log(
        "Requesting history:",
        historyRequest
    );


    send(
        historyRequest
    );


    /*
    LIVE SUBSCRIPTION
    */

    const tickRequest = {

        ticks:
            symbol,

        subscribe:
            1,

        req_id:
            nextRequestId()
    };


    console.log(
        "Subscribing to ticks:",
        tickRequest
    );


    send(
        tickRequest
    );


    setText(
        tickStatus,
        "Waiting for ticks..."
    );
}


/* =====================================================
   HISTORY
===================================================== */

function processHistory(
    data
) {

    if (!data.history) {

        console.warn(
            "No history object:",
            data
        );

        return;
    }


    /*
    Update pip size if Deriv supplies it.
    */

    const historyPip =
        Number(
            data.history.pip_size ??
            data.history.pip
        );


    if (
        Number.isFinite(
            historyPip
        ) &&
        historyPip > 0
    ) {

        pipSize =
            historyPip;
    }


    const prices =
        Array.isArray(
            data.history.prices
        )
            ? data.history.prices
            : [];


    const times =
        Array.isArray(
            data.history.times
        )
            ? data.history.times
            : [];


    console.log(
        "History ticks:",
        prices.length
    );


    if (!prices.length) {

        setText(
            tickStatus,
            "0 ticks"
        );


        setText(
            signalExplanation,
            "Deriv returned no tick history for this market."
        );


        return;
    }


    ticks = [];


    for (
        let i = 0;
        i < prices.length;
        i++
    ) {

        const price =
            Number(
                prices[i]
            );


        if (
            !Number.isFinite(
                price
            )
        ) {

            continue;
        }


        const digit =
            getLastDigit(
                price
            );


        if (
            digit === null ||
            !Number.isInteger(
                digit
            )
        ) {

            continue;
        }


        ticks.push({

            price:
                price,

            digit:
                digit,

            epoch:
                Number(
                    times[i]
                ) ||
                Date.now() / 1000
        });
    }


    limitTicks();


    updateDisplay();

    analyze();


    setText(
        statusText,
        `Live • ${ticks.length} ticks`
    );


    setText(
        signalExplanation,
        `${ticks.length} historical ticks loaded. Waiting for live ticks...`
    );
}


/* =====================================================
   LIVE TICK
===================================================== */

function processTick(
    data
) {

    if (!data.tick) {

        return;
    }


    const price =
        Number(
            data.tick.quote
        );


    if (
        !Number.isFinite(
            price
        )
    ) {

        console.warn(
            "Invalid tick:",
            data.tick
        );

        return;
    }


    /*
    Update pip size when supplied.
    */

    const tickPip =
        Number(
            data.tick.pip_size ??
            data.tick.pip
        );


    if (
        Number.isFinite(
            tickPip
        ) &&
        tickPip > 0
    ) {

        pipSize =
            tickPip;
    }


    const digit =
        getLastDigit(
            price,
            tickPip > 0
                ? tickPip
                : null
        );


    if (
        digit === null
    ) {

        return;
    }


    ticks.push({

        price:
            price,

        digit:
            digit,

        epoch:
            Number(
                data.tick.epoch
            ) ||
            Date.now() / 1000
    });


    limitTicks();


    if (
        data.subscription &&
        data.subscription.id
    ) {

        currentSubscriptionId =
            data.subscription.id;
    }


    updateDisplay();

    analyze();


    setText(
        statusText,
        `LIVE • ${ticks.length} ticks`
    );
}


/* =====================================================
   LIMIT TICKS
===================================================== */

function limitTicks() {

    const limit =
        getTickLimit();


    if (
        ticks.length > limit
    ) {

        ticks =
            ticks.slice(
                -limit
            );
    }
}


/* =====================================================
   =====================================================
   ADVANCED ANALYSIS ENGINE
   =====================================================
===================================================== */


/*
=========================================================
GET ANALYSIS WINDOW
=========================================================
*/

function getAnalysisWindow(
    size
) {

    if (
        ticks.length <= size
    ) {

        return ticks.slice();
    }


    return ticks.slice(
        -size
    );
}


/*
=========================================================
GET DIGIT COUNTS
=========================================================
*/

function getDigitCounts(
    data
) {

    const counts =
        Array(10).fill(0);


    data.forEach(
        tick => {

            const digit =
                Number(
                    tick.digit
                );


            if (
                Number.isInteger(
                    digit
                ) &&
                digit >= 0 &&
                digit <= 9
            ) {

                counts[digit]++;
            }
        }
    );


    return counts;
}


/*
=========================================================
DIGIT FREQUENCY
=========================================================
*/

function getDigitFrequency(
    data,
    digit
) {

    if (!data.length) {

        return 0;
    }


    const matches =
        data.filter(
            tick =>
                tick.digit ===
                digit
        ).length;


    return (
        matches /
        data.length
    ) * 100;
}


/*
=========================================================
GET CONDITION RATE
=========================================================
*/

function getConditionRate(
    data,
    condition
) {

    if (!data.length) {

        return 0;
    }


    const wins =
        data.filter(
            condition
        ).length;


    return (
        wins /
        data.length
    ) * 100;
}


/*
=========================================================
STATISTICS
=========================================================
*/

function getStatistics(
    condition
) {

    const long =
        getAnalysisWindow(
            ANALYSIS_CONFIG.LONG_WINDOW
        );


    const medium =
        getAnalysisWindow(
            ANALYSIS_CONFIG.MEDIUM_WINDOW
        );


    const short =
        getAnalysisWindow(
            ANALYSIS_CONFIG.SHORT_WINDOW
        );


    const longRate =
        getConditionRate(
            long,
            condition
        );


    const mediumRate =
        getConditionRate(
            medium,
            condition
        );


    const shortRate =
        getConditionRate(
            short,
            condition
        );


    const weightedRate =
        (
            longRate *
            ANALYSIS_CONFIG.LONG_WEIGHT
        ) +

        (
            mediumRate *
            ANALYSIS_CONFIG.MEDIUM_WEIGHT
        ) +

        (
            shortRate *
            ANALYSIS_CONFIG.SHORT_WEIGHT
        );


    return {

        long,

        medium,

        short,

        longRate,

        mediumRate,

        shortRate,

        weightedRate,

        sampleSize:
            ticks.length
    };
}


/*
=========================================================
BINOMIAL Z SCORE

Measures how far observed frequency is from expected
frequency relative to normal sampling variation.
=========================================================
*/

function getZScore(
    observedRate,
    expectedRate,
    sampleSize
) {

    if (
        sampleSize <= 0
    ) {

        return 0;
    }


    const p =
        expectedRate / 100;


    const observed =
        observedRate / 100;


    /*
    Boundary cases.
    */

    if (
        p <= 0
    ) {

        return observed > 0
            ? Math.sqrt(
                sampleSize
            )
            : 0;
    }


    if (
        p >= 1
    ) {

        return observed < 1
            ? -Math.sqrt(
                sampleSize
            )
            : 0;
    }


    const standardError =
        Math.sqrt(
            (
                p *
                (1 - p)
            ) /
            sampleSize
        );


    if (
        standardError <= 0
    ) {

        return 0;
    }


    return (
        (
            observed -
            p
        ) /
        standardError
    );
}


/*
=========================================================
CONSISTENCY

100 = windows almost identical
0 = windows strongly disagree
=========================================================
*/

function calculateConsistency(
    rates
) {

    if (
        !rates.length
    ) {

        return 0;
    }


    const average =
        rates.reduce(
            (
                total,
                value
            ) =>
                total + value,
            0
        ) /
        rates.length;


    const deviation =
        rates.reduce(
            (
                total,
                value
            ) =>
                total +
                Math.abs(
                    value -
                    average
                ),
            0
        ) /
        rates.length;


    return clamp(
        100 -
        (
            deviation *
            6
        ),
        0,
        100
    );
}


/*
=========================================================
AGREEMENT

Measures how many windows are above the expected baseline.
For an actual signal, at least two windows should agree.
=========================================================
*/

function calculateAgreement(
    rates,
    expected
) {

    if (
        !rates.length
    ) {

        return 0;
    }


    const tolerance =
        1;


    const agreeing =
        rates.filter(
            rate =>
                rate >
                expected +
                tolerance
        ).length;


    return (
        agreeing /
        rates.length
    ) * 100;
}


/*
=========================================================
MINIMUM EDGE

The observed condition should be meaningfully above its
mathematical baseline.
=========================================================
*/

function getMinimumEdge(
    expected
) {

    return clamp(
        expected * 0.05,
        2,
        5
    );
}


/*
=========================================================
SIGNAL QUALITY
=========================================================
*/

function getSignalQuality(
    confidence
) {

    if (
        confidence >= 70
    ) {

        return "STRONG";
    }


    if (
        confidence >= 60
    ) {

        return "MODERATE";
    }


    if (
        confidence >= 55
    ) {

        return "WEAK";
    }


    return "NO SIGNAL";
}


/*
=========================================================
BUILD CONFIDENCE

This deliberately does NOT treat raw percentage as
confidence.

It combines:

1. Statistical evidence
2. Edge above expected probability
3. Consistency
4. Window agreement
5. Sample reliability
6. Positive momentum
=========================================================
*/

function buildConfidence(
    stats,
    expected
) {

    const {

        longRate,

        mediumRate,

        shortRate,

        weightedRate,

        sampleSize

    } = stats;


    const edge =
        weightedRate -
        expected;


    /*
    Only positive edge is considered
    a trade-supporting signal.
    */

    const positiveEdge =
        Math.max(
            0,
            edge
        );


    /*
    Z scores.
    */

    const longZ =
        getZScore(
            longRate,
            expected,
            stats.long.length
        );


    const mediumZ =
        getZScore(
            mediumRate,
            expected,
            stats.medium.length
        );


    const shortZ =
        getZScore(
            shortRate,
            expected,
            stats.short.length
        );


    /*
    Weighted statistical evidence.
    */

    const weightedZ =
        (
            longZ *
            ANALYSIS_CONFIG.LONG_WEIGHT
        ) +

        (
            mediumZ *
            ANALYSIS_CONFIG.MEDIUM_WEIGHT
        ) +

        (
            shortZ *
            ANALYSIS_CONFIG.SHORT_WEIGHT
        );


    /*
    Only positive evidence helps the signal.
    */

    const positiveZ =
        Math.max(
            0,
            weightedZ
        );


    /*
    Consistency.
    */

    const consistency =
        calculateConsistency([
            longRate,
            mediumRate,
            shortRate
        ]);


    /*
    Agreement.
    */

    const agreement =
        calculateAgreement(
            [
                longRate,
                mediumRate,
                shortRate
            ],
            expected
        );


    /*
    Momentum.

    Positive = condition became more frequent
    in the recent window.
    */

    const momentum =
        shortRate -
        longRate;


    const positiveMomentum =
        Math.max(
            0,
            momentum
        );


    /*
    SCORE COMPONENTS
    */

    const evidenceScore =
        clamp(
            positiveZ * 7,
            0,
            28
        );


    const edgeScore =
        clamp(
            positiveEdge *
            (
                expected <= 10
                    ? 1.1
                    : 0.8
            ),
            0,
            16
        );


    const consistencyScore =
        consistency *
        0.15;


    const agreementScore =
        agreement *
        0.12;


    const sampleScore =
        clamp(
            mapRange(
                sampleSize,
                30,
                500,
                0,
                10
            ),
            0,
            10
        );


    const momentumScore =
        clamp(
            positiveMomentum *
            0.4,
            0,
            8
        );


    /*
    Start conservative.
    */

    let confidence =
        20 +

        evidenceScore +

        edgeScore +

        consistencyScore +

        agreementScore +

        sampleScore +

        momentumScore;


    /*
    No positive edge = no strong signal.
    */

    if (
        edge <= 0
    ) {

        confidence =
            Math.min(
                confidence,
                45
            );
    }


    /*
    Insufficient sample penalty.
    */

    if (
        sampleSize < 100
    ) {

        confidence -=
            10;
    }


    /*
    Weak agreement penalty.
    */

    if (
        agreement < 66.7
    ) {

        confidence -=
            8;
    }


    /*
    Low consistency penalty.
    */

    if (
        consistency < 50
    ) {

        confidence -=
            8;
    }


    confidence =
        clamp(
            confidence,
            0,
            ANALYSIS_CONFIG.MAX_CONFIDENCE
        );


    return {

        confidence,

        expected,

        weightedRate,

        edge,

        longRate,

        mediumRate,

        shortRate,

        momentum,

        consistency,

        agreement,

        weightedZ,

        longZ,

        mediumZ,

        shortZ,

        sampleSize,

        quality:
            getSignalQuality(
                confidence
            )
    };
}


/*
=========================================================
ENTRY DECISION
=========================================================
*/

function getEntryDecision(
    result
) {

    const required =
        Math.max(
            ANALYSIS_CONFIG.MIN_ENTRY_CONFIDENCE,
            getThreshold()
        );


    const minimumEdge =
        getMinimumEdge(
            result.expected
        );


    const conditions = {

        enoughTicks:
            result.sampleSize >=
            ANALYSIS_CONFIG.MIN_ENTRY_TICKS,

        confidence:
            result.confidence >=
            required,

        positiveEdge:
            result.edge >=
            minimumEdge,

        recentAboveBaseline:
            result.shortRate >
            result.expected,

        agreement:
            result.agreement >=
            ANALYSIS_CONFIG.MIN_AGREEMENT,

        consistency:
            result.consistency >=
            ANALYSIS_CONFIG.MIN_CONSISTENCY,

        evidence:
            result.weightedZ >=
            ANALYSIS_CONFIG.MIN_EVIDENCE_Z
    };


    const entry =
        Object.values(
            conditions
        ).every(
            Boolean
        );


    return {

        entry,

        required,

        minimumEdge,

        conditions
    };
}


/*
=========================================================
BUILD EXPLANATION
=========================================================
*/

function buildExplanation(
    result
) {

    const edgeText =
        result.edge >= 0
            ? `+${result.edge.toFixed(1)} pts`
            : `${result.edge.toFixed(1)} pts`;


    const momentumText =
        result.momentum >= 0
            ? `+${result.momentum.toFixed(1)} pts`
            : `${result.momentum.toFixed(1)} pts`;


    return [

        `Expected baseline: ${result.expected.toFixed(1)}%.`,

        `Observed weighted rate: ${result.weightedRate.toFixed(1)}% (${edgeText}).`,

        `Long ${result.longRate.toFixed(1)}% • 100-tick ${result.mediumRate.toFixed(1)}% • 30-tick ${result.shortRate.toFixed(1)}%.`,

        `Momentum: ${momentumText}.`,

        `Window agreement: ${result.agreement.toFixed(0)}% • Consistency: ${result.consistency.toFixed(0)}%.`,

        `Statistical evidence: Z ${result.weightedZ.toFixed(2)}.`,

        `Sample: ${result.sampleSize} ticks.`,

        `Signal quality: ${result.quality}.`

    ].join(" ");
}


/*
=========================================================
ANALYZE CONDITION
=========================================================
*/

function analyzeCondition(
    model
) {

    const stats =
        getStatistics(
            model.condition
        );


    const result =
        buildConfidence(
            stats,
            model.expected
        );


    const finalResult = {

        ...result,

        display:
            model.display,

        title:
            model.title,

        type:
            model.type,

        explanation:
            buildExplanation(
                result
            )
    };


    const decision =
        getEntryDecision(
            finalResult
        );


    finalResult.entry =
        decision.entry;


    finalResult.required =
        decision.required;


    finalResult.minimumEdge =
        decision.minimumEdge;


    finalResult.entryConditions =
        decision.conditions;


    return finalResult;
}


/* =====================================================
   MATCH MODEL
===================================================== */

function createMatchModel(
    digit
) {

    return {

        type:
            "MATCH",

        expected:
            10,

        display:
            String(digit),

        title:
            `MATCH ${digit}`,

        condition:
            tick =>
                tick.digit ===
                digit
    };
}


/* =====================================================
   FIND BEST MATCH DIGIT
===================================================== */

function calculateMatch() {

    /*
    Analyze every digit independently.
    */

    const candidates =
        [];


    for (
        let digit = 0;
        digit <= 9;
        digit++
    ) {

        const result =
            analyzeCondition(
                createMatchModel(
                    digit
                )
            );


        candidates.push(
            result
        );
    }


    /*
    Prefer the strongest positive edge.

    Statistical evidence and recent momentum
    help break ties.
    */

    candidates.sort(
        (a, b) => {

            const scoreA =

                (
                    Math.max(
                        0,
                        a.edge
                    ) *
                    2
                ) +

                (
                    Math.max(
                        0,
                        a.weightedZ
                    ) *
                    3
                ) +

                (
                    Math.max(
                        0,
                        a.momentum
                    ) *
                    0.4
                );


            const scoreB =

                (
                    Math.max(
                        0,
                        b.edge
                    ) *
                    2
                ) +

                (
                    Math.max(
                        0,
                        b.weightedZ
                    ) *
                    3
                ) +

                (
                    Math.max(
                        0,
                        b.momentum
                    ) *
                    0.4
                );


            return scoreB - scoreA;
        }
    );


    const best =
        candidates[0];


    /*
    Make sure the display is still the
    selected digit even if there is no signal.
    */

    return {

        ...best,

        title:
            `MATCH ${best.display}`,

        explanation:
            `Digit ${best.display} analysis. ${best.explanation}`
    };
}


/* =====================================================
   DIFFERS
===================================================== */

function calculateDiffers(
    selectedDigit
) {

    const model = {

        type:
            "DIFFERS",

        expected:
            90,

        display:
            `≠${selectedDigit}`,

        title:
            `DIFFERS ${selectedDigit}`,

        condition:
            tick =>
                tick.digit !==
                selectedDigit
    };


    return analyzeCondition(
        model
    );
}


/* =====================================================
   OVER
===================================================== */

function calculateOver(
    selectedBarrier
) {

    /*
    Digits above barrier:

    OVER 0 = 90%
    OVER 1 = 80%
    OVER 2 = 70%
    OVER 3 = 60%
    OVER 4 = 50%
    OVER 5 = 40%
    OVER 6 = 30%
    OVER 7 = 20%
    OVER 8 = 10%
    OVER 9 = 0%
    */

    const expected =
        (
            9 -
            selectedBarrier
        ) /
        10 *
        100;


    const model = {

        type:
            "OVER",

        expected:
            expected,

        display:
            `>${selectedBarrier}`,

        title:
            `OVER ${selectedBarrier}`,

        condition:
            tick =>
                tick.digit >
                selectedBarrier
    };


    return analyzeCondition(
        model
    );
}


/* =====================================================
   UNDER
===================================================== */

function calculateUnder(
    selectedBarrier
) {

    /*
    UNDER 0 = 0%
    UNDER 1 = 10%
    UNDER 2 = 20%
    UNDER 3 = 30%
    UNDER 4 = 40%
    UNDER 5 = 50%
    UNDER 6 = 60%
    UNDER 7 = 70%
    UNDER 8 = 80%
    UNDER 9 = 90%
    */

    const expected =
        (
            selectedBarrier
        ) /
        10 *
        100;


    const model = {

        type:
            "UNDER",

        expected:
            expected,

        display:
            `<${selectedBarrier}`,

        title:
            `UNDER ${selectedBarrier}`,

        condition:
            tick =>
                tick.digit <
                selectedBarrier
    };


    return analyzeCondition(
        model
    );
}


/* =====================================================
   EVEN
===================================================== */

function calculateEven() {

    const model = {

        type:
            "EVEN",

        expected:
            50,

        display:
            "EVEN",

        title:
            "EVEN",

        condition:
            tick =>
                tick.digit % 2 ===
                0
    };


    return analyzeCondition(
        model
    );
}


/* =====================================================
   ODD
===================================================== */

function calculateOdd() {

    const model = {

        type:
            "ODD",

        expected:
            50,

        display:
            "ODD",

        title:
            "ODD",

        condition:
            tick =>
                tick.digit % 2 !==
                0
    };


    return analyzeCondition(
        model
    );
}


/* =====================================================
   APPLY ANALYSIS RESULT
===================================================== */

function applyAnalysisResult(
    result
) {

    if (!result) {

        return;
    }


    const confidence =
        clamp(
            Number(
                result.confidence
            ) || 0,
            0,
            ANALYSIS_CONFIG.MAX_CONFIDENCE
        );


    setText(
        bestConfidence,
        confidence.toFixed(1)
    );


    if (confidenceBar) {

        confidenceBar.style.width =
            `${confidence}%`;
    }


    setText(
        bestDigit,
        result.display
    );


    setText(
        signalTitle,
        result.title
    );


    setText(
        signalExplanation,
        result.explanation
    );


    /*
    IMPORTANT:
    Entry is NOT based on confidence alone.
    All entry filters must pass.
    */

    if (
        result.entry
    ) {

        setText(
            entryStatus,
            `🟢 ENTRY CONDITION MET • ${result.quality}`
        );


        entryStatus?.classList.remove(
            "waiting"
        );


        entryStatus?.classList.add(
            "ready"
        );

    } else {

        /*
        Distinguish between not enough data
        and a weak signal.
        */

        if (
            result.sampleSize <
            ANALYSIS_CONFIG.MIN_ENTRY_TICKS
        ) {

            setText(
                entryStatus,
                `⏳ WAITING FOR MORE DATA • ${result.sampleSize}/${ANALYSIS_CONFIG.MIN_ENTRY_TICKS} ticks`
            );

        } else {

            setText(
                entryStatus,
                "⛔ NO TRADE — SIGNAL FILTER FAILED"
            );
        }


        entryStatus?.classList.remove(
            "ready"
        );


        entryStatus?.classList.add(
            "waiting"
        );
    }
}


/* =====================================================
   MAIN ANALYZE
===================================================== */

function analyze() {

    if (!ticks.length) {

        clearSignalOnly();

        return;
    }


    /*
    Not enough ticks for the multi-window
    system.
    */

    if (
        ticks.length <
        ANALYSIS_CONFIG.MIN_ANALYSIS_TICKS
    ) {

        const remaining =
            ANALYSIS_CONFIG.MIN_ANALYSIS_TICKS -
            ticks.length;


        setText(
            bestConfidence,
            "0.0"
        );


        if (confidenceBar) {

            confidenceBar.style.width =
                "0%";
        }


        setText(
            bestDigit,
            "-"
        );


        setText(
            signalTitle,
            "Collecting data..."
        );


        setText(
            signalExplanation,
            `${ticks.length} ticks available. Need ${remaining} more tick${remaining === 1 ? "" : "s"} before advanced analysis.`
        );


        setText(
            entryStatus,
            "⏳ WAITING FOR DATA"
        );


        entryStatus?.classList.remove(
            "ready"
        );


        entryStatus?.classList.add(
            "waiting"
        );


        return;
    }


    let result;


    /*
    Special DIFFERS mode.

    Existing UI behavior preserved:
    if mode = diff and type = MATCH,
    analyze DIFFERS using barrier.
    */

    if (
        currentMode === "diff" &&
        currentType === "MATCH"
    ) {

        result =
            calculateDiffers(
                getBarrier()
            );

    } else {

        switch (
            currentType
        ) {

            case "MATCH":

                result =
                    calculateMatch();

                break;


            case "OVER":

                result =
                    calculateOver(
                        getBarrier()
                    );

                break;


            case "UNDER":

                result =
                    calculateUnder(
                        getBarrier()
                    );

                break;


            case "EVEN":

                result =
                    calculateEven();

                break;


            case "ODD":

                result =
                    calculateOdd();

                break;


            default:

                result =
                    calculateMatch();
        }
    }


    applyAnalysisResult(
        result
    );
}


/* =====================================================
   DIGIT GRID
===================================================== */

function updateDigitGrid() {

    if (!digitGrid) {

        return;
    }


    const counts =
        getDigitCounts(
            ticks
        );


    const total =
        ticks.length;


    digitGrid.innerHTML =
        "";


    for (
        let digit = 0;
        digit <= 9;
        digit++
    ) {

        const percentage =
            total
                ? (
                    counts[digit] /
                    total
                ) * 100
                : 0;


        const box =
            document.createElement(
                "div"
            );


        box.className =
            "digit-item";


        /*
        Hot threshold is now based on
        expected 10%, rather than arbitrary
        frequency alone.

        15%+ = noticeably above baseline.
        */

        if (
            percentage >= 15
        ) {

            box.classList.add(
                "hot"
            );
        }


        box.innerHTML = `
            <div class="digit-number">
                ${digit}
            </div>

            <div class="digit-percent">
                ${percentage.toFixed(1)}%
            </div>
        `;


        digitGrid.appendChild(
            box
        );
    }
}


/* =====================================================
   RECENT DIGITS
===================================================== */

function updateRecentDigits() {

    if (!recentDigits) {

        return;
    }


    recentDigits.innerHTML =
        "";


    ticks
        .slice(-20)
        .forEach(
            tick => {

                const item =
                    document.createElement(
                        "div"
                    );


                item.className =
                    "recent-digit";


                item.textContent =
                    String(
                        tick.digit
                    );


                recentDigits.appendChild(
                    item
                );
            }
        );
}


/* =====================================================
   DISPLAY
===================================================== */

function updateDisplay() {

    if (!ticks.length) {

        return;
    }


    const latest =
        ticks[
            ticks.length - 1
        ];


    setText(
        livePrice,
        formatPrice(
            latest.price
        )
    );


    setText(
        lastDigit,
        String(
            latest.digit
        )
    );


    setText(
        tickStatus,
        `${ticks.length} ticks`
    );


    updateRecentDigits();

    updateDigitGrid();
}


/* =====================================================
   CLEAR SIGNAL
===================================================== */

function clearSignalOnly() {

    setText(
        bestDigit,
        "-"
    );


    setText(
        bestConfidence,
        "0.0"
    );


    if (confidenceBar) {

        confidenceBar.style.width =
            "0%";
    }
}


/* =====================================================
   CLEAR ANALYSIS
===================================================== */

function clearAnalysis() {

    clearSignalOnly();


    setText(
        livePrice,
        "-"
    );


    setText(
        lastDigit,
        "-"
    );


    setText(
        tickStatus,
        "0 ticks"
    );


    setText(
        entryStatus,
        "⏳ WAITING FOR DATA"
    );


    entryStatus?.classList.remove(
        "ready"
    );


    entryStatus?.classList.add(
        "waiting"
    );


    if (digitGrid) {

        digitGrid.innerHTML =
            "";
    }


    if (recentDigits) {

        recentDigits.innerHTML =
            "";
    }
}


/* =====================================================
   AUTO SCAN
===================================================== */

function startAutoScan() {

    stopAutoScan();


    autoScanTimer =
        setInterval(
            () => {

                if (
                    connected &&
                    currentSymbol &&
                    ticks.length
                ) {

                    analyze();
                }

            },
            3000
        );
}


function stopAutoScan() {

    if (autoScanTimer) {

        clearInterval(
            autoScanTimer
        );

        autoScanTimer = null;
    }
}


/* =====================================================
   CLOSE
===================================================== */

function handleClose(
    event
) {

    console.warn(
        "Deriv WebSocket closed:",
        event.code,
        event.reason ||
            "(no reason)"
    );


    connected = false;

    connecting = false;


    stopPing();


    currentSubscriptionId =
        null;


    updateConnectionUI(
        "offline",
        manualDisconnect
            ? "Disconnected"
            : "Disconnected — retrying..."
    );


    resetConnectButton();


    if (
        manualDisconnect
    ) {

        setText(
            signalTitle,
            "Disconnected"
        );


        setText(
            signalExplanation,
            "Scanner disconnected."
        );


        return;
    }


    setText(
        signalTitle,
        "Reconnecting..."
    );


    setText(
        signalExplanation,
        "Connection closed. Retrying in 5 seconds..."
    );


    scheduleReconnect();
}


/* =====================================================
   RECONNECT
===================================================== */

function scheduleReconnect() {

    if (reconnectTimer) {

        return;
    }


    reconnectTimer =
        setTimeout(
            () => {

                reconnectTimer =
                    null;


                if (
                    !connected &&
                    !connecting &&
                    !manualDisconnect
                ) {

                    connectDeriv();
                }

            },
            RECONNECT_DELAY
        );
}


/* =====================================================
   ERROR
===================================================== */

function handleError(
    error
) {

    console.error(
        "Deriv WebSocket error:",
        error
    );


    updateConnectionUI(
        "offline",
        "WebSocket connection error"
    );


    setText(
        signalExplanation,
        "Unable to establish the Deriv WebSocket connection. Check the browser console."
    );
}


/* =====================================================
   RESET BUTTON
===================================================== */

function resetConnectButton() {

    if (!connectBtn) {

        return;
    }


    connectBtn.disabled =
        false;


    connectBtn.textContent =
        connected
            ? "🔌 Disconnect"
            : "⚡ Connect Scanner";
}


/* =====================================================
   DISCONNECT
===================================================== */

function disconnectDeriv() {

    manualDisconnect = true;


    stopAutoScan();

    stopPing();


    if (reconnectTimer) {

        clearTimeout(
            reconnectTimer
        );

        reconnectTimer = null;
    }


    if (
        currentSubscriptionId &&
        ws &&
        ws.readyState ===
            WebSocket.OPEN
    ) {

        send({

            forget:
                currentSubscriptionId,

            req_id:
                nextRequestId()
        });
    }


    currentSubscriptionId =
        null;


    if (ws) {

        try {

            ws.close(
                1000,
                "User disconnected"
            );

        } catch (error) {

            console.warn(
                error
            );
        }
    }


    ws = null;

    connected = false;

    connecting = false;


    updateConnectionUI(
        "offline",
        "Disconnected"
    );


    resetConnectButton();
}


/* =====================================================
   BUTTON EVENTS
===================================================== */

if (connectBtn) {

    connectBtn.addEventListener(
        "click",
        () => {

            if (connected) {

                disconnectDeriv();

            } else {

                connectDeriv();
            }
        }
    );
}


if (marketSelect) {

    marketSelect.addEventListener(
        "change",
        handleMarketChange
    );
}


if (scanBtn) {

    scanBtn.addEventListener(
        "click",
        () => {

            if (!ticks.length) {

                setText(
                    signalExplanation,
                    "Waiting for tick data..."
                );

                return;
            }


            analyze();
        }
    );
}


if (autoScan) {

    autoScan.addEventListener(
        "change",
        () => {

            if (
                autoScan.checked
            ) {

                startAutoScan();

            } else {

                stopAutoScan();
            }
        }
    );
}


/* =====================================================
   MODE BUTTONS
===================================================== */

document
    .querySelectorAll(
        ".mode"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll(
                            ".mode"
                        )
                        .forEach(
                            item =>
                                item.classList.remove(
                                    "active"
                                )
                        );


                    button.classList.add(
                        "active"
                    );


                    currentMode =
                        button.dataset.mode ||
                        "match";


                    analyze();
                }
            );
        }
    );


/* =====================================================
   SIGNAL TYPE BUTTONS
===================================================== */

document
    .querySelectorAll(
        ".type-button"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll(
                            ".type-button"
                        )
                        .forEach(
                            item =>
                                item.classList.remove(
                                    "active"
                                )
                        );


                    button.classList.add(
                        "active"
                    );


                    currentType =
                        button.dataset.type ||
                        "MATCH";


                    analyze();
                }
            );
        }
    );


/* =====================================================
   SETTINGS
===================================================== */

if (threshold) {

    threshold.addEventListener(
        "input",
        analyze
    );


    threshold.addEventListener(
        "change",
        analyze
    );
}


if (barrier) {

    barrier.addEventListener(
        "input",
        analyze
    );


    barrier.addEventListener(
        "change",
        analyze
    );
}


if (tickCount) {

    tickCount.addEventListener(
        "change",
        () => {

            if (
                connected &&
                currentSymbol
            ) {

                subscribeToMarket(
                    currentSymbol
                );
            }
        }
    );
}


/* =====================================================
   INITIALIZE
===================================================== */

console.log(
    "======================================"
);


console.log(
    "DERIV PRO SIGNAL SCANNER"
);


console.log(
    "Advanced analysis only"
);


console.log(
    "NO AUTOMATIC TRADING"
);


console.log(
    "Deriv endpoint:",
    DERIV_WS
);


console.log(
    "Analysis windows:",
    "30 / 100 / 1000"
);


console.log(
    "======================================"
);


updateConnectionUI(
    "offline",
    "Ready to connect"
);
