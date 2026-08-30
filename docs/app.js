/* PLOD — weekly tick status board. Reads Arcron TestNet keeper box state.
   TestNet only. Read-only. No wallet. No keys. */
(() => {
  const INDEXER = "https://testnet-idx.algonode.cloud";
  const ALGOD = "https://testnet-api.algonode.cloud";
  const EXPLORER = "https://testnet.explorer.perawallet.app/application/";
  const CONTRACT_SRC =
    "https://github.com/corvid-agent/plod/blob/main/smart_contracts/plod/contract.py";
  const DEFAULT_KEEPER = 769891898;
  const ROUND_SEC = 2.8;
  const REFRESH_MS = 30000;

  function b64ToBytes(b64) {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function u64(dv, off) {
    return dv.getUint32(off) * 0x100000000 + dv.getUint32(off + 4);
  }

  function boxIdFromName(b64name) {
    const raw = b64ToBytes(b64name);
    if (raw.length < 9 || raw[0] !== 117) return null; // "u" || itob(upkeep_id)
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    return u64(dv, 1);
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

  async function listBoxes(keeper) {
    const names = [];
    let url = INDEXER + "/v2/applications/" + keeper + "/boxes";
    for (let i = 0; i < 20; i++) {
      const page = await fetchJson(url);
      for (const b of page.boxes || []) names.push(b.name);
      if (!page["next-token"]) break;
      url = INDEXER + "/v2/applications/" + keeper +
        "/boxes?next=" + encodeURIComponent(page["next-token"]);
    }
    return names;
  }

  function flaps(el, text) {
    el.replaceChildren();
    for (const ch of String(text)) {
      const d = document.createElement("span");
      d.className = "flap" + (ch === " " ? " blank" : "");
      d.textContent = ch === " " ? " " : ch;
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
    "stat-next", "stat-interval", "stat-exec",
    "stat-escrow", "stat-round", "stat-ticks",
  ];

  function fillStats(map) {
    for (const id of STAT_IDS) {
      flaps(document.getElementById(id), map[id] || "—");
    }
  }

  function renderUpkeep(u, round, ticks) {
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
      "stat-next": String(u.next_execution_round),
      "stat-interval": intervalLabel(u.interval_rounds),
      "stat-exec": String(u.times_executed),
      "stat-escrow": algo(u.balance) + " ALGO",
      "stat-round": String(round),
      "stat-ticks": ticks == null ? "—" : String(ticks),
    });
  }

  let cfgPromise = null;
  function loadConfig() {
    if (!cfgPromise) {
      cfgPromise = fetchJson("./deploy.json", true).then((c) => ({
        appId: Number(c.appId) || 0,
        keeper: Number(c.keeperAppId) || DEFAULT_KEEPER,
        network: c.network || "testnet",
        notes: c.notes || "",
      }));
    }
    return cfgPromise;
  }

  async function tick() {
    let cfg;
    try {
      cfg = await loadConfig();
    } catch (e) {
      setStatus("FEED DOWN", "down",
        "deploy.json unreadable · showing nothing rather than guessing");
      fillStats({});
      return;
    }
    document.getElementById("keeper-meta").textContent =
      cfg.network + " · weekly · Arcron keeper " + cfg.keeper;

    if (cfg.appId <= 0) {
      setStatus("NOT DEPLOYED", "gate",
        'contract exists as <a href="' + CONTRACT_SRC + '">source</a> only' +
        " · lights up after TestNet deploy + Arcron registration");
      fillStats({});
      return;
    }

    let round, upkeeps, ticks = null;
    try {
      const status = await fetchJson(ALGOD + "/v2/status");
      round = status["last-round"];
      const names = await listBoxes(cfg.keeper);
      const decoded = await Promise.all(names.map(async (name) => {
        const id = boxIdFromName(name);
        if (id == null) return null;
        const box = await fetchJson(INDEXER + "/v2/applications/" + cfg.keeper +
          "/box?name=b64:" + encodeURIComponent(name));
        return decodeUpkeep(id, b64ToBytes(box.value));
      }));
      upkeeps = decoded.filter(Boolean);
      try {
        const app = await fetchJson(INDEXER + "/v2/applications/" + cfg.appId);
        const params = (app.application && app.application.params) || app.params || {};
        const c = readGlobal(params["global-state"], "calls");
        ticks = c == null ? null : c;
      } catch {
        ticks = null; // contract counter is decorative; keeper box is the truth
      }
    } catch (e) {
      setStatus("FEED DOWN", "down",
        "indexer unreachable · showing nothing rather than guessing");
      fillStats({});
      return;
    }

    const mine = upkeeps.find((u) => u.target_app === cfg.appId);
    if (!mine) {
      setStatus("NOT REGISTERED", "gate",
        'app <a href="' + EXPLORER + cfg.appId + '">' + cfg.appId + "</a>" +
        " is live but no upkeep on keeper " + cfg.keeper + " points at it yet");
      fillStats({
        "stat-round": String(round),
        "stat-ticks": ticks == null ? "—" : String(ticks),
      });
      return;
    }

    renderUpkeep(mine, round, ticks);
  }

  tick();
  setInterval(tick, REFRESH_MS);
})();
