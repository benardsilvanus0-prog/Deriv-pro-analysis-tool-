// ======================================================
// DERIV DIGIT ANALYZER PRO
// WebSocket Market Data + Digit Analysis
// Matches / Differs / Over / Under / Even / Odd
// ======================================================

let ws = null;

let ticks = [];
let currentSymbol = "";
let currentPipSize = 2;
let maxTicks = 1000;
let currentMode = "match";
let currentType = "MATCH";

const $ = id => document.getElementById(id);


// ======================================================
// STATUS
// ======================================================

function updateStatus(message, connected = false) {

    const status = $("statusText");
    const dot = $("connectionDot");
    const badge = $("liveBadge");

    if (status) {
        status.textContent = message;
    }

    if (dot) {
        dot.className =
            connected
                ? "connection-dot online"
                : "connection-dot offline";
    }

    if (badge) {
        badge.textContent =
            connected ? "LIVE" : "OFFLINE";

        badge.classList.toggle("live", connected);
    }
}


// ======================================================
// CONNECT
// ======================================================

function connectDeriv() {

    if (ws) {
        try {
            ws.close();
        } catch (e) {}
    }

    ticks = [];

    $("connectBtn").textContent = "Connecting...";

    updateStatus("Connecting to Deriv...", false);

    // Public market-data WebSocket
    ws = new WebSocket(
        "wss://ws.binaryws.com/websockets/v3"
    );


    ws.onopen = () => {

        console.log("CONNECTED TO DERIV");

        updateStatus(
            "Connected - loading markets...",
            true
        );

        $("connectBtn").textContent =
            "🟢 Connected";

        // Load active symbols
        ws.send(JSON.stringify({
            active_symbols: "brief",
            req_id: 1
        }));
    };


    ws.onmessage = event => {

        let data;

        try {
            data = JSON.parse(event.data);
        } catch (error) {
            console.error("Invalid JSON:", event.data);
            return;
        }

        console.log("DERIV:", data);


        // ==============================================
        // ERROR
        // ==============================================

        if (data.error) {

            console.error("DERIV ERROR:", data.error);

            updateStatus(
                "API Error: " +
                (data.error.message || "Unknown error"),
                false
            );

            $("connectBtn").textContent =
                "⚡ Connect Scanner";

            return;
        }


        // ==============================================
        // ACTIVE SYMBOLS
        // ==============================================

        if (data.msg_type === "active_symbols") {

            console.log(
                "ACTIVE SYMBOLS:",
                data.active_symbols
            );

            loadMarkets(data.active_symbols);

            return;
        }


        // ==============================================
        // HISTORY
        // ==============================================

        if (data.msg_type === "history") {

            console.log("HISTORY RECEIVED");

            if (
                data.history &&
                Array.isArray(data.history.prices)
            ) {

                ticks =
                    data.history.prices
                        .map(Number)
                        .filter(Number.isFinite)
                        .slice(-maxTicks);

                updateTickCount();

                renderRecentDigits();

                analyzeMarket();
            }

            return;
        }


        // ==============================================
        // LIVE TICK
        // ==============================================

        if (data.msg_type === "tick") {

            receiveTick(data.tick);

            return;
        }
    };


    ws.onerror = error => {

        console.error(
            "WEBSOCKET ERROR:",
            error
        );

        updateStatus(
            "WebSocket connection error",
            false
        );

        $("connectBtn").textContent =
            "⚡ Connect Scanner";
    };


    ws.onclose = () => {

        console.log("DERIV CONNECTION CLOSED");

        updateStatus(
            "Disconnected",
            false
        );

        $("connectBtn").textContent =
            "⚡ Connect Scanner";
    };
}


// ======================================================
// LOAD MARKETS
// ======================================================

