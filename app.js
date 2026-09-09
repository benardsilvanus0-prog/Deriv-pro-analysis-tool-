/*
 * Deriv Digit Analyzer Pro
 * Clean WebSocket client for public market data.
 * Analysis only: no trades are executed.
 */

(() => {
  'use strict';

  const APP_ID = '1089';

  const ENDPOINT =
    `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  const FALLBACK_MARKETS = [
    ['R_10', 'Volatility 10 Index'],
    ['R_25', 'Volatility 25 Index'],
    ['R_50', 'Volatility 50 Index'],
    ['R_75', 'Volatility 75 Index'],
    ['R_100', 'Volatility 100 Index'],
    ['1HZ10V', 'Volatility 10 (1s) Index'],
    ['1HZ25V', 'Volatility 25 (1s) Index'],
    ['1HZ50V', 'Volatility 50 (1s) Index'],
    ['1HZ75V', 'Volatility 75 (1s) Index'],
    ['1HZ100V', 'Volatility 100 (1s) Index']
  ];

  let ws = null;
  let ticks = [];

  let currentSymbol = '';
  let currentPipSize = 0.01;
  let currentDecimals = 2;

  let maxTicks = 1000;
  let tickSubscriptionId = null;

  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let manuallyDisconnected = false;

  let currentType = 'MATCH';

  // ==========================================
  // ELEMENT HELPER
  // ==========================================

  const $ = id => document.getElementById(id);

  // ==========================================
  // SAFE TEXT UPDATE
  // ==========================================

  function text(id, value) {
    const el = $(id);

    if (el) {
      el.textContent = String(value);
    }
  }

  // ==========================================
  // SAFE WIDTH UPDATE
  // ==========================================

  function setWidth(id, value) {
    const el = $(id);

    if (!el) return;

    const width = Math.max(
      0,
      Math.min(100, Number(value) || 0)
    );

    el.style.width = `${width}%`;
  }

  // ==========================================
  // UPDATE CONNECTION STATUS
  // ==========================================

  function updateStatus(message, connected = false) {

    text('statusText', message);

    text(
      'connectionStatus',
      connected
        ? '🟢 Connected'
        : '🔴 Offline'
    );

    text(
      'wsState',
      connected
        ? 'connected'
        : 'disconnected'
    );

    const dot = $('connectionDot');

    if (dot) {

      dot.className =
        `connection-dot ${
          connected
            ? 'online'
            : 'offline'
        }`;
    }

    const badge = $('liveBadge');

    if (badge) {

      badge.textContent =
        connected
          ? 'LIVE'
          : 'OFFLINE';

      badge.classList.toggle(
        'live',
        connected
      );
    }

    const btn = $('connectBtn');

    if (btn && connected) {

      btn.textContent =
        '🟢 Connected';
    }
  }

  // ==========================================
  // ERROR HANDLER
  // ==========================================

  function setError(message) {

    console.error(
      '[Deriv]',
      message
    );

    updateStatus(
      message,
      false
    );

    text(
      'signalTitle',
      'Connection problem'
    );

    text(
      'signalExplanation',
      message
    );

    text(
      'entryStatus',
      '⚠️ CHECK CONNECTION'
    );

    const btn = $('connectBtn');

    if (btn) {

      btn.textContent =
        '⚡ Connect Scanner';
    }
  }

  // ==========================================
  // PIP SIZE → DECIMAL PLACES
  // ==========================================

  function decimalsFromPip(pip) {

    const n = Number(pip);

    if (
      !Number.isFinite(n) ||
      n <= 0
    ) {
      return 2;
    }

    const s =
      n.toString()
        .toLowerCase();

    if (s.includes('e-')) {

      return Number(
        s.split('e-')[1]
      );
    }

    if (!s.includes('.')) {

      return 0;
    }

    return s
      .split('.')[1]
      .length;
  }

  // ==========================================
  // GET LAST DIGIT
  // ==========================================

  function getLastDigit(value) {

    const s = String(value);

    for (
      let i = s.length - 1;
      i >= 0;
      i--
    ) {

      if (
        s[i] >= '0' &&
        s[i] <= '9'
      ) {

        return Number(s[i]);
      }
    }

    return 0;
  }

  // ==========================================
  // FORMAT PRICE
  // ==========================================

  function formatPrice(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) {

      return '--';
    }

    return n.toFixed(
      currentDecimals
    );
  }

  // ==========================================
  // CLEAR TICK SUBSCRIPTION
  // ==========================================

  function clearSubscription() {

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      !tickSubscriptionId
    ) {

      return;
    }

    try {

      ws.send(
        JSON.stringify({
          forget: tickSubscriptionId
        })
      );

    } catch (error) {

      console.warn(
        'Unable to forget subscription',
        error
      );
    }

    tickSubscriptionId = null;
  }

  // ==========================================
  // SEND REQUEST
  // ==========================================

  function send(request) {

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {

      setError(
        'Deriv is not connected. Press Connect Scanner.'
      );

      return false;
    }

    try {

      ws.send(
        JSON.stringify(request)
      );

      return true;

    } catch (error) {

      console.error(error);

      setError(
        'Could not send request to Deriv.'
      );

      return false;
    }
  }

  // ==========================================
  // FALLBACK MARKETS
  // ==========================================

  function populateFallbackMarkets() {

    const select =
      $('marketSelect');

    if (!select) return;

    if (select.options.length) {
      return;
    }

    select.innerHTML = '';

    FALLBACK_MARKETS.forEach(
      ([symbol, name]) => {

        const option =
          document.createElement(
            'option'
          );

        option.value = symbol;

        option.textContent =
          `${name} (${symbol})`;

        /*
         * pip_size is a price increment.
         * 0.01 means two decimal places.
         */
        option.dataset.pip =
          '0.01';

        select.appendChild(
          option
        );
      }
    );
  }

  // ==========================================
  // LOAD MARKETS
  // ==========================================

  function loadMarkets(markets) {

    const select =
      $('marketSelect');

    if (!select) {

      console.error(
        'marketSelect element not found'
      );

      return;
    }

    const list =
      Array.isArray(markets)
        ? markets
        : [];

    select.innerHTML = '';

    const usable = [];

    for (
      const market of list
    ) {

      const symbol =
        market.underlying_symbol ||
        market.symbol;

      if (!symbol) {
        continue;
      }

      const name =
        market.underlying_symbol_name ||
        market.display_name ||
        symbol;

      const pip =
        Number(
          market.pip_size ??
          market.pip
        );

      usable.push({

        symbol,

        name,

        pip:
          Number.isFinite(pip) &&
          pip > 0
            ? pip
            : 0.01,

        market:
          market.market || '',

        submarket:
          market.submarket || ''
      });
    }

    // ========================================
    // PREFER SYNTHETIC INDICES
    // ========================================

    const synthetic =
      usable.filter(
        m =>
          /^R_/.test(m.symbol) ||
          /^1HZ/.test(m.symbol) ||
          /synthetic|volatility|jump|boom|crash/i.test(
            `${m.name} ${m.market} ${m.submarket}`
          )
      );

    const finalList =
      synthetic.length
        ? synthetic
        : usable;

    // ========================================
    // NOTHING RECEIVED
    // ========================================

    if (!finalList.length) {

      populateFallbackMarkets();

      updateStatus(
        'No markets returned — using synthetic symbols',
        true
      );

      subscribeMarket();

      return;
    }

    // ========================================
    // SORT MARKETS
    // ========================================

    finalList.sort(
      (a, b) =>
        a.name.localeCompare(
          b.name
        )
    );

    // ========================================
    // CREATE OPTIONS
    // ========================================

    finalList.forEach(
      market => {

        const option =
          document.createElement(
            'option'
          );

        option.value =
          market.symbol;

        option.textContent =
          `${market.name} (${market.symbol})`;

        option.dataset.pip =
          String(market.pip);

        select.appendChild(
          option
        );
      }
    );

    // ========================================
    // PREFER R_100
    // ========================================

    const preferred =
      finalList.findIndex(
        m => m.symbol === 'R_100'
      );

    if (preferred >= 0) {

      select.selectedIndex =
        preferred;

    } else {

      select.selectedIndex = 0;
    }

    text(
      'marketName',
      select.options[
        select.selectedIndex
      ]?.textContent ||
      select.value
    );

    updateStatus(
      `${finalList.length} markets loaded`,
      true
    );

    subscribeMarket();
  }

  // ==========================================
  // CONNECT TO DERIV
  // ==========================================

  function connectDeriv() {

    manuallyDisconnected = false;

    if (reconnectTimer) {

      clearTimeout(
        reconnectTimer
      );

      reconnectTimer = null;
    }

    if (ws) {

      try {
        ws.close();
      } catch (_) {}

      ws = null;
    }

    ticks = [];

    tickSubscriptionId = null;

    const btn =
      $('connectBtn');

    if (btn) {

      btn.textContent =
        'Connecting...';
    }

    updateStatus(
      'Connecting to Deriv...',
      false
    );

    text(
      'signalTitle',
      'Connecting to Deriv...'
    );

    text(
      'signalExplanation',
      'Loading available synthetic markets...'
    );

    try {

      ws =
        new WebSocket(
          ENDPOINT
        );

    } catch (error) {

      setError(
        `WebSocket could not start: ${error.message}`
      );

      return;
    }

    // ========================================
    // WEBSOCKET OPEN
    // ========================================

    ws.onopen = () => {

      console.log(
        'Deriv WebSocket connected'
      );

      reconnectAttempts = 0;

      updateStatus(
        'Connected — loading markets...',
        true
      );

      if (btn) {

        btn.textContent =
          '🟢 Connected';
      }

      // Request available markets
      send({

        active_symbols:
          'brief',

        req_id: 1
      });
    };

    // ========================================
    // WEBSOCKET MESSAGE
    // ========================================

    ws.onmessage =
      event => {

        let data;

        try {

          data =
            JSON.parse(
              event.data
            );

        } catch (error) {

          console.error(
            'Invalid Deriv response',
            event.data
          );

          return;
        }

        console.debug(
          '[Deriv]',
          data
        );

        // ==================================
        // API ERROR
        // ==================================

        if (data.error) {

          const message =
            data.error.message ||
            'Unknown Deriv API error';

          setError(
            `API Error: ${message}`
          );

          return;
        }

        // ==================================
        // ACTIVE SYMBOLS
        // ==================================

        if (
          data.msg_type ===
          'active_symbols'
        ) {

          console.log(
            'Markets:',
            data.active_symbols
          );

          loadMarkets(
            data.active_symbols
          );

          return;
        }

        // ==================================
        // HISTORY
        // ==================================

        if (
          data.msg_type === 'history' &&
          data.history
        ) {

          loadHistory(
            data.history
          );

          return;
        }

        // ==================================
        // LIVE TICK
        // ==================================

        if (
          data.msg_type === 'tick' &&
          data.tick
        ) {

          if (
            data.subscription &&
            data.subscription.id
          ) {

            tickSubscriptionId =
              data.subscription.id;
          }

          receiveTick(
            data.tick
          );
        }
      };

    // ========================================
    // WEBSOCKET ERROR
    // ========================================

    ws.onerror = () => {

      setError(
        'WebSocket connection error. Check your internet connection or try again.'
      );
    };

    // ========================================
    // WEBSOCKET CLOSED
    // ========================================

    ws.onclose = () => {

      console.log(
        'Deriv WebSocket closed'
      );

      tickSubscriptionId = null;

      if (manuallyDisconnected) {

        updateStatus(
          'Disconnected',
          false
        );

        return;
      }

      updateStatus(
        'Connection closed — reconnecting...',
        false
      );

      const delay =
        Math.min(
          30000,
          1000 *
          Math.pow(
            2,
            reconnectAttempts++
          )
        );

      reconnectTimer =
        setTimeout(
          connectDeriv,
          delay
        );
    };
  }

  // ==========================================
  // SUBSCRIBE TO MARKET
  // ==========================================

  function subscribeMarket() {

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {

      return;
    }

    const select =
      $('marketSelect');

    if (
      !select ||
      !select.value
    ) {

      return;
    }

    clearSubscription();

    currentSymbol =
      select.value;

    maxTicks =
      Number(
        $('tickCount')?.value ||
        1000
      );

    const option =
      select.options[
        select.selectedIndex
      ];

    currentPipSize =
      Number(
        option?.dataset?.pip
      ) || 0.01;

    currentDecimals =
      decimalsFromPip(
        currentPipSize
      );

    ticks = [];

    text(
      'marketName',
      option?.textContent ||
      currentSymbol
    );

    text(
      'tickStatus',
      `Loading ${maxTicks} ticks...`
    );

    text(
      'signalTitle',
      'Collecting ticks...'
    );

    text(
      'signalExplanation',
      `Loading ${maxTicks} recent ticks from ${currentSymbol}.`
    );

    updateStatus(
      `Receiving ${currentSymbol} ticks`,
      true
    );

    // ========================================
    // GET HISTORICAL TICKS
    // ========================================

    send({

      ticks_history:
        currentSymbol,

      count:
        maxTicks,

      end:
        'latest',

      style:
        'ticks',

      req_id:
        2
    });

    // ========================================
    // SUBSCRIBE TO LIVE TICKS
    // ========================================

    send({

      ticks:
        currentSymbol,

      subscribe:
        1,

      req_id:
        3
    });
  }

  // ==========================================
  // LOAD HISTORY
  // ==========================================

  function loadHistory(history) {

    if (
      !history ||
      !Array.isArray(
        history.prices
      )
    ) {

      console.error(
        'Invalid tick history',
        history
      );

      return;
    }

    ticks =
      history.prices
        .map(Number)
        .filter(
          Number.isFinite
        )
        .slice(
          -maxTicks
        );

    updateTickCount();

    renderRecentDigits();

    analyzeMarket();

    console.log(
      `Loaded ${ticks.length} historical ticks`
    );
  }

  // ==========================================
  // RECEIVE LIVE TICK
  // ==========================================

  function receiveTick(tick) {

    if (!tick) {
      return;
    }

    const price =
      Number(
        tick.quote
      );

    if (
      !Number.isFinite(price)
    ) {

      return;
    }

    // ========================================
    // UPDATE PIP SIZE
    // ========================================

    if (
      tick.pip_size !== undefined
    ) {

      currentPipSize =
        Number(
          tick.pip_size
        ) ||
        currentPipSize;

      currentDecimals =
        decimalsFromPip(
          currentPipSize
        );
    }

    // ========================================
    // FORMAT PRICE
    // ========================================

    const formatted =
      formatPrice(price);

    text(
      'livePrice',
      formatted
    );

    // ========================================
    // LAST DIGIT
    // ========================================

    const digit =
      getLastDigit(
        formatted
      );

    text(
      'lastDigit',
      digit
    );

    // ========================================
    // STORE TICK
    // ========================================

    ticks.push(
      price
    );

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

  // ==========================================
  // GET DIGITS
  // ==========================================

  function getDigits() {

    return ticks.map(
      value =>
        getLastDigit(
          formatPrice(value)
        )
    );
  }

  // ==========================================
  // UPDATE TICK COUNT
  // ==========================================

  function updateTickCount() {

    text(
      'tickStatus',
      `${ticks.length} ticks`
    );

    text(
      'tickTotal',
      ticks.length
    );
  }

  // ==========================================
  // RENDER DIGIT GRID
  // ==========================================

  function renderDigitGrid(
    counts,
    percentages
  ) {

    const grid =
      $('digitGrid');

    if (!grid) {
      return;
    }

    grid.innerHTML = '';

    const max =
      Math.max(
        ...counts,
        0
      );

    for (
      let digit = 0;
      digit <= 9;
      digit++
    ) {

      const box =
        document.createElement(
          'div'
        );

      box.className =
        'digit-stat';

      if (
        counts[digit] === max &&
        max > 0
      ) {

        box.classList.add(
          'hot'
        );
      }

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

      grid.appendChild(
        box
      );
    }
  }

  // ==========================================
  // RECENT DIGITS
  // ==========================================

  function renderRecentDigits() {

    const container =
      $('recentDigits');

    if (!container) {
      return;
    }

    container.innerHTML = '';

    getDigits()
      .slice(-30)
      .reverse()
      .forEach(
        digit => {

          const span =
            document.createElement(
              'span'
            );

          span.className =
            'recent-digit';

          span.textContent =
            digit;

          container.appendChild(
            span
          );
        }
      );
  }

  // ==========================================
  // ANALYZE MARKET
  // ==========================================

  function analyzeMarket() {

    const digits =
      getDigits();

    // Need enough data
    if (
      digits.length < 20
    ) {

      text(
        'signalTitle',
        'Collecting ticks...'
      );

      text(
        'bestDigit',
        '-'
      );

      text(
        'bestConfidence',
        '0.0%'
      );

      setWidth(
        'confidenceBar',
        0
      );

      text(
        'entryStatus',
        '⏳ COLLECTING DATA'
      );

      return;
    }

    // ========================================
    // DIGIT COUNTS
    // ========================================

    const counts =
      Array(10).fill(0);

    digits.forEach(
      digit => {

        counts[digit]++;
      }
    );

    const total =
      digits.length;

    const percentages =
      counts.map(
        count =>
          count /
          total *
          100
      );

    renderDigitGrid(
      counts,
      percentages
    );

    // ========================================
    // BARRIER
    // ========================================

    const barrier =
      Number(
        $('barrier')?.value ??
        4
      );

    let confidence = 0;

    let label = 'MATCH';

    let candidate =
      percentages.indexOf(
        Math.max(
          ...percentages
        )
      );

    // ========================================
    // ANALYSIS TYPE
    // ========================================

    switch (
      currentType
    ) {

      // --------------------------------------
      // OVER
      // --------------------------------------

      case 'OVER':

        confidence =
          digits.filter(
            digit =>
              digit > barrier
          ).length /
          total *
          100;

        label =
          `OVER ${barrier}`;

        candidate =
          '↑';

        break;

      // --------------------------------------
      // UNDER
      // --------------------------------------

      case 'UNDER':

        confidence =
          digits.filter(
            digit =>
              digit < barrier
          ).length /
          total *
          100;

        label =
          `UNDER ${barrier}`;

        candidate =
          '↓';

        break;

      // --------------------------------------
      // EVEN
      // --------------------------------------

      case 'EVEN':

        confidence =
          digits.filter(
            digit =>
              digit % 2 === 0
          ).length /
          total *
          100;

        label =
          'EVEN';

        candidate =
          'E';

        break;

      // --------------------------------------
      // ODD
      // --------------------------------------

      case 'ODD':

        confidence =
          digits.filter(
            digit =>
              digit % 2 !== 0
          ).length /
          total *
          100;

        label =
          'ODD';

        candidate =
          'O';

        break;

      // --------------------------------------
      // DIFFERS
      // --------------------------------------

      case 'DIFFERS':

        confidence =
          100 -
          percentages[
            barrier
          ];

        label =
          `DIFFERS ${barrier}`;

        candidate =
          barrier;

        break;

      // --------------------------------------
      // MATCH
      // --------------------------------------

      default:

        confidence =
          percentages[
            barrier
          ];

        label =
          `MATCH ${barrier}`;

        candidate =
          barrier;

        break;
    }

    // ========================================
    // LIMIT CONFIDENCE
    // ========================================

    confidence =
      Math.max(
        0,
        Math.min(
          100,
          confidence
        )
      );

    // ========================================
    // MAIN SIGNAL
    // ========================================

    text(
      'bestDigit',
      candidate
    );

    text(
      'bestConfidence',
      `${confidence.toFixed(1)}%`
    );

    setWidth(
      'confidenceBar',
      confidence
    );

    text(
      'signalTitle',
      label
    );

    text(
      'signalExplanation',
      `${confidence.toFixed(1)}% of the selected ${digits.length}-tick sample matches this condition. This is historical frequency, not a guaranteed prediction.`
    );

    // ========================================
    // MATCH
    // ========================================

    text(
      'matchDigit',
      barrier
    );

    text(
      'matchConfidence',
      `${percentages[barrier].toFixed(1)}%`
    );

    text(
      'matchGap',
      `Frequency ${percentages[barrier].toFixed(1)}%`
    );

    // ========================================
    // OVER
    // ========================================

    const overConfidence =
      digits.filter(
        digit =>
          digit > barrier
      ).length /
      total *
      100;

    text(
      'overLabel',
      `OVER ${barrier}`
    );

    text(
      'overConfidence',
      `${overConfidence.toFixed(1)}%`
    );

    // ========================================
    // UNDER
    // ========================================

    const underConfidence =
      digits.filter(
        digit =>
          digit < barrier
      ).length /
      total *
      100;

    text(
      'underLabel',
      `UNDER ${barrier}`
    );

    text(
      'underConfidence',
      `${underConfidence.toFixed(1)}%`
    );

    // ========================================
    // EVEN
    // ========================================

    const evenConfidence =
      digits.filter(
        digit =>
          digit % 2 === 0
      ).length /
      total *
      100;

    text(
      'evenConfidence',
      `${evenConfidence.toFixed(1)}%`
    );

    // ========================================
    // ODD
    // ========================================

    const oddConfidence =
      digits.filter(
        digit =>
          digit % 2 !== 0
      ).length /
      total *
      100;

    text(
      'oddConfidence',
      `${oddConfidence.toFixed(1)}%`
    );

    // ========================================
    // HOT DIGIT
    // ========================================

    const hot =
      percentages.indexOf(
        Math.max(
          ...percentages
        )
      );

    text(
      'hotDigit',
      hot
    );

    text(
      'hotInfo',
      `${percentages[hot].toFixed(1)}%`
    );

    // ========================================
    // COLD DIGIT
    // ========================================

    const cold =
      percentages.indexOf(
        Math.min(
          ...percentages
        )
      );

    text(
      'coldDigit',
      cold
    );

    text(
      'coldInfo',
      `${percentages[cold].toFixed(1)}%`
    );

    // ========================================
    // ENTRY THRESHOLD
    // ========================================

    const threshold =
      Number(
        $('threshold')?.value ||
        65
      );

    const entry =
      $('entryStatus');

    if (
      confidence >= threshold
    ) {

      text(
        'entryStatus',
        '🟢 ENTRY CONDITION MET'
      );

      if (entry) {

        entry.className =
          'entry-status ready';
      }

    } else {

      text(
        'entryStatus',
        '🟡 WAIT FOR BETTER SETUP'
      );

      if (entry) {

        entry.className =
          'entry-status waiting';
      }
    }
  }

  // ==========================================
  // DISCONNECT
  // ==========================================

  function disconnect() {

    manuallyDisconnected =
      true;

    if (reconnectTimer) {

      clearTimeout(
        reconnectTimer
      );

      reconnectTimer = null;
    }

    clearSubscription();

    if (ws) {

      try {
        ws.close();
      } catch (_) {}
    }

    ws = null;

    updateStatus(
      'Disconnected',
      false
    );

    const btn =
      $('connectBtn');

    if (btn) {

      btn.textContent =
        '⚡ Connect Scanner';
    }
  }

  // ==========================================
  // BUTTON EVENTS
  // ==========================================

  function bindEvents() {

    $('connectBtn')
      ?.addEventListener(
        'click',
        connectDeriv
      );

    $('disconnectBtn')
      ?.addEventListener(
        'click',
        disconnect
      );

    $('marketSelect')
      ?.addEventListener(
        'change',
        subscribeMarket
      );

    $('tickCount')
      ?.addEventListener(
        'change',
        subscribeMarket
      );

    $('barrier')
      ?.addEventListener(
        'change',
        analyzeMarket
      );

    $('threshold')
      ?.addEventListener(
        'change',
        analyzeMarket
      );

    $('scanBtn')
      ?.addEventListener(
        'click',
        analyzeMarket
      );

    // ========================================
    // ANALYSIS TYPE BUTTONS
    // ========================================

    document
      .querySelectorAll(
        '.type-button'
      )
      .forEach(
        button => {

          button.addEventListener(
            'click',
            () => {

              document
                .querySelectorAll(
                  '.type-button'
                )
                .forEach(
                  b =>
                    b.classList.remove(
                      'active'
                    )
                );

              button.classList.add(
                'active'
              );

              currentType =
                String(
                  button.dataset.type ||
                  'MATCH'
                ).toUpperCase();

              analyzeMarket();
            }
          );
        }
      );

    // ========================================
    // MODE BUTTONS
    // ========================================

    document
      .querySelectorAll(
        '.mode'
      )
      .forEach(
        button => {

          button.addEventListener(
            'click',
            () => {

              document
                .querySelectorAll(
                  '.mode'
                )
                .forEach(
                  b =>
                    b.classList.remove(
                      'active'
                    )
                );

              button.classList.add(
                'active'
              );

              currentType =
                String(
                  button.dataset.type ||
                  button.dataset.mode ||
                  'MATCH'
                ).toUpperCase();

              analyzeMarket();
            }
          );
        }
      );

    // ========================================
    // CREATE DEFAULT BARRIERS
    // ========================================

    const barrier =
      $('barrier');

    if (
      barrier &&
      !barrier.options.length
    ) {

      for (
        let digit = 0;
        digit <= 9;
        digit++
      ) {

        const option =
          document.createElement(
            'option'
          );

        option.value =
          digit;

        option.textContent =
          digit;

        if (digit === 4) {

          option.selected =
            true;
        }

        barrier.appendChild(
          option
        );
      }
    }
  }

  // ==========================================
  // START APPLICATION
  // ==========================================

  bindEvents();

  populateFallbackMarkets();

  updateStatus(
    'Offline — press Connect Scanner',
    false
  );

  console.log(
    '[Deriv Digit Analyzer] app.js loaded successfully'
  );

  // ==========================================
  // DEBUG FUNCTIONS
  // ==========================================

  window.DerivAnalyzer = {

    connect:
      connectDeriv,

    disconnect:
      disconnect,

    analyze:
      analyzeMarket
  };

})();
