// Deriv Digit Analyzer Pro V2 - analysis only
let ws = null;
let ticks = [];
let currentSymbol = null;
let maxTicks = 1000;
let activeSubscriptionId = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

const $ = id => document.getElementById(id);
const marketSelect = $("marketSelect");
const tickCountSelect = $("tickCount");
const barrierSelect = $("barrier");
const thresholdSelect = $("threshold");
const connectBtn = $("connectBtn");
const statusEl = $("connectionStatus");

for (let i = 0; i <= 9; i++) {
  const o = document.createElement("option");
  o.value = i; o.textContent = i;
  if (i === 5) o.selected = true;
  barrierSelect.appendChild(o);
}

function setStatus(text) { statusEl.textContent = text; }

function connectDeriv() {
  clearTimeout(reconnectTimer);
  if (ws && ws.readyState === WebSocket.OPEN) return subscribeMarket();

  setStatus("🟡 Connecting...");
  // Replace with your own registered Deriv app_id before production deployment.
  ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");

  ws.onopen = () => {
    reconnectAttempts = 0;
    setStatus("🟢 Connected — loading markets...");
    send({ active_symbols: "brief", req_id: 1 });
  };

  ws.onmessage = event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.error) {
      console.error("Deriv API error:", data.error);
      setStatus("🔴 " + data.error.message);
      return;
    }
    if (data.msg_type === "active_symbols") loadMarkets(data.active_symbols || []);
    if (data.msg_type === "history") loadHistory(data.history);
    if (data.msg_type === "tick") handleTick(data.tick, data.subscription);
  };

  ws.onerror = () => setStatus("🔴 Connection error");
  ws.onclose = () => {
    setStatus("🔴 Disconnected");
    activeSubscriptionId = null;
    if (reconnectAttempts < 5) {
      reconnectAttempts++;
      reconnectTimer = setTimeout(connectDeriv, 1500 * reconnectAttempts);
    }
  };
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function loadMarkets(symbols) {
  // Prefer synthetic/derived indices, but keep a fallback if filtering finds none.
  const preferred = symbols.filter(s =>
    /volatility|synthetic|jump|crash|boom|step/i.test((s.display_name || "") + " " + (s.market || ""))
  );
  const list = preferred.length ? preferred : symbols;

  marketSelect.innerHTML = "";
  if (!list.length) {
    marketSelect.innerHTML = "<option>No markets returned</option>";
    setStatus("🔴 No markets available");
    return;
  }

  list.sort((a,b) => (a.display_name || "").localeCompare(b.display_name || ""));
  list.forEach(s => {
    const option = document.createElement("option");
    option.value = s.symbol;
    option.textContent = `${s.display_name} (${s.symbol})`;
    marketSelect.appendChild(option);
  });

  currentSymbol = marketSelect.value;
  ticks = [];
  subscribeMarket();
}

function subscribeMarket() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !marketSelect.value) return;

  currentSymbol = marketSelect.value;
  maxTicks = Number(tickCountSelect.value);
  ticks = [];
  activeSubscriptionId = null;

  setStatus(`🟡 Loading ${maxTicks} ticks...`);

  send({
    ticks_history: currentSymbol,
    count: maxTicks,
    end: "latest",
    style: "ticks",
    req_id: 2
  });

  // Forget all previous tick subscriptions before starting another.
  send({ forget_all: "ticks", req_id: 3 });
  send({ ticks: currentSymbol, subscribe: 1, req_id: 4 });
}

function loadHistory(history) {
  if (!history || !Array.isArray(history.prices)) return;
  ticks = history.prices.map(Number).filter(Number.isFinite).slice(-maxTicks);
  setStatus("🟢 Live");
  updateAnalysis();
}

function handleTick(tick, subscription) {
  if (!tick || Number(tick.quote) === undefined) return;
  if (subscription && subscription.id) activeSubscriptionId = subscription.id;

  const price = Number(tick.quote);
  $("livePrice").textContent = formatQuote(tick);
  const digit = getLastDigit(tick);
  $("lastDigit").textContent = digit;

  ticks.push({ price, digit });
  if (ticks.length > maxTicks) ticks.shift();
  updateAnalysis();
}

function formatQuote(tick) {
  const precision = Number.isInteger(tick.pip_size) ? tick.pip_size : null;
  return precision !== null ? Number(tick.quote).toFixed(precision) : String(tick.quote);
}

function getLastDigit(value) {
  if (typeof value === "object" && value !== null) {
    const precision = Number.isInteger(value.pip_size) ? value.pip_size : null;
    const quote = precision !== null ? Number(value.quote).toFixed(precision) : String(value.quote);
    const m = quote.match(/(\d)(?!.*\d)/);
    return m ? Number(m[1]) : 0;
  }
  const text = String(value);
  const m = text.match(/(\d)(?!.*\d)/);
  return m ? Number(m[1]) : 0;
}

function normalizedDigits() {
  return ticks.map(t => typeof t === "object" ? t.digit : getLastDigit(t));
}

function frequencies(arr) {
  const f = Array(10).fill(0);
  arr.forEach(d => { if (d >= 0 && d <= 9) f[d]++; });
  return f;
}

function gaps(arr) {
  return Array.from({length:10}, (_, d) => {
    for (let i = arr.length - 1, gap = 0; i >= 0; i--, gap++) {
      if (arr[i] === d) return gap;
    }
    return arr.length;
  });
}

