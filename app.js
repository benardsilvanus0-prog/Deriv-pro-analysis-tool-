"use strict";

/* =========================================================
   MATCHES SIGNAL SCANNER
   DERIV MARKET DATA
   ANALYSIS ONLY - NO AUTOMATIC TRADING
   ========================================================= */


/* =========================================================
   CONFIGURATION
   ========================================================= */

/*
 * Use Deriv's current websocket hostname.
 *
 * We deliberately do NOT use:
 * wss://ws.binaryws.com/...
 *
 * We also don't use app_id=1089 here.
 */
const DERIV_WS =
    "wss://ws.derivws.com/websockets/v3";


/*
 * Known synthetic symbols used as a fallback if
 * active_symbols returns an empty array.
 *
 * These are only fallback choices. The scanner still
 * requests the actual market list first.
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


/* =========================================================
   STATE
   ========================================================= */

let ws = null;

let reconnectTimer = null;
let pingTimer = null;
let autoScanTimer = null;

let connected = false;
let connecting = false;

let manualDisconnect = false;

let currentSymbol = "";
let currentMarket = null;

let currentSubscriptionId = null;

let pipSize = 0.01;

let ticks = [];

let currentMode = "match";
let currentType = "MATCH";

let requestId = 1;


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
   HELPERS
   ========================================================= */

function setText(element, value) {

    if (element) {
        element.textContent = value;
    }
}


function safeNumber(value, fallback = 0) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function nextRequestId() {

    return requestId++;
}


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


/*
 * Extract the final decimal digit from
 * the displayed quote.
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
        "Connecting to Deriv market data..."
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


        ws = new WebSocket(
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
        "Deriv WebSocket connected:",
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
     * Heartbeat.
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
     * Request active symbols.
     *
     * IMPORTANT:
     * No product_type parameter.
     */

    send({

        active_symbols:
            "brief",

        req_id:
            nextRequestId()

    });
}


/* =========================================================
   SEND
   ========================================================= */

