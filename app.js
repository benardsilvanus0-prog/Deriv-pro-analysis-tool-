// ==========================================================
// DERIV DIGIT ANALYSIS TOOL - COMPLETE APP.JS
// ==========================================================

"use strict";


// ==========================================================
// CONFIGURATION
// ==========================================================

const APP_ID = 1089;

let ws = null;

let ticks = [];

let currentSymbol = null;

let pipSize = 2;

let maxTicks = 1000;

let tickSubscriptionId = null;

let autoScanTimer = null;

let currentMode = "match";

let currentType = "MATCH";


// ==========================================================
// ELEMENT HELPER
// ==========================================================

function $(id) {
    return document.getElementById(id);
}


// ==========================================================
// SAFE TEXT UPDATE
// ==========================================================

function setText(id, value) {

    const element = $(id);

    if (element) {
        element.textContent = value;
    }

}


// ==========================================================
// STATUS
// ==========================================================

function updateStatus(message, connected) {

    setText("statusText", message);

    const dot = $("connectionDot");
    const badge = $("liveBadge");

    if (dot) {

        dot.className =
            connected
                ? "connection-dot online"
                : "connection-dot offline";

    }

    if (badge) {

        badge.textContent =
            connected
                ? "LIVE"
                : "OFFLINE";

        badge.classList.toggle(
            "live",
            connected
        );

    }

}


// ==========================================================
// CONNECT BUTTON STATE
// ==========================================================

function setConnectButton(text) {

    const button = $("connectBtn");

    if (button) {
        button.textContent = text;
    }

}


// ==========================================================
// CONNECT TO DERIV
// ==========================================================

function connectDeriv() {

    // Already connected
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        updateStatus(
            "Already connected",
            true
        );

        return;

    }


    // Close old connection
    if (ws) {

        try {
            ws.close();
        } catch (e) {}

    }


    ticks = [];

    currentSymbol = null;

    tickSubscriptionId = null;


    setConnectButton(
        "⏳ Connecting..."
    );


    updateStatus(
        "Connecting to Deriv...",
        false
    );


    try {

        ws = new WebSocket(
            "wss://ws.derivws.com/websockets/v3?app_id=" +
            APP_ID
        );

    } catch (error) {

        updateStatus(
            "WebSocket could not start",
            false
        );

        setConnectButton(
            "⚡ Connect Scanner"
        );

        return;

    }


    // ======================================================
    // OPEN
    // ======================================================

    ws.onopen = function () {

        console.log(
            "DERIV WEBSOCKET CONNECTED"
        );


        updateStatus(
            "Connected - loading markets...",
            true
        );


        setConnectButton(
            "🟢 Connected"
        );


        // Request all active symbols
        ws.send(
            JSON.stringify({

                active_symbols: "full",

                req_id: 1

            })
        );

    };


    // ======================================================
    // MESSAGE
    // ======================================================

    ws.onmessage = function (event) {

        let data;

        try {

            data = JSON.parse(
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
            "DERIV:",
            data
        );


        // ==================================================
        // API ERROR
        // ==================================================

        if (data.error) {

            console.error(
                "DERIV API ERROR:",
                data.error
            );


            updateStatus(
                "API Error: " +
                (
                    data.error.message ||
                    "Unknown error"
                ),
                false
            );


            setConnectButton(
                "⚡ Connect Scanner"
            );


            return;

        }


        // ==================================================
        // ACTIVE SYMBOLS
        // ==================================================

        if (
            data.msg_type ===
            "active_symbols"
        ) {

            loadMarkets(
                data.active_symbols
            );

            return;

        }


        // ==================================================
        // HISTORY
        // ==================================================

        if (
            data.msg_type ===
            "history"
        ) {

            loadHistory(
                data.history
            );

            return;

        }


        // ==================================================
        // LIVE TICK
        // ==================================================

        if (
            data.msg_type ===
            "tick"
        ) {

            receiveTick(
                data.tick
            );


            // Save subscription ID
            if (
                data.subscription &&
                data.subscription.id
            ) {

                tickSubscriptionId =
                    data.subscription.id;

            }


            return;

        }

    };


    // ======================================================
    // ERROR
    // ======================================================

    ws.onerror = function (error) {

        console.error(
            "WebSocket error:",
            error
        );


        updateStatus(
            "WebSocket connection error",
            false
        );


        setConnectButton(
            "⚡ Connect Scanner"
        );

    };


    // ======================================================
    // CLOSE
    // ======================================================

    ws.onclose = function () {

        console.log(
            "Deriv WebSocket closed"
        );


        tickSubscriptionId = null;


        updateStatus(
            "Disconnected",
            false
        );


        setConnectButton(
            "⚡ Connect Scanner"
        );

    };

}


