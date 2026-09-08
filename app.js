// =====================================
// DERIV MATCHES SIGNAL SCANNER
// ANALYSIS ONLY
// =====================================


// CURRENT API STATE

let ws = null;

let ticks = [];

let currentSymbol = null;

let pipSize = 2;

let maxTicks = 1000;

let selectedMode = "match";

let selectedType = "MATCH";

let autoScanTimer = null;


// =====================================
// ELEMENT HELPER
// =====================================

const $ = (id) => document.getElementById(id);


// =====================================
// ELEMENTS
// =====================================

const marketSelect = $("marketSelect");

const tickCount = $("tickCount");

const threshold = $("threshold");

const barrier = $("barrier");

const connectBtn = $("connectBtn");

const scanBtn = $("scanBtn");


// =====================================
// STATUS
// =====================================

function setStatus(text, online = false) {

    $("statusText").textContent = text;


    const dot = $("connectionDot");

    dot.className =
        "connection-dot " +
        (online ? "online" : "offline");


    if (online) {

        $("liveBadge").textContent = "LIVE";

        $("liveBadge").classList.add("live");

    } else {

        $("liveBadge").textContent = "OFFLINE";

        $("liveBadge").classList.remove("live");

    }

}


// =====================================
// WEBSOCKET ENDPOINT
// =====================================

function connectDeriv() {

    // Close old connection

    if (ws) {

        try {
            ws.close();
        } catch (error) {}

    }


    setStatus("Connecting...", false);

    connectBtn.textContent =
        "⏳ Connecting...";


    /*
       Public market data connection.

       No account login is required
       for active symbols and ticks.
    */

    ws = new WebSocket(

        "wss://ws.binaryws.com/websockets/v3"

    );


    // ---------------------------------
    // CONNECTION OPEN
    // ---------------------------------

    ws.onopen = function () {

        setStatus(
            "Loading markets...",
            true
        );


        connectBtn.textContent =
            "🟢 Connected";


        // Request active symbols

        send({

            active_symbols: "brief",

            req_id: 1

        });

    };


    // ---------------------------------
    // RECEIVE DATA
    // ---------------------------------

    ws.onmessage = function (event) {

        let data;

        try {

            data = JSON.parse(event.data);

        }

        catch (error) {

            console.error(error);

            return;

        }


        console.log("DERIV:", data);


        // API ERROR

        if (data.error) {

            console.error(data.error);

            setStatus(
                "API Error: " +
                data.error.message,
                false
            );

            return;

        }


        // ACTIVE SYMBOLS

        if (data.msg_type === "active_symbols") {

            loadMarkets(
                data.active_symbols
            );

            return;

        }


        // TICK HISTORY

        if (data.msg_type === "history") {

            loadHistory(
                data.history
            );

            return;

        }


        // LIVE TICK

        if (data.msg_type === "tick") {

            handleTick(
                data.tick
            );

            return;

        }

    };


    // ---------------------------------
    // ERROR
    // ---------------------------------

    ws.onerror = function () {

        setStatus(
            "Connection error",
            false
        );


        connectBtn.textContent =
            "⚡ Connect Scanner";

    };


    // ---------------------------------
    // CLOSED
    // ---------------------------------

    ws.onclose = function () {

        setStatus(
            "Disconnected",
            false
        );


        connectBtn.textContent =
            "⚡ Connect Scanner";

    };

}


// =====================================
// SEND MESSAGE
// =====================================

function send(data) {

    if (!ws) return false;


    if (
        ws.readyState !==
        WebSocket.OPEN
    ) {

        return false;

    }


    ws.send(
        JSON.stringify(data)
    );


    return true;

}


// =====================================
// LOAD MARKETS
// =====================================

function loadMarkets(symbols) {

    marketSelect.innerHTML = "";


    if (
        !Array.isArray(symbols) ||
        symbols.length === 0
    ) {

        setStatus(
            "No markets received",
            false
        );

        return;

    }


    const markets = symbols

        .map(function (item) {

            return {

                /*
                   Supports current and
                   older field names
                */

                symbol:

                    item.underlying_symbol ||
                    item.symbol,


                name:

                    item.underlying_symbol_name ||
                    item.display_name ||
                    item.underlying_symbol ||
                    item.symbol,


                market:

                    item.market || "",


                pip:

                    item.pip_size ||
                    item.pip ||
                    2

            };

        })


        .filter(function (item) {

            return item.symbol;

        });


    // Prefer synthetic markets

    let preferredMarkets =

        markets.filter(function (item) {

            const text =

                (
                    item.name +
                    " " +
                    item.market
                ).toLowerCase();


            return (

                text.includes("volatility") ||
                text.includes("synthetic") ||
                text.includes("jump") ||
                text.includes("step")

            );

        });


    // Use all markets if filter fails

    if (
        preferredMarkets.length === 0
    ) {

        preferredMarkets = markets;

    }


    // Sort alphabetically

    preferredMarkets.sort(

        function (a, b) {

            return a.name.localeCompare(
                b.name
            );

        }

    );


    // Add options

    preferredMarkets.forEach(

        function (item) {

            const option =
                document.createElement(
                    "option"
                );


            option.value =
                item.symbol;


            option.textContent =
                item.name;


            option.dataset.pip =
                item.pip;


            marketSelect.appendChild(
                option
            );

        }

    );


    // VALID MARKET EXISTS

    if (
        marketSelect.options.length > 0
    ) {

        currentSymbol =
            marketSelect.value;


        $("marketName").textContent =
            marketSelect.options[
                marketSelect.selectedIndex
            ].textContent;


        setStatus(
            "Market ready",
            true
        );


        subscribeMarket();

    }

}


