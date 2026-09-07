// ==========================================
// DERIV DIGIT ANALYZER - FIXED CONNECTION
// ==========================================

let ws = null;
let ticks = [];
let maxTicks = 1000;
let currentSymbol = null;


// ==========================================
// HTML ELEMENTS
// ==========================================

const $ = (id) => document.getElementById(id);

const marketSelect = $("marketSelect");
const tickCountSelect = $("tickCount");
const barrierSelect = $("barrier");
const thresholdSelect = $("threshold");
const connectBtn = $("connectBtn");


// ==========================================
// CREATE DIGIT BARRIERS
// ==========================================

for (let i = 0; i <= 9; i++) {

    const option = document.createElement("option");

    option.value = i;
    option.textContent = i;

    if (i === 5) {
        option.selected = true;
    }

    barrierSelect.appendChild(option);
}


// ==========================================
// STATUS
// ==========================================

function setStatus(message) {

    $("connectionStatus").textContent = message;

}


// ==========================================
// SEND WEBSOCKET MESSAGE
// ==========================================

function send(data) {

    if (!ws) return;

    if (ws.readyState === WebSocket.OPEN) {

        ws.send(JSON.stringify(data));

        console.log("SENT:", data);

    }

}


// ==========================================
// CONNECT TO DERIV
// ==========================================

function connectDeriv() {

    // Prevent multiple connections

    if (ws && ws.readyState === WebSocket.OPEN) {

        setStatus("🟢 Already connected");

        return;

    }


    setStatus("🟡 Connecting to Deriv...");

    connectBtn.disabled = true;

    connectBtn.textContent = "Connecting...";


    // Deriv WebSocket

    ws = new WebSocket(
        "wss://ws.binaryws.com/websockets/v3?app_id=1089"
    );


    // ==========================================
    // CONNECTION OPEN
    // ==========================================

    ws.onopen = function () {

        console.log("Deriv WebSocket Connected");

        setStatus("🟢 Connected — Loading markets...");

        connectBtn.disabled = false;

        connectBtn.textContent = "🔄 Connected";


        // Request markets

        send({

            active_symbols: "brief",

            req_id: 1

        });

    };


    // ==========================================
    // RECEIVE DATA
    // ==========================================

    ws.onmessage = function (event) {

        let data;

        try {

            data = JSON.parse(event.data);

        } catch (error) {

            console.error("JSON Error:", error);

            return;

        }


        console.log("RECEIVED:", data);


        // ==========================================
        // API ERROR
        // ==========================================

        if (data.error) {

            console.error("Deriv API Error:", data.error);

            setStatus(
                "🔴 API Error: " +
                data.error.message
            );

            return;

        }


        // ==========================================
        // ACTIVE SYMBOLS
        // ==========================================

        if (data.msg_type === "active_symbols") {

            console.log(
                "Markets received:",
                data.active_symbols
            );

            loadMarkets(
                data.active_symbols || []
            );

        }


        // ==========================================
        // TICK HISTORY
        // ==========================================

        if (data.msg_type === "history") {

            loadHistory(data.history);

        }


        // ==========================================
        // LIVE TICK
        // ==========================================

        if (data.msg_type === "tick") {

            handleTick(data.tick);

        }

    };


    // ==========================================
    // CONNECTION ERROR
    // ==========================================

    ws.onerror = function (error) {

        console.error("WebSocket Error:", error);

        setStatus(
            "🔴 Connection error — check internet"
        );

        connectBtn.disabled = false;

        connectBtn.textContent = "🔌 Connect";

    };


    // ==========================================
    // CONNECTION CLOSED
    // ==========================================

    ws.onclose = function () {

        console.log("WebSocket Disconnected");

        setStatus("🔴 Disconnected");

        connectBtn.disabled = false;

        connectBtn.textContent = "🔌 Connect";

    };

}


// ==========================================
// LOAD MARKETS
// ==========================================

function loadMarkets(symbols) {

    marketSelect.innerHTML = "";


    if (!symbols || symbols.length === 0) {

        const option =
            document.createElement("option");

        option.textContent =
            "No markets received";

        marketSelect.appendChild(option);

        setStatus("🔴 No markets returned");

        return;

    }


    // ==========================================
    // SUPPORT OLD AND NEW DERIV API FIELD NAMES
    // ==========================================

    const formattedMarkets = symbols.map(function (item) {

        return {

            symbol:

                item.symbol ||
                item.underlying_symbol,


            name:

                item.display_name ||
                item.underlying_symbol_name ||
                item.symbol ||
                item.underlying_symbol,


            market:

                item.market || ""

        };

    });


    // Remove invalid markets

    const validMarkets =
        formattedMarkets.filter(function (item) {

            return item.symbol;

        });


    // ==========================================
    // PREFER SYNTHETIC MARKETS
    // ==========================================

    let syntheticMarkets =
        validMarkets.filter(function (item) {

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

                text.includes("boom") ||

                text.includes("crash") ||

                text.includes("step")

            );

        });


    // If no synthetic markets found, show all

    if (syntheticMarkets.length === 0) {

        syntheticMarkets = validMarkets;

    }


    // Sort markets

    syntheticMarkets.sort(function (a, b) {

        return a.name.localeCompare(b.name);

    });


    // Add markets to dropdown

    syntheticMarkets.forEach(function (item) {

        const option =
            document.createElement("option");


        option.value = item.symbol;


        option.textContent =
            item.name +
            " (" +
            item.symbol +
            ")";


        marketSelect.appendChild(option);

    });


    // Select first market

    currentSymbol =
        marketSelect.value;


    setStatus(
        "🟢 Markets loaded — Loading ticks..."
    );


    // Start analysis

    subscribeMarket();

}