// ==========================================================
// LOAD MARKETS
// ==========================================================

function loadMarkets(markets) {

    const select =
        $("marketSelect");


    if (!select) {
        return;
    }


    select.innerHTML = "";


    if (
        !Array.isArray(markets) ||
        markets.length === 0
    ) {

        select.innerHTML =
            '<option value="">No markets received</option>';


        updateStatus(
            "Deriv returned no active markets",
            false
        );


        return;

    }


    let validMarkets = [];


    markets.forEach(
        function (market) {

            const symbol =
                market.underlying_symbol ||
                market.symbol;


            const name =
                market.display_name ||
                market.underlying_symbol_name ||
                symbol;


            if (!symbol) {
                return;
            }


            // Prevent duplicates
            if (
                validMarkets.some(
                    m => m.symbol === symbol
                )
            ) {

                return;

            }


            validMarkets.push({

                symbol: symbol,

                name: name,

                pip:
                    Number(
                        market.pip_size
                    ) || 2

            });

        }
    );


    if (
        validMarkets.length === 0
    ) {

        select.innerHTML =
            '<option value="">No valid markets</option>';


        updateStatus(
            "No valid markets found",
            false
        );


        return;

    }


    // ======================================================
    // CREATE OPTIONS
    // ======================================================

    validMarkets.forEach(
        function (market) {

            const option =
                document.createElement(
                    "option"
                );


            option.value =
                market.symbol;


            option.textContent =
                market.name;


            option.dataset.pip =
                market.pip;


            select.appendChild(
                option
            );

        }
    );


    // ======================================================
    // PREFER SYNTHETIC MARKETS
    // ======================================================

    let preferredIndex = -1;


    const preferredWords = [

        "volatility",

        "1hz",

        "jump",

        "boom",

        "crash",

        "step",

        "range",

        "drift"

    ];


    for (
        let i = 0;
        i < select.options.length;
        i++
    ) {

        const text =
            select.options[i]
                .textContent
                .toLowerCase();


        if (
            preferredWords.some(
                word =>
                    text.includes(word)
            )
        ) {

            preferredIndex = i;

            break;

        }

    }


    if (
        preferredIndex >= 0
    ) {

        select.selectedIndex =
            preferredIndex;

    }


    console.log(
        "MARKETS LOADED:",
        select.options.length
    );


    updateStatus(
        select.options.length +
        " markets loaded",
        true
    );


    setConnectButton(
        "🟢 Connected"
    );


    // Automatically start selected market
    subscribeMarket();

}


// ==========================================================
// UNSUBSCRIBE OLD TICKS
// ==========================================================

function unsubscribeOldTicks() {

    if (
        !ws ||
        ws.readyState !==
        WebSocket.OPEN
    ) {

        return;

    }


    if (tickSubscriptionId) {

        try {

            ws.send(
                JSON.stringify({

                    forget:
                        tickSubscriptionId

                })
            );

        } catch (error) {

            console.error(
                "Could not unsubscribe:",
                error
            );

        }

        tickSubscriptionId = null;

    }

}


// ==========================================================
// SUBSCRIBE MARKET
// ==========================================================

