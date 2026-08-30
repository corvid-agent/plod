/**
 * The board. Reads TestNet, paints one of three words.
 *
 * Everything it shows is derived from public chain state and `deploy.json`.
 * There is no wallet, no key and no write path anywhere in this page.
 */

import { algos, duration, executionsRemaining, toHex, shortAddress, SKIP_AHEAD } from './arcron.js';
import { applicationAddress } from './sha512_256.js';
import { currentRound, fetchUpkeep, fetchUpkeeps, globalState } from './chain.js';
import { findUpkeep, plodStatus } from './plod-status.js';

const ALGOD = 'https://testnet-api.algonode.cloud';

const el = (id) => document.getElementById(id);

function flaps(target, text, width) {
  const padded = String(text).padStart(width, ' ').slice(-width);
  target.replaceChildren();
  for (const character of padded) {
    const flap = document.createElement('span');
    flap.className = character === ' ' ? 'flap blank' : 'flap';
    flap.textContent = character === ' ' ? '0' : character;
    target.appendChild(flap);
  }
}

function setStatus({ word, state, reason }) {
  const headline = el('headline');
  headline.textContent = word;
  headline.className = `destination ${state}`;
  el('subhead').textContent = reason;
  document.title = `PLOD — ${word}`;
}

function fail(message) {
  const error = el('err');
  error.hidden = false;
  error.textContent = message;
}

async function main() {
  flaps(el('calls'), '0', 6);
  flaps(el('last-round'), '0', 10);
  flaps(el('next-due'), '0', 10);
  flaps(el('escrow'), '0', 8);

  let config;
  try {
    const res = await fetch('./deploy.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`deploy.json ${res.status}`);
    config = await res.json();
  } catch {
    setStatus({ word: 'GROUNDED', state: 'grounded', reason: 'Could not read deploy.json.' });
    return;
  }

  const appId = Number(config.appId) || 0;
  const keeperAppId = Number(config.keeperAppId) || 0;
  const upkeepId = Number(config.upkeepId) || 0;

  el('keeper-app').textContent = keeperAppId ? String(keeperAppId) : '—';
  el('keeper-addr').textContent = keeperAppId ? shortAddress(applicationAddress(keeperAppId)) : '—';
  if (keeperAppId) el('keeper-addr').title = applicationAddress(keeperAppId);
  el('plod-app').textContent = appId ? String(appId) : 'not deployed';

  // Not deployed is a complete answer on its own: there is nothing on chain
  // to read, and saying so beats a spinner that never resolves.
  if (appId <= 0) {
    setStatus(plodStatus({ appId, upkeep: null, currentRound: 0n, keeperAppId }));
    return;
  }

  let round;
  try {
    round = await currentRound(ALGOD);
    el('round').textContent = String(round);
  } catch {
    setStatus({
      word: 'GROUNDED',
      state: 'grounded',
      reason: 'TestNet node unreachable, so the schedule could not be read. This is the board’s fault, not the chain’s.',
    });
    fail(`Could not reach ${ALGOD}.`);
    return;
  }

  // Plod's own counters, which are true whatever the keeper is doing.
  try {
    const state = await globalState(ALGOD, appId);
    flaps(el('calls'), String(state.calls ?? 0n), 6);
    flaps(el('last-round'), String(state.last_round ?? 0n), 10);
  } catch {
    fail(`App ${appId} could not be read; the counters below may be stale.`);
  }

  let upkeep = null;
  try {
    upkeep = upkeepId > 0
      ? await fetchUpkeep(ALGOD, keeperAppId, upkeepId)
      : findUpkeep(await fetchUpkeeps(ALGOD, keeperAppId), appId, 0);
  } catch {
    fail(`Keeper ${keeperAppId} registry could not be read.`);
  }

  setStatus(plodStatus({ appId, upkeep, currentRound: round, keeperAppId }));

  if (!upkeep) return;
  flaps(el('next-due'), String(upkeep.nextExecutionRound), 10);
  flaps(el('escrow'), algos(upkeep.balance), 8);
  el('upkeep-id').textContent = String(upkeep.id);
  el('interval').textContent = `${upkeep.intervalRounds} rounds (~${duration(upkeep.intervalRounds)})`;
  el('policy').textContent = upkeep.policy === SKIP_AHEAD ? 'skips ahead' : 'catches up';
  el('fee').textContent = `${algos(upkeep.feePerExecution)} ALGO`;
  el('runs-left').textContent = String(executionsRemaining(upkeep));
  el('ticks').textContent = String(upkeep.timesExecuted);
  el('selector').textContent = `0x${toHex(upkeep.callArgs[0] ?? new Uint8Array())}`;
  el('detail').hidden = false;
}

main();
