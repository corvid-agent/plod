# plod

A public weekly cadence on Arcron TestNet. If keepers show up, the counter ticks.

**LIVE on Arcron TestNet. Unaudited. No MainNet path.** This repo will refuse
one. Do not send mainnet funds at this contract.

| | live |
|---|---|
| App | [`770734249`](https://testnet.explorer.perawallet.app/application/770734249) |
| Keeper | [`769891898`](https://testnet.explorer.perawallet.app/application/769891898) |
| Upkeep | `110` |
| Interval | `224000` rounds (~1 week at measured TestNet round time) |
| Policy | `SKIP_AHEAD` |
| Next tick | round `67054248` |
| Fee | `4000` µALGO / tick |
| Escrow | `500000` µALGO (0.5 ALGO) |
| Ticks so far | `0` |
| Creator | `CEPY52VZRWFLQCJZXQRVQFOPMNAD6M4HCDP4XWKVFXRONJTC6KJVWRCXJI` |

Status board: <https://corvid-agent.github.io/plod/>

Read-only snapshot as of round `66852622` (2026-08-31T15:54:52Z UTC): `docs/snapshot.json`. Refresh with `python3 scripts/refresh_snapshot.py` (no key). The CRT prefers live algod/indexer and falls back to that file.

Sibling flight board: [arrivals](https://corvid-agent.github.io/arrivals/).

## What it is

`Plod` is a small ARC-4 Algorand Python (Puya) app. Global state is three
numbers a keeper can move:

| key | meaning |
|---|---|
| `calls` | how many times `tick` has succeeded |
| `last_round` | `Global.round` of the last successful tick |
| `last_caller` | inner-call sender of that tick |
| `keeper_app` | Arcron keeper app id, set once by the creator |

The Arcron hook is **`tick()`**, zero arguments. Arcron `execute()` inner-calls
the target; the inner sender is `Application(keeper_app).address`, and that is
what `tick` authorizes. It does not compare against `itob(keeper_app.id)`.

The keeper is named with `set_keeper(app)` after create — an explicit admin
method, not a create arg. A sloppy `deploy.py` that mapped every uint64
create-arg onto keeper app `769891898` would freeze a "weekly" interval at
about 68 years. This contract takes no uint64 create args so that cannot
happen here.

## Live register

On TestNet as of 2026-08-30 ([#1](https://github.com/corvid-agent/plod/issues/1),
[#2](https://github.com/corvid-agent/plod/issues/2)):

- Keeper: Arcron TestNet app **`769891898`**
- Upkeep: **`110`**
- Hook: `tick()` (selector only)
- Interval: **224000 rounds** at measured ~2.7 s/round
- Fee: **4000 µALGO**, escrow **0.5 ALGO**, policy **SKIP_AHEAD**
- First tick due round **67054248**
- Contract `calls` is still **0**

That round count was chosen at **register** time against measured round time,
not compiled into the app.

The Pages board reads **only** box `u || itob(110)` on the keeper plus this
app's global `calls`. It paints **ON TIME / LATE / GROUNDED**
([#3](https://github.com/corvid-agent/plod/issues/3)). It does not walk the
rest of the keeper's boxes.

## How it was deployed

No mnemonic belongs in this repo, in a workflow, or in `docs/deploy.json`.
The creator of record deployed from a machine that already had the TestNet
bank. Zero create-args. Then `set_keeper(769891898)`, then Arcron register
for weekly `tick()`. Ids live in `docs/deploy.json`. Do not re-create.

Sketch, AlgoKit / Puya, TestNet only — kept so nobody "helps" by passing
the keeper id as a create arg:

```bash
# compile
algokit compile python smart_contracts/plod/contract.py

# create with ZERO args — do not pass 769891898, an interval, or anything else
# sign with a key that lives in the OS keychain / AlgoKit wallet / env var
# that is NOT committed. `algokit goal account export` if you must; never
# paste a 25-word phrase into a file in this tree.

# then, still as creator:
#   set_keeper(Application(769891898))
# write the resulting app id into docs/deploy.json (appId, still "testnet")
# register the upkeep on Arcron 769891898 with tick() and a weekly interval
```

Use the TestNet dispenser for fees. If a deploy script grows a `create_args`
list, keep it empty. The weekly cadence is an Arcron register field, not a
Puya constructor argument.

## Layout

```
smart_contracts/plod/contract.py   ARC-4 target
docs/index.html                    CRT board
docs/app.js                        live reader (upkeep 110 only)
docs/style.css
docs/deploy.json                   live TestNet ids (app 770734249)
.github/workflows/pages.yml        publishes docs/ from main
```

## License

MIT. See [LICENSE](LICENSE).
