<script>
"use strict";

/* ==========================================================
   EXPERT TRADER ANALYSIS
   DERIV PUBLIC MARKET DATA
   ANALYSIS ONLY — NO AUTOMATIC TRADING
   ========================================================== */

const WS_URL =
  "wss://api.derivws.com/trading/v1/options/ws/public";

const MAX_TICKS = 5000;
const RECONNECT_DELAY = 3000;

const $ = id => document.getElementById(id);

const S = {
  ws: null,
  connected: false,
  manual: false,

  symbol: "",
  marketName: "",
  pip: null,

  markets: [],
  ticks: [],

  request: 1,
  subscription: null,

  timer: null,
  reconnectTimer: null,

  analysisRunning: false,
  polling: false,

  chart: null,
  patternChart: null,

  contract: "OVER",
  barrier: 4,

  lastAnalysis: 0
};


/* ==========================================================
   HELPERS
   ========================================================== */

function log(msg, type = "") {

  const d = document.createElement("div");

  d.className = type;

  d.textContent =
    new Date().toLocaleTimeString() +
    "  " +
    msg;

  $("log").appendChild(d);

  $("log").scrollTop =
    $("log").scrollHeight;

  console.log(msg);
}


function req() {
  return ++S.request;
}


function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}


function symbolOf(x) {
  return (
    x?.underlying_symbol ||
    x?.symbol ||
    ""
  );
}


function nameOf(x) {
  return (
    x?.underlying_symbol_name ||
    x?.display_name ||
    symbolOf(x)
  );
}


function pipOf(x) {

  const p = Number(
    x?.pip_size ??
    x?.pip
  );

  return Number.isFinite(p)
    ? p
    : null;
}


