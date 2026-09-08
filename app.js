// ============================================
// DERIV DIGIT ANALYSIS TOOL
// MARKET CONNECTION + LIVE TICKS
// ============================================

let ws = null;
let ticks = [];
let currentSymbol = null;
let pipSize = 2;
let maxTicks = 1000;

let selectedMode = "match";
let selectedType = "MATCH";

const APP_ID = 1089;


// ============================================
// ELEMENT HELPER
// ============================================

function $(id) {
    return document.getElementById(id);
}


// ============================================
// STATUS
// ============================================

function setStatus(message, connected = false) {

    const statusText = $("statusText");

    if (statusText) {
        statusText.textContent = message;
    }

    const dot = $("connectionDot");

    if (dot) {
        dot.className =
            "connection-dot " +
            (connected ? "online" : "offline");
    }

    const badge = $("liveBadge");

    if (badge) {

        badge.textContent =
            connected ? "LIVE" : "OFFLINE";

        if (connected) {
            badge.classList.add("live");
        } else {
            badge.classList.remove("live");
        }
    }
}


// ============================================
// CONNECT TO DERIV
// ============================================

function connectDeriv() {

    // Close old connection first

    if (ws) {

        try {
            ws.close();
        } catch (error) {
            console.log(error);
        }
    }


    setStatus("Connecting to Deriv...", false);


    $("connectBtn").textContent =
        "⏳ Connecting...";


    // Official Deriv WebSocket

    const websocketURL =
        `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;


    console.log(
        "Connecting:",
        websocketURL
    );


    try {

        ws = new WebSocket(websocketURL);

    } catch (error) {

        console.error(error);

        setStatus(
            "Could not create WebSocket",
            false
        );

        $("connectBtn").textContent =
            "⚡ Connect Scanner";

        return;
    }


    // =========================================
    // CONNECTION OPEN
    // =========================================

    ws.onopen = function () {

        console.log(
            "CONNECTED TO DERIV"
        );


        setStatus(
            "Connected - loading markets...",
            true
        );


        $("connectBtn").textContent =
            "🟢 Connected";


        // Load active markets

        sendRequest({
            active_symbols: "brief",
            product_type: "basic",
            req_id: 100
        });

    };


    // =========================================
    // RECEIVE DATA
    // =========================================

    ws.onmessage = function (event) {

        let data;

        try {

            data = JSON.parse(event.data);

        } catch (error) {

            console.error(
                "JSON ERROR:",
                error
            );

            return;
        }


        console.log(
            "DERIV RESPONSE:",
            data
        );


        // API ERROR

        if (data.error) {

            console.error(
                "DERIV API ERROR:",
                data.error
            );


            setStatus(
                "API Error: " +
                data.error.message,
                false
            );

            return;
        }


        // ACTIVE SYMBOLS

        if (
            data.msg_type ===
            "active_symbols"
        ) {

            console.log(
                "Markets received:",
                data.active_symbols.length
            );


            loadMarkets(
                data.active_symbols
            );

            return;
        }


        // TICK HISTORY

        if (
            data.msg_type ===
            "history"
        ) {

            loadHistory(
                data.history
            );

            return;
        }


        // LIVE TICK

        if (
            data.msg_type ===
            "tick"
        ) {

            handleLiveTick(
                data.tick
            );

            return;
        }

    };


    // =========================================
    // ERROR
    // =========================================

    ws.onerror = function (error) {

        console.error(
            "WEBSOCKET ERROR:",
            error
        );


        setStatus(
            "WebSocket connection failed",
            false
        );


        $("connectBtn").textContent =
            "⚡ Connect Scanner";

    };


    // =========================================
    // CLOSED
    // =========================================

    ws.onclose = function (event) {

        console.log(
            "WebSocket closed:",
            event.code,
            event.reason
        );


        setStatus(
            "Disconnected",
            false
        );


        $("connectBtn").textContent =
            "⚡ Connect Scanner";

    };

}


// ============================================
// SEND REQUEST
// ============================================

function sendRequest(request) {

    if (!ws) {

        console.error(
            "WebSocket does not exist"
        );

        return false;
    }


    if (
        ws.readyState !==
        WebSocket.OPEN
    ) {

        console.error(
            "WebSocket is not open"
        );

        return false;
    }


    console.log(
        "SENDING:",
        request
    );


    ws.send(
        JSON.stringify(request)
    );


    return true;
}


// ============================================
// LOAD MARKETS
// ============================================

function loadMarkets(symbols) {

    const marketSelect =
        $("marketSelect");


    marketSelect.innerHTML = "";


    // Check response

    if (
        !symbols ||
        !Array.isArray(symbols) ||
        symbols.length === 0
    ) {

        setStatus(
            "No markets received from Deriv",
            false
        );

        return;
    }


    // Filter usable markets

    const validMarkets =
        symbols.filter(function (market) {

            const symbol =
                market.underlying_symbol ||
                market.symbol;


            return (
                symbol &&
                typeof symbol === "string"
            );

        });


    console.log(
        "Valid markets:",
        validMarkets.length
    );


    // Prefer Volatility / Synthetic markets

    let syntheticMarkets =
        validMarkets.filter(function (market) {

            const name =
                (
                    market.underlying_symbol_name ||
                    market.display_name ||
                    ""
                ).toLowerCase();


            const marketType =
                (
                    market.market ||
                    ""
                ).toLowerCase();


            return (

                name.includes("volatility") ||
                name.includes("jump") ||
                name.includes("step") ||
                marketType.includes("synthetic")

            );

        });


    // If no synthetic filter results,
    // show all valid markets

    if (
        syntheticMarkets.length === 0
    ) {

        syntheticMarkets =
            validMarkets;

    }


    // Sort markets

    syntheticMarkets.sort(
        function (a, b) {

            const nameA =
                a.underlying_symbol_name ||
                a.display_name ||
                a.underlying_symbol ||
                a.symbol;


            const nameB =
                b.underlying_symbol_name ||
                b.display_name ||
                b.underlying_symbol ||
                b.symbol;


            return nameA.localeCompare(
                nameB
            );

        }
    );


    // Create market options

    syntheticMarkets.forEach(
        function (market) {

            const option =
                document.createElement("option");


            const symbol =
                market.underlying_symbol ||
                market.symbol;


            const name =
                market.underlying_symbol_name ||
                market.display_name ||
                symbol;


            option.value = symbol;

            option.textContent = name;

            option.dataset.pip =
                market.pip_size ||
                market.pip ||
                2;


            marketSelect.appendChild(option);

        }
    );


    // Check again

    if (
        marketSelect.options.length === 0
    ) {

        setStatus(
            "Markets could not be loaded",
            false
        );

        return;
    }


    // Select first market

    currentSymbol =
        marketSelect.value;


    $("marketName").textContent =
        marketSelect.options[
            marketSelect.selectedIndex
        ].textContent;


    setStatus(
        marketSelect.options.length +
        " markets loaded",
        true
    );


    // Automatically load first market

    subscribeToMarket();

}


// ============================================
// SUBSCRIBE TO MARKET
// ============================================

function subscribeToMarket() {

    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
    ) {

        setStatus(
            "Connect to Deriv first",
            false
        );

        return;
    }


    const marketSelect =
        $("marketSelect");


    const symbol =
        marketSelect.value;


    // VERY IMPORTANT CHECK

    if (
        !symbol ||
        symbol === "" ||
        symbol === "undefined"
    ) {

        setStatus(
            "Please select a market",
            false
        );

        return;
    }


    console.log(
        "SUBSCRIBING TO:",
        symbol
    );


    currentSymbol = symbol;


    maxTicks =
        Number(
            $("tickCount").value
        );


    // Get pip size

    const option =
        marketSelect.options[
            marketSelect.selectedIndex
        ];


    pipSize =
        Number(
            option.dataset.pip
        ) || 2;


    // Clear old ticks

    ticks = [];


    $("tickStatus").textContent =
        "Loading " +
        maxTicks +
        " ticks...";


    $("marketName").textContent =
        option.textContent;


    setStatus(
        "Loading " +
        option.textContent,
        true
    );


    // =========================================
    // GET TICK HISTORY
    // =========================================

    sendRequest({

        ticks_history: symbol,

        count: maxTicks,

        end: "latest",

        style: "ticks",

        req_id: 200

    });


    // =========================================
    // SUBSCRIBE LIVE TICKS
    // =========================================

    sendRequest({

        ticks: symbol,

        subscribe: 1,

        req_id: 300

    });

}


// ============================================
// LOAD HISTORY
// ============================================

function loadHistory(history) {

    if (!history) {

        console.error(
            "No history received"
        );

        return;
    }


    if (
        !history.prices ||
        !Array.isArray(history.prices)
    ) {

        console.error(
            "Invalid history:",
            history
        );

        return;
    }


    ticks =
        history.prices
        .map(Number)
        .filter(function (price) {

            return Number.isFinite(price);

        });


    // Limit ticks

    ticks =
        ticks.slice(-maxTicks);


    $("tickStatus").textContent =
        ticks.length +
        " ticks loaded";


    console.log(
        "History loaded:",
        ticks.length
    );


    analyzeMarket();

}


// ============================================
// LIVE TICK
// ============================================

function handleLiveTick(tick) {

    if (!tick) return;


    const price =
        Number(tick.quote);


    if (
        !Number.isFinite(price)
    ) {

        return;
    }


    // Update pip size

    if (
        tick.pip_size !== undefined
    ) {

        pipSize =
            Number(tick.pip_size) ||
            pipSize;

    }


    const formattedPrice =
        price.toFixed(pipSize);


    $("livePrice").textContent =
        formattedPrice;


    const digit =
        getLastDigit(formattedPrice);


    $("lastDigit").textContent =
        digit;


    ticks.push(price);


    // Keep selected history size

    if (
        ticks.length >
        maxTicks
    ) {

        ticks.shift();

    }


    $("tickStatus").textContent =
        ticks.length +
        " ticks";


    renderRecentDigits();


    if (
        ticks.length >= 20
    ) {

        analyzeMarket();

    }

}


// ============================================
// GET LAST DIGIT
// ============================================

function getLastDigit(price) {

    const formatted =
        Number(price)
        .toFixed(pipSize);


    const digits =
        formatted.match(/\d/g);


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


// ============================================
// GET DIGITS
// ============================================

function getDigits() {

    return ticks.map(
        function (price) {

            return getLastDigit(price);

        }
    );

}


// ============================================
// ANALYZE MARKET
// ============================================

function analyzeMarket() {

    if (
        ticks.length < 20
    ) {

        return;
    }


    const digits =
        getDigits();


    const total =
        digits.length;


    const frequency =
        Array(10).fill(0);


    digits.forEach(
        function (digit) {

            frequency[digit]++;

        }
    );


    renderDigitGrid(
        frequency,
        total
    );


    let signal;


    if (
        selectedType === "MATCH"
    ) {

        signal =
            getMatchSignal(
                frequency,
                total
            );

    }


    else if (
        selectedType === "OVER"
    ) {

        signal =
            getOverSignal(
                digits,
                total
            );

    }


    else if (
        selectedType === "UNDER"
    ) {

        signal =
            getUnderSignal(
                digits,
                total
            );

    }


    else if (
        selectedType === "EVEN"
    ) {

        signal =
            getEvenSignal(
                digits,
                total
            );

    }


    else if (
        selectedType === "ODD"
    ) {

        signal =
            getOddSignal(
                digits,
                total
            );

    }


    if (signal) {

        updateSignal(signal);

    }

}


// ============================================
// MATCH / DIFFER SIGNAL
// ============================================

function getMatchSignal(
    frequency,
    total
) {

    let digit;


    if (
        selectedMode === "match"
    ) {

        digit =
            frequency.indexOf(
                Math.max(...frequency)
            );

    }

    else {

        digit =
            frequency.indexOf(
                Math.min(...frequency)
            );

    }


    const count =
        frequency[digit];


    const confidence =
        (count / total) * 100;


    return {

        title:

            selectedMode === "match"

                ? "MATCH " + digit

                : "DIFFERS " + digit,


        digit: digit,


        confidence: confidence,


        explanation:

            "Based on " +
            total +
            " analyzed ticks, digit " +
            digit +
            " appeared " +
            count +
            " times."

    };

}


// ============================================
// OVER SIGNAL
// ============================================

function getOverSignal(digits, total) {

    const b =
        Number($("barrier").value);


    const count =
        digits.filter(
            d => d > b
        ).length;


    return {

        title: "OVER " + b,

        digit: "↑",

        confidence:
            count / total * 100,

        explanation:
            count +
            " digits were above " +
            b

    };

}


// ============================================
// UNDER SIGNAL
// ============================================

function getUnderSignal(digits, total) {

    const b =
        Number($("barrier").value);


    const count =
        digits.filter(
            d => d < b
        ).length;


    return {

        title: "UNDER " + b,

        digit: "↓",

        confidence:
            count / total * 100,

        explanation:
            count +
            " digits were below " +
            b

    };

}


// ============================================
// EVEN SIGNAL
// ============================================

function getEvenSignal(digits, total) {

    const count =
        digits.filter(
            d => d % 2 === 0
        ).length;


    return {

        title: "EVEN",

        digit: "E",

        confidence:
            count / total * 100,

        explanation:
            count +
            " digits were even"

    };

}


// ============================================
// ODD SIGNAL
// ============================================

function getOddSignal(digits, total) {

    const count =
        digits.filter(
            d => d % 2 !== 0
        ).length;


    return {

        title: "ODD",

        digit: "O",

        confidence:
            count / total * 100,

        explanation:
            count +
            " digits were odd"

    };

}


// ============================================
// UPDATE SIGNAL
// ============================================

function updateSignal(signal) {

    $("signalTitle").textContent =
        signal.title;


    $("bestDigit").textContent =
        signal.digit;


    $("bestConfidence").textContent =
        signal.confidence.toFixed(1);


    $("confidenceBar").style.width =
        Math.min(
            signal.confidence,
            100
        ) + "%";


    $("signalExplanation").textContent =
        signal.explanation;


    const threshold =
        Number(
            $("threshold").value
        );


    const entryStatus =
        $("entryStatus");


    if (
        signal.confidence >= threshold
    ) {

        entryStatus.textContent =
            "🟢 SIGNAL MEETS ENTRY LEVEL";


        entryStatus.className =
            "entry-status ready";

    }

    else {

        entryStatus.textContent =
            "🟡 WAIT — BELOW ENTRY LEVEL";


        entryStatus.className =
            "entry-status waiting";

    }

}


// ============================================
// DIGIT STATISTICS
// ============================================

function renderDigitGrid(
    frequency,
    total
) {

    const grid =
        $("digitGrid");


    grid.innerHTML = "";


    const highest =
        Math.max(...frequency);


    for (
        let digit = 0;
        digit < 10;
        digit++
    ) {

        const percent =
            frequency[digit] /
            total *
            100;


        const item =
            document.createElement("div");


        item.className =
            "digit-item";


        if (
            frequency[digit] === highest
        ) {

            item.classList.add("hot");

        }


        item.innerHTML = `

            <div class="digit-number">

                ${digit}

            </div>

            <div class="digit-percent">

                ${percent.toFixed(1)}%

            </div>

        `;


        grid.appendChild(item);

    }

}


// ============================================
// RECENT DIGITS
// ============================================

function renderRecentDigits() {

    const container =
        $("recentDigits");


    container.innerHTML = "";


    const digits =
        getDigits().slice(-30);


    digits.forEach(
        function (digit) {

            const item =
                document.createElement("div");


            item.className =
                "recent-digit";


            item.textContent =
                digit;


            container.appendChild(item);

        }
    );

}


// ============================================
// CONNECT BUTTON
// ============================================

$("connectBtn").addEventListener(
    "click",
    connectDeriv
);


// ============================================
// MARKET CHANGE
// ============================================

$("marketSelect").addEventListener(
    "change",
    function () {

        subscribeToMarket();

    }
);


// ============================================
// TICK COUNT CHANGE
// ============================================

$("tickCount").addEventListener(
    "change",
    function () {

        if (
            ws &&
            ws.readyState === WebSocket.OPEN
        ) {

            subscribeToMarket();

        }

    }
);


// ============================================
// SCAN BUTTON
// ============================================

$("scanBtn").addEventListener(
    "click",
    function () {

        analyzeMarket();

    }
);


// ============================================
// SIGNAL TYPE BUTTONS
// ============================================

document
    .querySelectorAll(".type-button")
    .forEach(
        function (button) {

            button.addEventListener(
                "click",
                function () {

                    document
                        .querySelectorAll(
                            ".type-button"
                        )
                        .forEach(
                            function (b) {

                                b.classList.remove(
                                    "active"
                                );

                            }
                        );


                    button.classList.add(
                        "active"
                    );


                    selectedType =
                        button.dataset.type;


                    analyzeMarket();

                }
            );

        }
    );


// ============================================
// MATCH / DIFFER MODE
// ============================================

document
    .querySelectorAll(".mode")
    .forEach(
        function (button) {

            button.addEventListener(
                "click",
                function () {

                    document
                        .querySelectorAll(".mode")
                        .forEach(
                            function (b) {

                                b.classList.remove(
                                    "active"
                                );

                            }
                        );


                    button.classList.add(
                        "active"
                    );


                    selectedMode =
                        button.dataset.mode;


                    analyzeMarket();

                }
            );

        }
    );
