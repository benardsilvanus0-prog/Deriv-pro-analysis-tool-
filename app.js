/* =========================================================
   MATCHES SIGNAL SCANNER
   Compatible with the supplied index.html
   Analysis only - NO automatic trading
   ========================================================= */

"use strict";

/* ---------------- CONFIG ---------------- */

const DERIV_WS = "wss://ws.binaryws.com/websockets/v3";

let ws = null;
let reconnectTimer = null;
let autoScanTimer = null;

let connected = false;
let connecting = false;

let currentSymbol = "";
let currentMarket = null;

let pipSize = 2;
let ticks = [];

let currentMode = "match";
let currentType = "MATCH";

let requestId = 1;


/* ---------------- DOM ---------------- */

const $ = (id) => document.getElementById(id);

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


/* ---------------- HELPERS ---------------- */

function setText(element, value) {
    if (element) {
        element.textContent = value;
    }
}


function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}


function decimalPlacesFromPip(pip) {
    const n = Number(pip);

    if (!Number.isFinite(n) || n <= 0) {
        return 2;
    }

    if (n >= 1) {
        return 0;
    }

    return Math.max(0, Math.round(-Math.log10(n)));
}


function formatPrice(price) {
    const places = decimalPlacesFromPip(pipSize);

    return Number(price).toFixed(places);
}


function getLastDigit(price) {
    const places = decimalPlacesFromPip(pipSize);

    const formatted = Number(price).toFixed(places);

    const digits = formatted.replace(/\D/g, "");

    if (!digits.length) {
        return null;
    }

    return Number(digits.charAt(digits.length - 1));
}


function updateConnectionUI(state, message = "") {

    if (connectionDot) {
        connectionDot.classList.remove("online", "offline", "connecting");

        if (state === "online") {
            connectionDot.classList.add("online");
        } else if (state === "connecting") {
            connectionDot.classList.add("connecting");
        } else {
            connectionDot.classList.add("offline");
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
            (state === "online"
                ? "Connected"
                : state === "connecting"
                    ? "Connecting..."
                    : "Disconnected");
    }
}


/* ---------------- CONNECT ---------------- */

function connectDeriv() {

    if (connecting || connected) {
        return;
    }

    connecting = true;

    updateConnectionUI("connecting", "Connecting to Deriv...");

    setText(signalTitle, "Connecting...");
    setText(signalExplanation, "Connecting to Deriv market data...");

    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = "⏳ Connecting...";
    }

    try {

        ws = new WebSocket(DERIV_WS);

        ws.onopen = handleOpen;
        ws.onmessage = handleMessage;
        ws.onerror = handleError;
        ws.onclose = handleClose;

    } catch (error) {

        console.error("WebSocket creation error:", error);

        connecting = false;

        updateConnectionUI("offline", "Connection failed");

        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.textContent = "⚡ Connect Scanner";
        }
    }
}


/* ---------------- OPEN ---------------- */

function handleOpen() {

    console.log("Deriv WebSocket connected");

    connected = true;
    connecting = false;

    updateConnectionUI("online", "Connected");

    if (connectBtn) {
        connectBtn.disabled = false;
        connectBtn.textContent = "🔌 Connected";
    }

    setText(signalTitle, "Select a market");
    setText(signalExplanation, "Choose a market to start analysis.");

    /*
       Deriv's public market-data API supports active_symbols.
       product_type: basic is included for compatibility with
       the WebSocket v3 endpoint.
    */

    send({
        active_symbols: "brief",
        product_type: "basic",
        req_id: nextRequestId()
    });
}


/* ---------------- SEND ---------------- */

function send(data) {

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket is not open:", data);
        return false;
    }

    try {
        ws.send(JSON.stringify(data));
        return true;
    } catch (error) {
        console.error("WebSocket send error:", error);
        return false;
    }
}


function nextRequestId() {
    return requestId++;
}


/* ---------------- MESSAGE ---------------- */

