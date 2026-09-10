"use strict";

/* =========================================================
   DERIV MATCHES SIGNAL SCANNER
   MARKET ANALYSIS ONLY
   NO AUTOMATIC TRADING
   ========================================================= */

/*
 * Current Deriv public market-data WebSocket.
 *
 * No app_id is required.
 * No login is required.
 * No OTP is required.
 */
const DERIV_WS =
    "wss://api.derivws.com/trading/v1/options/ws/public";


/* =========================================================
   FALLBACK MARKETS
   ========================================================= */

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


/* =========================================================
   STATE
   ========================================================= */

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


/* =========================================================
   DOM
   ========================================================= */

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


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function setText(element, value) {

    if (element) {
        element.textContent = String(value);
    }
}


function safeNumber(value, fallback = 0) {

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function nextRequestId() {

    return requestId++;
}


function getTickLimit() {

    let value =
        Number(
            tickCount?.value
        );

    if (!Number.isFinite(value)) {
        value = 1000;
    }

    value =
        Math.round(value);

    return Math.max(
        10,
        Math.min(
            5000,
            value
        )
    );
}


function getThreshold() {

    let value =
        Number(
            threshold?.value
        );

    if (!Number.isFinite(value)) {
        value = 60;
    }

    return Math.max(
        0,
        Math.min(
            100,
            value
        )
    );
}


function getBarrier() {

    let value =
        Number(
            barrier?.value
        );

    if (!Number.isFinite(value)) {
        value = 5;
    }

    return Math.max(
        0,
        Math.min(
            9,
            Math.round(value)
        )
    );
}


/* =========================================================
   PIP / PRICE HELPERS
   ========================================================= */

function decimalPlacesFromPip(pip) {

    const number =
        Number(pip);

    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {
        return 2;
    }

    if (number >= 1) {
        return 0;
    }

    /*
     * Handles:
     * 0.1   -> 1
     * 0.01  -> 2
     * 0.001 -> 3
     * 0.0001 -> 4
     */
    return Math.max(
        0,
        Math.round(
            -Math.log10(number)
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


function getLastDigit(price) {

    const places =
        decimalPlacesFromPip(
            pipSize
        );

    const formatted =
        Number(price).toFixed(
            places
        );

    const digits =
        formatted.replace(
            /\D/g,
            ""
        );

    if (!digits.length) {
        return null;
    }

    return Number(
        digits.charAt(
            digits.length - 1
        )
    );
}


/* =========================================================
   CONNECTION UI
   ========================================================= */

function updateConnectionUI(
    state,
    message = ""
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


    if (statusText) {

        statusText.textContent =
            message ||
            (
                state === "online"
                    ? "Connected"
                    : state === "connecting"
                        ? "Connecting..."
                        : "Disconnected"
            );
    }
}


/* =========================================================
   SEND WEBSOCKET MESSAGE
   ========================================================= */

function send(data) {

    if (
        !ws ||
        ws.readyState !==
            WebSocket.OPEN
    ) {

        console.warn(
            "WebSocket is not open.",
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
            "WebSocket send error:",
            error
        );

        return false;
    }
}


/* =========================================================
   CONNECT
   ========================================================= */

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

        console.log(
            "Opening Deriv WebSocket:",
            DERIV_WS
        );

        ws =
            new WebSocket(
                DERIV_WS
            );


        ws.onopen =
            handleOpen;

        ws.onmessage =
            handleMessage;

        ws.onerror =
            handleError;

        ws.onclose =
            handleClose;

    } catch (error) {

        console.error(
            "WebSocket creation error:",
            error
        );

        connecting = false;

        updateConnectionUI(
            "offline",
            "Connection failed"
        );

        if (connectBtn) {

            connectBtn.disabled = false;

            connectBtn.textContent =
                "⚡ Connect Scanner";
        }
    }
}


/* =========================================================
   WEBSOCKET OPEN
   ========================================================= */

function handleOpen() {

    console.log(
        "================================="
    );

    console.log(
        "Deriv WebSocket connected"
    );

    console.log(
        "Endpoint:",
        DERIV_WS
    );

    console.log(
        "Mode: ANALYSIS ONLY"
    );

    console.log(
        "================================="
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
            "🔌 Connected";
    }


    setText(
        signalTitle,
        "Loading markets..."
    );

    setText(
        signalExplanation,
        "Requesting available Deriv markets..."
    );


    /*
     * Keep connection alive.
     */
    if (pingTimer) {

        clearInterval(
            pingTimer
        );
    }


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


    /*
     * Current public API:
     * active_symbols does not require
     * product_type.
     */
    send({

        active_symbols:
            "brief",

        req_id:
            nextRequestId()

    });
}


/* =========================================================
   MESSAGE HANDLER
   ========================================================= */

function handleMessage(event) {

    let data = null;


    try {

        data =
            JSON.parse(
                event.data
            );

    } catch (error) {

        console.error(
            "Invalid JSON received:",
            event.data
        );

        return;
    }


    console.log(
        "Deriv message:",
        data
    );


    /* -----------------------------------------
       API ERROR
       ----------------------------------------- */

    if (data.error) {

        handleApiError(data);

        return;
    }


    /* -----------------------------------------
       ACTIVE SYMBOLS
       ----------------------------------------- */

    if (
        data.msg_type ===
        "active_symbols"
    ) {

        processActiveSymbols(
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
       LIVE TICK
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


    /* -----------------------------------------
       SUBSCRIPTION RESPONSE
       ----------------------------------------- */

    if (
        data.subscription &&
        data.subscription.id
    ) {

        currentSubscriptionId =
            data.subscription.id;
    }
}


/* =========================================================
   API ERROR
   ========================================================= */

function handleApiError(data) {

    console.error(
        "Deriv API error:",
        data.error
    );


    const code =
        data.error.code ||
        "API_ERROR";


    const message =
        data.error.message ||
        "Deriv API error";


    setText(
        statusText,
        `${code}: ${message}`
    );


    setText(
        signalExplanation,
        `${code}: ${message}`
    );


    /*
     * If active_symbols failed,
     * load fallback markets.
     */
    if (
        data.echo_req &&
        data.echo_req.active_symbols
    ) {

        console.warn(
            "active_symbols failed. Loading fallback markets."
        );

        loadFallbackMarkets();
    }
}


/* =========================================================
   ACTIVE SYMBOLS
   ========================================================= */

function processActiveSymbols(data) {

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
            "Deriv returned zero active symbols."
        );

        loadFallbackMarkets();

        return;
    }


    loadMarkets(
        symbols
    );
}


/* =========================================================
   NORMALIZE MARKET
   ========================================================= */

function normalizeMarket(item) {

    if (!item) {
        return null;
    }


    /*
     * Current API names.
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


    const market =
        item.market ||
        "";


    const subgroup =
        item.subgroup ||
        "";


    return {

        symbol:
            String(symbol),

        name:
            String(name),

        type:
            String(type),

        market:
            String(market),

        subgroup:
            String(subgroup),

        pip:
            Number(pip) || 0

    };
}


/* =========================================================
   LOAD MARKETS
   ========================================================= */

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
     * Prefer synthetic indices.
     */
    let usable =
        normalized.filter(
            market => {

                const symbol =
                    market.symbol;

                const type =
                    market.type.toLowerCase();

                const marketName =
                    market.market.toLowerCase();


                return (
                    type.includes(
                        "synthetic"
                    ) ||

                    marketName.includes(
                        "synthetic"
                    ) ||

                    /^R_/i.test(
                        symbol
                    ) ||

                    /^1HZ/i.test(
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
     * If the API returns symbols but
     * our filter doesn't recognize them,
     * keep all valid symbols.
     */
    if (!usable.length) {

        usable =
            normalized;
    }


    if (!usable.length) {

        loadFallbackMarkets();

        return;
    }


    /*
     * Remove duplicate symbols.
     */
    const unique =
        new Map();


    usable.forEach(
        market => {

            if (
                !unique.has(
                    market.symbol
                )
            ) {

                unique.set(
                    market.symbol,
                    market
                );
            }
        }
    );


    populateMarketSelect(
        Array.from(
            unique.values()
        ),
        false
    );
}


/* =========================================================
   FALLBACK MARKETS
   ========================================================= */

function loadFallbackMarkets() {

    console.warn(
        "Using fallback synthetic markets."
    );


    const markets =
        FALLBACK_MARKETS.map(
            market => ({

                symbol:
                    market.symbol,

                name:
                    market.name,

                type:
                    "synthetic_index",

                market:
                    "synthetic",

                subgroup:
                    "synthetic",

                pip:
                    market.pip

            })
        );


    populateMarketSelect(
        markets,
        true
    );
}


/* =========================================================
   MARKET SELECT
   ========================================================= */

function populateMarketSelect(
    markets,
    fallback = false
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


    if (count <= 0) {

        setText(
            statusText,
            "No markets available"
        );

        setText(
            signalExplanation,
            "Deriv returned no usable markets."
        );

        return;
    }


    setText(
        statusText,
        `${count} markets loaded`
    );


    setText(
        signalTitle,
        "Select a market"
    );


    setText(
        signalExplanation,
        fallback
            ? "Live market list was empty. Fallback symbols are available."
            : "Choose a market to start analysis."
    );


    /*
     * Select first market automatically.
     */
    if (
        marketSelect.value === "" &&
        marketSelect.options.length > 1
    ) {

        marketSelect.selectedIndex =
            1;
    }
}


/* =========================================================
   MARKET CHANGE
   ========================================================= */

function handleMarketChange() {

    if (!marketSelect) {
        return;
    }


    const symbol =
        marketSelect.value;


    if (!symbol) {

        currentSymbol = "";

        currentMarket = null;

        stopMarketSubscription();

        clearAnalysis();

        return;
    }


    currentSymbol =
        symbol;


    const option =
        marketSelect.options[
            marketSelect.selectedIndex
        ];


    const name =
        option.dataset.name ||
        symbol;


    const selectedPip =
        Number(
            option.dataset.pip
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
        `Loading ${symbol} tick history...`
    );


    setText(
        statusText,
        `Loading ${symbol}...`
    );


    subscribeToMarket(
        symbol
    );
}


/* =========================================================
   STOP CURRENT MARKET SUBSCRIPTION
   ========================================================= */

function stopMarketSubscription() {

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
}


/* =========================================================
   SUBSCRIBE MARKET
   ========================================================= */

function subscribeToMarket(symbol) {

    if (
        !connected ||
        !ws ||
        ws.readyState !==
            WebSocket.OPEN
    ) {

        setText(
            statusText,
            "Not connected to Deriv"
        );

        setText(
            signalExplanation,
            "Connect to Deriv before selecting a market."
        );

        return;
    }


    /*
     * Stop previous subscription.
     */
    stopMarketSubscription();


    ticks = [];


    const count =
        getTickLimit();


    /*
     * Request history.
     */
    const historySent =
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
     * Subscribe to live ticks.
     */
    const tickSent =
        send({

            ticks:
                symbol,

            subscribe:
                1,

            req_id:
                nextRequestId()

        });


    if (
        !historySent ||
        !tickSent
    ) {

        setText(
            statusText,
            "Failed to request market data"
        );

        return;
    }


    setText(
        statusText,
        `Streaming ${symbol}`
    );


    setText(
        tickStatus,
        "Loading ticks..."
    );
}


/* =========================================================
   HISTORY
   ========================================================= */

function processHistory(data) {

    if (!data.history) {

        console.warn(
            "History response has no history:",
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


    if (!prices.length) {

        setText(
            signalExplanation,
            "No historical ticks were returned for this market."
        );

        setText(
            tickStatus,
            "0 ticks"
        );

        return;
    }


    const historyTicks = [];


    prices.forEach(
        (price, index) => {

            const numericPrice =
                Number(price);


            if (
                !Number.isFinite(
                    numericPrice
                )
            ) {
                return;
            }


            const digit =
                getLastDigit(
                    numericPrice
                );


            if (
                digit === null
            ) {
                return;
            }


            historyTicks.push({

                price:
                    numericPrice,

                digit:
                    digit,

                epoch:
                    Number(
                        times[index]
                    ) ||
                    Date.now() / 1000

            });
        }
    );


    ticks =
        historyTicks.slice(
            -getTickLimit()
        );


    console.log(
        "Historical ticks loaded:",
        ticks.length
    );


    updateDisplay();

    analyze();


    setText(
        statusText,
        `Live • ${ticks.length} historical ticks`
    );


    setText(
        tickStatus,
        `${ticks.length} ticks`
    );
}


/* =========================================================
   LIVE TICK
   ========================================================= */

function processTick(data) {

    if (!data.tick) {
        return;
    }


    /*
     * Save subscription ID.
     */
    if (
        data.subscription &&
        data.subscription.id
    ) {

        currentSubscriptionId =
            data.subscription.id;
    }


    /*
     * Update pip size when supplied.
     */
    if (
        data.tick.pip_size !==
        undefined
    ) {

        const p =
            Number(
                data.tick.pip_size
            );


        if (
            Number.isFinite(p) &&
            p > 0
        ) {

            pipSize = p;
        }
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
            "Invalid tick quote:",
            data.tick
        );

        return;
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


    const max =
        getTickLimit();


    if (
        ticks.length > max
    ) {

        ticks =
            ticks.slice(
                -max
            );
    }


    setText(
        livePrice,
        formatPrice(price)
    );


    setText(
        lastDigit,
        String(digit)
    );


    setText(
        tickStatus,
        `${ticks.length} ticks`
    );


    updateRecentDigits();

    updateDigitGrid();

    analyze();


    setText(
        statusText,
        `LIVE • ${ticks.length} ticks`
    );
}


/* =========================================================
   ANALYSIS
   ========================================================= */

function analyze() {

    if (!ticks.length) {

        setText(
            bestConfidence,
            "0.0"
        );

        setText(
            bestDigit,
            "-"
        );

        if (confidenceBar) {

            confidenceBar.style.width =
                "0%";
        }

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

                break;
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
                safeNumber(
                    result.confidence
                )
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


/* =========================================================
   MATCH
   ========================================================= */

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


    let best =
        0;


    for (
        let i = 1;
        i < 10;
        i++
    ) {

        if (
            counts[i] >
            counts[best]
        ) {

            best = i;
        }
    }


    const confidence =
        (
            counts[best] /
            ticks.length
        ) * 100;


    return {

        display:
            String(best),

        title:
            `MATCH ${best}`,

        confidence:
            confidence,

        explanation:
            `Digit ${best} appeared ${counts[best]} times out of ${ticks.length} analyzed ticks.`

    };
}


/* =========================================================
   DIFFERS
   ========================================================= */

function calculateDiffers(
    barrierDigit
) {

    const digit =
        Math.max(
            0,
            Math.min(
                9,
                Math.round(
                    safeNumber(
                        barrierDigit,
                        5
                    )
                )
            )
        );


    const matches =
        ticks.filter(
            tick =>
                tick.digit ===
                digit
        ).length;


    const differs =
        ticks.length -
        matches;


    const confidence =
        (
            differs /
            ticks.length
        ) * 100;


    return {

        display:
            `≠${digit}`,

        title:
            `DIFFERS ${digit}`,

        confidence:
            confidence,

        explanation:
            `Digit ${digit} was absent from ${differs} of the last ${ticks.length} analyzed ticks.`

    };
}


/* =========================================================
   OVER
   ========================================================= */

function calculateOver(
    barrierDigit
) {

    const digit =
        Math.max(
            0,
            Math.min(
                9,
                Math.round(
                    safeNumber(
                        barrierDigit,
                        5
                    )
                )
            )
        );


    const wins =
        ticks.filter(
            tick =>
                tick.digit >
                digit
        ).length;


    const confidence =
        (
            wins /
            ticks.length
        ) * 100;


    return {

        display:
            `>${digit}`,

        title:
            `OVER ${digit}`,

        confidence:
            confidence,

        explanation:
            `${wins} of ${ticks.length} analyzed digits were greater than ${digit}.`

    };
}


/* =========================================================
   UNDER
   ========================================================= */

function calculateUnder(
    barrierDigit
) {

    const digit =
        Math.max(
            0,
            Math.min(
                9,
                Math.round(
                    safeNumber(
                        barrierDigit,
                        5
                    )
                )
            )
        );


    const wins =
        ticks.filter(
            tick =>
                tick.digit <
                digit
        ).length;


    const confidence =
        (
            wins /
            ticks.length
        ) * 100;


    return {

        display:
            `<${digit}`,

        title:
            `UNDER ${digit}`,

        confidence:
            confidence,

        explanation:
            `${wins} of ${ticks.length} analyzed digits were less than ${digit}.`

    };
}


/* =========================================================
   EVEN
   ========================================================= */

function calculateEven() {

    const wins =
        ticks.filter(
            tick =>
                tick.digit % 2 === 0
        ).length;


    const confidence =
        (
            wins /
            ticks.length
        ) * 100;


    return {

        display:
            "EVEN",

        title:
            "EVEN",

        confidence:
            confidence,

        explanation:
            `${wins} of ${ticks.length} analyzed digits were even.`

    };
}


/* =========================================================
   ODD
   ========================================================= */

function calculateOdd() {

    const wins =
        ticks.filter(
            tick =>
                tick.digit % 2 !== 0
        ).length;


    const confidence =
        (
            wins /
            ticks.length
        ) * 100;


    return {

        display:
            "ODD",

        title:
            "ODD",

        confidence:
            confidence,

        explanation:
            `${wins} of ${ticks.length} analyzed digits were odd.`

    };
}


/* =========================================================
   DIGIT GRID
   ========================================================= */

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
            total > 0
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


/* =========================================================
   RECENT DIGITS
   ========================================================= */

function updateRecentDigits() {

    if (!recentDigits) {
        return;
    }


    recentDigits.innerHTML =
        "";


    const recent =
        ticks.slice(
            -20
        );


    recent.forEach(
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


/* =========================================================
   DISPLAY
   ========================================================= */

function updateDisplay() {

    if (!ticks.length) {
        return;
    }


    const last =
        ticks[
            ticks.length - 1
        ];


    setText(
        livePrice,
        formatPrice(
            last.price
        )
    );


    setText(
        lastDigit,
        String(
            last.digit
        )
    );


    setText(
        tickStatus,
        `${ticks.length} ticks`
    );


    updateRecentDigits();

    updateDigitGrid();
}


/* =========================================================
   CLEAR ANALYSIS
   ========================================================= */

function clearAnalysis() {

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


/* =========================================================
   AUTO SCAN
   ========================================================= */

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

        autoScanTimer =
            null;
    }
}


/* =========================================================
   CLOSE
   ========================================================= */

function handleClose(event) {

    console.warn(
        "Deriv WebSocket closed:",
        event.code,
        event.reason ||
            "(no reason)"
    );


    connected = false;
    connecting = false;


    if (pingTimer) {

        clearInterval(
            pingTimer
        );

        pingTimer =
            null;
    }


    currentSubscriptionId =
        null;


    updateConnectionUI(
        "offline",
        manualDisconnect
            ? "Disconnected"
            : "Disconnected — retrying..."
    );


    if (connectBtn) {

        connectBtn.disabled = false;

        connectBtn.textContent =
            "⚡ Connect Scanner";
    }


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


    if (!reconnectTimer) {

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
                5000
            );
    }
}


/* =========================================================
   ERROR
   ========================================================= */

function handleError(error) {

    console.error(
        "Deriv WebSocket error:",
        error
    );


    updateConnectionUI(
        "offline",
        "WebSocket error"
    );


    setText(
        signalExplanation,
        "WebSocket connection error. See the browser console for details."
    );
}


/* =========================================================
   DISCONNECT
   ========================================================= */

function disconnectDeriv() {

    manualDisconnect =
        true;


    stopAutoScan();


    if (reconnectTimer) {

        clearTimeout(
            reconnectTimer
        );

        reconnectTimer =
            null;
    }


    if (pingTimer) {

        clearInterval(
            pingTimer
        );

        pingTimer =
            null;
    }


    stopMarketSubscription();


    if (ws) {

        try {

            ws.close();

        } catch (error) {

            console.warn(
                "Error closing WebSocket:",
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


    if (connectBtn) {

        connectBtn.disabled =
            false;

        connectBtn.textContent =
            "⚡ Connect Scanner";
    }
}


/* =========================================================
   CONNECT BUTTON
   ========================================================= */

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


/* =========================================================
   MARKET SELECT
   ========================================================= */

if (marketSelect) {

    marketSelect.addEventListener(
        "change",
        handleMarketChange
    );
}


/* =========================================================
   SCAN BUTTON
   ========================================================= */

if (scanBtn) {

    scanBtn.addEventListener(
        "click",
        () => {

            if (!ticks.length) {

                setText(
                    signalExplanation,
                    "Waiting for tick data before scanning."
                );

                return;
            }


            analyze();
        }
    );
}


/* =========================================================
   AUTO SCAN
   ========================================================= */

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


/* =========================================================
   MODE BUTTONS
   ========================================================= */

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
                            b => {

                                b.classList.remove(
                                    "active"
                                );
                            }
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


/* =========================================================
   SIGNAL TYPE BUTTONS
   ========================================================= */

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
                            b => {

                                b.classList.remove(
                                    "active"
                                );
                            }
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


/* =========================================================
   THRESHOLD
   ========================================================= */

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


/* =========================================================
   BARRIER
   ========================================================= */

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


/* =========================================================
   TICK COUNT
   ========================================================= */

if (tickCount) {

    tickCount.addEventListener(
        "change",
        () => {

            if (
                currentSymbol &&
                connected
            ) {

                subscribeToMarket(
                    currentSymbol
                );
            }
        }
    );
}


/* =========================================================
   PAGE VISIBILITY
   ========================================================= */

document.addEventListener(
    "visibilitychange",
    () => {

        /*
         * If the browser tab becomes active
         * again and the connection disappeared,
         * reconnect.
         */

        if (
            document.visibilityState ===
            "visible"
        ) {

            if (
                !connected &&
                !connecting &&
                !manualDisconnect
            ) {

                connectDeriv();
            }
        }
    }
);


/* =========================================================
   INITIAL STATE
   ========================================================= */

console.log(
    "================================="
);

console.log(
    "Matches Signal Scanner loaded successfully."
);

console.log(
    "Deriv public endpoint:",
    DERIV_WS
);

console.log(
    "Authentication: NONE"
);

console.log(
    "Trading: DISABLED"
);

console.log(
    "Analysis: ENABLED"
);

console.log(
    "================================="
);


updateConnectionUI(
    "offline",
    "Ready to connect"
);