function loadMarkets(markets) {

    const select = $("marketSelect");

    select.innerHTML = "";

    if (
        !Array.isArray(markets) ||
        markets.length === 0
    ) {

        select.innerHTML =
            `<option value="">
                No markets received
            </option>`;

        updateStatus(
            "Deriv returned no markets",
            false
        );

        return;
    }


    let validMarkets = 0;


    markets.forEach(market => {

        // New API field
        const symbol =
            market.underlying_symbol ||
            market.symbol;

        const name =
            market.underlying_symbol_name ||
            market.display_name ||
            symbol;

        if (!symbol) return;


        const option =
            document.createElement("option");

        option.value = symbol;

        option.textContent =
            name + " (" + symbol + ")";

        option.dataset.pip =
            market.pip_size ||
            market.pip ||
            2;

        option.dataset.market =
            market.market || "";

        select.appendChild(option);

        validMarkets++;
    });


    if (validMarkets === 0) {

        select.innerHTML =
            `<option value="">
                No valid markets
            </option>`;

        updateStatus(
            "No valid symbols received",
            false
        );

        return;
    }


    // ==================================================
    // PREFER SYNTHETIC INDICES
    // ==================================================

    let preferred = -1;


    for (
        let i = 0;
        i < select.options.length;
        i++
    ) {

        const text =
            select.options[i]
                .textContent
                .toLowerCase();

        const value =
            select.options[i]
                .value
                .toUpperCase();


        if (
            value.includes("R_") ||
            value.includes("1HZ") ||
            text.includes("volatility") ||
            text.includes("jump") ||
            text.includes("crash") ||
            text.includes("boom")
        ) {

            preferred = i;
            break;
        }
    }


    if (preferred >= 0) {

        select.selectedIndex =
            preferred;

    } else {

        select.selectedIndex = 0;
    }


    updateStatus(
        validMarkets +
        " markets loaded",
        true
    );


    $("connectBtn").textContent =
        "🟢 Connected";


    console.log(
        "SELECTED:",
        select.value
    );


    subscribeMarket();
}


// ======================================================
// SUBSCRIBE MARKET
// ======================================================

function subscribeMarket() {

    if (!ws) return;

    if (
        ws.readyState !==
        WebSocket.OPEN
    ) {
        return;
    }


    const select =
        $("marketSelect");

    const symbol =
        select.value;


    if (!symbol) {

        updateStatus(
            "Select a market first",
            false
        );

        return;
    }


    currentSymbol =
        symbol;


    maxTicks =
        Number(
            $("tickCount").value
        ) || 1000;


    const option =
        select.options[
            select.selectedIndex
        ];


    currentPipSize =
        Number(
            option.dataset.pip
        ) || 2;


    $("marketName").textContent =
        option.textContent;


    $("tickStatus").textContent =
        "Loading ticks...";


    ticks = [];


    // ==============================================
    // GET HISTORY
    // ==============================================

    ws.send(JSON.stringify({

        ticks_history: currentSymbol,

        count: maxTicks,

        end: "latest",

        style: "ticks",

        req_id: 2

    }));


    // ==============================================
    // LIVE TICKS
    // ==============================================

    ws.send(JSON.stringify({

        ticks: currentSymbol,

        subscribe: 1,

        req_id: 3

    }));


    updateStatus(
        "Receiving " +
        currentSymbol +
        " ticks",
        true
    );


    $("signalTitle").textContent =
        "Collecting market data";


    $("signalExplanation").textContent =
        "Analyzing the latest ticks from " +
        currentSymbol + "...";
}


// ======================================================
// RECEIVE TICK
// ======================================================

function receiveTick(tick) {

    if (!tick) return;


    const price =
        Number(tick.quote);


    if (!Number.isFinite(price)) {
        return;
    }


    if (
        tick.pip_size !== undefined
    ) {

        currentPipSize =
            Number(tick.pip_size) ||
            currentPipSize;
    }


    const formatted =
        price.toFixed(
            currentPipSize
        );


    $("livePrice").textContent =
        formatted;


    const digit =
        getLastDigit(formatted);


    $("lastDigit").textContent =
        digit;


    ticks.push(price);


    if (
        ticks.length >
        maxTicks
    ) {

        ticks.shift();
    }


    updateTickCount();

    renderRecentDigits();

    analyzeMarket();
}


// ======================================================
// LAST DIGIT
// ======================================================

function getLastDigit(value) {

    const text =
        String(value);


    const match =
        text.match(/\d/g);


    if (!match) {
        return 0;
    }


    return Number(
        match[match.length - 1]
    );
}