function number(value, fallback = 0) {

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


/* ==========================================================
   LAST DIGIT
   ========================================================== */

function digitOf(quote, pip) {

  if (
    !Number.isFinite(
      Number(quote)
    )
  ) {
    return null;
  }

  const n = Number(quote);

  let decimals = null;

  if (
    Number.isFinite(pip) &&
    pip > 0 &&
    pip < 1
  ) {

    decimals = Math.max(
      0,
      Math.round(
        -Math.log10(pip)
      )
    );
  }

  if (decimals === null) {

    const text = String(quote);

    decimals =
      text.includes(".")
        ? text.split(".")[1].length
        : 0;
  }

  const fixed =
    n.toFixed(decimals);

  const digits =
    fixed.replace(/\D/g, "");

  return digits
    ? Number(digits.at(-1))
    : null;
}


/* ==========================================================
   PRICE FORMATTING
   ========================================================== */

function decimalPlaces(pip) {

  if (
    !Number.isFinite(pip) ||
    pip <= 0
  ) {
    return 4;
  }

  if (pip >= 1) {
    return 0;
  }

  return clamp(
    Math.round(-Math.log10(pip)),
    0,
    10
  );
}


function formatPrice(price) {

  const n = Number(price);

  if (!Number.isFinite(n)) {
    return "0.0000";
  }

  return n.toFixed(
    decimalPlaces(S.pip)
  );
}


/* ==========================================================
   MARKET RANKING
   ========================================================== */

function scoreMarket(m) {

  const s =
    symbolOf(m).toUpperCase();

  let score = 0;

  if (s.startsWith("1HZ")) score += 100;
  if (s.startsWith("R_")) score += 90;

  if (/BOOM|CRASH/.test(s)) {
    score += 70;
  }

  if (
    m.is_trading === 1 ||
    m.is_trading === true
  ) {
    score += 20;
  }

  return score;
}


/* ==========================================================
   FALLBACK MARKETS
   ========================================================== */

function fallbackMarkets() {

  return [
    ["1HZ10V", "Volatility 10 (1s)", 0.01],
    ["1HZ25V", "Volatility 25 (1s)", 0.01],
    ["1HZ50V", "Volatility 50 (1s)", 0.01],
    ["1HZ75V", "Volatility 75 (1s)", 0.01],
    ["1HZ100V", "Volatility 100 (1s)", 0.01],

    ["R_10", "Volatility 10", 0.01],
    ["R_25", "Volatility 25", 0.01],
    ["R_50", "Volatility 50", 0.01],
    ["R_75", "Volatility 75", 0.01],
    ["R_100", "Volatility 100", 0.01]
  ].map(x => ({
    symbol: x[0],
    name: x[1],
    pip: x[2]
  }));
}


/* ==========================================================
   CONNECTION
   ========================================================== */

function connect() {

  if (
    S.ws &&
    (
      S.ws.readyState === WebSocket.OPEN ||
      S.ws.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  S.manual = false;

  $("connector").textContent =
    "● Connecting";

  $("connector").style.background =
    "#0b9e66";

  log(
    "Connecting to Deriv public market data..."
  );

  try {

    S.ws = new WebSocket(WS_URL);

  } catch (e) {

    log(
      "WebSocket creation failed: " +
      e.message,
      "err"
    );

    scheduleReconnect();

    return;
  }


  S.ws.onopen = () => {

    S.connected = true;

    $("connector").textContent =
      "● Connected";

    $("connector").style.background =
      "#0aa66b";

    log(
      "Connected to Deriv.",
      "ok"
    );

    send({
      active_symbols: "brief",
      req_id: req()
    });

    if (S.symbol) {
      loadMarketData();
    }
  };


  S.ws.onmessage = e => {

    handle(e.data);
  };


  S.ws.onerror = () => {

    $("connector").textContent =
      "● Error";

    $("connector").style.background =
      "#ff3d5a";

    log(
      "WebSocket error.",
      "err"
    );
  };


  S.ws.onclose = e => {

    S.connected = false;
    S.subscription = null;

    $("connector").textContent =
      "● Disconnected";

    $("connector").style.background =
      "#ff3d5a";

    log(
      "WebSocket closed: " +
      e.code,
      "err"
    );

    if (!S.manual) {
      scheduleReconnect();
    }
  };
}


function scheduleReconnect() {

  if (S.reconnectTimer) {
    return;
  }

  S.reconnectTimer =
    setTimeout(() => {

      S.reconnectTimer = null;

      connect();

    }, RECONNECT_DELAY);
}


function disconnect() {

  S.manual = true;

  clearTimeout(S.reconnectTimer);

  S.reconnectTimer = null;

  stopAutoTimer();

  if (
    S.ws &&
    S.ws.readyState === WebSocket.OPEN
  ) {
    try {
      forgetSubscription();
    } catch (_) {}
  }

  if (S.ws) {
    S.ws.close();
  }

  S.ws = null;
  S.connected = false;

  $("connector").textContent =
    "● Disconnected";

  $("connector").style.background =
    "#ff3d5a";
}


function send(data) {

  if (
    !S.ws ||
    S.ws.readyState !== WebSocket.OPEN
  ) {
    return false;
  }

  try {

    S.ws.send(
      JSON.stringify(data)
    );

    return true;

  } catch (e) {

    log(
      "Send failed: " +
      e.message,
      "err"
    );

    return false;
  }
}


/* ==========================================================
   MESSAGE HANDLER
   ========================================================== */

function handle(raw) {

  let d;

  try {

    d = JSON.parse(raw);

  } catch (_) {

    return;
  }


  if (d.error) {

    const code =
      d.error.code ||
      d.error.error_code ||
      "ERROR";

    const message =
      d.error.message ||
      "Unknown API error";

    log(
      "API: " +
      code +
      " — " +
      message,
      "err"
    );

    $("message").textContent =
      message;

    return;
  }


  switch (d.msg_type) {

    case "active_symbols":
      activeSymbols(d);
      break;

    case "history":
      handleHistory(d);
      break;

    case "tick":
      handleTick(d);
      break;

    case "ping":
      break;
  }


  if (
    d.subscription &&
    d.subscription.id
  ) {

    S.subscription =
      d.subscription.id;
  }
}


/* ==========================================================
   ACTIVE SYMBOLS
   ========================================================== */

function activeSymbols(d) {

  let list =
    Array.isArray(d.active_symbols)
      ? d.active_symbols
      : [];


  list = list.filter(
    x => {

      const s =
        symbolOf(x).toUpperCase();

      return (
        /^1HZ\d+V$/.test(s) ||
        /^R_\d+$/.test(s) ||
        /BOOM/.test(s) ||
        /CRASH/.test(s)
      );
    }
  );


  if (!list.length) {

    log(
      "No synthetic symbols returned; using fallback list."
    );

    populateMarkets(
      fallbackMarkets()
    );

    return;
  }


  list.sort(
    (a, b) =>
      scoreMarket(b) -
      scoreMarket(a)
  );


  S.markets =
    list.map(x => ({
      symbol: symbolOf(x),
      name: nameOf(x),
      pip: pipOf(x)
    }));


  populateMarkets(
    S.markets
  );

  log(
    S.markets.length +
    " supported markets loaded.",
    "ok"
  );
}


/* ==========================================================
   MARKET SELECT
   ========================================================== */

function populateMarkets(markets) {

  const sel =
    $("market");

  if (!sel) return;

  sel.innerHTML = "";

  markets.forEach(m => {

    const option =
      document.createElement("option");

    option.value =
      m.symbol;

    option.textContent =
      m.name +
      " (" +
      m.symbol +
      ")";

    option.dataset.pip =
      m.pip ?? "";

    sel.appendChild(option);
  });


  if (!S.symbol && markets.length) {

    sel.value =
      markets[0].symbol;

    changeMarket(
      markets[0].symbol
    );

  } else if (S.symbol) {

    sel.value =
      S.symbol;
  }
}


/* ==========================================================
   MARKET CHANGE
   ========================================================== */

function changeMarket(symbol) {

  if (!symbol) {
    return;
  }

  forgetSubscription();

  S.symbol =
    symbol;

  const market =
    S.markets.find(
      x => x.symbol === symbol
    );


  S.marketName =
    market?.name ||
    symbol;


  S.pip =
    market?.pip ??
    null;


  const option =
    $("market")?.selectedOptions?.[0];


  if (
    option &&
    Number.isFinite(
      Number(option.dataset.pip)
    )
  ) {

    S.pip =
      Number(option.dataset.pip);
  }


  S.ticks = [];

  S.lastAnalysis = 0;

  clearAnalysis();

  $("marketName").textContent =
    S.marketName;

  $("marketMeta").textContent =
    "Public market data • " +
    S.symbol;

  $("price").textContent =
    "0.0000";

  $("lastDigit").textContent =
    "—";

  $("lastDigitBig").textContent =
    "—";

  $("status").textContent =
    "Loading";

  $("message").textContent =
    "Loading historical ticks...";


  if (S.connected) {
    loadMarketData();
  }
}


/* ==========================================================
   LOAD HISTORY + LIVE TICKS
   ========================================================== */

function loadMarketData() {

  if (
    !S.connected ||
    !S.symbol
  ) {
    return;
  }


  forgetSubscription();

  S.ticks = [];

  const count =
    getAnalysisCount();


  log(
    "Requesting " +
    count +
    " historical ticks for " +
    S.symbol +
    "..."
  );


  send({

    ticks_history: S.symbol,

    count: count,

    end: "latest",

    style: "ticks",

    subscribe: 0,

    req_id: req()
  });


  send({

    ticks: S.symbol,

    subscribe: 1,

    req_id: req()
  });


  $("status").textContent =
    "Collecting";

  $("message").textContent =
    "Collecting historical and live tick data...";
}


function forgetSubscription() {

  if (!S.subscription) {
    return;
  }

  send({
    forget: S.subscription,
    req_id: req()
  });

  S.subscription = null;
}


/* ==========================================================
   HISTORY
   ========================================================== */

function handleHistory(d) {

  const history =
    d.history || {};

  const prices =
    Array.isArray(history.prices)
      ? history.prices
      : [];

  const times =
    Array.isArray(history.times)
      ? history.times
      : [];


  if (!prices.length) {

    log(
      "No historical prices received.",
      "err"
    );

    $("message").textContent =
      "No historical tick data received.";

    return;
  }


  S.ticks =
    prices.map(
      (price, i) => {

        const quote =
          Number(price);

        return {
          price: quote,

          time:
            Number(times[i]) ||
            Date.now() / 1000,

          digit:
            digitOf(
              quote,
              S.pip
            )
        };
      }
    )
    .filter(
      x =>
        Number.isFinite(x.price) &&
        Number.isInteger(x.digit)
    )
    .slice(-MAX_TICKS);


  log(
    S.ticks.length +
    " historical ticks loaded.",
    "ok"
  );


  renderCurrentPrice();

  updateRecentDigits();

  updateCharts();

  updateDataProgress();


  $("status").textContent =
    "Live";

  $("message").textContent =
    "Live market data connected. Start analysis when ready.";


  if (S.analysisRunning) {
    runAnalysis();
  }
}


/* ==========================================================
   LIVE TICK
   ========================================================== */

function handleTick(d) {

  const t =
    d.tick;

  if (!t) {
    return;
  }


  const symbol =
    t.symbol ||
    t.underlying_symbol ||
    "";


  if (
    S.symbol &&
    symbol &&
    symbol !== S.symbol
  ) {
    return;
  }


  const quote =
    Number(
      t.quote ??
      t.ask ??
      t.bid
    );


  if (!Number.isFinite(quote)) {
    return;
  }


  const digit =
    digitOf(
      quote,
      S.pip
    );


  if (!Number.isInteger(digit)) {
    return;
  }


  const item = {

    price: quote,

    time:
      Number(t.epoch) ||
      Date.now() / 1000,

    digit
  };


  S.ticks.push(item);


  if (
    S.ticks.length >
    MAX_TICKS
  ) {

    S.ticks =
      S.ticks.slice(-MAX_TICKS);
  }


  renderCurrentPrice();

  updateRecentDigits();

  updateCharts();

  updateDataProgress();


  if (S.analysisRunning) {
    runAnalysis();
  }
}


/* ==========================================================
   CURRENT PRICE
   ========================================================== */

function renderCurrentPrice() {

  const last =
    S.ticks.at(-1);

  if (!last) {
    return;
  }


  $("price").textContent =
    formatPrice(last.price);

  $("lastDigit").textContent =
    last.digit;

  $("lastDigitBig").textContent =
    last.digit;

  $("tickCount").textContent =
    S.ticks.length;
}


/* ==========================================================
   RECENT DIGITS
   ========================================================== */

function updateRecentDigits() {

  const last =
    S.ticks.slice(-20);

  const digits =
    last.map(x => x.digit);

  document
    .querySelectorAll(".digit")
    .forEach(el => {

      el.classList.remove(
        "active"
      );
    });


  digits.forEach(d => {

    const over =
      document.querySelector(
        `.digit[data-digit="${d}"][data-side="over"]`
      );

    const under =
      document.querySelector(
        `.digit[data-digit="${d}"][data-side="under"]`
      );

    if (over) {
      over.classList.add("active");
    }

    if (under) {
      under.classList.add("active");
    }
  });
}


/* ==========================================================
   DIGIT BUTTONS
   ========================================================== */

function buildDigitButtons() {

  const over =
    $("overDigits");

  const under =
    $("underDigits");


  over.innerHTML = "";
  under.innerHTML = "";


  for (let i = 0; i <= 9; i++) {

    const a =
      document.createElement("button");

    a.className = "digit";

    a.textContent = i;

    a.dataset.digit = i;
    a.dataset.side = "over";

    a.title =
      "Select digit " + i;

    a.onclick = () => {

      $("barrier").value =
        String(i);

      S.barrier = i;

      $("contract").value =
        "OVER";

      S.contract = "OVER";

      runAnalysis();
    };


    const b =
      document.createElement("button");

    b.className = "digit";

    b.textContent = i;

    b.dataset.digit = i;
    b.dataset.side = "under";

    b.title =
      "Select digit " + i;

    b.onclick = () => {

      $("barrier").value =
        String(i);

      S.barrier = i;

      $("contract").value =
        "UNDER";

      S.contract = "UNDER";

      runAnalysis();
    };


    over.appendChild(a);
    under.appendChild(b);
  }
}


/* ==========================================================
   ANALYSIS SETTINGS
   ========================================================== */

function getAnalysisCount() {

  const a =
    Number(
      $("analysisTicks")?.value ||
      $("sample")?.value ||
      500
    );

  return clamp(
    Number.isFinite(a)
      ? a
      : 500,
    30,
    MAX_TICKS
  );
}


function getDuration() {

  return Number(
    $("duration")?.value ||
    100
  );
}


function getThreshold() {

  const raw =
    String(
      $("threshold")?.value ||
      "65"
    );

  return clamp(
    Number(
      raw.replace("%", "")
    ),
    0,
    100
  );
}


/* ==========================================================
   ANALYSIS MATH
   ========================================================== */

function frequency(digits) {

  const f =
    Array(10).fill(0);

  digits.forEach(d => {

    if (
      Number.isInteger(d) &&
      d >= 0 &&
      d <= 9
    ) {
      f[d]++;
    }
  });

  return f;
}


function percentages(freq, total) {

  return freq.map(
    n =>
      total
        ? (n / total) * 100
        : 0
  );
}


function entropy(freq) {

  const total =
    freq.reduce(
      (a, b) => a + b,
      0
    );

  if (!total) {
    return 1;
  }

  let h = 0;

  freq.forEach(n => {

    if (!n) return;

    const p =
      n / total;

    h -=
      p * Math.log2(p);
  });

  return clamp(
    h / Math.log2(10),
    0,
    1
  );
}


function topTwo(freq) {

  const arr =
    freq.map(
      (value, digit) => ({
        digit,
        value
      })
    )
    .sort(
      (a, b) =>
        b.value -
        a.value
    );

  return [
    arr[0],
    arr[1]
  ];
}


function zScore(observed, expected, total) {

  const p =
    expected;

  const variance =
    total *
    p *
    (1 - p);

  if (variance <= 0) {
    return 0;
  }

  return (
    (observed - total * p) /
    Math.sqrt(variance)
  );
}


/* ==========================================================
   CONTRACT EVALUATION
   ========================================================== */

function evaluateContract(digits) {

  const total =
    digits.length;

  if (total < 30) {

    return {
      confidence: 0,
      pattern: "Insufficient data",
      bestDigit: null,
      targetProbability: 0,
      consistency: 0,
      z: 0,
      explanation:
        "At least 30 valid ticks are required."
    };
  }


  const freq =
    frequency(digits);


  const pct =
    percentages(
      freq,
      total
    );


  const contract =
    S.contract;


  let targetCount = 0;
  let targetProbability = 0;
  let bestDigit = null;
  let pattern = "Balanced";
  let z = 0;


  if (contract === "MATCH") {

    const best =
      topTwo(freq)[0];

    bestDigit =
      best.digit;

    targetCount =
      best.value;

    targetProbability =
      best.value / total;

    pattern =
      "Digit " +
      bestDigit +
      " frequency";

    z =
      zScore(
        best.value,
        0.10,
        total
      );

  }


  else if (contract === "DIFF") {

    const best =
      topTwo(freq)[0];

    bestDigit =
      best.digit;

    targetCount =
      total -
      freq[bestDigit];

    targetProbability =
      targetCount / total;

    pattern =
      "Differs from " +
      bestDigit;

    z =
      zScore(
        targetCount,
        0.90,
        total
      );
  }


  else if (contract === "OVER") {

    const barrier =
      S.barrier;

    targetCount =
      freq
        .slice(
          barrier + 1,
          10
        )
        .reduce(
          (a, b) => a + b,
          0
        );

    targetProbability =
      targetCount / total;

    bestDigit =
 
