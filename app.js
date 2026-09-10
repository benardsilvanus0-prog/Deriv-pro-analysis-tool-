```javascript
"use strict";

/*
=========================================================
DERIV MATCHES / OVER / UNDER SIGNAL SCANNER
ANALYSIS ONLY — NO AUTOMATIC TRADING

Public market data only.
No account token/login is required.

Features:
- Live Deriv markets
- Historical ticks
- Live tick stream
- MATCH
- DIFFERS
- OVER
- UNDER
- EVEN
- ODD
- Digit statistics
- Recent digits
- Confidence calculation
- Entry threshold
- Automatic reconnect
- Safe subscription handling

IMPORTANT:
This is an analysis/statistics tool.
It does NOT guarantee profitable trades.
=========================================================
*/


/* =====================================================
   CONFIGURATION
===================================================== */

/*
Current public Deriv market-data WebSocket.
No authentication is required for market data.
*/
const DERIV_WS =
    "wss://api.derivws.com/trading/v1/options/ws/public";

/*
Legacy public endpoint used only as a fallback if the
new public endpoint cannot establish/use the connection.
*/
const LEGACY_DERIV_WS =
    "wss://ws.binaryws.com/websockets/v3";


const DEFAULT_TICK_COUNT = 1000;
const MAX_TICK_COUNT = 5000;

const RECONNECT_DELAY = 5000;
const CONNECTION_TIMEOUT = 10000;

const PING_INTERVAL = 12000;


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
let connectionTimer = null;
let autoScanTimer = null;

let requestId = 1;

let currentSymbol = "";
let currentMarket = null;

let currentSubscriptionId = null;

let pipSize = 0.01;

let ticks = [];

let currentMode = "match";
let currentType = "MATCH";

let websocketEndpoint =
    DERIV_WS;

let usingFallbackEndpoint = false;

let activeRequestId = null;
let historyRequestId = null;
let tickRequestId = null;


/* =====================================================
   DOM HELPERS
===================================================== */

const $ = id =>
    document.getElementById(id);


/* Main controls */

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


/* Connection */

const connectionDot =
    $("connectionDot");

const statusText =
    $("statusText");

const liveBadge =
    $("liveBadge");


/* Signal */

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


/* Tick */

const tickStatus =
    $("tickStatus");

const livePrice =
    $("livePrice");

const lastDigit =
    $("lastDigit");

const marketName =
    $("marketName");


/* Digit UI */

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
   PRICE / PIP FUNCTIONS
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

    /*
    pip_size can be supplied as:
    0.01
    0.001
    0.0001
    etc.
    */

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
Extract the final digit from the displayed
price according to the market's pip size.
*/
function getLastDigit(
    price
) {

    const numericPrice =
        Number(price);

    if (
        !Number.isFinite(
            numericPrice
        )
    ) {

        return null;
    }


    const places =
        decimalPlacesFromPip(
            pipSize
        );


    const formatted =
        numericPrice.toFixed(
            places
        );


    /*
    If there is a decimal part,
    use the last decimal digit.
    */
    if (
        formatted.includes(".")
    ) {

        const parts =
            formatted.split(".");

        const decimals =
            parts[1] || "";

        if (decimals.length) {

            return Number(
                decimals[
                    decimals.length - 1
                ]
            );
        }
    }


    /*
    Fallback for integer prices.
    */
    const digits =
        formatted.replace(
            /\D/g,
            ""
        );


    if (!digits.length) {

        return null;
    }


    return Number(
        digits[
            digits.length - 1
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
   WEBSOCKET SEND
===================================================== */

function send(
    data
) {

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

        console.log(
            "Deriv SEND:",
            data
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
        "Opening WebSocket:",
        websocketEndpoint
    );


    try {

        ws =
            new WebSocket(
                websocketEndpoint
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


        /*
        Protect against a connection that hangs
        without producing open/error/close.
        */
        clearConnectionTimer();


        connectionTimer =
            setTimeout(
                () => {

                    if (
                        connecting &&
                        !connected
                    ) {

                        console.warn(
                            "Connection timeout."
                        );


                        try {

                            ws?.close();

                        } catch (error) {

                            console.warn(
                                error
                            );
                        }
                    }

                },
                CONNECTION_TIMEOUT
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

    clearConnectionTimer();


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


    /*
    Current public market-data API.

    Important:
    Do NOT send product_type here when using
    the newer API endpoint.
    */
    activeRequestId =
        nextRequestId();


    send({

        active_symbols:
            "brief",

        req_id:
            activeRequestId
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
            PING_INTERVAL
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
   MESSAGE HANDLER
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
            "Invalid JSON from Deriv:",
            event.data
        );

        return;
    }


    console.log(
        "Deriv RECEIVE:",
        data
    );


    /*
    -----------------------------------------
    API ERROR
    -----------------------------------------
    */

    if (data.error) {

        handleApiError(
            data
        );

        return;
    }


    /*
    -----------------------------------------
    ACTIVE SYMBOLS
    -----------------------------------------
    */

    if (
        data.msg_type ===
        "active_symbols"
    ) {

        handleActiveSymbols(
            data
        );

        return;
    }


    /*
    -----------------------------------------
    HISTORY
    -----------------------------------------
    */

    if (
        data.msg_type ===
        "history"
    ) {

        processHistory(
            data
        );

        return;
    }


    /*
    -----------------------------------------
    TICK
    -----------------------------------------
    */

    if (
        data.msg_type ===
        "tick"
    ) {

        processTick(
            data
        );

        return;
    }


    /*
    -----------------------------------------
    PING
    -----------------------------------------
    */

    if (
        data.msg_type ===
        "ping"
    ) {

        return;
    }


    /*
    -----------------------------------------
    SUBSCRIPTION
    -----------------------------------------
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

    const error =
        data.error || {};


    const code =
        error.code ||
        "API_ERROR";


    const message =
        error.message ||
        "Unknown Deriv API error";


    console.error(
        "DERIV API ERROR:",
        error
    );


    setText(
        statusText,
        `${code}: ${message}`
    );


    setText(
        signalExplanation,
        `${code}: ${message}`
    );


    /*
    If the active-symbol request failed,
    try the legacy endpoint once.
    */
    const request =
        data.echo_req || {};


    if (
        request.active_symbols &&
        !usingFallbackEndpoint
    ) {

        console.warn(
            "Active symbols failed on new endpoint. Trying legacy endpoint..."
        );


        switchToLegacyEndpoint();

        return;
    }


    /*
    If history/ticks fail, show a useful message.
    */
    if (
        request.ticks_history ||
        request.ticks
    ) {

        setText(
            tickStatus,
            "Data request failed"
        );
    }
}


/* =====================================================
   SWITCH TO LEGACY ENDPOINT
===================================================== */

function switchToLegacyEndpoint() {

    if (
        usingFallbackEndpoint
    ) {

        return;
    }


    usingFallbackEndpoint =
        true;


    websocketEndpoint =
        LEGACY_DERIV_WS;


    console.warn(
        "Switching to legacy Deriv WebSocket:",
        websocketEndpoint
    );


    try {

        ws?.close();

    } catch (error) {

        console.warn(
            error
        );
    }


    connected = false;
    connecting = false;


    setText(
        signalTitle,
        "Retrying connection..."
    );


    setText(
        signalExplanation,
        "Trying Deriv's compatible public market-data endpoint..."
    );


    setTimeout(
        () => {

            if (
                !manualDisconnect
            ) {

                connectDeriv();
            }

        },
        1000
    );
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
        "Active symbols received:",
        symbols.length
    );


    if (!symbols.length) {

        console.warn(
            "Deriv returned an empty active_symbols array."
        );


        /*
        Do not immediately pretend these are live
        markets. Show fallback choices but clearly
        identify them as fallback.
        */
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


    /*
    New API:
      underlying_symbol
      underlying_symbol_name
      underlying_symbol_type
      pip_size

    Legacy API:
      symbol
      display_name
      symbol_type
      pip
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
            item.submarket || "",

        exchangeOpen:
            item.exchange_is_open,

        suspended:
            item.is_trading_suspended
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


    /*
    Prefer synthetic indices.

    We retain all symbols if the API doesn't
    return identifiable synthetic symbols.
    */
    let markets =
        normalized.filter(
            market => {

                const symbol =
                    market.symbol.toUpperCase();

                const type =
                    market.type.toLowerCase();

                const marketName =
                    market.name.toLowerCase();


                return (

                    type.includes(
                        "synthetic"
                    )

                    ||

                    type.includes(
                        "derived"
                    )

                    ||

                    /^R_\d+/i.test(
                        symbol
                    )

                    ||

                    /^1HZ\d+/i.test(
                        symbol
                    )

                    ||

                    /^BOOM/i.test(
                        symbol
                    )

                    ||

                    /^CRASH/i.test(
                        symbol
                    )

                    ||

                    marketName.includes(
                        "volatility"
                    )

                    ||

                    marketName.includes(
                        "boom"
                    )

                    ||

                    marketName.includes(
                        "crash"
                    )
                );
            }
        );


    /*
    If filtering produces nothing,
    use all available symbols.
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
    Remove duplicates.
    */
    const unique =
        new Map();


    markets.forEach(
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


    markets =
        Array.from(
            unique.values()
        );


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
   FALLBACK MARKETS
===================================================== */

function loadFallbackMarkets() {

    console.warn(
        "Using fallback synthetic markets."
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
   POPULATE MARKET SELECT
===================================================== */

function populateMarketSelect(
    markets,
    fallback
) {

    if (!marketSelect) {

        console.error(
            "marketSelect element not found."
        );

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


            option.dataset.type =
                market.type || "";


            marketSelect.appendChild(
                option
            );
        }
    );


    const count =
        marketSelect.options.length - 1;


    console.log(
        `Markets loaded: ${count}`
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


        setText(
            signalExplanation,
            "Deriv returned no usable markets."
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

            ? "Deriv returned no usable market list. Fallback synthetic markets are shown."
            
            : "Choose a market to begin analysis."
    );


    /*
    Automatically select first available market.
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


    /*
    Use pip supplied by active_symbols
    when available.
    */
    if (
        Number.isFinite(
            selectedPip
        ) &&
        selectedPip > 0
    ) {

        pipSize =
            selectedPip;
    }


    /*
    Clear previous market data.
    */
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
   SUBSCRIBE TO MARKET
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
            "Cannot subscribe — WebSocket is not open."
        );


        setText(
            statusText,
            "Not connected"
        );


        return;
    }


    /*
    Cancel previous tick subscription.
    */
    forgetCurrentSubscription();


    /*
    Reset tick state.
    */
    ticks = [];


    const count =
        getTickLimit();


    /*
    -----------------------------------------
    HISTORY REQUEST
    -----------------------------------------
    */

    historyRequestId =
        nextRequestId();


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
            historyRequestId
    };


    console.log(
        "Requesting history:",
        historyRequest
    );


    if (
        !send(
            historyRequest
        )
    ) {

        return;
    }


    /*
    -----------------------------------------
    LIVE TICK SUBSCRIPTION
    -----------------------------------------
    */

    tickRequestId =
        nextRequestId();


    const tickRequest = {

        ticks:
            symbol,

        subscribe:
            1,

        req_id:
            tickRequestId
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
   FORGET SUBSCRIPTION
===================================================== */

function forgetCurrentSubscription() {

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


/* =====================================================
   HISTORY
===================================================== */

function processHistory(
    data
) {

    if (!data.history) {

        console.warn(
            "History response has no history object:",
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


    /*
    New API may provide pip_size in the
    history response.
    */
    const historyPip =
        Number(
            data.pip_size ??
            data.history.pip_size
        );


    if (
        Number.isFinite(
            historyPip
        ) &&
        historyPip > 0
    ) {

        /*
        Some API versions represent pip_size
        as decimal precision while others may
        provide the actual price increment.

        Only use it if it looks like a valid
        decimal price increment.
        */
        if (
            historyPip < 1
        ) {

            pipSize =
                historyPip;
        }
    }


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
            digit < 0 ||
            digit > 9
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
        `LIVE • ${ticks.length} historical ticks`
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
            "Invalid tick price:",
            data.tick
        );

        return;
    }


    /*
    Get pip size if supplied by tick.
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
        tickPip > 0 &&
        tickPip < 1
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


    /*
    Make sure this tick belongs to
    the currently selected symbol.
    */
    if (
        data.tick.symbol &&
        currentSymbol &&
        data.tick.symbol !==
            currentSymbol
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
   ANALYSIS ENGINE
===================================================== */

function analyze() {

    if (!ticks.length) {

        clearSignalOnly();

        return;
    }


    let result;


    /*
    DIFFERS mode.
    */
    if (
        currentMode === "diff"
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


    /*
    Entry threshold.
    */
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


    /*
    IMPORTANT:
    Start at digit 0.
    The old version incorrectly started
    at digit 1.
    */
    let bestDigitValue =
        0;


    for (
        let digit = 0;
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


    const total =
        ticks.length;


    const confidence =
        total
            ? (
                counts[
                    bestDigitValue
                ] /
                total
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
            `Digit ${bestDigitValue} occurred ${counts[bestDigitValue]} times in the last ${total} ticks.`
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

            <div class="digit-count">
                ${counts[digit]} ticks
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
   CONNECTION TIMER
===================================================== */

function clearConnectionTimer() {

    if (connectionTimer) {

        clearTimeout(
            connectionTimer
        );

        connectionTimer = null;
    }
}


/* =====================================================
   CLOSE
===================================================== */

function handleClose(
    event
) {

    clearConnectionTimer();

    stopPing();


    console.warn(
        "Deriv WebSocket closed:",
        event.code,
        event.reason ||
            "(no reason)"
    );


    connected = false;
    connecting = false;


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

    if (
        reconnectTimer
    ) {

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
   WEBSOCKET ERROR
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
        "WebSocket connection error. The scanner will retry automatically."
    );
}


/* =====================================================
   RESET CONNECT BUTTON
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

    clearConnectionTimer();


    if (
        reconnectTimer
    ) {

        clearTimeout(
            reconnectTimer
        );

        reconnectTimer =
            null;
    }


    forgetCurrentSubscription();


    if (ws) {

        try {

            ws.close(
                1000,
                "User disconnected"
            );

        } catch (error) {

            console.warn(
                "Close error:",
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

                /*
                Start with the current endpoint.
                */
                websocketEndpoint =
                    DERIV_WS;

                usingFallbackEndpoint =
                    false;

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
   PAGE VISIBILITY
===================================================== */

document.addEventListener(
    "visibilitychange",
    () => {

        /*
        When the browser tab becomes visible
        again, make sure the connection is alive.
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


/* =====================================================
   INITIALIZATION
===================================================== */

console.log(
    "=========================================="
);

console.log(
    "DERIV MATCHES SIGNAL SCANNER"
);

console.log(
    "Analysis only — NO automatic trading"
);

console.log(
    "Primary endpoint:",
    DERIV_WS
);

console.log(
    "Fallback endpoint:",
    LEGACY_DERIV_WS
);

console.log(
    "=========================================="
);


updateConnectionUI(
    "offline",
    "Ready to connect"
);


/*
Do not automatically connect on page load.
The user presses Connect Scanner.
*/
```
