"use strict";

/*
=========================================================
DERIV PRO SIGNAL SCANNER
ANALYSIS ONLY - NO AUTOMATIC TRADING

Uses Deriv public WebSocket market data.

IMPORTANT:
The confidence value is a statistical/technical
signal-quality score.

It is NOT a guaranteed probability of winning
the next contract.

The scanner deliberately produces NO TRADE when
the evidence is not strong enough.
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


/* =====================================================
   ADVANCED ANALYSIS CONFIG
===================================================== */

const ANALYSIS_CONFIG = {

    /*
    Analysis windows
    */

    LONG_WINDOW: 1000,

    MEDIUM_WINDOW: 100,

    SHORT_WINDOW: 30,


    /*
    Recent data receives more weight.
    */

    LONG_WEIGHT: 0.20,

    MEDIUM_WEIGHT: 0.30,

    SHORT_WEIGHT: 0.50,


    /*
    Minimum data before analysis.
    */

    MIN_ANALYSIS_TICKS: 30,


    /*
    Minimum data before an entry can
    ever be approved.
    */

    MIN_ENTRY_TICKS: 100,


    /*
    Minimum confidence regardless
    of the user's selected threshold.
    */

    MIN_ENTRY_CONFIDENCE: 60,


    /*
    Minimum quality requirements.
    */

    MIN_CONSISTENCY: 50,

    MIN_AGREEMENT: 66.7,

    MIN_EVIDENCE_Z: 1.5,


    /*
    Maximum displayed confidence.
    */

    MAX_CONFIDENCE: 95
};


/* =====================================================
   FALLBACK MARKETS
===================================================== */

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


const marketSelect = $("marketSelect");

const tickCount = $("tickCount");

const threshold = $("threshold");

const barrier = $("barrier");

const connectBtn = $("connectBtn");

const scanBtn = $("scanBtn");

const autoScan = $("autoScan");

const connectionDot = $("connectionDot");

const statusText = $("statusText");

const liveBadge = $("liveBadge");

const signalTitle = $("signalTitle");

const bestDigit = $("bestDigit");

const bestConfidence = $("bestConfidence");

const confidenceBar = $("confidenceBar");

const signalExplanation = $("signalExplanation");

const entryStatus = $("entryStatus");

const tickStatus = $("tickStatus");

const livePrice = $("livePrice");

const lastDigit = $("lastDigit");

const marketName = $("marketName");

const digitGrid = $("digitGrid");

const recentDigits = $("recentDigits");


/* =====================================================
   BASIC HELPERS
===================================================== */

function setText(element, value) {

    if (element) {
        element.textContent = value;
    }
}


function number(value, fallback = 0) {

    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;
}


function nextRequestId() {

    return requestId++;
}


function clamp(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );
}


