/**
 * ======================================================
 * DERIV DIGIT ANALYZER PRO (ES6+ Optimized & Fixed)
 * ======================================================
 */

(() => {
  // Application State
  const state = {
    ws: null,
    ticks: [],
    currentSymbol: "",
    currentPipSize: 2,
    maxTicks: 1000,
    currentMode: "match",
    currentType: "MATCH",
  };

  // Helper for DOM caching
  const $ = (id) => document.getElementById(id);

  const DOM = {
    statusText: $("statusText"),
    connectionDot: $("connectionDot"),
    liveBadge: $("liveBadge"),
    connectBtn: $("connectBtn"),
    marketSelect: $("marketSelect"),
    marketName: $("marketName"),
    tickStatus: $("tickStatus"),
    livePrice: $("livePrice"),
    lastDigit: $("lastDigit"),
    signalTitle: $("signalTitle"),
    signalExplanation: $("signalExplanation"),
    bestDigit: $("bestDigit"),
    bestConfidence: $("bestConfidence"),
    confidenceBar: $("confidenceBar"),
    entryStatus: $("entryStatus"),
    barrier: $("barrier"),
    threshold: $("threshold"),
    tickCount: $("tickCount"),
    digitGrid: $("digitGrid"),
    recentDigits: $("recentDigits"),
    autoScan: $("autoScan"),
  };

  // ======================================================
  // UTILITIES
  // ======================================================

  /**
   * Fast last-digit extraction from numeric string representation
   */
  const getLastDigit = (value) => {
    const str = String(value);
    const lastChar = str[str.length - 1];
    return Number.isInteger(+lastChar) ? +lastChar : 0;
  };

  const getDigits = () =>
    state.ticks.map((price) =>
      getLastDigit(price.toFixed(state.currentPipSize))
    );

  // ======================================================
  // UI STATUS UPDATES
  // ======================================================

  const updateStatus = (message, connected = false) => {
    if (DOM.statusText) DOM.statusText.textContent = message;

    if (DOM.connectionDot) {
      DOM.connectionDot.className = `connection-dot ${connected ? "online" : "offline"}`;
    }

    if (DOM.liveBadge) {
      DOM.liveBadge.textContent = connected ? "LIVE" : "OFFLINE";
      DOM.liveBadge.classList.toggle("live", connected);
    }
  };

  // ======================================================
  // WEBSOCKET & MARKET MANAGEMENT
  // ======================================================

  const connectDeriv = () => {
    if (state.ws) {
      try {
        state.ws.close();
      } catch (e) {
        // Ignore close errors on reset
      }
    }

    state.ticks = [];
    if (DOM.connectBtn) DOM.connectBtn.textContent = "Connecting...";
    updateStatus("Connecting to Deriv...", false);

    state.ws = new WebSocket("wss://ws.binaryws.com/websockets/v3");

    state.ws.onopen = () => {
      console.log("CONNECTED TO DERIV");
      updateStatus("Connected - loading markets...", true);
      if (DOM.connectBtn) DOM.connectBtn.textContent = "🟢 Connected";

      state.ws.send(
        JSON.stringify({ active_symbols: "brief", req_id: 1 })
      );
    };

    state.ws.onmessage = handleSocketMessage;

    state.ws.onerror = (error) => {
      console.error("WEBSOCKET ERROR:", error);
      updateStatus("WebSocket connection error", false);
      if (DOM.connectBtn) DOM.connectBtn.textContent = "⚡ Connect Scanner";
    };

    state.ws.onclose = () => {
      console.log("DERIV CONNECTION CLOSED");
      updateStatus("Disconnected", false);
      if (DOM.connectBtn) DOM.connectBtn.textContent = "⚡ Connect Scanner";
    };
  };

  const handleSocketMessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (error) {
      console.error("Invalid JSON:", event.data);
      return;
    }

    if (data.error) {
      console.error("DERIV ERROR:", data.error);
      updateStatus(`API Error: ${data.error.message || "Unknown error"}`, false);
      if (DOM.connectBtn) DOM.connectBtn.textContent = "⚡ Connect Scanner";
      return;
    }

    switch (data.msg_type) {
      case "active_symbols":
        loadMarkets(data.active_symbols);
        break;

      case "history":
        if (Array.isArray(data.history?.prices)) {
          state.ticks = data.history.prices
            .map(Number)
            .filter(Number.isFinite)
            .slice(-state.maxTicks);

          updateTickCount();
          renderRecentDigits();
          analyzeMarket();
        }
        break;

      case "tick":
        receiveTick(data.tick);
        break;
    }
  };

  const loadMarkets = (markets = []) => {
    const select = DOM.marketSelect;
    if (!select) return;

    select.innerHTML = "";

    if (!Array.isArray(markets) || markets.length === 0) {
      select.innerHTML = `<option value="">No markets received</option>`;
      updateStatus("Deriv returned no markets", false);
      return;
    }

    const fragment = document.createDocumentFragment();
    let validMarkets = 0;

    markets.forEach((market) => {
      const symbol = market.underlying_symbol || market.symbol;
      const name = market.underlying_symbol_name || market.display_name || symbol;

      if (!symbol) return;

      const option = document.createElement("option");
      option.value = symbol;
      option.textContent = `${name} (${symbol})`;
      option.dataset.pip = market.pip_size || market.pip || 2;
      option.dataset.market = market.market || "";

      fragment.appendChild(option);
      validMarkets++;
    });

    if (validMarkets === 0) {
      select.innerHTML = `<option value="">No valid markets</option>`;
      updateStatus("No valid symbols received", false);
      return;
    }

    select.appendChild(fragment);

    // Prefer Synthetic / Volatility Indices
    const preferredIndex = Array.from(select.options).findIndex((opt) => {
      const text = opt.textContent.toLowerCase();
      const val = opt.value.toUpperCase();
      return (
        val.includes("R_") ||
        val.includes("1HZ") ||
        ["volatility", "jump", "crash", "boom"].some((term) => text.includes(term))
      );
    });

    select.selectedIndex = preferredIndex >= 0 ? preferredIndex : 0;

    updateStatus(`${validMarkets} markets loaded`, true);
    if (DOM.connectBtn) DOM.connectBtn.textContent = "🟢 Connected";

    subscribeMarket();
  };

  const subscribeMarket = () => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

    const select = DOM.marketSelect;
    const symbol = select?.value;

    if (!symbol) {
      updateStatus("Select a market first", false);
      return;
    }

    // FIX: Unsubscribe from all previous tick streams before requesting a new one
    state.ws.send(JSON.stringify({ forget_all: "ticks" }));

    state.currentSymbol = symbol;
    state.maxTicks = Number(DOM.tickCount?.value) || 1000;

    const selectedOption = select.options[select.selectedIndex];
    state.currentPipSize = Number(selectedOption.dataset.pip) || 2;

    if (DOM.marketName) DOM.marketName.textContent = selectedOption.textContent;
    if (DOM.tickStatus) DOM.tickStatus.textContent = "Loading ticks...";

    state.ticks = [];

    // History Request
    state.ws.send(
      JSON.stringify({
        ticks_history: state.currentSymbol,
        count: state.maxTicks,
        end: "latest",
        style: "ticks",
        req_id: 2,
      })
    );

    // Stream Subscription
    state.ws.send(
      JSON.stringify({
        ticks: state.currentSymbol,
        subscribe: 1,
        req_id: 3,
      })
    );

    updateStatus(`Receiving ${state.currentSymbol} ticks`, true);

    if (DOM.signalTitle) DOM.signalTitle.textContent = "Collecting market data";
    if (DOM.signalExplanation) {
      DOM.signalExplanation.textContent = `Analyzing the latest ticks from ${state.currentSymbol}...`;
    }
  };

  const receiveTick = (tick) => {
    if (!tick) return;

    // FIX: Guard clause to reject "ghost ticks" from previous markets
    if (tick.symbol !== state.currentSymbol) return;

    const price = Number(tick.quote);
    if (!Number.isFinite(price)) return;

    if (tick.pip_size !== undefined) {
      state.currentPipSize = Number(tick.pip_size) || state.currentPipSize;
    }

    const formatted = price.toFixed(state.currentPipSize);

    if (DOM.livePrice) DOM.livePrice.textContent = formatted;
    if (DOM.lastDigit) DOM.lastDigit.textContent = getLastDigit(formatted);

    state.ticks.push(price);

    if (state.ticks.length > state.maxTicks) {
      state.ticks.shift();
    }

    updateTickCount();
    renderRecentDigits();
    analyzeMarket();
  };

  // ======================================================
  // ANALYTICS & RENDERING
  // ======================================================

  const updateTickCount = () => {
    if (DOM.tickStatus) DOM.tickStatus.textContent = `${state.ticks.length} ticks`;
  };

  const analyzeMarket = () => {
    const digits = getDigits();
    const total = digits.length;

    if (total < 20) {
      if (DOM.signalTitle) DOM.signalTitle.textContent = "Collecting ticks...";
      if (DOM.bestDigit) DOM.bestDigit.textContent = "-";
      if (DOM.bestConfidence) DOM.bestConfidence.textContent = "0.0";
      if (DOM.confidenceBar) DOM.confidenceBar.style.width = "0%";
      if (DOM.entryStatus) DOM.entryStatus.textContent = "⏳ COLLECTING DATA";
      return;
    }

    const counts = Array(10).fill(0);
    digits.forEach((digit) => counts[digit]++);

    const percentages = counts.map((count) => (count / total) * 100);
    renderDigitGrid(counts, percentages);

    let bestDigit = percentages.reduce(
      (maxIdx, curr, idx, arr) => (curr > arr[maxIdx] ? idx : maxIdx),
      0
    );

    let confidence = percentages[bestDigit];
    const barrier = Number(DOM.barrier?.value || 0);

    // Signal type calculations
    switch (state.currentType) {
      case "OVER":
        confidence = (digits.filter((d) => d > barrier).length / total) * 100;
        break;
      case "UNDER":
        confidence = (digits.filter((d) => d < barrier).length / total) * 100;
        break;
      case "EVEN":
        confidence = (digits.filter((d) => d % 2 === 0).length / total) * 100;
        break;
      case "ODD":
        confidence = (digits.filter((d) => d % 2 !== 0).length / total) * 100;
        break;
      case "MATCH":
        confidence = percentages[barrier];
        bestDigit = barrier;
        break;
    }

    confidence = Math.min(100, Math.max(0, confidence));

    if (DOM.bestDigit) DOM.bestDigit.textContent = bestDigit;
    if (DOM.bestConfidence) DOM.bestConfidence.textContent = confidence.toFixed(1);
    if (DOM.confidenceBar) DOM.confidenceBar.style.width = `${confidence}%`;

    if (DOM.signalTitle) {
      DOM.signalTitle.textContent = getSignalName(state.currentType, bestDigit, barrier);
    }
    if (DOM.signalExplanation) {
      DOM.signalExplanation.textContent = getExplanation(
        state.currentType,
        bestDigit,
        confidence,
        barrier
      );
    }

    const threshold = Number(DOM.threshold?.value || 0);

    if (DOM.entryStatus) {
      if (confidence >= threshold) {
        DOM.entryStatus.textContent = "🟢 ENTRY CONDITION MET";
        DOM.entryStatus.className = "entry-status ready";
      } else {
        DOM.entryStatus.textContent = "🟡 WAIT FOR BETTER SETUP";
        DOM.entryStatus.className = "entry-status waiting";
      }
    }
  };

  const getSignalName = (type, digit, barrier) => {
    const signals = {
      MATCH: `MATCH ${digit}`,
      OVER: `OVER ${barrier}`,
      UNDER: `UNDER ${barrier}`,
      EVEN: "EVEN",
      ODD: "ODD",
    };
    return signals[type] || "Signal";
  };

  const getExplanation = (type, digit, confidence, barrier) => {
    const formattedConf = confidence.toFixed(1);
    switch (type) {
      case "MATCH":
        return `Digit ${digit} appeared most strongly in history. Frequency: ${formattedConf}%.`;
      case "OVER":
        return `${formattedConf}% of analyzed digits were above barrier ${barrier}.`;
      case "UNDER":
        return `${formattedConf}% of analyzed digits were below barrier ${barrier}.`;
      case "EVEN":
        return `${formattedConf}% of analyzed digits were even.`;
      case "ODD":
        return `${formattedConf}% of analyzed digits were odd.`;
      default:
        return "Statistical analysis.";
    }
  };

  const renderDigitGrid = (counts, percentages) => {
    if (!DOM.digitGrid) return;

    // FIX: Only construct the elements once to prevent DOM thrashing
    if (DOM.digitGrid.children.length === 0) {
      const fragment = document.createDocumentFragment();
      for (let digit = 0; digit <= 9; digit++) {
        const box = document.createElement("div");
        box.className = "digit-stat";
        box.innerHTML = `
          <div class="digit-number">${digit}</div>
          <div class="digit-count">0 hits</div>
          <div class="digit-percent">0.0%</div>
        `;
        fragment.appendChild(box);
      }
      DOM.digitGrid.appendChild(fragment);
    }

    // FIX: Update existing text content safely instead of replacing HTML
    const children = DOM.digitGrid.children;
    for (let digit = 0; digit <= 9; digit++) {
      const box = children[digit];
      box.children[1].textContent = `${counts[digit]} hits`;
      box.children[2].textContent = `${percentages[digit].toFixed(1)}%`;
    }
  };

  const renderRecentDigits = () => {
    if (!DOM.recentDigits) return;

    const digits = getDigits().slice(-30).reverse();

    // FIX: Build the elements exactly once
    if (DOM.recentDigits.children.length === 0) {
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 30; i++) {
        const span = document.createElement("span");
        span.className = "recent-digit";
        fragment.appendChild(span);
      }
      DOM.recentDigits.appendChild(fragment);
    }

    // FIX: Apply new values to the existing static spans
    const children = DOM.recentDigits.children;
    for (let i = 0; i < 30; i++) {
      children[i].textContent = digits[i] !== undefined ? digits[i] : "";
    }
  };

  // ======================================================
  // EVENT LISTENERS
  // ======================================================

  const bindEvents = () => {
    // Mode toggle buttons
    document.querySelectorAll(".mode").forEach((button) => {
      button.addEventListener("click", (e) => {
        document.querySelectorAll(".mode").forEach((b) => b.classList.remove("active"));
        e.currentTarget.classList.add("active");
        state.currentMode = e.currentTarget.dataset.mode;
        analyzeMarket();
      });
    });

    // Type selection buttons
    document.querySelectorAll(".type-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        document.querySelectorAll(".type-button").forEach((b) => b.classList.remove("active"));
        e.currentTarget.classList.add("active");
        state.currentType = e.currentTarget.dataset.type;
        analyzeMarket();
      });
    });

    // Controls
    DOM.connectBtn?.addEventListener("click", connectDeriv);

    DOM.marketSelect?.addEventListener("change", () => {
      if (state.ws?.readyState === WebSocket.OPEN) subscribeMarket();
    });

    DOM.tickCount?.addEventListener("change", () => {
      if (state.ws?.readyState === WebSocket.OPEN) subscribeMarket();
    });

    DOM.barrier?.addEventListener("change", analyzeMarket);
    DOM.threshold?.addEventListener("change", analyzeMarket);

    // FIX: Removed the redundant setInterval. `analyzeMarket()` is already 
    // triggered by `receiveTick()`, making the interval unnecessary CPU load.
  };

  // FIX: Wait for the DOM to fully load before running the app
  document.addEventListener("DOMContentLoaded", () => {
    // Re-cache DOM elements to ensure they exist now that the page is loaded
    Object.keys(DOM).forEach(key => {
        DOM[key] = $(key);
    });
    
    bindEvents();
    console.log("Deriv Digit Analyzer loaded and optimized.");
  });
})();