// ======================================================
// DIGIT ARRAY
// ======================================================

function getDigits() {

    return ticks.map(price => {

        const formatted =
            Number(price)
                .toFixed(currentPipSize);

        return getLastDigit(
            formatted
        );

    });
}


// ======================================================
// UPDATE TICK COUNT
// ======================================================

function updateTickCount() {

    $("tickStatus").textContent =
        ticks.length +
        " ticks";
}


// ======================================================
// ANALYSIS
// ======================================================

function analyzeMarket() {

    const digits =
        getDigits();


    if (digits.length < 20) {

        $("signalTitle").textContent =
            "Collecting ticks...";

        $("bestDigit").textContent =
            "-";

        $("bestConfidence").textContent =
            "0.0";

        $("confidenceBar").style.width =
            "0%";

        $("entryStatus").textContent =
            "⏳ COLLECTING DATA";

        return;
    }


    const counts =
        Array(10).fill(0);


    digits.forEach(digit => {
        counts[digit]++;
    });


    const total =
        digits.length;


    const percentages =
        counts.map(
            count =>
                (count / total) * 100
        );


    renderDigitGrid(
        counts,
        percentages,
        total
    );


    let bestDigit = 0;


    for (
        let i = 1;
        i < 10;
        i++
    ) {

        if (
            percentages[i] >
            percentages[bestDigit]
        ) {

            bestDigit = i;
        }
    }


    let confidence =
        percentages[bestDigit];


    // ==============================================
    // TYPE ANALYSIS
    // ==============================================

    if (
        currentType === "OVER"
    ) {

        const barrier =
            Number(
                $("barrier").value
            );

        const overCount =
            digits.filter(
                d => d > barrier
            ).length;

        confidence =
            (overCount / total) * 100;

    }


    if (
        currentType === "UNDER"
    ) {

        const barrier =
            Number(
                $("barrier").value
            );

        const underCount =
            digits.filter(
                d => d < barrier
            ).length;

        confidence =
            (underCount / total) * 100;
    }


    if (
        currentType === "EVEN"
    ) {

        const evenCount =
            digits.filter(
                d => d % 2 === 0
            ).length;

        confidence =
            (evenCount / total) * 100;
    }


    if (
        currentType === "ODD"
    ) {

        const oddCount =
            digits.filter(
                d => d % 2 !== 0
            ).length;

        confidence =
            (oddCount / total) * 100;
    }


    if (
        currentType === "MATCH"
    ) {

        const barrier =
            Number(
                $("barrier").value
            );

        confidence =
            percentages[barrier];

        bestDigit =
            barrier;
    }


    confidence =
        Math.min(
            100,
            Math.max(
                0,
                confidence
            )
        );


    // ==============================================
    // DISPLAY
    // ==============================================

    $("bestDigit").textContent =
        bestDigit;


    $("bestConfidence").textContent =
        confidence.toFixed(1);


    $("confidenceBar").style.width =
        confidence + "%";


    $("signalTitle").textContent =
        getSignalName(
            currentType,
            bestDigit
        );


    $("signalExplanation").textContent =
        getExplanation(
            currentType,
            bestDigit,
            confidence
        );


    const threshold =
        Number(
            $("threshold").value
        );


    if (
        confidence >= threshold
    ) {

        $("entryStatus").textContent =
            "🟢 ENTRY CONDITION MET";

        $("entryStatus").className =
            "entry-status ready";

    } else {

        $("entryStatus").textContent =
            "🟡 WAIT FOR BETTER SETUP";

        $("entryStatus").className =
            "entry-status waiting";
    }
}


// ======================================================
// SIGNAL NAME
// ======================================================

function getSignalName(
    type,
    digit
) {

    switch (type) {

        case "MATCH":
            return "MATCH " + digit;

        case "OVER":
            return "OVER " +
                $("barrier").value;

        case "UNDER":
            return "UNDER " +
                $("barrier").value;

        case "EVEN":
            return "EVEN";

        case "ODD":
            return "ODD";

        default:
            return "Signal";
    }
}


