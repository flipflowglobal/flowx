/**
 * NEXUS-ARB v2 Dashboard — app.js
 * WebSocket client + Canvas-based real-time charts
 * No external dependencies — pure browser APIs
 */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  pnlHistory:    [],   // [{ts, cumulative}] rolling 500
  kellyHistory:  [],   // [float] rolling 50
  gasHistory:    [],   // [float] rolling 60
  opportunities: [],   // last 50
  trades:        [],   // last 50
  ws:            null,
  reconnectDelay: 1000,
  connected:     false,
};

// ── Formatting ────────────────────────────────────────────────────────────────
const fmt = {
  usd:     v => `$${(+v || 0).toFixed(4)}`,
  pct:     v => `${((+v || 0)*100).toFixed(1)}%`,
  gwei:    v => `${(+v || 0).toFixed(2)}`,
  score:   v => `${(+v || 0).toFixed(3)}`,
  addr:    v => v ? v.slice(0,8)+'…' : '──',
  ts:      v => {
    const d = new Date((+v)*1000);
    return d.toTimeString().slice(0,8);
  },
  uptime:  s => {
    s = Math.floor(+s||0);
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  },
  eth:     v => `$${(+v||0).toLocaleString('en-US',{maximumFractionDigits:0})}`,
};

// ── WebSocket Connection ───────────────────────────────────────────────────────
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url      = `${protocol}://${location.host}/ws`;
  state.ws       = new WebSocket(url);

  state.ws.onopen = () => {
    state.connected     = true;
    state.reconnectDelay = 1000;
    document.getElementById('conn-dot').className = 'status-dot connected';
    console.log('[NEXUS] WebSocket connected');
    // Fetch initial data
    fetchInitial();
  };

  state.ws.onmessage = e => {
    try { handleMessage(JSON.parse(e.data)); } catch(_) {}
  };

  state.ws.onclose = () => {
    state.connected = false;
    document.getElementById('conn-dot').className = 'status-dot error';
    setTimeout(() => {
      state.reconnectDelay = Math.min(state.reconnectDelay * 1.5, 30000);
      connectWS();
    }, state.reconnectDelay);
  };

  state.ws.onerror = () => state.ws.close();
}

// ── Message Handler ───────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'opportunity_scored':  onOpportunity(msg.payload); break;
    case 'trade_executed':      onTrade(msg.payload);       break;
    case 'circuit_breaker':     onCircuitBreaker(msg.payload); break;
    case 'gas_update':          onGasUpdate(msg.payload);   break;
    case 'weight_update':       onWeightUpdate(msg.payload); break;
    case 'heartbeat':           break;
    case 'pong':                break;
  }
}

function onOpportunity(p) {
  const opp = p.opportunity || p;
  const ai  = p.ai_decision || {};
  state.opportunities.unshift({ ...opp, ai_decision: ai, ts: Date.now()/1000 });
  state.opportunities = state.opportunities.slice(0, 50);
  document.getElementById('opp-count').textContent = `${state.opportunities.length} visible`;
  renderOppTable();
}

function onTrade(p) {
  state.trades.unshift({...p, ts: p.confirmed_at || Date.now()/1000});
  state.trades = state.trades.slice(0, 50);

  // Update P&L chart
  const last = state.pnlHistory.length > 0
    ? state.pnlHistory[state.pnlHistory.length-1].cumulative
    : 0;
  state.pnlHistory.push({
    ts: Date.now()/1000,
    cumulative: last + (p.net_profit_usd || 0),
  });
  state.pnlHistory = state.pnlHistory.slice(-500);

  // Kelly history
  state.kellyHistory.push(p.kelly_fraction || 0);
  state.kellyHistory = state.kellyHistory.slice(-50);

  renderTradeTable();
  drawPnlChart();
  drawKellyChart();
  updateStats();
}

function onCircuitBreaker(p) {
  updateCBBadge(p.state);
}

function onGasUpdate(p) {
  const gwei = p.base_fee_gwei || 0;
  document.getElementById('hdr-gas').textContent = `${fmt.gwei(gwei)} GWEI`;
  document.getElementById('gas-val').textContent  = fmt.gwei(gwei);
  state.gasHistory.push(gwei);
  state.gasHistory = state.gasHistory.slice(-60);
  drawGasArc(gwei);

  if (p.kelly_fraction !== undefined) {
    document.getElementById('kelly-val').textContent  = fmt.score(p.kelly_fraction);
    state.kellyHistory.push(p.kelly_fraction);
    state.kellyHistory = state.kellyHistory.slice(-50);
    drawKellyChart();
  }
}