// ==========================================
// SUBSCRIBE TO MARKET
// ==========================================

function subscribeMarket() {

    if (!ws) return;


    if (ws.readyState !== WebSocket.OPEN) {

        setStatus("🔴 Not connected");

        return;

    }


    if (!marketSelect.value) {

        return;

    }


    currentSymbol =
        marketSelect.value;


    maxTicks =
        Number(
            tickCountSelect.value
        );


    ticks = [];


    setStatus(
        "🟡 Loading " +
        maxTicks +
        " ticks..."
    );


    // Remove previous tick subscriptions

    send({

        forget_all: "ticks"

    });


    // ==========================================
    // GET TICK HISTORY
    // ==========================================

    send({

        ticks_history:
            currentSymbol,

        count:
            maxTicks,

        end:
            "latest",

        style:
            "ticks",

        req_id: 2

    });


    // ==========================================
    // SUBSCRIBE TO LIVE TICKS
    // ==========================================

    send({

        ticks:
            currentSymbol,

        subscribe:
            1,

        req_id: 3

    });

}


// ==========================================
// LOAD HISTORY
// ==========================================

function loadHistory(history) {

    if (!history) return;

    if (!Array.isArray(history.prices)) return;


    ticks = history.prices
        .map(Number)
        .filter(Number.isFinite)
        .slice(-maxTicks);


    console.log(
        "History loaded:",
        ticks.length
    );


    $("tickTotal").textContent =
        ticks.length;


    setStatus("🟢 Live");

    updateAnalysis();

}


// ==========================================
// GET LAST DIGIT
// ==========================================

function getLastDigit(value) {

    const text =
        String(value);


    const numbers =
        text.match(/\d/g);


    if (!numbers || numbers.length === 0) {

        return 0;

    }


    return Number(
        numbers[numbers.length - 1]
    );

}


// ==========================================
// HANDLE LIVE TICK
// ==========================================

function handleTick(tick) {

    if (!tick) return;


    const quote =
        Number(tick.quote);


    if (!Number.isFinite(quote)) {

        return;

    }


    // Display price

    $("livePrice").textContent =
        tick.quote;


    // Get last digit

    const digit =
        getLastDigit(tick.quote);


    $("lastDigit").textContent =
        digit;


    // Add tick

    ticks.push(quote);


    // Keep selected number of ticks

    if (ticks.length > maxTicks) {

        ticks.shift();

    }


    $("tickTotal").textContent =
        ticks.length;


    // Update analysis

    updateAnalysis();

}


// ==========================================
// MAIN ANALYSIS
// ==========================================

