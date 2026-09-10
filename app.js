"use strict";

/*
=========================================================
DERIV MATCHES SIGNAL SCANNER
ANALYSIS ONLY - NO AUTOMATIC TRADING

Uses Deriv's current public WebSocket API.
No account login/token is required for public market data.
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
Fallback markets.

These are only used if Deriv returns no symbols.
The application will still attempt to request live
data from Deriv.
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

const $ = id => document.getElementById(id);

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


/*
Get last digit using the market's pip size.
*/
function getLastDigit(price) {

    const places =
        decimalPlacesFromPip(
            pipSize
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

        connectBtn.disabled = true;

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


    /*
    Current Deriv API:
    active_symbols does not need
    product_type.
    */

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
    Some API versions may return
    subscription information separately.
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

function handleApiError(data) {

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
    Only use fallback when market request
    itself failed.
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

function handleActiveSymbols(data) {

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

function normalizeMarket(item) {

    if (!item) {
        return null;
    }


    /*
    New API field names.
    Legacy names are retained for compatibility.
    */

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
            .map(
                normalizeMarket
            )
            .filter(Boolean);


    console.log(
        "Normalized markets:",
        normalized.length
    );


    /*
    Prefer synthetic indices.
    */

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
    If synthetic filtering returns
    nothing, show all markets.
    */

    if (!markets.length) {

        markets =
            normalized;
    }


    if (!markets.length) {

        loadFallbackMarkets();

        return;
    }


    /*
    Sort alphabetically.
    */

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
            ? "Deriv returned no market list. Testing the fallback synthetic markets."
            : "Choose a market to begin analysis."
    );


    /*
    Select first market automatically.
    */

    marketSelect.selectedIndex = 1;


    /*
    Start it automatically.
    */

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

function subscribeToMarket(symbol) {

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

    if (currentSubscriptionId) {

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

function processHistory(data) {

    if (!data.history) {

        console.warn(
            "No history object:",
            data
        );

        return;
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
            digit === null
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

function processTick(data) {

    if (!data.tick) {
        return;
    }


    /*
    New API / legacy compatibility.
    */

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
        Number.isFinite(tickPip) &&
        tickPip > 0
    ) {

        pipSize =
            tickPip;
    }


    const digit =
        getLastDigit(
            price
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


    /*
    Capture subscription ID.
    */

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
   ANALYSIS
===================================================== */

function analyze() {

    if (!ticks.length) {

        clearSignalOnly();

        return;
    }


    let result;


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


    if (!result) {
        return;
    }


    const confidence =
        Math.max(
            0,
            Math.min(
                100,
                Number(
                    result.confidence
                ) || 0
            )
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


    const required =
        getThreshold();


    if (
        confidence >= required
    ) {

        setText(
            entryStatus,
            "🟢 ENTRY CONDITION MET"
        );


        entryStatus?.classList.remove(
            "waiting"
        );


        entryStatus?.classList.add(
            "ready"
        );

    } else {

        setText(
            entryStatus,
            "⏳ WAITING FOR STRONGER SIGNAL"
        );


        entryStatus?.classList.remove(
            "ready"
        );


        entryStatus?.classList.add(
            "waiting"
        );
    }
}


/* =====================================================
   MATCH
===================================================== */

function calculateMatch() {

    const counts =
        Array(10).fill(0);


    ticks.forEach(
        tick => {

            if (
                Number.isInteger(
                    tick.digit
                )
            ) {

                counts[
                    tick.digit
                ]++;
            }
        }
    );


    let bestDigitValue = 0;


    for (
        let digit = 1;
        digit <= 9;
        digit++
    ) {

        if (
            counts[digit] >
            counts[bestDigitValue]
        ) {

            bestDigitValue =
                digit;
        }
    }


    const confidence =
        ticks.length
            ? (
                counts[
                    bestDigitValue
                ] /
                ticks.length
            ) * 100
            : 0;


    return {

        display:
            String(
                bestDigitValue
            ),

        title:
            `MATCH ${bestDigitValue}`,

        confidence:
            confidence,

        explanation:
            `Digit ${bestDigitValue} occurred ${counts[bestDigitValue]} times in the last ${ticks.length} ticks.`
    };
}


/* =====================================================
   DIFFERS
===================================================== */

function calculateDiffers(
    selectedDigit
) {

    const matches =
        ticks.filter(
            tick =>
                tick.digit ===
                selectedDigit
        ).length;


    const differs =
        ticks.length -
        matches;


    const confidence =
        ticks.length
            ? (
                differs /
                ticks.length
            ) * 100
            : 0;


    return {

        display:
            `≠${selectedDigit}`,

        title:
            `DIFFERS ${selectedDigit}`,

        confidence:
            confidence,

        explanation:
            `Digit ${selectedDigit} was different on ${differs} of the last ${ticks.length} ticks.`
    };
}


/* =====================================================
   OVER
===================================================== */

function calculateOver(
    selectedBarrier
) {

    const wins =
        ticks.filter(
            tick =>
                tick.digit >
                selectedBarrier
        ).length;


    const confidence =
        ticks.length
            ? (
                wins /
                ticks.length
            ) * 100
            : 0;


    return {

        display:
            `>${selectedBarrier}`,

        title:
            `OVER ${selectedBarrier}`,

        confidence:
            confidence,

        explanation:
            `${wins} of ${ticks.length} ticks were above ${selectedBarrier}.`
    };
}


/* =====================================================
   UNDER
===================================================== */

function calculateUnder(
    selectedBarrier
) {

    const wins =
        ticks.filter(
            tick =>
                tick.digit <
                selectedBarrier
        ).length;


    const confidence =
        ticks.length
            ? (
                wins /
                ticks.length
            ) * 100
            : 0;


    return {

        display:
            `<${selectedBarrier}`,

        title:
            `UNDER ${selectedBarrier}`,

        confidence:
            confidence,

        explanation:
            `${wins} of ${ticks.length} ticks were below ${selectedBarrier}.`
    };
}


/* =====================================================
   EVEN
===================================================== */

function calculateEven() {

    const wins =
        ticks.filter(
            tick =>
                tick.digit % 2 === 0
        ).length;


    const confidence =
        ticks.length
            ? (
                wins /
                ticks.length
            ) * 100
            : 0;


    return {

        display:
            "EVEN",

        title:
            "EVEN",

        confidence:
            confidence,

        explanation:
            `${wins} of ${ticks.length} ticks were even.`
    };
}


/* =====================================================
   ODD
===================================================== */

function calculateOdd() {

    const wins =
        ticks.filter(
            tick =>
                tick.digit % 2 !== 0
        ).length;


    const confidence =
        ticks.length
            ? (
                wins /
                ticks.length
            ) * 100
            : 0;


    return {

        display:
            "ODD",

        title:
            "ODD",

        confidence:
            confidence,

        explanation:
            `${wins} of ${ticks.length} ticks were odd.`
    };
}


/* =====================================================
   DIGIT GRID
===================================================== */

function updateDigitGrid() {

    if (!digitGrid) {
        return;
    }


    const counts =
        Array(10).fill(0);


    ticks.forEach(
        tick => {

            if (
                Number.isInteger(
                    tick.digit
                )
            ) {

                counts[
                    tick.digit
                ]++;
            }
        }
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
   CLEAR
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
    "MATCHES SIGNAL SCANNER"
);

console.log(
    "Analysis only - NO AUTOMATIC TRADING"
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
