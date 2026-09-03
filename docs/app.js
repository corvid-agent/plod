/* PLOD — weekly tick status board. Reads Arcron TestNet keeper box state.
   TestNet only. Read-only. No wallet. No keys.
   Reads ONLY u||itob(upkeepId) from deploy.json. Does not walk keeper boxes.
   Skip 81. Never poke 87.
   Graphs paint appending TestNet history via in-page SQLite (sql.js). */
(() => {
  const INDEXER = "https://testnet-idx.algonode.cloud";
  const ALGOD = "https://testnet-api.algonode.cloud";
  const EXPLORER = "https://testnet.explorer.perawallet.app/application/";
  const CONTRACT_SRC =
    "https://github.com/corvid-agent/plod/blob/main/smart_contracts/plod/contract.py";
  const DEFAULT_KEEPER = 769891898;
  const PLOD_APP = 770734249;
  const ROUND_SEC = 2.8;
  const REFRESH_MS = 30000;
  const SKIP_UPKEEP = 81;
  const NEVER_POKE = 87;
  const REGISTERED_ROUND = 66830248;
  const FEE_PER_EXEC = 4000;
  const PHOS = "#7cff6b";
  const DIM = "#3a8a32";
  const AMBER = "#e6c15a";
  const DEAD = "#143318";

  function b64ToBytes(b64) {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function u64(dv, off) {
    return dv.getUint32(off) * 0x100000000 + dv.getUint32(off + 4);
  }

  function itob8(n) {
    const raw = new Uint8Array(8);
    const dv = new DataView(raw.buffer);
    dv.setUint32(0, Math.floor(n / 0x100000000));
    dv.setUint32(4, n >>> 0);
    return raw;
  }

  function upkeepBoxB64(id) {
    const raw = new Uint8Array(9);
    raw[0] = 117; // "u"
    raw.set(itob8(id), 1);
    let s = "";
    for (const b of raw) s += String.fromCharCode(b);
    return btoa(s);
  }

  // Same upkeep box layout as corvid-agent/arrivals.
  function decodeUpkeep(id, bytes) {
    if (bytes.length < 130) throw new Error("short upkeep " + id);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      id,
      target_app: u64(dv, 32),
      interval_rounds: u64(dv, 42),
      next_execution_round: u64(dv, 50),
      fee_per_execution: u64(dv, 58),
      balance: u64(dv, 66),
      times_executed: u64(dv, 74),
      registered_round: bytes.length >= 106 ? u64(dv, 98) : REGISTERED_ROUND,
    };
  }

  function b64utf8(b64) {
    try { return atob(b64); } catch { return ""; }
  }

  function readGlobal(state, name) {
    if (!Array.isArray(state)) return null;
    for (const kv of state) {
      if (b64utf8(kv.key) !== name) continue;
      if (kv.value && kv.value.type === 2) return kv.value.uint;
      if (kv.value && kv.value.type === 1) return kv.value.bytes;
      return null;
    }
    return null;
  }

  async function fetchJson(url, noStore) {
    const opts = { headers: { Accept: "application/json" } };
    if (noStore) opts.cache = "no-store";
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(url + " " + res.status);
    return res.json();
  }

  function flaps(el, text) {
    el.replaceChildren();
    for (const ch of String(text)) {
      const d = document.createElement("span");
      d.className = "flap" + (ch === " " ? " blank" : "");
      d.textContent = ch === " " ? "\u00a0" : ch;
      el.appendChild(d);
    }
  }

  function algo(micro) {
    const s = (micro / 1e6).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return s === "" ? "0" : s;
  }

  function intervalLabel(rounds) {
    const sec = rounds * ROUND_SEC;
    if (sec < 90) return rounds + "r";
    if (sec < 3600) return "~" + Math.round(sec / 60) + "m";
    if (sec < 86400) return "~" + (sec / 3600).toFixed(1) + "h";
    return "~" + (sec / 86400).toFixed(1) + "d";
  }

  function dueLabel(u, round) {
    const delta = u.next_execution_round - round;
    const sec = Math.abs(delta) * ROUND_SEC;
    let span;
    if (sec < 90) span = Math.abs(delta) + "r";
    else if (sec < 3600) span = "~" + Math.round(sec / 60) + "m";
    else if (sec < 86400) span = "~" + (sec / 3600).toFixed(1) + "h";
    else span = "~" + (sec / 86400).toFixed(1) + "d";
    return delta >= 0 ? "due in " + span : "overdue " + span;
  }

  function statusOf(u, round) {
    if (u.balance < u.fee_per_execution) return "GROUNDED";
    if (round > u.next_execution_round) return "LATE";
    return "ON TIME";
  }

  function setStatus(word, cls, subHtml) {
    const el = document.getElementById("status");
    el.className = "flaps big " + cls;
    flaps(el, word.toUpperCase());
    document.getElementById("subhead").innerHTML = subHtml;
    document.title = "PLOD — " + word.toUpperCase();
  }

  const STAT_IDS = [
    "stat-app", "stat-upkeep", "stat-next", "stat-interval",
    "stat-exec", "stat-escrow", "stat-round", "stat-ticks",
  ];

  function fillStats(map) {
    for (const id of STAT_IDS) {
      if (map[id] == null) continue;
      flaps(document.getElementById(id), map[id]);
    }
  }

  function paintKnown(cfg, extra) {
    extra = extra || {};
    fillStats(Object.assign({
      "stat-app": cfg.appId ? String(cfg.appId) : "—",
      "stat-upkeep": cfg.upkeepId ? String(cfg.upkeepId) : "—",
      "stat-ticks": extra.ticks != null ? String(extra.ticks) : "0",
    }, extra.stats || {}));
  }

  function sizeCanvas(c) {
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    const w = Math.max(280, Math.floor(rect.width || c.width || 640));
    const h = Math.max(100, Math.floor((c.height / (c.width || 640)) * w));
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function drawRemainingLine(rows) {
    const c = document.getElementById("remaining-canvas");
    const meta = document.getElementById("remaining-meta");
    if (!c) return;
    const { ctx, w, h } = sizeCanvas(c);
    ctx.clearRect(0, 0, w, h);
    if (meta) meta.textContent = "sqlite " + rows.length + " samples · TestNet";
    if (!rows.length) {
      ctx.fillStyle = DIM;
      ctx.font = "12px IBM Plex Mono, monospace";
      ctx.fillText("no history yet", 12, 28);
      return;
    }
    const vals = rows.map((r) => Number(r.remaining_rounds || 0));
    const max = Math.max(...vals, 1);
    const pad = 16;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const px = pad + (i * (w - pad * 2)) / Math.max(1, vals.length - 1);
      const py = h - pad - (v / max) * (h - pad * 2);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = PHOS;
    ctx.lineWidth = 2;
    ctx.shadowColor = PHOS;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
    const lastX = pad + ((vals.length - 1) * (w - pad * 2)) / Math.max(1, vals.length - 1);
    ctx.lineTo(lastX, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = "rgba(124,255,107,0.08)";
    ctx.fill();
    ctx.fillStyle = DIM;
    ctx.font = "10px IBM Plex Mono, monospace";
    const last = vals[vals.length - 1];
    ctx.fillText(String(last) + "r left", pad, 14);
  }

  function drawEscrowHistory(rows, currentEscrow, fee) {
    const c = document.getElementById("escrow-canvas");
    if (!c) return;
    const { ctx, w, h } = sizeCanvas(c);
    ctx.clearRect(0, 0, w, h);
    const escrows = rows.length
      ? rows.map((r) => Number(r.escrow || 0))
      : [Number(currentEscrow || 0)];
    const feeVal = Number(fee != null ? fee : FEE_PER_EXEC);
    const max = Math.max(...escrows, feeVal, 1);
    const pad = 16;
    const chartH = Math.floor(h * 0.55);
    ctx.beginPath();
    escrows.forEach((v, i) => {
      const px = pad + (i * (w - pad * 2)) / Math.max(1, escrows.length - 1);
      const py = chartH - 8 - (v / max) * (chartH - 24);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = PHOS;
    ctx.lineWidth = 2;
    ctx.shadowColor = PHOS;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // current escrow vs fee bars
    const barY = chartH + 10;
    const barH = Math.min(22, h - barY - 8);
    const cur = Number(currentEscrow != null ? currentEscrow : escrows[escrows.length - 1] || 0);
    const barMax = Math.max(cur, feeVal, 1);
    const usable = w - 100;
    ctx.fillStyle = DEAD;
    ctx.fillRect(90, barY, usable, barH);
    ctx.fillStyle = PHOS;
    ctx.shadowColor = PHOS;
    ctx.shadowBlur = 8;
    ctx.fillRect(90, barY, Math.max(2, (cur / barMax) * usable), barH);
    ctx.shadowBlur = 0;
    ctx.fillStyle = AMBER;
    const feeW = Math.max(2, (feeVal / barMax) * usable);
    ctx.fillRect(90, barY + barH + 4, feeW, Math.max(4, barH / 3));
    ctx.fillStyle = DIM;
    ctx.font = "10px IBM Plex Mono, monospace";
    ctx.fillText("escrow", 4, barY + barH - 6);
    ctx.fillText("fee", 4, barY + barH + 12);
    ctx.fillStyle = PHOS;
    ctx.fillText(String(cur), 94, barY + barH - 6);
  }

  function drawWeekTimeline(sample) {
    const c = document.getElementById("timeline-canvas");
    if (!c) return;
    const { ctx, w, h } = sizeCanvas(c);
    ctx.clearRect(0, 0, w, h);
    const reg = Number((sample && sample.registered_round) || REGISTERED_ROUND);
    const last = Number((sample && sample.lastRound) || 0);
    const next = Number((sample && sample.next_execution_round) || 67054248);
    const ticks = Number((sample && sample.ticks) || 0);
    const lo = Math.min(reg, last || reg, next);
    const hi = Math.max(reg, last || reg, next);
    const span = Math.max(1, hi - lo);
    const y = h / 2;
    const pad = 40;
    function xOf(r) {
      return pad + ((r - lo) / span) * (w - pad * 2);
    }
    ctx.strokeStyle = DEAD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
    const marks = [
      { r: reg, label: "registered", color: DIM },
      { r: last || reg, label: "lastRound", color: PHOS },
      { r: next, label: "next", color: AMBER },
    ];
    marks.forEach((m) => {
      const px = xOf(m.r);
      ctx.beginPath();
      ctx.arc(px, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.shadowColor = m.color;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = m.color;
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(m.label, px, y - 14);
      ctx.fillText("r" + m.r, px, y + 22);
    });
    ctx.textAlign = "left";
    ctx.fillStyle = DIM;
    ctx.font = "10px IBM Plex Mono, monospace";
    ctx.fillText("ticks " + ticks, pad, 14);
  }

  let sqlDb = null;

  async function bootSql(rows) {
    if (typeof initSqlJs !== "function") return rows;
    const SQL = await initSqlJs({
      locateFile: (f) => "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/" + f,
    });
    sqlDb = new SQL.Database();
    sqlDb.run(
      "CREATE TABLE samples (t TEXT, network TEXT, appId INTEGER, keeperAppId INTEGER, upkeepId INTEGER, lastRound INTEGER, next_execution_round INTEGER, remaining_rounds INTEGER, escrow INTEGER, ticks INTEGER, times_executed INTEGER, status TEXT, source TEXT)"
    );
    const ins = sqlDb.prepare(
      "INSERT INTO samples VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    rows.forEach((r) => {
      ins.run([
        r.t || "",
        r.network || "testnet",
        Number(r.appId || 0),
        Number(r.keeperAppId || 0),
        Number(r.upkeepId || 0),
        Number(r.lastRound || 0),
        Number(r.next_execution_round || 0),
        Number(r.remaining_rounds || 0),
        Number(r.escrow || 0),
        Number(r.ticks || 0),
        Number(r.times_executed || 0),
        r.status || "",
        r.source || "",
      ]);
    });
    ins.free();
    const res = sqlDb.exec(
      "SELECT t, network, appId, keeperAppId, upkeepId, lastRound, next_execution_round, remaining_rounds, escrow, ticks, times_executed, status, source FROM samples WHERE network='testnet' AND appId=770734249 AND upkeepId=110 ORDER BY lastRound"
    );
    if (!res[0]) return rows;
    return res[0].values.map((v) => ({
      t: v[0],
      network: v[1],
      appId: v[2],
      keeperAppId: v[3],
      upkeepId: v[4],
      lastRound: v[5],
      next_execution_round: v[6],
      remaining_rounds: v[7],
      escrow: v[8],
      ticks: v[9],
      times_executed: v[10],
      status: v[11],
      source: v[12],
    }));
  }

  async function loadHistoryGraphs(liveSample) {
    let history = [];
    try {
      const res = await fetch("./history.json", { cache: "no-store" });
      if (res.ok) history = await res.json();
    } catch (_) {
      history = [];
    }
    if (!Array.isArray(history)) history = [];
    // TestNet only — never paint LocalNet app ids as TestNet.
    history = history.filter(
      (r) =>
        r &&
        r.network === "testnet" &&
        Number(r.appId) === PLOD_APP &&
        Number(r.upkeepId) === 110
    );
    if (liveSample && liveSample.lastRound) {
      const exists = history.some(
        (r) => Number(r.lastRound) === Number(liveSample.lastRound)
      );
      if (!exists) history = history.concat([liveSample]);
    }
    let rows = history;
    try {
      rows = await bootSql(history);
    } catch (_) {
      rows = history;
    }
    const last = rows[rows.length - 1] || liveSample || null;
    const escrow = last ? Number(last.escrow || 0) : 0;
    drawRemainingLine(rows);
    drawEscrowHistory(rows, escrow, FEE_PER_EXEC);
    drawWeekTimeline(
      last
        ? Object.assign({}, last, {
            registered_round: REGISTERED_ROUND,
          })
        : { registered_round: REGISTERED_ROUND, lastRound: 0, next_execution_round: 67054248, ticks: 0 }
    );
  }

  function sampleFromUpkeep(u, round, ticks, status, source) {
    return {
      t: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      network: "testnet",
      appId: PLOD_APP,
      keeperAppId: DEFAULT_KEEPER,
      upkeepId: 110,
      lastRound: Number(round),
      next_execution_round: Number(u.next_execution_round),
      remaining_rounds: Number(u.next_execution_round) - Number(round),
      escrow: Number(u.balance),
      ticks: Number(ticks || 0),
      times_executed: Number(u.times_executed || 0),
      status: status || statusOf(u, round),
      source: source || "live",
      registered_round: Number(u.registered_round || REGISTERED_ROUND),
    };
  }

  function renderUpkeep(u, round, ticks, cfg) {
    const st = statusOf(u, round);
    const cls = st === "ON TIME" ? "ontime" : st === "LATE" ? "late" : "grounded";
    let sub;
    if (st === "ON TIME") {
      sub = "next exec round " + u.next_execution_round + " · " +
        dueLabel(u, round) + " · upkeep #" + u.id;
    } else if (st === "LATE") {
      sub = "window passed at round " + u.next_execution_round + " · " +
        dueLabel(u, round) + " · upkeep #" + u.id;
    } else {
      sub = "escrow " + u.balance + " µALGO below fee " + u.fee_per_execution +
        " µALGO · upkeep #" + u.id + " is out of fuel";
    }
    setStatus(st, cls, sub);
    fillStats({
      "stat-app": String(cfg.appId),
      "stat-upkeep": String(u.id),
      "stat-next": String(u.next_execution_round),
      "stat-interval": intervalLabel(u.interval_rounds),
      "stat-exec": String(u.times_executed),
      "stat-escrow": algo(u.balance) + " ALGO",
      "stat-round": String(round),
      "stat-ticks": ticks == null ? "0" : String(ticks),
    });
  }

  let cfgPromise = null;
  function loadConfig() {
    if (!cfgPromise) {
      cfgPromise = fetchJson("./deploy.json", true).then((c) => ({
        appId: Number(c.appId) || 0,
        keeper: Number(c.keeperAppId) || DEFAULT_KEEPER,
        upkeepId: Number(c.upkeepId) || 0,
        network: c.network || "testnet",
        notes: c.notes || "",
      }));
    }
    return cfgPromise;
  }

  async function fetchOwnUpkeep(keeper, id) {
    if (id === NEVER_POKE) throw new Error("refusing upkeep " + NEVER_POKE);
    if (id === SKIP_UPKEEP || id <= 0) return null;
    const box = await fetchJson(
      INDEXER + "/v2/applications/" + keeper +
      "/box?name=b64:" + encodeURIComponent(upkeepBoxB64(id))
    );
    return decodeUpkeep(id, b64ToBytes(box.value));
  }

  async function tick() {
    let cfg;
    try {
      cfg = await loadConfig();
    } catch (e) {
      setStatus("FEED DOWN", "down",
        "deploy.json unreadable · showing nothing rather than guessing");
      loadHistoryGraphs(null);
      return;
    }
    document.getElementById("keeper-meta").textContent =
      cfg.network + " · app " + cfg.appId + " · upkeep " + cfg.upkeepId;

    if (cfg.appId <= 0) {
      setStatus("NOT DEPLOYED", "gate",
        'contract exists as <a href="' + CONTRACT_SRC + '">source</a> only' +
        " · lights up after TestNet deploy + Arcron registration");
      loadHistoryGraphs(null);
      return;
    }

    paintKnown(cfg, { ticks: 0 });

    let round, mine = null, ticks = 0;
    try {
      const status = await fetchJson(ALGOD + "/v2/status");
      round = status["last-round"];
      mine = await fetchOwnUpkeep(cfg.keeper, cfg.upkeepId);
      try {
        const app = await fetchJson(INDEXER + "/v2/applications/" + cfg.appId);
        const params = (app.application && app.application.params) || app.params || {};
        const c = readGlobal(params["global-state"], "calls");
        ticks = c == null ? 0 : c;
      } catch {
        ticks = 0;
      }
    } catch (e) {
      try {
        const snap = await fetchJson("./snapshot.json");
        const u = snap.upkeep || {};
        const decoded = {
          id: Number(u.id),
          target_app: Number(u.target_app),
          interval_rounds: Number(u.interval_rounds),
          next_execution_round: Number(u.next_execution_round),
          fee_per_execution: Number(u.fee_per_execution),
          balance: Number(u.balance),
          times_executed: Number(u.times_executed),
          registered_round: Number(u.registered_round || REGISTERED_ROUND),
        };
        if (Number(snap.appId) !== cfg.appId || decoded.target_app !== cfg.appId) {
          throw new Error("snapshot mismatch");
        }
        const snapRound = Number(snap.last_round);
        const snapTicks = (snap.app && snap.app.calls != null) ? snap.app.calls : 0;
        renderUpkeep(decoded, snapRound, snapTicks, cfg);
        const sub = document.getElementById("subhead");
        if (sub) {
          sub.innerHTML = sub.innerHTML +
            " · snapshot fallback round " + snapRound +
            (snap.generated_at ? " (" + snap.generated_at + ")" : "");
        }
        loadHistoryGraphs(
          sampleFromUpkeep(decoded, snapRound, snapTicks, snap.status, "snapshot")
        );
        return;
      } catch (e2) {
        setStatus("FEED DOWN", "down",
          "indexer unreachable · app " + cfg.appId + " · upkeep " + cfg.upkeepId +
          " · ticks 0 rather than guessing chain flaps");
        paintKnown(cfg, { ticks: 0 });
        loadHistoryGraphs(null);
        return;
      }
    }

    if (!mine || mine.target_app !== cfg.appId) {
      setStatus("NOT REGISTERED", "gate",
        'app <a href="' + EXPLORER + cfg.appId + '">' + cfg.appId + "</a>" +
        " is live but upkeep " + cfg.upkeepId + " on keeper " + cfg.keeper +
        " does not point at it");
      fillStats({
        "stat-app": String(cfg.appId),
        "stat-upkeep": cfg.upkeepId ? String(cfg.upkeepId) : "—",
        "stat-round": String(round),
        "stat-ticks": String(ticks),
      });
      loadHistoryGraphs(null);
      return;
    }

    renderUpkeep(mine, round, ticks, cfg);
    loadHistoryGraphs(sampleFromUpkeep(mine, round, ticks, null, "live"));
  }

  drawRemainingLine([]);
  drawEscrowHistory([], 0, FEE_PER_EXEC);
  drawWeekTimeline(null);
  tick();
  setInterval(tick, REFRESH_MS);
})();