// =====================================
// SUBSCRIBE MARKET
// =====================================

function subscribeMarket() {

    if (
        !ws ||
        ws.readyState !==
        WebSocket.OPEN
    ) {

        return;

    }


    const symbol =
        marketSelect.value;


    // IMPORTANT SAFETY CHECK

    if (
        !symbol ||
        symbol.length < 2
    ) {

        setStatus(
            "Select a valid market",
            false
        );

        return;

    }


    currentSymbol = symbol;


    maxTicks =
        Number(
            tickCount.value
        );


    ticks = [];


    const option =

        marketSelect.options[
            marketSelect.selectedIndex
        ];


    pipSize =

        Number(
            option.dataset.pip
        ) || 2;


    $("marketName").textContent =
        option.textContent;


    $("tickStatus").textContent =
        "Loading ticks...";


    // Get tick history FIRST

    send({

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

    });


    // Subscribe to live ticks

    send({

        ticks:
            currentSymbol,

        subscribe:
            1,

        req_id:
            3

    });


    setStatus(
        "Receiving market data",
        true
    );

}


// =====================================
// LOAD HISTORY
// =====================================

function loadHistory(history) {

    if (
        !history ||
        !Array.isArray(history.prices)
    ) {

        return;

    }


    ticks =
        history.prices
        .map(function (price) {

            return Number(price);

        })
        .filter(function (price) {

            return Number.isFinite(price);

        })
        .slice(-maxTicks);


    $("tickStatus").textContent =
        ticks.length + " ticks";


    analyzeMarket();

}


// =====================================
// LIVE TICK
// =====================================

function handleTick(tick) {

    if (!tick) return;


    const price =
        Number(tick.quote);


    if (!Number.isFinite(price)) {

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
        getLastDigit(
            formattedPrice
        );


    $("lastDigit").textContent =
        digit;


    ticks.push(price);


    if (
        ticks.length >
        maxTicks
    ) {

        ticks.shift();

    }


    $("tickStatus").textContent =
        ticks.length + " ticks";


    renderRecentDigits();


    if (
        ticks.length >= 20
    ) {

        analyzeMarket();

    }

}


// =====================================
// LAST DIGIT
// =====================================

function getLastDigit(value) {

    const formatted =
        Number(value)
        .toFixed(pipSize);


    const digits =
        formatted.match(/\d/g);


    if (!digits) return 0;


    return Number(
        digits[digits.length - 1]
    );

}


// =====================================
// GET ALL DIGITS
// =====================================

function getDigits() {

    return ticks.map(
        getLastDigit
    );

}


// =====================================
// ANALYZE MARKET
// =====================================

function analyzeMarket() {

    if (ticks.length < 20) {

        return;

    }


    const digits =
        getDigits();


    const total =
        digits.length;


    const frequency =
        Array(10).fill(0);


    digits.forEach(function (digit) {

        frequency[digit]++;

    });


    renderDigitGrid(
        frequency,
        total
    );


    let signal;


    // ---------------------------------
    // MATCH / DIFFER
    // ---------------------------------

    if (
        selectedType === "MATCH"
    ) {

        signal =
            getMatchSignal(
                frequency,
                total
            );

    }


    // ---------------------------------
    // OVER
    // ---------------------------------

    else if (
        selectedType === "OVER"
    ) {

        signal =
            getOverSignal(
                digits,
                total
            );

    }


    // ---------------------------------
    // UNDER
    // ---------------------------------

    else if (
        selectedType === "UNDER"
    ) {

        signal =
            getUnderSignal(
                digits,
                total
            );

    }


    // ---------------------------------
    // EVEN
    // ---------------------------------

    else if (
        selectedType === "EVEN"
    ) {

        signal =
            getEvenSignal(
                digits,
                total
            );

    }


    // ---------------------------------
    // ODD
    // ---------------------------------

    else if (
        selectedType === "ODD"
    ) {

        signal =
            getOddSignal(
                digits,
                total
            );

    }


    updateSignal(signal);

}


// =====================================
// MATCH SIGNAL
// =====================================

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


    const percentage =
        frequency[digit] /
        total *
        100;


    return {

        title:

            selectedMode === "match"

                ? "Trade MATCH " + digit

                : "DIFFERS from " + digit,


        digit: digit,


        confidence:

            percentage,


        explanation:

            selectedMode === "match"

                ? "Digit " + digit +
                  " appeared " +
                  frequency[digit] +
                  " times in the analyzed tick sample."

                : "Digit " + digit +
                  " appeared least often in the analyzed tick sample."

    };

}


// =====================================
// OVER SIGNAL
// =====================================