function send(data) {

    if (
        !ws ||
        ws.readyState !==
            WebSocket.OPEN
    ) {

        console.warn(
            "WebSocket is not open:",
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
   MESSAGE HANDLER
   ========================================================= */

function handleMessage(event) {

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
        "Deriv message:",
        data
    );


    /* -----------------------------------------
       API ERROR
       ----------------------------------------- */

    if (data.error) {

        console.error(
            "Deriv API error:",
            data.error
        );


        const message =
            data.error.message ||
            data.error.code ||
            "Deriv API error";


        setText(
            statusText,
            message
        );


        setText(
            signalExplanation,
            message
        );


        /*
         * If active_symbols itself failed,
         * use fallback markets so the UI
         * remains usable.
         */

        if (
            data.echo_req &&
            data.echo_req.active_symbols
        ) {

            loadFallbackMarkets();
        }


        return;
    }


    /* -----------------------------------------
       ACTIVE SYMBOLS
       ----------------------------------------- */

    if (
        data.msg_type ===
        "active_symbols"
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
                "Deriv returned an empty active_symbols list. Using fallback markets."
            );


            loadFallbackMarkets();

        } else {

            loadMarkets(
                symbols
            );
        }


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
}


/* =========================================================
   NORMALIZE MARKET
   ========================================================= */

function normalizeMarket(item) {

    if (!item) {
        return null;
    }


    /*
     * Support both current and legacy
     * Deriv market field names.
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
        item.pip_size ||
        item.pip ||
        "";


    return {

        symbol:
            String(symbol),

        name:
            String(name),

        type:
            String(type),

        pip:
            Number(pip) || 0

    };
}


/* =========================================================
   LOAD MARKETS
   ========================================================= */

function loadMarkets(symbols) {

    if (
        !Array.isArray(symbols)
    ) {

        console.error(
            "Invalid market list:",
            symbols
        );

        loadFallbackMarkets();

        return;
    }


    console.log(
        "Markets received:",
        symbols.length
    );


    const normalized =
        symbols
            .map(
                normalizeMarket
            )
            .filter(Boolean);


    /*
     * Prefer synthetic indices.
     */

    let usable =
        normalized.filter(
            market => {

                const symbol =
                    market.symbol;

                const type =
                    market.type;


                return (
                    type ===
                        "synthetic_index" ||

                    type ===
                        "synthetic" ||

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
     * If the API returned markets but
     * our filter didn't recognize them,
     * use all normalized markets.
     */

    if (!usable.length) {

        usable =
            normalized;
    }


    if (!usable.length) {

        loadFallbackMarkets();

        return;
    }


    populateMarketSelect(
        usable,
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
   POPULATE MARKET SELECT
   ========================================================= */

function populateMarketSelect(
    markets,
    fallback = false
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

            if (!market.symbol) {
                return;
            }


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
            "No markets were returned by Deriv."
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
            ? "Using the synthetic-market fallback list."
            : "Choose a market to start analysis."
    );


    /*
     * Automatically select the first
     * market if nothing is selected.
     */

    if (
        marketSelect.value === ""
    ) {

        marketSelect.selectedIndex =
            1;
    }


    /*
     * Do NOT automatically subscribe here.
     * The user can select a market,
     * and the change handler starts it.
     */
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
   SUBSCRIBE TO MARKET
   ========================================================= */

function subscribeToMarket(symbol) {

    if (
        !connected ||
        !ws ||
        ws.readyState !==
            WebSocket.OPEN
    ) {

        console.warn(
            "Cannot subscribe. WebSocket is not connected."
        );

        return;
    }


    /*
     * Forget previous subscription.
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
        Math.max(
            10,
            Math.min(
                5000,
                Number(
                    tickCount?.value
                ) || 1000
            )
        );


    /*
     * Request historical ticks first.
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
     * Then subscribe to live ticks.
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
            "History response missing:",
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
            "No tick history received for this market."
        );

        return;
    }


    ticks = [];


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


            ticks.push({

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


    const max =
        Math.max(
            10,
            Math.min(
                5000,
                Number(
                    tickCount?.value
                ) || 1000
            )
        );


    if (
        ticks.length > max
    ) {

        ticks =
            ticks.slice(
                -max
            );
    }


    updateDisplay();


    analyze();


    setText(
        statusText,
        `Live • ${ticks.length} ticks`
    );
}


/* =========================================================
   LIVE TICK
   ========================================================= */

function processTick(data) {

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
        return;
    }


    /*
     * Update pip size from tick
     * when available.
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
        Math.max(
            10,
            Math.min(
                5000,
                Number(
                    tickCount?.value
                ) || 1000
            )
        );


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
        formatPrice(
            price
        )
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


    const selectedBarrier =
        safeNumber(
            barrier?.value,
            5
        );


    const selectedThreshold =
        safeNumber(
            threshold?.value,
            60
        );


    let result;


    /*
     * DIFFERS MODE
     */

    if (
        currentMode === "diff" &&
        currentType === "MATCH"
    ) {

        result =
            calculateDiffers(
                selectedBarrier
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
                        selectedBarrier
                    );

                break;


            case "UNDER":

                result =
                    calculateUnder(
                        selectedBarrier
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
        safeNumber(
            result.confidence
        );


    setText(
        bestConfidence,
        confidence.toFixed(1)
    );


    if (confidenceBar) {

        confidenceBar.style.width =
            `${Math.max(
                0,
                Math.min(
                    100,
                    confidence
                )
            )}%`;
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


    if (
        confidence >=
        selectedThreshold
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


    let best = 0;


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
            `Digit ${best} appeared ${counts[best]} times out of ${ticks.length} ticks.`

    };
}


/* =========================================================
   DIFFERS
   ========================================================= */

function calculateDiffers(
    digit
) {

    const selectedDigit =
        Math.max(
            0,
            Math.min(
                9,
                Math.round(
                    safeNumber(
                        digit,
                        0
                    )
                )
            )
        );


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
        (
            differs /
            ticks.length
        ) * 100;


    return {

        display:
            `≠${selectedDigit}`,

        title:
            `DIFFERS ${selectedDigit}`,

        confidence:
            confidence,

        explanation:
            `Digit ${selectedDigit} did not appear on ${differs} of the last ${ticks.length} ticks.`

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
            `${wins} of ${ticks.length} recent digits were above ${digit}.`

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
            `${wins} of ${ticks.length} recent digits were below ${digit}.`

    };
}


/* =========================================================
   EVEN
   ========================================================= */

function calculateEven() {

    const wins =
        ticks.filter(
            tick =>
                tick.digit % 2 ===
                0
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
            `${wins} of ${ticks.length} recent digits were even.`

    };
}


/* =========================================================
   ODD
   ========================================================= */

function calculateOdd() {

    const wins =
        ticks.filter(
            tick =>
                tick.digit % 2 !==
                0
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
            `${wins} of ${ticks.length} recent digits were odd.`

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


        /*
         * This matches your CSS.
         */

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


    /*
     * Reconnect.
     */

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
        "WebSocket error. Check the browser console."
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


        currentSubscriptionId =
            null;
    }


    if (ws) {

        try {

            ws.close();

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
                    "Wait for tick data before scanning."
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
        "change",
        analyze
    );


    threshold.addEventListener(
        "input",
        analyze
    );
}


/* =========================================================
   BARRIER
   ========================================================= */

if (barrier) {

    barrier.addEventListener(
        "change",
        analyze
    );


    barrier.addEventListener(
        "input",
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
   INITIAL STATE
   ========================================================= */

console.log(
    "Matches Signal Scanner loaded successfully."
);


console.log(
    "Deriv endpoint:",
    DERIV_WS
);


console.log(
    "Analysis mode: NO AUTOMATIC TRADING"
);


updateConnectionUI(
    "offline",
    "Ready to connect"
);