function onWeightUpdate(p) {
  const w = p.shapley_weights || p;
  updateEngineWeights(w);
}

// ── Fetch Initial Data ─────────────────────────────────────────────────────────
async function fetchInitial() {
  try {
    const [status, trades, opps, aiWeights, aiKelly] = await Promise.all([
      fetch('/api/v1/control/status').then(r=>r.json()).catch(()=>({})),
      fetch('/api/v1/trades?limit=50').then(r=>r.json()).catch(()=>[]),
      fetch('/api/v1/opportunities?limit=50').then(r=>r.json()).catch(()=>[]),
      fetch('/api/v1/ai/weights').then(r=>r.json()).catch(()=>({})),
      fetch('/api/v1/ai/kelly').then(r=>r.json()).catch(()=>({})),
    ]);

    // Populate trades & rebuild P&L from history
    if (Array.isArray(trades)) {
      state.trades = trades.reverse();
      let cum = 0;
      for (const t of state.trades) {
        cum += t.net_profit_usd || 0;
        state.pnlHistory.push({ ts: t.created_at || Date.now()/1000, cumulative: cum });
      }
      state.pnlHistory = state.pnlHistory.slice(-500);
      state.trades.reverse();
    }

    if (Array.isArray(opps)) {
      state.opportunities = opps;
    }

    // System status
    if (status) {
      document.getElementById('sys-uptime').textContent = fmt.uptime(status.uptime_seconds);
      document.getElementById('sys-scans').textContent  = status.scan_count || 0;
      document.getElementById('sys-eth').textContent    = fmt.eth(status.eth_price_usd);
      document.getElementById('sys-pools').textContent  = status.pools_loaded || 0;
      document.getElementById('sys-dry').textContent    = status.dry_run ? 'ON' : 'OFF';
      document.getElementById('hdr-chain').textContent  = status.active_chain === 'arbitrum' ? 'ARBITRUM' : 'ETH MAINNET';
      updateCBBadge(status.circuit_breaker || 'CLOSED');
    }

    // AI weights
    updateEngineWeights(aiWeights);

    // Kelly
    if (aiKelly) {
      document.getElementById('kelly-val').textContent  = fmt.score(aiKelly.kelly_fraction);
      document.getElementById('kelly-loan').textContent = fmt.usd(aiKelly.recommended_loan_usd);
      updateCBBadge(aiKelly.circuit_breaker_state);
    }

    renderTradeTable();
    renderOppTable();
    drawPnlChart();
    drawKellyChart();
    updateStats();
  } catch(e) {
    console.warn('[NEXUS] fetchInitial error:', e);
  }
}

// ── Stats Update ──────────────────────────────────────────────────────────────
function updateStats() {
  fetch('/api/v1/trades/stats').then(r=>r.json()).then(s => {
    document.getElementById('stat-total').textContent    = fmt.usd(s.total_profit_usd);
    document.getElementById('stat-winrate').textContent  = fmt.pct(s.win_rate);
    document.getElementById('stat-best').textContent     = fmt.usd(s.best_trade_usd);
    document.getElementById('stat-avg').textContent      = fmt.usd(s.avg_profit_usd);
    document.getElementById('stat-trades').textContent   = s.total_trades || 0;

    document.getElementById('stat-total').className =
      'stat-val ' + ((s.total_profit_usd||0) >= 0 ? 'green' : 'red');
  }).catch(()=>{});
}

// ── Engine Weights UI ─────────────────────────────────────────────────────────
function updateEngineWeights(w) {
  const engines = { ppo: 'ppo', thompson: 'thompson', ukf: 'ukf', cma_es: 'cma' };
  for (const [key, id] of Object.entries(engines)) {
    const val  = w[key] || w[key.replace('_','')] || 0.25;
    const pct  = (val * 100).toFixed(1);
    const bar  = document.getElementById(`bar-${id}`);
    const span = document.getElementById(`val-${id}`);
    if (bar)  bar.style.width  = `${pct}%`;
    if (span) span.textContent = val.toFixed(3);
  }
}

// ── Circuit Breaker Badge ─────────────────────────────────────────────────────
function updateCBBadge(st) {
  const el = document.getElementById('cb-badge');
  if (!el) return;
  el.textContent = st || 'CLOSED';
  el.className   = `cb-badge ${st || 'CLOSED'}`;
}