function getOverSignal(
    digits,
    total
) {

    const b =
        Number(barrier.value);


    const count =
        digits.filter(
            d => d > b
        ).length;


    return {

        title:
            "OVER " + b,

        digit:
            "↑",

        confidence:
            count / total * 100,

        explanation:
            count +
            " of the analyzed ticks had a digit above " +
            b + "."

    };

}


// =====================================
// UNDER SIGNAL
// =====================================

function getUnderSignal(
    digits,
    total
) {

    const b =
        Number(barrier.value);


    const count =
        digits.filter(
            d => d < b
        ).length;


    return {

        title:
            "UNDER " + b,

        digit:
            "↓",

        confidence:
            count / total * 100,

        explanation:
            count +
            " of the analyzed ticks had a digit below " +
            b + "."

    };

}


// =====================================
// EVEN SIGNAL
// =====================================

function getEvenSignal(
    digits,
    total
) {

    const count =
        digits.filter(
            d => d % 2 === 0
        ).length;


    return {

        title:
            "EVEN",

        digit:
            "E",

        confidence:
            count / total * 100,

        explanation:
            count +
            " of the analyzed digits were even."

    };

}


// =====================================
// ODD SIGNAL
// =====================================

function getOddSignal(
    digits,
    total
) {

    const count =
        digits.filter(
            d => d % 2 !== 0
        ).length;


    return {

        title:
            "ODD",

        digit:
            "O",

        confidence:
            count / total * 100,

        explanation:
            count +
            " of the analyzed digits were odd."

    };

}


// =====================================
// UPDATE SIGNAL UI
// =====================================

function updateSignal(signal) {

    if (!signal) return;


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


    const required =
        Number(threshold.value);


    const status =
        $("entryStatus");


    if (
        signal.confidence >=
        required
    ) {

        status.textContent =
            "🟢 SIGNAL MEETS YOUR ENTRY LEVEL";

        status.className =
            "entry-status ready";

    }

    else {

        status.textContent =
            "🟡 BELOW YOUR SELECTED ENTRY LEVEL";

        status.className =
            "entry-status waiting";

    }

}


// =====================================
// DIGIT GRID
// =====================================

function renderDigitGrid(
    frequency,
    total
) {

    const grid =
        $("digitGrid");


    grid.innerHTML = "";


    const max =
        Math.max(...frequency);


    for (
        let i = 0;
        i < 10;
        i++
    ) {

        const percent =
            frequency[i] /
            total *
            100;


        const item =
            document.createElement(
                "div"
            );


        item.className =
            "digit-item";


        if (
            frequency[i] === max
        ) {

            item.classList.add(
                "hot"
            );

        }


        item.innerHTML =

            '<div class="digit-number">' +

            i +

            '</div>' +

            '<div class="digit-percent">' +

            percent.toFixed(1) +

            '%</div>';


        grid.appendChild(item);

    }

}


// =====================================
// RECENT DIGITS
// =====================================

function renderRecentDigits() {

    const container =
        $("recentDigits");


    container.innerHTML = "";


    const digits =
        getDigits()
        .slice(-30);


    digits.forEach(function (digit) {

        const item =
            document.createElement(
                "div"
            );


        item.className =
            "recent-digit";


        item.textContent =
            digit;


        container.appendChild(item);

    });

}


// =====================================
// SIGNAL TYPE BUTTONS
// =====================================

document
    .querySelectorAll(".type-button")
    .forEach(function (button) {

        button.addEventListener(
            "click",
            function () {

                document
                    .querySelectorAll(
                        ".type-button"
                    )
                    .forEach(
                        b =>
                        b.classList.remove(
                            "active"
                        )
                    );


                button.classList.add(
                    "active"
                );


                selectedType =
                    button.dataset.type;


                analyzeMarket();

            }
        );

    });


// =====================================
// MATCH / DIFFER MODE
// =====================================

document
    .querySelectorAll(".mode")
    .forEach(function (button) {

        button.addEventListener(
            "click",
            function () {

                document
                    .querySelectorAll(".mode")
                    .forEach(
                        b =>
                        b.classList.remove(
                            "active"
                        )
                    );


                button.classList.add(
                    "active"
                );


                selectedMode =
                    button.dataset.mode;


                analyzeMarket();

            }
        );

    });


// =====================================
// EVENTS
// =====================================

connectBtn.addEventListener(
    "click",
    connectDeriv
);


scanBtn.addEventListener(
    "click",
    function () {

        analyzeMarket();

    }
);


marketSelect.addEventListener(
    "change",
    subscribeMarket
);


tickCount.addEventListener(
    "change",
    subscribeMarket
);


barrier.addEventListener(
    "change",
    analyzeMarket
);


threshold.addEventListener(
    "change",
    analyzeMarket
);


// =====================================
// AUTO SCAN
// =====================================

function startAutoScan() {

    if (autoScanTimer) {

        clearInterval(
            autoScanTimer
        );

    }


    autoScanTimer =
        setInterval(function () {

            if (
                $("autoScan").checked &&
                ticks.length >= 20
            ) {

                analyzeMarket();

            }

        }, 30000);

}


startAutoScan();