function scoreForDigit(digit, all, freq, gapValues) {
  const n = all.length;
  const recentN = Math.min(50, n);
  const recent = all.slice(-recentN);
  const recentRate = recent.filter(d => d === digit).length / recentN;
  const baseRate = freq[digit] / n;
  const gap = gapValues[digit];

  // A bounded statistical score, not a probability prediction.
  const frequencyStrength = Math.min(100, (baseRate / 0.10) * 50);
  const momentumStrength = Math.max(0, Math.min(100, ((recentRate - baseRate + 0.10) / 0.20) * 100));
  const gapStrength = Math.max(0, Math.min(100, (gap / Math.max(1, n / 10)) * 50));
  return Math.min(100, 0.55 * frequencyStrength + 0.30 * momentumStrength + 0.15 * gapStrength);
}

function groupScore(condition, all) {
  const n = all.length;
  const recentN = Math.min(50, n);
  const base = all.filter(condition).length / n;
  const recent = all.slice(-recentN).filter(condition).length / recentN;
  const expected = 0.5;
  const baseStrength = Math.min(100, Math.max(0, (base - expected + 0.5) * 100));
  const momentum = Math.min(100, Math.max(0, (recent - base + 0.5) * 100));
  return Math.min(100, baseStrength * 0.7 + momentum * 0.3);
}

function updateAnalysis() {
  const digits = normalizedDigits();
  if (digits.length < 20) return;

  const freq = frequencies(digits);
  const gapValues = gaps(digits);
  const bestDigit = freq.indexOf(Math.max(...freq));
  const coldDigit = freq.indexOf(Math.min(...freq));
  const barrier = Number(barrierSelect.value);

  const matchScore = scoreForDigit(bestDigit, digits, freq, gapValues);
  const overScore = groupScore(d => d > barrier, digits);
  const underScore = groupScore(d => d < barrier, digits);
  const evenScore = groupScore(d => d % 2 === 0, digits);
  const oddScore = groupScore(d => d % 2 === 1, digits);

  $("matchDigit").textContent = bestDigit;
  $("matchConfidence").textContent = matchScore.toFixed(1) + "%";
  $("matchGap").textContent = "Gap: " + gapValues[bestDigit] + " ticks";
  $("overLabel").textContent = "OVER " + barrier;
  $("underLabel").textContent = "UNDER " + barrier;
  $("overConfidence").textContent = overScore.toFixed(1) + "%";
  $("underConfidence").textContent = underScore.toFixed(1) + "%";
  $("evenConfidence").textContent = evenScore.toFixed(1) + "%";
  $("oddConfidence").textContent = oddScore.toFixed(1) + "%";

  const recent50 = digits.slice(-Math.min(50, digits.length));
  const hotFreq = frequencies(recent50);
  const hotDigit = hotFreq.indexOf(Math.max(...hotFreq));
  $("hotDigit").textContent = hotDigit;
  $("hotInfo").textContent = `${hotFreq[hotDigit]} appearances in recent ${recent50.length}`;

  $("coldDigit").textContent = coldDigit;
  $("coldInfo").textContent = `${freq[coldDigit]} appearances in ${digits.length}`;

  $("tickTotal").textContent = digits.length;
  const momentum = recent50.filter(d => d === bestDigit).length / recent50.length - freq[bestDigit] / digits.length;
  $("momentumInfo").textContent = momentum > 0.02 ? "RISING" : momentum < -0.02 ? "FALLING" : "STABLE";

  renderDigitDistribution(freq, gapValues, digits.length, hotDigit, coldDigit);
  renderRecentDigits(digits);

  const signals = [
    { strategy:"DIGIT MATCH", value:String(bestDigit), score:matchScore },
    { strategy:"DIGIT OVER", value:"OVER " + barrier, score:overScore },
    { strategy:"DIGIT UNDER", value:"UNDER " + barrier, score:underScore },
    { strategy:"EVEN", value:"EVEN", score:evenScore },
    { strategy:"ODD", value:"ODD", score:oddScore }
  ].sort((a,b) => b.score - a.score);

  const best = signals[0];
  $("bestStrategy").textContent = best.strategy;
  $("bestDigit").textContent = best.value;
  $("bestConfidence").textContent = best.score.toFixed(1) + "%";

  const threshold = Number(thresholdSelect.value);
  $("entryStatus").textContent =
    best.score >= threshold
      ? "🟢 ENTRY CONDITIONS MET — statistical signal"
      : best.score >= threshold - 8
        ? "🟡 WATCH — wait for stronger confirmation"
        : "🔴 WAIT — weak statistical conditions";
}

function renderDigitDistribution(freq, gapValues, total, hot, cold) {
  const grid = $("digitGrid");
  grid.innerHTML = "";
  for (let d = 0; d < 10; d++) {
    const card = document.createElement("div");
    card.className = "digit-card" + (d === hot ? " hot" : "") + (d === cold ? " cold" : "");
    const pct = total ? freq[d] / total * 100 : 0;
    card.innerHTML = `<div class="digit-number">${d}</div>
      <div>${freq[d]} ticks</div>
      <strong>${pct.toFixed(1)}%</strong>
      <small>Gap: ${gapValues[d]}</small>`;
    grid.appendChild(card);
  }
}

function renderRecentDigits(digits) {
  const box = $("recentDigits");
  box.innerHTML = "";
  digits.slice(-30).forEach(d => {
    const el = document.createElement("div");
    el.className = "recent-digit";
    el.textContent = d;
    box.appendChild(el);
  });
}

connectBtn.addEventListener("click", connectDeriv);
marketSelect.addEventListener("change", subscribeMarket);
tickCountSelect.addEventListener("change", subscribeMarket);
barrierSelect.addEventListener("change", updateAnalysis);
thresholdSelect.addEventListener("change", updateAnalysis);
window.addEventListener("beforeunload", () => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
});
