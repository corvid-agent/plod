# plod

A public weekly cadence on Arcron TestNet. If keepers show up, the counter ticks.

**TestNet only. Unaudited. Not deployed yet.** There is no MainNet path, and this
repo will refuse one. Do not send mainnet funds at this contract; there is no
contract on any network until [#1](https://github.com/corvid-agent/plod/issues/1)
lands.

Status board: <https://corvid-agent.github.io/plod/>

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

## Intended register

Once deployed on TestNet ([#1](https://github.com/corvid-agent/plod/issues/1)):

- Keeper: Arcron TestNet app **`769891898`**
- Hook: `tick()` (selector only)
- Interval: about a week, **~224000 rounds** at ~2.7 s/round

That round count is **approximate** and must be chosen at **register** time
against the round time you actually measure, not compiled into the app.
See [#2](https://github.com/corvid-agent/plod/issues/2).

The Pages stub lights up when `docs/deploy.json` has `appId > 0`. Later it
should read the live upkeep box and show **ON TIME / LATE / GROUNDED** —
[#3](https://github.com/corvid-agent/plod/issues/3).

## How a human deploys later

No mnemonic belongs in this repo, in a workflow, or in `docs/deploy.json`.
The creator of record (CoS) deploys from a machine that already has the
account, when that account has a TestNet bank ([#1](https://github.com/corvid-agent/plod/issues/1)).

Sketch, AlgoKit / Puya, TestNet only:

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
docs/index.html                    CRT board (this Pages stub)
docs/style.css
docs/deploy.json                   {"appId":0,...}  flip the number after deploy
.github/workflows/pages.yml        publishes docs/ from main
```

## License

MIT. See [LICENSE](LICENSE).
