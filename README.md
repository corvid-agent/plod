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

## The status board

<https://corvid-agent.github.io/plod/> reads TestNet directly and paints one of
three words. It is read-only: no wallet, no key, no write path.

| word | Arcron state | meaning |
|---|---|---|
| **ON TIME** | `scheduled` | the upkeep is funded and not yet due; a keeper is expected |
| **LATE** | `due` | past its round and still unserviced; any keeper may take it now |
| **GROUNDED** | `dormant` | nothing registered, or escrow below one fee, so no keeper can be paid |

Those are Arcron's own three states in flight-board words, not a second
opinion. Dormancy is judged against the *escalated* fee, because that is what a
keeper would actually be owed — an upkeep can starve at a balance its creator
counted as several runs.

The board reads the keeper's upkeep boxes (`b"u" + itob(upkeep_id)`) from
algod and finds the one whose `target_app` is Plod. Box state is something any
algod serves for free, so there is no indexer, no backend and no SDK in the
page. Set `upkeepId` in `docs/deploy.json` after registering and it reads that
box directly instead of scanning — more than one upkeep may target the same
app, and a board that silently picks the first is telling a half-truth.

Until `appId > 0` the board says GROUNDED and explains that Plod is not
deployed, which is the truth rather than a spinner.

### Running the tests

The board's arithmetic is a port of Arcron's own `js/src/upkeep.ts` and
`board.ts` — the ARC-4 `Upkeep` decode, the fee escalation and the dormancy
rule — with no dependencies, so it is tested rather than trusted:

```bash
npm test
```

That covers the SHA-512/256 and Algorand address encoding (against the FIPS
vectors and the live keeper's own app account), the box decode against real
ARC-4 bytes, the escalation curve, and which of the three words each state
produces. What it cannot cover is the network: that needs a live node.

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
#   and the upkeep id into upkeepId once registered
# register the upkeep on Arcron 769891898 with tick() and a weekly interval
```

Use the TestNet dispenser for fees. If a deploy script grows a `create_args`
list, keep it empty. The weekly cadence is an Arcron register field, not a
Puya constructor argument.

## Layout

```
smart_contracts/plod/contract.py   ARC-4 target
docs/index.html                    CRT status board
docs/style.css
docs/js/sha512_256.js              SHA-512/256 + Algorand address encoding
docs/js/arcron.js                  Upkeep box decode, fees, the three states
docs/js/chain.js                   algod reads (boxes, global state, round)
docs/js/plod-status.js             which word, and why
docs/js/board.js                   DOM wiring
docs/deploy.json                   {"appId":0,...}  flip the numbers after deploy
test/                              node --test, no dependencies
.github/workflows/pages.yml        publishes docs/ from main
.github/workflows/test.yml         runs the board tests
```

## License

MIT. See [LICENSE](LICENSE).