function updateAnalysis() {

    if (ticks.length < 20) {

        return;

    }


    const digits =
        ticks.map(getLastDigit);


    const frequency =
        Array(10).fill(0);


    digits.forEach(function (digit) {

        frequency[digit]++;

    });


    // ==========================================
    // HOT DIGIT
    // ==========================================

    const hotDigit =
        frequency.indexOf(
            Math.max(...frequency)
        );


    // ==========================================
    // COLD DIGIT
    // ==========================================

    const coldDigit =
        frequency.indexOf(
            Math.min(...frequency)
        );


    // ==========================================
    // BARRIER
    // ==========================================

    const barrier =
        Number(barrierSelect.value);


    // ==========================================
    // MATCH FREQUENCY
    // ==========================================

    const matchRate =
        (
            frequency[hotDigit] /
            digits.length
        ) * 100;


    // ==========================================
    // OVER
    // ==========================================

    const overCount =
        digits.filter(function (digit) {

            return digit > barrier;

        }).length;


    const overRate =
        (
            overCount /
            digits.length
        ) * 100;


    // ==========================================
    // UNDER
    // ==========================================

    const underCount =
        digits.filter(function (digit) {

            return digit < barrier;

        }).length;


    const underRate =
        (
            underCount /
            digits.length
        ) * 100;


    // ==========================================
    // EVEN
    // ==========================================

    const evenCount =
        digits.filter(function (digit) {

            return digit % 2 === 0;

        }).length;


    const evenRate =
        (
            evenCount /
            digits.length
        ) * 100;


    // ==========================================
    // ODD
    // ==========================================

    const oddCount =
        digits.filter(function (digit) {

            return digit % 2 !== 0;

        }).length;


    const oddRate =
        (
            oddCount /
            digits.length
        ) * 100;


    // ==========================================
    // UPDATE SCREEN
    // ==========================================

    $("matchDigit").textContent =
        hotDigit;


    $("matchConfidence").textContent =
        matchRate.toFixed(1) + "%";


    $("overLabel").textContent =
        "OVER " + barrier;


    $("overConfidence").textContent =
        overRate.toFixed(1) + "%";


    $("underLabel").textContent =
        "UNDER " + barrier;


    $("underConfidence").textContent =
        underRate.toFixed(1) + "%";


    $("evenConfidence").textContent =
        evenRate.toFixed(1) + "%";


    $("oddConfidence").textContent =
        oddRate.toFixed(1) + "%";


    // ==========================================
    // HOT / COLD
    // ==========================================

    $("hotDigit").textContent =
        hotDigit;


    $("hotInfo").textContent =
        frequency[hotDigit] +
        " appearances";


    $("coldDigit").textContent =
        coldDigit;


    $("coldInfo").textContent =
        frequency[coldDigit] +
        " appearances";


    // ==========================================
    // DIGIT GAP
    // ==========================================

    const lastPosition =
        digits.lastIndexOf(hotDigit);


    const gap =
        digits.length -
        1 -
        lastPosition;


    $("matchGap").textContent =
        "Gap: " +
        gap +
        " ticks";


    // ==========================================
    // MOMENTUM
    // ==========================================

    $("momentumInfo").textContent =
        "LIVE";


    // ==========================================
    // RENDER DIGITS
    // ==========================================

    renderDigitDistribution(
        frequency,
        digits
    );


    renderRecentDigits(digits);


    // ==========================================
    // BEST SIGNAL
    // ==========================================

    const signals = [

        {
            name: "DIGIT MATCH",
            value: hotDigit,
            score: matchRate
        },

        {
            name: "DIGIT OVER",
            value: "OVER " + barrier,
            score: overRate
        },

        {
            name: "DIGIT UNDER",
            value: "UNDER " + barrier,
            score: underRate
        },

        {
            name: "EVEN",
            value: "EVEN",
            score: evenRate
        },

        {
            name: "ODD",
            value: "ODD",
            score: oddRate
        }

    ];


    signals.sort(function (a, b) {

        return b.score - a.score;

    });


    const best =
        signals[0];


    $("bestStrategy").textContent =
        best.name;


    $("bestDigit").textContent =
        best.value;


    $("bestConfidence").textContent =
        best.score.toFixed(1) + "%";


    const threshold =
        Number(thresholdSelect.value);


    if (best.score >= threshold) {

        $("entryStatus").textContent =
            "🟢 STRONGEST CURRENT STATISTICAL SIGNAL";

    } else {

        $("entryStatus").textContent =
            "🟡 WAIT — More data/confirmation needed";

    }

}


// ==========================================
// DIGIT DISTRIBUTION
// ==========================================

function renderDigitDistribution(
    frequency,
    digits
) {

    const grid =
        $("digitGrid");


    grid.innerHTML = "";


    for (let digit = 0; digit <= 9; digit++) {

        const card =
            document.createElement("div");


        card.className =
            "digit-card";


        const percentage =
            (
                frequency[digit] /
                digits.length
            ) * 100;


        const lastIndex =
            digits.lastIndexOf(digit);


        const gap =
            lastIndex === -1
                ? digits.length
                : digits.length - 1 - lastIndex;


        card.innerHTML =

            `<div class="digit-number">${digit}</div>

             <div>${frequency[digit]} ticks</div>

             <strong>
                ${percentage.toFixed(1)}%
             </strong>

             <small>
                Gap: ${gap}
             </small>`;


        grid.appendChild(card);

    }

}


// ==========================================
// RECENT DIGITS
// ==========================================

function renderRecentDigits(digits) {

    const container =
        $("recentDigits");


    container.innerHTML = "";


    const recent =
        digits.slice(-30);


    recent.forEach(function (digit) {

        const item =
            document.createElement("div");


        item.className =
            "recent-digit";


        item.textContent =
            digit;


        container.appendChild(item);

    });

}


// ==========================================
// BUTTON EVENTS
// ==========================================

connectBtn.addEventListener(
    "click",
    connectDeriv
);


marketSelect.addEventListener(
    "change",
    subscribeMarket
);


tickCountSelect.addEventListener(
    "change",
    subscribeMarket
);


barrierSelect.addEventListener(
    "change",
    updateAnalysis
);


thresholdSelect.addEventListener(
    "change",
    updateAnalysis
);