// ── Opportunity Table ─────────────────────────────────────────────────────────
function renderOppTable() {
  const tbody = document.getElementById('opp-tbody');
  if (!tbody) return;
  const rows = state.opportunities.slice(0, 20).map(o => {
    const ai   = o.ai_decision || {};
    const route = (o.route || []).map(s => s.protocol || 'uni').join('→');
    const loanEth = (+o.loan_amount_wei||0) / 1e18;
    const pct  = fmt.pct(o.profit_probability || o.confidence || 0);
    const score = fmt.score(o.composite_score || ai.composite_score || 0);
    const status = ai.execute ? '<span class="tag-confirmed">QUEUED</span>'
                               : '<span class="tag-skip">SKIP</span>';
    return `<tr>
      <td>${fmt.ts(o.ts || o.created_at)}</td>
      <td style="font-size:10px;color:var(--cyan)">${route || '──'}</td>
      <td style="font-size:10px">${(o.route||[{protocol:'──'}])[0].protocol || '──'}</td>
      <td>${loanEth.toFixed(3)} ETH</td>
      <td class="${(+o.expected_profit_usd||0)>0?'profit-pos':'profit-neg'}">${fmt.usd(o.expected_profit_usd)}</td>
      <td style="color:var(--text-dim)">±${fmt.usd(o.profit_std_usd)}</td>
      <td>${pct}</td>
      <td style="color:var(--cyan)">${score}</td>
      <td>${status}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('') || '<tr><td colspan="9" style="color:var(--text-dim);text-align:center;padding:20px">No opportunities yet</td></tr>';
}

// ── Trade Table ───────────────────────────────────────────────────────────────
function renderTradeTable() {
  const tbody = document.getElementById('trade-tbody');
  if (!tbody) return;
  const rows = state.trades.slice(0, 20).map(t => {
    const net       = +t.net_profit_usd || 0;
    const netClass  = net >= 0 ? 'profit-pos' : 'profit-neg';
    const statusTag = t.status === 'confirmed'
      ? '<span class="tag-confirmed">CONFIRMED</span>'
      : t.status === 'reverted' || t.status === 'failed'
        ? '<span class="tag-failed">FAILED</span>'
        : '<span class="tag-pending">PENDING</span>';
    const txLink = t.tx_hash
      ? `<a class="tx-link" href="https://etherscan.io/tx/${t.tx_hash}" target="_blank">${t.tx_hash.slice(0,10)}…</a>`
      : '──';
    const loanEth = (+t.loan_amount_wei||0)/1e18;
    const gross   = (+t.gross_profit_wei||0)/1e18;
    const gasEth  = (+t.gas_cost_wei||0)/1e18;
    return `<tr>
      <td>${fmt.ts(t.confirmed_at || t.created_at)}</td>
      <td>${txLink}</td>
      <td>${loanEth.toFixed(3)} ETH</td>
      <td class="profit-pos">${gross.toFixed(6)} ETH</td>
      <td style="color:var(--amber)">${gasEth.toFixed(6)} ETH</td>
      <td class="${netClass}">${fmt.usd(net)}</td>
      <td>${statusTag}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('') || '<tr><td colspan="7" style="color:var(--text-dim);text-align:center;padding:20px">No trades yet</td></tr>';
}

// ── Canvas: P&L Line Chart ────────────────────────────────────────────────────
function drawPnlChart() {
  const canvas = document.getElementById('pnl-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const data = state.pnlHistory;
  if (data.length < 2) {
    ctx.fillStyle = '#1a2a1a44';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#607060';
    ctx.font = '12px "Share Tech Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('Awaiting trade data…', W/2, H/2);
    return;
  }

  const vals = data.map(d => d.cumulative);
  const min  = Math.min(...vals);
  const max  = Math.max(...vals);
  const range = max - min || 1;
  const pad  = { t: 10, b: 20, l: 50, r: 10 };

  const toX = i  => pad.l + (i / (data.length-1)) * (W - pad.l - pad.r);
  const toY = v  => pad.t + (1 - (v - min) / range) * (H - pad.t - pad.b);

  // Background grid
  ctx.strokeStyle = '#1a2a1a';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + (g/4) * (H - pad.t - pad.b);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    const v = min + (1 - g/4) * range;
    ctx.fillStyle = '#607060';
    ctx.font = '9px "Share Tech Mono"';
    ctx.textAlign = 'right';
    ctx.fillText(`$${v.toFixed(2)}`, pad.l - 3, y + 3);
  }

  // Gradient fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
  grad.addColorStop(0, '#00ff8830');
  grad.addColorStop(1, '#00ff8800');
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(vals[0]));
  for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(vals[i]));
  ctx.lineTo(toX(data.length-1), H - pad.b);
  ctx.lineTo(toX(0), H - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(vals[0]));
  for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(vals[i]));
  ctx.strokeStyle = vals[vals.length-1] >= 0 ? '#00ff88' : '#ff3355';
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = '#00ff8860';
  ctx.shadowBlur  = 6;
  ctx.stroke();
  ctx.shadowBlur  = 0;

  // Last point dot
  const lx = toX(data.length-1), ly = toY(vals[vals.length-1]);
  ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI*2);
  ctx.fillStyle = '#00ff88'; ctx.fill();
}