function handleMessage(event) {

    let data;

    try {
        data = JSON.parse(event.data);
    } catch (error) {
        console.error("Invalid JSON from Deriv:", event.data);
        return;
    }

    console.log("Deriv:", data);

    /* API error */

    if (data.error) {

        console.error("Deriv API error:", data.error);

        setText(statusText, data.error.message || "API Error");
        setText(signalExplanation, data.error.message || "Deriv API error.");

        return;
    }


    /* Active symbols */

    if (data.msg_type === "active_symbols") {

        loadMarkets(data.active_symbols || []);

        return;
    }


    /* Historical ticks */

    if (data.msg_type === "history") {

        processHistory(data);

        return;
    }


    /* Live tick */

    if (data.msg_type === "tick") {

        processTick(data);

        return;
    }


    /* Subscription */

    if (data.msg_type === "tick") {
        return;
    }
}


/* ---------------- MARKETS ---------------- */

function loadMarkets(symbols) {

    if (!Array.isArray(symbols)) {
        console.error("No active_symbols array:", symbols);
        return;
    }

    console.log("Markets received:", symbols.length);

    /*
       Prefer synthetic indices because digit contracts are
       commonly analysed there.

       If filtering produces nothing, show all available markets.
    */

    let usable = symbols.filter(item => {

        const type =
            item.symbol_type ||
            item.underlying_symbol_type ||
            "";

        return (
            type === "synthetic_index" ||
            type === "synthetic" ||
            String(item.symbol || item.underlying_symbol || "")
                .match(/^(R_|1HZ|BOOM|CRASH|JD|stp)/i)
        );
    });


    if (!usable.length) {
        usable = symbols;
    }


    usable.sort((a, b) => {

        const nameA =
            a.display_name ||
            a.underlying_symbol_name ||
            a.symbol ||
            a.underlying_symbol ||
            "";

        const nameB =
            b.display_name ||
            b.underlying_symbol_name ||
            b.symbol ||
            b.underlying_symbol ||
            "";

        return String(nameA).localeCompare(String(nameB));
    });


    marketSelect.innerHTML = "";

    const placeholder = document.createElement("option");

    placeholder.value = "";
    placeholder.textContent = "Select market";

    marketSelect.appendChild(placeholder);


    usable.forEach(item => {

        const symbol =
            item.symbol ||
            item.underlying_symbol;

        if (!symbol) {
            return;
        }

        const name =
            item.display_name ||
            item.underlying_symbol_name ||
            symbol;

        const option = document.createElement("option");

        option.value = symbol;
        option.textContent = `${name} (${symbol})`;

        option.dataset.pip =
            item.pip ||
            item.pip_size ||
            "";

        option.dataset.name = name;

        marketSelect.appendChild(option);
    });


    console.log(
        "Markets loaded:",
        marketSelect.options.length - 1
    );


    if (marketSelect.options.length <= 1) {

        setText(
            signalExplanation,
            "Deriv connected, but no markets were returned."
        );

        return;
    }


    setText(
        statusText,
        `${marketSelect.options.length - 1} markets loaded`
    );
}


/* ---------------- MARKET CHANGE ---------------- */

function handleMarketChange() {

    const symbol = marketSelect.value;

    if (!symbol) {
        return;
    }

    currentSymbol = symbol;

    const option =
        marketSelect.options[marketSelect.selectedIndex];

    currentMarket = {
        symbol: symbol,
        name: option.dataset.name || symbol
    };


    const selectedPip = Number(option.dataset.pip);

    if (Number.isFinite(selectedPip) && selectedPip > 0) {
        pipSize = selectedPip;
    }


    ticks = [];

    clearAnalysis();

    setText(
        marketName,
        currentMarket.name
    );

    setText(
        signalTitle,
        currentMarket.name
    );

    setText(
        signalExplanation,
        "Loading tick history..."
    );

    setText(
        statusText,
        "Loading ticks..."
    );


    subscribeToMarket(symbol);
}


/* ---------------- SUBSCRIBE ---------------- */