function subscribeMarket() {

    if (
        !ws ||
        ws.readyState !==
        WebSocket.OPEN
    ) {

        return;

    }


    const select =
        $("marketSelect");


    if (!select) {
        return;
    }


    const symbol =
        select.value;


    if (!symbol) {

        updateStatus(
            "Select a market",
            false
        );

        return;

    }


    // Stop previous subscription
    unsubscribeOldTicks();


    currentSymbol =
        symbol;


    maxTicks =
        Number(
            $("tickCount")?.value
        ) || 1000;


    const option =
        select.options[
            select.selectedIndex
        ];


    pipSize =
        Number(
            option?.dataset?.pip
        ) || 2;


    setText(
        "marketName",
        option?.textContent || symbol
    );


    setText(
        "tickStatus",
        "Loading ticks..."
    );


    setText(
        "livePrice",
        "-"
    );


    setText(
        "lastDigit",
        "-"
    );


    ticks = [];


    showWaitingSignal();


    console.log(
        "SUBSCRIBING TO:",
        currentSymbol
    );


    // ======================================================
    // REQUEST HISTORY
    // ======================================================

    ws.send(
        JSON.stringify({

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

        })
    );


    // ======================================================
    // LIVE TICK SUBSCRIPTION
    // ======================================================

    ws.send(
        JSON.stringify({

            ticks:
                currentSymbol,

            subscribe:
                1,

            req_id:
                3

        })
    );


    updateStatus(
        "Receiving " +
        currentSymbol +
        " data",
        true
    );

}


// ==========================================================
// LOAD HISTORY
// ==========================================================

function loadHistory(history) {

    if (
        !history ||
        !Array.isArray(
            history.prices
        )
    ) {

        console.warn(
            "No tick history received"
        );

        return;

    }


    // Use API pip size if supplied
    if (
        history.pip_size !==
        undefined
    ) {

        pipSize =
            Number(
                history.pip_size
            ) || pipSize;

    }


    ticks =
        history.prices
            .map(Number)
            .filter(
                Number.isFinite
            );


    if (
        ticks.length >
        maxTicks
    ) {

        ticks =
            ticks.slice(
                -maxTicks
            );

    }


    setText(
        "tickStatus",
        ticks.length +
        " ticks"
    );


    console.log(
        "HISTORY LOADED:",
        ticks.length
    );


    renderRecentDigits();

    renderDigitStatistics();

    analyzeMarket();

}


// ==========================================================
// RECEIVE LIVE TICK
// ==========================================================

function receiveTick(tick) {

    if (!tick) {
        return;
    }


    const price =
        Number(tick.quote);


    if (
        !Number.isFinite(price)
    ) {

        return;

    }


    if (
        tick.pip_size !==
        undefined
    ) {

        pipSize =
            Number(
                tick.pip_size
            ) || pipSize;

    }


    const formatted =
        price.toFixed(
            pipSize
        );


    setText(
        "livePrice",
        formatted
    );


    const digit =
        getLastDigit(
            formatted
        );


    setText(
        "lastDigit",
        digit
    );


    ticks.push(price);


    if (
        ticks.length >
        maxTicks
    ) {

        ticks.shift();

    }


    setText(
        "tickStatus",
        ticks.length +
        " ticks"
    );


    renderRecentDigits();

    renderDigitStatistics();

    analyzeMarket();

}


// ==========================================================
// GET LAST DIGIT
// ==========================================================

function getLastDigit(price) {

    const text =
        String(price);


    const decimal =
        text.split(".")[1];


    if (
        decimal &&
        decimal.length > 0
    ) {

        return Number(
            decimal[
                decimal.length - 1
            ]
        );

    }


    // Fallback
    const digits =
        text.match(/\d/g);


    if (
        !digits ||
        digits.length === 0
    ) {

        return 0;

    }


    return Number(
        digits[
            digits.length - 1
        ]
    );

}


// ==========================================================
// GET ALL DIGITS
// ==========================================================

function getDigits() {

    return ticks.map(
        function (price) {

            const formatted =
                Number(price).toFixed(
                    pipSize
                );


            return getLastDigit(
                formatted
            );

        }
    );

}


// ==========================================================
// DIGIT COUNTS
// ==========================================================

function getDigitCounts() {

    const counts =
        Array(10).fill(0);


    const digits =
        getDigits();


    digits.forEach(
        function (digit) {

            if (
                digit >= 0 &&
                digit <= 9
            ) {

                counts[digit]++;

            }

        }
    );


    return counts;

}