function mapRange(
    value,
    inMin,
    inMax,
    outMin,
    outMax
) {

    if (inMax === inMin) {
        return outMin;
    }

    const ratio =
        (value - inMin) /
        (inMax - inMin);

    return (
        outMin +
        ratio *
        (outMax - outMin)
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
                65
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
   PRICE / PIP
===================================================== */

function decimalPlacesFromPip(pip) {

    const p = Number(pip);

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


function formatPrice(price) {

    const places =
        decimalPlacesFromPip(
            pipSize
        );

    return Number(price).toFixed(
        places
    );
}


/* =====================================================
   LAST DIGIT
===================================================== */

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

    const parts =
        formatted.split(".");

    if (parts.length < 2) {

        const integer =
            formatted.replace(
                /\D/g,
                ""
            );

        if (!integer) {
            return null;
        }

        return Number(
            integer[
                integer.length - 1
            ]
        );
    }

    const decimal =
        parts[1];

    if (!decimal) {
        return null;
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

        if (state === "online") {

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
   SEND
===================================================== */

function send(data) {

    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
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

        connectBtn.disabled = true;

        connectBtn.textContent =
            "⏳ Connecting...";
    }

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

    connected = true;

    connecting = false;

    updateConnectionUI(
        "online",
        "Connected to Deriv"
    );

    if (connectBtn) {

        connectBtn.disabled = false;

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

function handleMessage(event) {

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


    if (data.error) {

        handleApiError(data);

        return;
    }


    if (
        data.msg_type ===
        "active_symbols"
    ) {

        handleActiveSymbols(data);

        return;
    }


    if (
        data.msg_type ===
        "history"
    ) {

        processHistory(data);

        return;
    }


    if (
        data.msg_type ===
        "tick"
    ) {

        processTick(data);

        return;
    }


    if (
        data.msg_type ===
        "ping"
    ) {

        return;
    }


    if (
        data.subscription &&
        data.subscription.id
    ) {

        currentSubscriptionId =
            data.subscription.id;
    }
}


/* =====================================================
   API ERROR
===================================================== */

function handleApiError(data) {

    console.error(
        "DERIV API ERROR:",
        data.error
    );

    const errorCode =
        data.error?.code ||
        "API_ERROR";

    const errorMessage =
        data.error?.message ||
        "Deriv API error";

    setText(
        statusText,
        `${errorCode}: ${errorMessage}`
    );

    setText(
        signalExplanation,
        `${errorCode}: ${errorMessage}`
    );

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

function handleActiveSymbols(data) {

    const symbols =
        Array.isArray(
            data.active_symbols
        )
            ? data.active_symbols
            : [];

    if (!symbols.length) {

        loadFallbackMarkets();

        return;
    }

    loadMarkets(symbols);
}


/* =====================================================
   NORMALIZE MARKET
===================================================== */

function normalizeMarket(item) {

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

function loadMarkets(symbols) {

    const normalized =
        symbols
            .map(normalizeMarket)
            .filter(Boolean);


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
    If synthetic filtering finds nothing,
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
   FALLBACK MARKETS
===================================================== */

function loadFallbackMarkets() {

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


    marketSelect.innerHTML = "";


    const placeholder =
        document.createElement(
            "option"
        );


    placeholder.value = "";


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
        marketSelect.options.length - 1;


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
            ? "Testing fallback synthetic markets."
            : "Choose a market to begin analysis."
    );


    /*
    Automatically select first market.
    */

    marketSelect.selectedIndex = 1;

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


    subscribeToMarket(symbol);
}


/* =====================================================
   SUBSCRIBE
===================================================== */

function subscribeToMarket(symbol) {

    if (
        !connected ||
        !ws ||
        ws.readyState !==
            WebSocket.OPEN
    ) {

        return;
    }


    if (currentSubscriptionId) {

        send({

            forget:
                currentSubscriptionId,

            req_id:
                nextRequestId()
        });


        currentSubscriptionId = null;
    }


    ticks = [];


    const count =
        getTickLimit();


    /*
    HISTORY
    */

    send({

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
    });


    /*
    LIVE TICKS
    */

    send({

        ticks:
            symbol,

        subscribe:
            1,

        req_id:
            nextRequestId()
    });


    setText(
        tickStatus,
        "Waiting for ticks..."
    );
}


/* =====================================================
   HISTORY
===================================================== */

function processHistory(data) {

    if (!data.history) {
        return;
    }


    const historyPip =
        Number(
            data.history.pip_size ??
            data.history.pip
        );


    if (
        Number.isFinite(historyPip) &&
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


    if (!prices.length) {

        setText(
            tickStatus,
            "0 ticks"
        );

        setText(
            signalExplanation,
            "No tick history returned for this market."
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
            !Number.isFinite(price)
        ) {
            continue;
        }


        const digit =
            getLastDigit(price);


        if (
            digit === null ||
            !Number.isInteger(digit)
        ) {
            continue;
        }


        ticks.push({

            price:
                price,

            digit:
                digit,

            epoch:
                Number(times[i]) ||
                Date.now() / 1000
        });
    }


    limitTicks();

    updateDisplay();

    analyze();


    setText(
        statusText,
        `LIVE • ${ticks.length} ticks`
    );
}


/* =====================================================
   LIVE TICK
===================================================== */

function processTick(data) {

    if (!data.tick) {
        return;
    }


    const price =
        Number(
            data.tick.quote
        );


    if (
        !Number.isFinite(price)
    ) {
        return;
    }


    const tickPip =
        Number(
            data.tick.pip_size ??
            data.tick.pip
        );


    if (
        Number.isFinite(tickPip) &&
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
        digit === null ||
        !Number.isInteger(digit)
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
   ANALYSIS WINDOW
===================================================== */

function getAnalysisWindow(size) {

    if (
        ticks.length <= size
    ) {

        return ticks.slice();
    }


    return ticks.slice(
        -size
    );
}


/* =====================================================
   CONDITION RATE
===================================================== */

function getConditionRate(
    data,
    condition
) {

    if (!data.length) {
        return 0;
    }


    const successful =
        data.filter(
            condition
        ).length;


    return (
        successful /
        data.length
    ) * 100;
}


/* =====================================================
   GET STATISTICS
===================================================== */

function getStatistics(condition) {

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


/* =====================================================
   Z SCORE
===================================================== */

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


    const expected =
        expectedRate / 100;


    const observed =
        observedRate / 100;


    /*
    Special cases.
    */

    if (expected <= 0) {

        return observed > 0
            ? Math.sqrt(sampleSize)
            : 0;
    }


    if (expected >= 1) {

        return observed < 1
            ? -Math.sqrt(sampleSize)
            : 0;
    }


    const standardError =
        Math.sqrt(
            (
                expected *
                (1 - expected)
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
            expected
        ) /
        standardError
    );
}


/* =====================================================
   CONSISTENCY
===================================================== */

function calculateConsistency(rates) {

    if (!rates.length) {
        return 0;
    }


    const average =
        rates.reduce(
            (sum, value) =>
                sum + value,
            0
        ) /
        rates.length;


    const deviation =
        rates.reduce(
            (sum, value) =>
                sum +
                Math.abs(
                    value -
                    average
                ),
            0
        ) /
        rates.length;


    return clamp(
        100 -
        deviation * 6,
        0,
        100
    );
}


/* =====================================================
   AGREEMENT
===================================================== */

function calculateAgreement(
    rates,
    expected
) {

    if (!rates.length) {
        return 0;
    }


    /*
    A window must be at least
    1 percentage point above baseline.
    */

    const tolerance = 1;


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


/* =====================================================
   MINIMUM EDGE
===================================================== */

function getMinimumEdge(expected) {

    /*
    Require an edge of roughly 5% of
    the mathematical baseline.

    Never less than 2 percentage points.
    Never more than 5 points.
    */

    return clamp(
        expected * 0.05,
        2,
        5
    );
}


/* =====================================================
   SIGNAL QUALITY
===================================================== */

function getSignalQuality(confidence) {

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


/* =====================================================
   BUILD CONFIDENCE
===================================================== */

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


    /*
    IMPORTANT:

    Confidence is based on the condition
    being ABOVE its expected baseline.

    Example:

    MATCH = 10%
    DIFFERS = 90%
    EVEN = 50%
    ODD = 50%

    OVER/UNDER depend on barrier.
    */

    const edge =
        weightedRate -
        expected;


    const positiveEdge =
        Math.max(
            0,
            edge
        );


    /*
    Statistical evidence.
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

    Positive means the condition has
    become more frequent recently.
    */

    const momentum =
        shortRate -
        longRate;


    const positiveMomentum =
        Math.max(
            0,
            momentum
        );


    /* -----------------------------------------
       SCORE COMPONENTS
    ----------------------------------------- */

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
        consistency * 0.15;


    const agreementScore =
        agreement * 0.12;


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
            positiveMomentum * 0.4,
            0,
            8
        );


    /*
    Conservative starting score.
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
    If the condition is not above
    baseline, it cannot be a strong
    trade-supporting signal.
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
    Small samples are penalized.
    */

    if (
        sampleSize < 100
    ) {

        confidence -= 10;
    }


    /*
    Poor agreement penalty.
    */

    if (
        agreement < 66.7
    ) {

        confidence -= 8;
    }


    /*
    Poor consistency penalty.
    */

    if (
        consistency < 50
    ) {

        confidence -= 8;
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


/* =====================================================
   ENTRY FILTER
===================================================== */

function getEntryDecision(result) {

    /*
    User selected threshold is respected,
    but never below 60%.
    */

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
        ).every(Boolean);


    return {

        entry,

        required,

        minimumEdge,

        conditions
    };
}


/* =====================================================
   EXPLANATION
===================================================== */

function buildExplanation(result) {

    const edgeText =
        result.edge >= 0
            ? `+${result.edge.toFixed(1)} pts`
            : `${result.edge.toFixed(1)} pts`;


    const momentumText =
        result.momentum >= 0
            ? `+${result.momentum.toFixed(1)} pts`
            : `${result.momentum.toFixed(1)} pts`;


    return [

        `Expected ${result.expected.toFixed(1)}%.`,

        `Observed ${result.weightedRate.toFixed(1)}% (${edgeText}).`,

        `Long ${result.longRate.toFixed(1)}% • 100T ${result.mediumRate.toFixed(1)}% • 30T ${result.shortRate.toFixed(1)}%.`,

        `Momentum ${momentumText}.`,

        `Agreement ${result.agreement.toFixed(0)}% • Consistency ${result.consistency.toFixed(0)}%.`,

        `Evidence Z=${result.weightedZ.toFixed(2)}.`,

        `Sample ${result.sampleSize}.`,

        `Quality: ${result.quality}.`

    ].join(" ");
}


/* =====================================================
   ANALYZE CONDITION
===================================================== */

function analyzeCondition(model) {

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
            buildExplanation(result)
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

function createMatchModel(digit) {

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
                tick.digit === digit
    };
}


/* =====================================================
   MATCH ANALYSIS
===================================================== */

function calculateMatch() {

    const candidates = [];


    /*
    Analyze ALL digits, including 0.
    */

    for (
        let digit = 0;
        digit <= 9;
        digit++
    ) {

        candidates.push(
            analyzeCondition(
                createMatchModel(digit)
            )
        );
    }


    /*
    Select the digit with the strongest
    positive evidence.

    Confidence alone is not used because
    a digit can receive a high score from
    a noisy short window.
    */

    candidates.sort(
        (a, b) => {

            const scoreA =

                (
                    Math.max(
                        0,
                        a.edge
                    ) * 2
                ) +

                (
                    Math.max(
                        0,
                        a.weightedZ
                    ) * 3
                ) +

                (
                    Math.max(
                        0,
                        a.momentum
                    ) * 0.4
                );


            const scoreB =

                (
                    Math.max(
                        0,
                        b.edge
                    ) * 2
                ) +

                (
                    Math.max(
                        0,
                        b.weightedZ
                    ) * 3
                ) +

                (
                    Math.max(
                        0,
                        b.momentum
                    ) * 0.4
                );


            return scoreB - scoreA;
        }
    );


    const best =
        candidates[0];


    return {

        ...best,

        title:
            `MATCH ${best.display}`,

        explanation:
            `Digit ${best.display}. ${best.explanation}`
    };
}


/* =====================================================
   DIFFERS
===================================================== */

function calculateDiffers(
    selectedDigit
) {

    return analyzeCondition({

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
    });
}


/* =====================================================
   OVER
===================================================== */

function calculateOver(
    selectedBarrier
) {

    /*
    OVER X mathematical baselines:

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
        ) / 10 * 100;


    return analyzeCondition({

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
    });
}


/* =====================================================
   UNDER
===================================================== */

function calculateUnder(
    selectedBarrier
) {

    /*
    UNDER X mathematical baselines:

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
        selectedBarrier /
        10 * 100;


    return analyzeCondition({

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
    });
}


/* =====================================================
   EVEN
===================================================== */

function calculateEven() {

    return analyzeCondition({

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
    });
}


/* =====================================================
   ODD
===================================================== */

function calculateOdd() {

    return analyzeCondition({

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
    });
}


/* =====================================================
   APPLY RESULT
===================================================== */

function applyAnalysisResult(result) {

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
    ENTRY MUST PASS EVERY FILTER.
    */

    if (result.entry) {

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

        if (
            result.sampleSize <
            ANALYSIS_CONFIG.MIN_ENTRY_TICKS
        ) {

            setText(
                entryStatus,
                `⏳ WAITING FOR MORE DATA • ${result.sampleSize}/${ANALYSIS_CONFIG.MIN_ENTRY_TICKS}`
            );

        } else if (
            result.confidence <
            result.required
        ) {

            setText(
                entryStatus,
                `⛔ NO TRADE • CONFIDENCE ${result.confidence.toFixed(1)}% < ${result.required}%`
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
   MAIN ANALYSIS
===================================================== */

function analyze() {

    if (!ticks.length) {

        clearSignalOnly();

        return;
    }


    /*
    Need at least 30 ticks before
    calculating the advanced system.
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
    DIFF mode + MATCH button
    means DIFFERS using the barrier.
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

        switch (currentType) {

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


    applyAnalysisResult(result);
}


/* =====================================================
   DIGIT COUNTS
===================================================== */

function getDigitCounts(data) {

    const counts =
        Array(10).fill(0);


    data.forEach(
        tick => {

            const digit =
                Number(
                    tick.digit
                );


            if (
                Number.isInteger(digit) &&
                digit >= 0 &&
                digit <= 9
            ) {

                counts[digit]++;
            }
        }
    );


    return counts;
}


/* =====================================================
   DIGIT GRID
===================================================== */

function updateDigitGrid() {

    if (!digitGrid) {
        return;
    }


    const counts =
        getDigitCounts(ticks);


    const total =
        ticks.length;


    digitGrid.innerHTML = "";


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
        15% or more means the digit is
        noticeably above the 10% baseline.
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


    recentDigits.innerHTML = "";


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
        digitGrid.innerHTML = "";
    }


    if (recentDigits) {
        recentDigits.innerHTML = "";
    }
}


/* =====================================================
   AUTO SCAN
===================================================== */

function startAutoScan() {

    stopAutoScan();


    /*
    HTML says every 30 seconds,
    so use 30 seconds here.

    Live ticks still trigger analysis
    immediately.
    */

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
            30000
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

function handleClose(event) {

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


    if (manualDisconnect) {

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

function handleError(error) {

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
        "WebSocket connection error. Check the browser console."
    );
}


/* =====================================================
   RESET CONNECT BUTTON
===================================================== */

function resetConnectButton() {

    if (!connectBtn) {
        return;
    }


    connectBtn.disabled = false;


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


    currentSubscriptionId = null;


    if (ws) {

        try {

            ws.close(
                1000,
                "User disconnected"
            );

        } catch (error) {

            console.warn(error);
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
   CONNECT BUTTON
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


/* =====================================================
   MARKET SELECT
===================================================== */

if (marketSelect) {

    marketSelect.addEventListener(
        "change",
        handleMarketChange
    );
}


/* =====================================================
   SCAN BUTTON
===================================================== */

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


/* =====================================================
   AUTO SCAN
===================================================== */

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


    /*
    Start automatically because
    checkbox is checked in HTML.
    */

    if (autoScan.checked) {

        startAutoScan();
    }
}


/* =====================================================
   MODE BUTTONS
===================================================== */

document
    .querySelectorAll(".mode")
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
    .querySelectorAll(".type-button")
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
   THRESHOLD
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


/* =====================================================
   BARRIER
===================================================== */

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


/* =====================================================
   TICK COUNT
===================================================== */

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
    "ADVANCED ANALYSIS ONLY"
);

console.log(
    "NO AUTOMATIC TRADING"
);

console.log(
    "Analysis windows: 30 / 100 / 1000"
);

console.log(
    "Minimum analysis ticks:",
    ANALYSIS_CONFIG.MIN_ANALYSIS_TICKS
);

console.log(
    "Minimum entry ticks:",
    ANALYSIS_CONFIG.MIN_ENTRY_TICKS
);

console.log(
    "Minimum entry confidence:",
    ANALYSIS_CONFIG.MIN_ENTRY_CONFIDENCE
);

console.log(
    "Deriv endpoint:",
    DERIV_WS
);

console.log(
    "======================================"
);


updateConnectionUI(
    "offline",
    "Ready to connect"
);
