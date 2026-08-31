/* PLOD — weekly tick status board. Reads Arcron TestNet keeper box state.
   TestNet only. Read-only. No wallet. No keys.
   Reads ONLY u||itob(upkeepId) from deploy.json. Does not walk keeper boxes.
   Skip 81. Never poke 87. */
(() => {
  const INDEXER = "https://testnet-idx.algonode.cloud";
  const ALGOD = "https://testnet-api.algonode.cloud";
  const EXPLORER = "https://testnet.explorer.perawallet.app/application/";
  const CONTRACT_SRC =
    "https://github.com/corvid-agent/plod/blob/main/smart_contracts/plod/contract.py";
  const DEFAULT_KEEPER = 769891898;
  const ROUND_SEC = 2.8;
  const REFRESH_MS = 30000;
  const SKIP_UPKEEP = 81;
  const NEVER_POKE = 87;

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
      return;
    }
    document.getElementById("keeper-meta").textContent =
      cfg.network + " · app " + cfg.appId + " · upkeep " + cfg.upkeepId;

    if (cfg.appId <= 0) {
      setStatus("NOT DEPLOYED", "gate",
        'contract exists as <a href="' + CONTRACT_SRC + '">source</a> only' +
        " · lights up after TestNet deploy + Arcron registration");
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
        };
        if (Number(snap.appId) !== cfg.appId || decoded.target_app !== cfg.appId) {
          throw new Error("snapshot mismatch");
        }
        const round = Number(snap.last_round);
        const ticks = (snap.app && snap.app.calls != null) ? snap.app.calls : 0;
        renderUpkeep(decoded, round, ticks, cfg);
        const sub = document.getElementById("subhead");
        if (sub) {
          sub.innerHTML = sub.innerHTML +
            " · snapshot fallback round " + round +
            (snap.generated_at ? " (" + snap.generated_at + ")" : "");
        }
        return;
      } catch (e2) {
        setStatus("FEED DOWN", "down",
          "indexer unreachable · app " + cfg.appId + " · upkeep " + cfg.upkeepId +
          " · ticks 0 rather than guessing chain flaps");
        paintKnown(cfg, { ticks: 0 });
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
      return;
    }

    renderUpkeep(mine, round, ticks, cfg);
  }

  tick();
  setInterval(tick, REFRESH_MS);
})();
