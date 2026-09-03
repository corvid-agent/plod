"""Honesty tests for plod CRT docs — no live network."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
APP = 770734249
KEEPER = 769891898
UPKEEP = 110
FORBIDDEN_APPS = {1001, 1002, 1003, 1004, 1005}


def _load(name: str):
    return json.loads((DOCS / name).read_text())


def test_deploy_json_testnet_ids():
    d = _load("deploy.json")
    assert d["network"] == "testnet"
    assert int(d["appId"]) == APP
    assert int(d["upkeepId"]) == UPKEEP
    assert int(d["keeperAppId"]) == KEEPER
    assert int(d["upkeepId"]) not in (81, 87)
    assert int(d["keeperAppId"]) not in (81, 87)


def test_snapshot_json_matches_deploy():
    s = _load("snapshot.json")
    assert s["network"] == "testnet"
    assert int(s["appId"]) == APP
    assert int(s["upkeepId"]) == UPKEEP
    assert int(s["keeperAppId"]) == KEEPER
    u = s["upkeep"]
    assert int(u["target_app"]) == APP
    assert int(u["id"]) == UPKEEP


def test_history_json_testnet_only():
    rows = _load("history.json")
    assert isinstance(rows, list)
    assert rows
    mnemonic_keys = {"mnemonic", "mnemonics", "secret", "private_key", "passphrase"}
    for r in rows:
        assert r["network"] == "testnet"
        assert int(r["appId"]) == APP
        assert int(r["upkeepId"]) == UPKEEP
        assert r["network"] != "localnet"
        assert int(r["appId"]) not in FORBIDDEN_APPS
        assert not (mnemonic_keys & set(r.keys()))
        assert int(r["remaining_rounds"]) == int(r["next_execution_round"]) - int(r["lastRound"])


def test_index_html_has_sql_and_canvases():
    html = (DOCS / "index.html").read_text()
    assert "sql-wasm.js" in html
    assert "1.11.0" in html
    assert 'id="remaining-canvas"' in html
    assert 'id="escrow-canvas"' in html
    assert 'id="timeline-canvas"' in html
    assert "appending TestNet history" in html or "in-page SQLite" in html


def test_app_js_sql_and_guards():
    js = (DOCS / "app.js").read_text()
    assert "initSqlJs" in js
    assert "bootSql" in js
    assert "SKIP_UPKEEP" in js and "81" in js
    assert "NEVER_POKE" in js and "87" in js
    assert "./history.json" in js
    assert "loadHistoryGraphs" in js


def test_refresh_snapshot_script():
    src = (ROOT / "scripts" / "refresh_snapshot.py").read_text()
    assert "81" in src and "87" in src
    assert "refusing" in src.lower() or "UPKEEP in (81, 87)" in src
    assert "snapshot.json" in src
    assert "history.json" in src
    assert "mnemonic" not in src.lower() or "No mnemonic" in src or "no mnemonic" in src.lower()
    # must mention append path
    assert "append" in src.lower() or "HISTORY" in src


def test_readme_live_ids_and_pages():
    text = (ROOT / "README.md").read_text()
    assert "770734249" in text
    assert "upkeep" in text.lower() and "110" in text
    assert "corvid-agent.github.io/plod" in text
    assert "MIT" in text
