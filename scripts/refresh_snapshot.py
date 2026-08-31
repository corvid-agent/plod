#!/usr/bin/env python3
"""Refresh docs/snapshot.json from TestNet plod app 770734249 / upkeep 110. Read-only. No mnemonic."""
from __future__ import annotations

import base64
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

APP_ID = 770734249
KEEPER = 769891898
UPKEEP = 110
ALGOD = "https://testnet-api.algonode.cloud"
INDEXER = "https://testnet-idx.algonode.cloud"
OUT = Path(__file__).resolve().parents[1] / "docs" / "snapshot.json"


def get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "plod-snapshot-refresh"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def u64(raw: bytes, off: int) -> int:
    return int.from_bytes(raw[off : off + 8], "big")


def app_globals(app_json: dict) -> dict:
    params = (app_json.get("application") or {}).get("params") or app_json.get("params") or {}
    out = {}
    for kv in params.get("global-state") or []:
        key = base64.b64decode(kv["key"]).decode("ascii", "replace")
        val = kv.get("value") or {}
        if val.get("type") == 2:
            out[key] = int(val.get("uint") or 0)
        elif val.get("type") == 1:
            out[key] = base64.b64decode(val.get("bytes") or "").hex()
    return out


def decode_upkeep(raw: bytes) -> dict:
    if len(raw) < 130:
        raise SystemExit(f"short upkeep box {len(raw)}")
    return {
        "id": UPKEEP,
        "target_app": u64(raw, 32),
        "interval_rounds": u64(raw, 42),
        "next_execution_round": u64(raw, 50),
        "fee_per_execution": u64(raw, 58),
        "balance": u64(raw, 66),
        "times_executed": u64(raw, 74),
        "registered_round": u64(raw, 98),
    }


def status_of(u: dict, last_round: int) -> str:
    if u["balance"] < u["fee_per_execution"]:
        return "GROUNDED"
    if last_round > u["next_execution_round"]:
        return "LATE"
    return "ON TIME"


def main() -> None:
    if UPKEEP in (81, 87):
        raise SystemExit("refusing upkeep 81/87")
    status = get(f"{ALGOD}/v2/status")
    last_round = int(status["last-round"])
    app = get(f"{INDEXER}/v2/applications/{APP_ID}")
    gs = app_globals(app)
    name = base64.b64encode(b"u" + UPKEEP.to_bytes(8, "big")).decode("ascii")
    box = get(f"{INDEXER}/v2/applications/{KEEPER}/box?name=b64:{name}")
    upkeep = decode_upkeep(base64.b64decode(box["value"]))
    if upkeep["target_app"] != APP_ID:
        raise SystemExit(f"upkeep {UPKEEP} target {upkeep['target_app']} != {APP_ID}")
    snapshot = {
        "network": "testnet",
        "appId": APP_ID,
        "keeperAppId": KEEPER,
        "upkeepId": UPKEEP,
        "last_round": last_round,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {
            "indexer": INDEXER,
            "algod": ALGOD,
            "box": "u||itob(110)",
        },
        "app": {
            "calls": int(gs.get("calls") or 0),
            "keeper_app": int(gs.get("keeper_app") or 0),
            "last_round": int(gs.get("last_round") or 0) if isinstance(gs.get("last_round"), int) else 0,
        },
        "upkeep": upkeep,
        "status": status_of(upkeep, last_round),
        "notes": "Read-only snapshot of box u||itob(110). Skip 81. Never poke 87. No invented txids.",
    }
    OUT.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(
        f"wrote {OUT} last_round={last_round} status={snapshot['status']} "
        f"next={upkeep['next_execution_round']} ticks={snapshot['app']['calls']}"
    )


if __name__ == "__main__":
    main()