function subscribeToMarket(symbol) {

    if (!connected || !ws) {
        return;
    }


    /*
       Ask for historical ticks first.
    */

    const count =
        Math.max(
            10,
            Number(tickCount.value) || 1000
        );


    send({
        ticks_history: symbol,
        count: count,
        end: "latest",
        style: "ticks",
        req_id: nextRequestId()
    });


    /*
       Then subscribe to live ticks.
    */

    send({
        ticks: symbol,
        subscribe: 1,
        req_id: nextRequestId()
    });


    setText(
        statusText,
        `Streaming ${symbol}`
    );
}


/* ---------------- HISTORY ---------------- */

function processHistory(data) {

    if (!data.history) {
        console.warn("History response missing history:", data);
        return;
    }


    const prices = data.history.prices || [];
    const times = data.history.times || [];


    if (!prices.length) {

        setText(
            signalExplanation,
            "No tick history received for this market."
        );

        return;
    }


    ticks = [];


    prices.forEach((price, index) => {

        const numericPrice = Number(price);

        if (!Number.isFinite(numericPrice)) {
            return;
        }

        const digit = getLastDigit(numericPrice);

        if (digit === null) {
            return;
        }

        ticks.push({
            price: numericPrice,
            digit: digit,
            epoch: times[index] || Date.now() / 1000
        });
    });


    const max =
        Number(tickCount.value) || 1000;

    if (ticks.length > max) {
        ticks = ticks.slice(-max);
    }


    updateDisplay();

    analyze();


    setText(
        statusText,
        `Live • ${ticks.length} ticks`
    );
}


/* ---------------- LIVE TICK ---------------- */