// ======================================================
// EXPLANATION
// ======================================================

function getExplanation(
    type,
    digit,
    confidence
) {

    if (type === "MATCH") {

        return (
            "Digit " +
            digit +
            " appeared most strongly " +
            "in the selected tick history. " +
            "Observed frequency: " +
            confidence.toFixed(1) +
            "%."
        );
    }


    if (type === "OVER") {

        return (
            confidence.toFixed(1) +
            "% of analyzed digits were " +
            "above barrier " +
            $("barrier").value +
            "."
        );
    }


    if (type === "UNDER") {

        return (
            confidence.toFixed(1) +
            "% of analyzed digits were " +
            "below barrier " +
            $("barrier").value +
            "."
        );
    }


    if (type === "EVEN") {

        return (
            confidence.toFixed(1) +
            "% of analyzed digits were even."
        );
    }


    if (type === "ODD") {

        return (
            confidence.toFixed(1) +
            "% of analyzed digits were odd."
        );
    }


    return "Statistical analysis.";
}


// ======================================================
// DIGIT GRID
// ======================================================

function renderDigitGrid(
    counts,
    percentages,
    total
) {

    const grid =
        $("digitGrid");


    if (!grid) return;


    grid.innerHTML = "";


    for (
        let digit = 0;
        digit <= 9;
        digit++
    ) {

        const box =
            document.createElement("div");


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
                ${percentages[digit].toFixed(1)}%
            </div>

        `;


        grid.appendChild(box);
    }
}


// ======================================================
// RECENT DIGITS
// ======================================================

function renderRecentDigits() {

    const container =
        $("recentDigits");


    if (!container) return;


    const digits =
        getDigits()
            .slice(-30)
            .reverse();


    container.innerHTML = "";


    digits.forEach(digit => {

        const span =
            document.createElement("span");


        span.textContent =
            digit;


        span.className =
            "recent-digit";


        container.appendChild(span);
    });
}


// ======================================================
// MODE BUTTONS
// ======================================================

document
    .querySelectorAll(".mode")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                document
                    .querySelectorAll(".mode")
                    .forEach(b =>
                        b.classList.remove(
                            "active"
                        )
                    );

                button.classList.add(
                    "active"
                );

                currentMode =
                    button.dataset.mode;

                analyzeMarket();
            }
        );
    });


// ======================================================
// TYPE BUTTONS
// ======================================================

document
    .querySelectorAll(".type-button")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                document
                    .querySelectorAll(
                        ".type-button"
                    )
                    .forEach(b =>
                        b.classList.remove(
                            "active"
                        )
                    );

                button.classList.add(
                    "active"
                );

                currentType =
                    button.dataset.type;

                analyzeMarket();
            }
        );
    });


// ======================================================
// CONNECT
// ======================================================

$("connectBtn")
    .addEventListener(
        "click",
        connectDeriv
    );


// ======================================================
// MARKET CHANGE
// ======================================================

$("marketSelect")
    .addEventListener(
        "change",
        () => {

            if (
                ws &&
                ws.readyState ===
                WebSocket.OPEN
            ) {

                subscribeMarket();
            }
        }
    );


// ======================================================
// TICK COUNT CHANGE
// ======================================================

$("tickCount")
    .addEventListener(
        "change",
        () => {

            if (
                ws &&
                ws.readyState ===
                WebSocket.OPEN
            ) {

                subscribeMarket();
            }
        }
    );


// ======================================================
// BARRIER CHANGE
// ======================================================

$("barrier")
    .addEventListener(
        "change",
        analyzeMarket
    );


// ======================================================
// THRESHOLD CHANGE
// ======================================================

$("threshold")
    .addEventListener(
        "change",
        analyzeMarket
    );


// ======================================================
// AUTO SCAN
// ======================================================

setInterval(() => {

    const checkbox =
        $("autoScan");

    if (
        checkbox &&
        checkbox.checked &&
        ticks.length >= 20
    ) {

        analyzeMarket();
    }

}, 30000);


// ======================================================
// START
// ======================================================

console.log(
    "Deriv Digit Analyzer loaded."
);