// ── Canvas: Gas Arc Gauge ─────────────────────────────────────────────────────
function drawGasArc(gwei) {
  const canvas = document.getElementById('gas-arc');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W/2, cy = H * 0.85;
  const r  = 70;
  const startAngle = Math.PI;
  const endAngle   = 2 * Math.PI;
  const maxGwei    = 200;
  const fraction   = Math.min(gwei / maxGwei, 1);
  const sweepAngle = startAngle + fraction * Math.PI;

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2*Math.PI);
  ctx.strokeStyle = '#1a2a1a';
  ctx.lineWidth   = 12;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // Fill
  const color = gwei < 30 ? '#00ff88' : gwei < 80 ? '#ffaa00' : '#ff3355';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, sweepAngle);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 12;
  ctx.shadowColor = color + '80';
  ctx.shadowBlur  = 10;
  ctx.stroke();
  ctx.shadowBlur  = 0;

  // Tick labels
  ctx.fillStyle = '#607060';
  ctx.font      = '9px "Share Tech Mono"';
  ctx.textAlign = 'center';
  [[0,'0'],[0.5,'100'],[1,'200']].forEach(([f, label]) => {
    const angle = Math.PI + f * Math.PI;
    const tx = cx + (r + 18) * Math.cos(angle);
    const ty = cy + (r + 18) * Math.sin(angle);
    ctx.fillText(label, tx, ty);
  });
}

// ── Canvas: Kelly Bar Chart ───────────────────────────────────────────────────
function drawKellyChart() {
  const canvas = document.getElementById('kelly-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const data = state.kellyHistory;
  if (data.length === 0) return;

  const max   = Math.max(...data.map(Math.abs), 0.01);
  const bw    = Math.max(3, Math.floor((W - 10) / data.length) - 1);
  const zeroY = H * 0.6;

  data.forEach((val, i) => {
    const x = 5 + i * (bw + 1);
    const barH = Math.abs(val) / max * (H * 0.5);
    const y    = val >= 0 ? zeroY - barH : zeroY;
    ctx.fillStyle = val >= 0 ? '#00bb66' : '#ff3355';
    ctx.fillRect(x, y, bw, barH);
  });

  // Zero line
  ctx.strokeStyle = '#1a2a1a';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(W, zeroY); ctx.stroke();
}

// ── Uptime Ticker ─────────────────────────────────────────────────────────────
let _uptimeStart = Date.now();
function tickUptime() {
  fetch('/api/v1/control/status').then(r=>r.json()).then(s => {
    document.getElementById('sys-uptime').textContent = fmt.uptime(s.uptime_seconds);
    document.getElementById('sys-scans').textContent  = s.scan_count || 0;
    document.getElementById('sys-eth').textContent    = fmt.eth(s.eth_price_usd);
    document.getElementById('sys-pools').textContent  = s.pools_loaded || 0;
    document.getElementById('hdr-block').textContent  = `BLOCK ${s.block_number || '──'}`;
    updateCBBadge(s.circuit_breaker || 'CLOSED');
  }).catch(()=>{});
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Initial draws with empty data
  drawPnlChart();
  drawGasArc(0);
  drawKellyChart();

  // Start WebSocket
  connectWS();

  // Periodic refresh of status + stats every 10s
  setInterval(tickUptime, 10000);
  setInterval(updateStats, 15000);

  // Heartbeat ping
  setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send('ping');
    }
  }, 25000);
});

// Re-draw charts on resize
window.addEventListener('resize', () => {
  drawPnlChart();
  drawKellyChart();
});