// ==========================================================
// DIGIT STATISTICS UI
// ==========================================================

function renderDigitStatistics() {

    const grid =
        $("digitGrid");


    if (!grid) {
        return;
    }


    const counts =
        getDigitCounts();


    const total =
        counts.reduce(
            (a, b) => a + b,
            0
        );


    grid.innerHTML = "";


    for (
        let digit = 0;
        digit <= 9;
        digit++
    ) {

        const percent =
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
            "digit-stat";


        box.innerHTML = `

            <div class="digit-number">
                ${digit}
            </div>

            <div class="digit-count">
                ${counts[digit]} hits
            </div>

            <div class="digit-percent">
                ${percent.toFixed(1)}%
            </div>

        `;


        grid.appendChild(
            box
        );

    }

}


// ==========================================================
// RECENT DIGITS
// ==========================================================

function renderRecentDigits() {

    const container =
        $("recentDigits");


    if (!container) {
        return;
    }


    const digits =
        getDigits()
            .slice(-30)
            .reverse();


    container.innerHTML = "";


    digits.forEach(
        function (digit) {

            const item =
                document.createElement(
                    "span"
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


// ==========================================================
// ANALYZE MARKET
// ==========================================================

function analyzeMarket() {

    const digits =
        getDigits();


    if (
        digits.length < 10
    ) {

        showWaitingSignal();

        return;

    }


    let result;


    switch (
        currentType
    ) {

        case "MATCH":

            result =
                analyzeMatch(
                    digits
                );

            break;


        case "DIFFER":

            result =
                analyzeDifferent(
                    digits
                );

            break;


        case "OVER":

            result =
                analyzeOver(
                    digits
                );

            break;


        case "UNDER":

            result =
                analyzeUnder(
                    digits
                );

            break;


        case "EVEN":

            result =
                analyzeEven(
                    digits
                );

            break;


        case "ODD":

            result =
                analyzeOdd(
                    digits
                );

            break;


        default:

            result =
                analyzeMatch(
                    digits
                );

    }


    if (!result) {
        return;
    }


    displaySignal(
        result
    );

}


// ==========================================================
// MATCH
// ==========================================================

function analyzeMatch(digits) {

    const barrier =
        Number(
            $("barrier")?.value
        );


    const hits =
        digits.filter(
            digit =>
                digit === barrier
        ).length;


    const confidence =
        (hits / digits.length) *
        100;


    return {

        type: "MATCH",

        digit: barrier,

        confidence:
            confidence,

        hits: hits,

        total:
            digits.length,

        text:
            "Digit " +
            barrier +
            " appeared " +
            hits +
            " times in the selected history."

    };

}


// ==========================================================
// DIFFER
// ==========================================================

function analyzeDifferent(digits) {

    const barrier =
        Number(
            $("barrier")?.value
        );


    const hits =
        digits.filter(
            digit =>
                digit !== barrier
        ).length;


    const confidence =
        (hits / digits.length) *
        100;


    return {

        type: "DIFFER",

        digit: barrier,

        confidence:
            confidence,

        hits: hits,

        total:
            digits.length,

        text:
            "Digits different from " +
            barrier +
            " occurred " +
            hits +
            " times."

    };

}


// ==========================================================
// OVER
// ==========================================================

function analyzeOver(digits) {

    const barrier =
        Number(
            $("barrier")?.value
        );


    const hits =
        digits.filter(
            digit =>
                digit > barrier
        ).length;


    const confidence =
        (hits / digits.length) *
        100;


    return {

        type: "OVER",

        digit: barrier,

        confidence:
            confidence,

        hits: hits,

        total:
            digits.length,

        text:
            "Digits above " +
            barrier +
            " occurred " +
            hits +
            " times."

    };

}


// ==========================================================
// UNDER
// ==========================================================

function analyzeUnder(digits) {

    const barrier =
        Number(
            $("barrier")?.value
        );


    const hits =
        digits.filter(
            digit =>
                digit < barrier
        ).length;


    const confidence =
        (hits / digits.length) *
        100;


    return {

        type: "UNDER",

        digit: barrier,

        confidence:
            confidence,

        hits: hits,

        total:
            digits.length,

        text:
            "Digits below " +
            barrier +
            " occurred " +
            hits +
            " times."

    };

}


// ==========================================================
// EVEN
// ==========================================================

function analyzeEven(digits) {

    const hits =
        digits.filter(
            digit =>
                digit % 2 === 0
        ).length;


    const confidence =
        (hits / digits.length) *
        100;


    return {

        type: "EVEN",

        digit: "EVEN",

        confidence:
            confidence,

        hits: hits,

        total:
            digits.length,

        text:
            "Even digits occurred " +
            hits +
            " times."

    };

}


// ==========================================================
// ODD
// ==========================================================

function analyzeOdd(digits) {

    const hits =
        digits.filter(
            digit =>
                digit % 2 !== 0
        ).length;


    const confidence =
        (hits / digits.length) *
        100;


    return {

        type: "ODD",

        digit: "ODD",

        confidence:
            confidence,

        hits: hits,

        total:
            digits.length,

        text:
            "Odd digits occurred " +
            hits +
            " times."

    };

}


// ==========================================================
// DISPLAY SIGNAL
// ==========================================================

function displaySignal(result) {

    const threshold =
        Number(
            $("threshold")?.value
        ) || 65;


    const confidence =
        Math.max(
            0,
            Math.min(
                100,
                result.confidence
            )
        );


    setText(
        "bestDigit",
        result.digit
    );


    setText(
        "bestConfidence",
        confidence.toFixed(1)
    );


    const bar =
        $("confidenceBar");


    if (bar) {

        bar.style.width =
            confidence.toFixed(1) +
            "%";

    }


    // ======================================================
    // SIGNAL TITLE
    // ======================================================

    let title =
        result.type;


    if (
        result.type ===
        "MATCH"
    ) {

        title =
            "Trade MATCH " +
            result.digit;

    }


    if (
        result.type ===
        "DIFFER"
    ) {

        title =
            "Trade DIFFER " +
            result.digit;

    }


    if (
        result.type ===
        "OVER"
    ) {

        title =
            "Trade OVER " +
            result.digit;

    }


    if (
        result.type ===
        "UNDER"
    ) {

        title =
            "Trade UNDER " +
            result.digit;

    }


    if (
        result.type ===
        "EVEN"
    ) {

        title =
            "Trade EVEN";

    }


    if (
        result.type ===
        "ODD"
    ) {

        title =
            "Trade ODD";

    }


    setText(
        "signalTitle",
        title
    );


    setText(
        "signalExplanation",
        result.text
    );


    // ======================================================
    // ENTRY STATUS
    // ======================================================

    const entry =
        $("entryStatus");


    if (!entry) {
        return;
    }


    entry.classList.remove(
        "waiting",
        "ready",
        "weak"
    );


    if (
        confidence >=
        threshold
    ) {

        entry.classList.add(
            "ready"
        );


        entry.textContent =
            "🟢 ENTRY CONDITION MET";

    } else {

        entry.classList.add(
            "weak"
        );


        entry.textContent =
            "🟡 WAIT - BELOW " +
            threshold +
            "%";

    }

}


// ==========================================================
// WAITING SCREEN
// ==========================================================

function showWaitingSignal() {

    setText(
        "bestDigit",
        "-"
    );


    setText(
        "bestConfidence",
        "0.0"
    );


    setText(
        "signalTitle",
        "Waiting for market"
    );


    setText(
        "signalExplanation",
        "Collecting tick data..."
    );


    const bar =
        $("confidenceBar");


    if (bar) {
        bar.style.width = "0%";
    }


    const entry =
        $("entryStatus");


    if (entry) {

        entry.className =
            "entry-status waiting";

        entry.textContent =
            "⏳ WAITING FOR DATA";

    }

}


// ==========================================================
// MODE BUTTONS
// ==========================================================

function setupModeButtons() {

    const buttons =
        document.querySelectorAll(
            ".mode"
        );


    buttons.forEach(
        function (button) {

            button.addEventListener(
                "click",
                function () {

                    buttons.forEach(
                        b =>
                            b.classList.remove(
                                "active"
                            )
                    );


                    button.classList.add(
                        "active"
                    );


                    currentMode =
                        button.dataset.mode ||
                        "match";


                    if (
                        currentMode ===
                        "diff"
                    ) {

                        currentType =
                            "DIFFER";

                    } else {

                        currentType =
                            "MATCH";

                    }


                    analyzeMarket();

                }
            );

        }
    );

}


// ==========================================================
// TYPE BUTTONS
// ==========================================================

function setupTypeButtons() {

    const buttons =
        document.querySelectorAll(
            ".type-button"
        );


    buttons.forEach(
        function (button) {

            button.addEventListener(
                "click",
                function () {

                    buttons.forEach(
                        b =>
                            b.classList.remove(
                                "active"
                            )
                    );


                    button.classList.add(
                        "active"
                    );


                    currentType =
                        button.dataset.type ||
                        "MATCH";


                    // Keep Matches/Differs mode
                    if (
                        currentType ===
                        "DIFFER"
                    ) {

                        currentMode =
                            "diff";

                    } else {

                        currentMode =
                            "match";

                    }


                    analyzeMarket();

                }
            );

        }
    );

}


// ==========================================================
// BARRIER CHANGE
// ==========================================================

function setupBarrier() {

    const barrier =
        $("barrier");


    if (!barrier) {
        return;
    }


    barrier.addEventListener(
        "change",
        function () {

            analyzeMarket();

        }
    );

}


// ==========================================================
// THRESHOLD CHANGE
// ==========================================================

function setupThreshold() {

    const threshold =
        $("threshold");


    if (!threshold) {
        return;
    }


    threshold.addEventListener(
        "change",
        function () {

            analyzeMarket();

        }
    );

}


// ==========================================================
// MARKET CHANGE
// ==========================================================

function setupMarket() {

    const market =
        $("marketSelect");


    if (!market) {
        return;
    }


    market.addEventListener(
        "change",
        function () {

            subscribeMarket();

        }
    );

}


// ==========================================================
// TICK COUNT CHANGE
// ==========================================================

function setupTickCount() {

    const tickCount =
        $("tickCount");


    if (!tickCount) {
        return;
    }


    tickCount.addEventListener(
        "change",
        function () {

            if (
                ws &&
                ws.readyState ===
                WebSocket.OPEN
            ) {

                subscribeMarket();

            }

        }
    );

}


// ==========================================================
// RESCAN
// ==========================================================

function setupScanButton() {

    const button =
        $("scanBtn");


    if (!button) {
        return;
    }


    button.addEventListener(
        "click",
        function () {

            if (
                !ws ||
                ws.readyState !==
                WebSocket.OPEN
            ) {

                connectDeriv();

                return;

            }


            subscribeMarket();

        }
    );

}


// ==========================================================
// AUTO SCAN
// ==========================================================

function setupAutoScan() {

    const checkbox =
        $("autoScan");


    if (!checkbox) {
        return;
    }


    function updateAutoScan() {

        if (autoScanTimer) {

            clearInterval(
                autoScanTimer
            );

            autoScanTimer = null;

        }


        if (
            checkbox.checked
        ) {

            autoScanTimer =
                setInterval(
                    function () {

                        if (
                            ws &&
                            ws.readyState ===
                            WebSocket.OPEN &&
                            currentSymbol
                        ) {

                            console.log(
                                "AUTO SCAN"
                            );


                            analyzeMarket();

                        }

                    },
                    30000
                );

        }

    }


    checkbox.addEventListener(
        "change",
        updateAutoScan
    );


    updateAutoScan();

}


// ==========================================================
// INITIALIZE
// ==========================================================

document.addEventListener(
    "DOMContentLoaded",
    function () {

        console.log(
            "Deriv Digit Analyzer loaded"
        );


        // Connect button
        const connectButton =
            $("connectBtn");


        if (connectButton) {

            connectButton.addEventListener(
                "click",
                connectDeriv
            );

        }


        setupModeButtons();

        setupTypeButtons();

        setupBarrier();

        setupThreshold();

        setupMarket();

        setupTickCount();

        setupScanButton();

        setupAutoScan();


        showWaitingSignal();


        renderDigitStatistics();

    }
);