function processTick(data) {

    if (!data.tick) {
        return;
    }


    const price = Number(data.tick.quote);

    if (!Number.isFinite(price)) {
        return;
    }


    /*
       Use market pip information if Deriv supplies it.
    */

    if (
        data.tick.pip_size !== undefined &&
        Number(data.tick.pip_size) > 0
    ) {
        pipSize = Number(data.tick.pip_size);
    }


    const digit = getLastDigit(price);

    if (digit === null) {
        return;
    }


    ticks.push({
        price: price,
        digit: digit,
        epoch:
            Number(data.tick.epoch) ||
            Date.now() / 1000
    });


    const max =
        Number(tickCount.value) || 1000;


    if (ticks.length > max) {
        ticks = ticks.slice(-max);
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


/* ---------------- ANALYSIS ---------------- */

function analyze() {

    if (!ticks.length) {

        setText(bestConfidence, "0.0");
        setText(bestDigit, "-");

        if (confidenceBar) {
            confidenceBar.style.width = "0%";
        }

        return;
    }


    const selectedBarrier =
        Number(barrier.value);


    const selectedThreshold =
        Number(threshold.value);


    let result;


    /*
       DIFFERS mode
    */

    if (
        currentMode === "diff" &&
        currentType === "MATCH"
    ) {

        result = calculateDiffers(
            selectedBarrier
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
        Number(result.confidence) || 0;


    setText(
        bestConfidence,
        confidence.toFixed(1)
    );


    if (confidenceBar) {

        const width =
            Math.max(
                0,
                Math.min(100, confidence)
            );

        confidenceBar.style.width =
            `${width}%`;
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


    if (confidence >= selectedThreshold) {

        setText(
            entryStatus,
            "🟢 ENTRY CONDITION MET"
        );

        entryStatus.classList.remove(
            "waiting"
        );

        entryStatus.classList.add(
            "ready"
        );

    } else {

        setText(
            entryStatus,
            "⏳ WAITING FOR STRONGER SIGNAL"
        );

        entryStatus.classList.remove(
            "ready"
        );

        entryStatus.classList.add(
            "waiting"
        );
    }
}


/* ---------------- MATCH ---------------- */

function calculateMatch() {

    const counts = Array(10).fill(0);

    ticks.forEach(tick => {
        counts[tick.digit]++;
    });


    let best = 0;

    for (let i = 1; i < 10; i++) {

        if (counts[i] > counts[best]) {
            best = i;
        }
    }


    const confidence =
        (counts[best] / ticks.length) * 100;


    return {

        display: String(best),

        title: `MATCH ${best}`,

        confidence: confidence,

        explanation:
            `Digit ${best} appeared ${counts[best]} times out of ${ticks.length} ticks.`
    };
}


/* ---------------- DIFFERS ---------------- */

function calculateDiffers(digit) {

    const matches =
        ticks.filter(
            tick => tick.digit === digit
        ).length;


    const differs =
        ticks.length - matches;


    const confidence =
        (differs / ticks.length) * 100;


    return {

        display: `≠${digit}`,

        title: `DIFFERS ${digit}`,

        confidence: confidence,

        explanation:
            `Digit ${digit} did not appear on ${differs} of the last ${ticks.length} ticks.`
    };
}


/* ---------------- OVER ---------------- */

function calculateOver(barrierDigit) {

    const wins =
        ticks.filter(
            tick => tick.digit > barrierDigit
        ).length;


    const confidence =
        (wins / ticks.length) * 100;


    return {

        display: `>${barrierDigit}`,

        title: `OVER ${barrierDigit}`,

        confidence: confidence,

        explanation:
            `${wins} of ${ticks.length} recent digits were above ${barrierDigit}.`
    };
}


/* ---------------- UNDER ---------------- */

function calculateUnder(barrierDigit) {

    const wins =
        ticks.filter(
            tick => tick.digit < barrierDigit
        ).length;


    const confidence =
        (wins / ticks.length) * 100;


    return {

        display: `<${barrierDigit}`,

        title: `UNDER ${barrierDigit}`,

        confidence: confidence,

        explanation:
            `${wins} of ${ticks.length} recent digits were below ${barrierDigit}.`
    };
}


/* ---------------- EVEN ---------------- */

function calculateEven() {

    const wins =
        ticks.filter(
            tick => tick.digit % 2 === 0
        ).length;


    const confidence =
        (wins / ticks.length) * 100;


    return {

        display: "EVEN",

        title: "EVEN",

        confidence: confidence,

        explanation:
            `${wins} of ${ticks.length} recent digits were even.`
    };
}


/* ---------------- ODD ---------------- */

function calculateOdd() {

    const wins =
        ticks.filter(
            tick => tick.digit % 2 !== 0
        ).length;


    const confidence =
        (wins / ticks.length) * 100;


    return {

        display: "ODD",

        title: "ODD",

        confidence: confidence,

        explanation:
            `${wins} of ${ticks.length} recent digits were odd.`
    };
}


/* ---------------- DIGIT GRID ---------------- */

function updateDigitGrid() {

    if (!digitGrid) {
        return;
    }


    const counts = Array(10).fill(0);


    ticks.forEach(tick => {
        counts[tick.digit]++;
    });


    digitGrid.innerHTML = "";


    for (let digit = 0; digit <= 9; digit++) {

        const percentage =
            ticks.length
                ? (counts[digit] / ticks.length) * 100
                : 0;


        const box =
            document.createElement("div");


        box.className = "digit-stat";


        box.innerHTML = `
            <strong>${digit}</strong>
            <span>${counts[digit]}</span>
            <small>${percentage.toFixed(1)}%</small>
        `;


        digitGrid.appendChild(box);
    }
}


/* ---------------- RECENT DIGITS ---------------- */

function updateRecentDigits() {

    if (!recentDigits) {
        return;
    }


    recentDigits.innerHTML = "";


    const recent =
        ticks.slice(-30);


    recent.forEach(tick => {

        const item =
            document.createElement("span");


        item.className = "recent-digit";


        item.textContent =
            String(tick.digit);


        recentDigits.appendChild(item);
    });
}


/* ---------------- DISPLAY ---------------- */

function updateDisplay() {

    if (!ticks.length) {
        return;
    }


    const latest =
        ticks[ticks.length - 1];


    setText(
        livePrice,
        formatPrice(latest.price)
    );


    setText(
        lastDigit,
        String(latest.digit)
    );


    setText(
        tickStatus,
        `${ticks.length} ticks`
    );


    updateDigitGrid();
    updateRecentDigits();
}


/* ---------------- CLEAR ---------------- */

function clearAnalysis() {

    setText(livePrice, "-");
    setText(lastDigit, "-");
    setText(bestDigit, "-");
    setText(bestConfidence, "0.0");

    if (confidenceBar) {
        confidenceBar.style.width = "0%";
    }


    setText(
        tickStatus,
        "0 ticks"
    );


    if (digitGrid) {
        digitGrid.innerHTML = "";
    }


    if (recentDigits) {
        recentDigits.innerHTML = "";
    }


    setText(
        entryStatus,
        "⏳ WAITING FOR DATA"
    );


    setText(
        signalExplanation,
        "Loading market data..."
    );
}


/* ---------------- SCAN ---------------- */

function scanMarket() {

    if (!currentSymbol) {

        setText(
            signalExplanation,
            "Select a market first."
        );

        return;
    }


    /*
       Re-request history.
    */

    send({
        ticks_history: currentSymbol,
        count:
            Number(tickCount.value) || 1000,
        end: "latest",
        style: "ticks",
        req_id: nextRequestId()
    });


    setText(
        statusText,
        "Scanning market..."
    );
}


/* ---------------- AUTO SCAN ---------------- */

function startAutoScan() {

    stopAutoScan();


    if (!autoScan || !autoScan.checked) {
        return;
    }


    autoScanTimer =
        setInterval(() => {

            if (
                connected &&
                currentSymbol
            ) {
                scanMarket();
            }

        }, 30000);
}


function stopAutoScan() {

    if (autoScanTimer) {

        clearInterval(
            autoScanTimer
        );

        autoScanTimer = null;
    }
}


/* ---------------- MODE BUTTONS ---------------- */

function setupModeButtons() {

    const buttons =
        document.querySelectorAll(
            ".mode"
        );


    buttons.forEach(button => {

        button.addEventListener(
            "click",
            () => {

                buttons.forEach(btn =>
                    btn.classList.remove(
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
    });
}


/* ---------------- TYPE BUTTONS ---------------- */

function setupTypeButtons() {

    const buttons =
        document.querySelectorAll(
            ".type-button"
        );


    buttons.forEach(button => {

        button.addEventListener(
            "click",
            () => {

                buttons.forEach(btn =>
                    btn.classList.remove(
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
    });
}


/* ---------------- CLOSE ---------------- */

function handleClose(event) {

    console.warn(
        "Deriv WebSocket closed:",
        event.code,
        event.reason
    );


    connected = false;
    connecting = false;


    updateConnectionUI(
        "offline",
        "Disconnected"
    );


    if (connectBtn) {
        connectBtn.disabled = false;
        connectBtn.textContent =
            "⚡ Connect Scanner";
    }


    setText(
        signalTitle,
        "Disconnected"
    );


    setText(
        signalExplanation,
        "Connection to Deriv was closed."
    );


    /*
       Automatically reconnect after 5 seconds.
    */

    if (!reconnectTimer) {

        reconnectTimer =
            setTimeout(() => {

                reconnectTimer = null;

                if (!connected) {
                    connectDeriv();
                }

            }, 5000);
    }
}


/* ---------------- ERROR ---------------- */

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
        "WebSocket connection error. Check the browser console."
    );
}


/* ---------------- DISCONNECT ---------------- */

function disconnectDeriv() {

    stopAutoScan();


    if (ws) {

        try {
            ws.close();
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


    if (connectBtn) {
        connectBtn.disabled = false;
        connectBtn.textContent =
            "⚡ Connect Scanner";
    }
}


/* ---------------- EVENTS ---------------- */

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
        scanMarket
    );
}


if (tickCount) {

    tickCount.addEventListener(
        "change",
        () => {

            if (currentSymbol) {
                scanMarket();
            }
        }
    );
}


if (threshold) {

    threshold.addEventListener(
        "change",
        analyze
    );
}


if (barrier) {

    barrier.addEventListener(
        "change",
        analyze
    );
}


if (autoScan) {

    autoScan.addEventListener(
        "change",
        () => {

            if (autoScan.checked) {
                startAutoScan();
            } else {
                stopAutoScan();
            }
        }
    );
}


/* ---------------- START UI ---------------- */

setupModeButtons();
setupTypeButtons();

updateConnectionUI(
    "offline",
    "Disconnected"
);

console.log(
    "Matches Signal Scanner loaded successfully."
);
