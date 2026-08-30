/**
 * The Arcron upkeep registry, decoded from box state.
 *
 * A faithful, dependency-free port of `js/src/upkeep.ts` and `js/src/board.ts`
 * in CorvidLabs/arcron. The arithmetic here decides what the board tells a
 * stranger, so it is a port and not a paraphrase: the escalation formula, the
 * dormancy test and the tail-offset guard all match the contract, because a
 * board that disagrees with the chain about who is late is worse than no
 * board.
 *
 * Source of truth is `smart_contracts/keeper/contract.py`. Where a comment
 * here explains *why*, the reasoning is that contract's.
 */

import { encodeAddress } from './sha512_256.js';

/** Box names are "u" followed by the upkeep id as a big-endian uint64. */
export const BOX_NAME_PREFIX = 'u'.charCodeAt(0);
export const BOX_NAME_BYTES = 9;
/** The fixed part of the ARC-4 Upkeep struct, before the argument list. */
export const HEAD_BYTES = 130;
/** Outer fee plus the extra covering execute's two inner transactions. */
export const EXECUTE_FEE = 3_000;
export const CATCH_UP = 0n;
export const SKIP_AHEAD = 1n;

/**
 * TestNet's measured block time. Arcron schedules in rounds, never in
 * seconds, so every duration this board shows is an estimate and is labelled
 * as one. The figure is from docs/integrating.md ("Rounds are not a clock").
 */
export const SECONDS_PER_ROUND = 2.695;

/** @returns {Uint8Array} the 9-byte box name for an upkeep id */
export function upkeepBoxName(id) {
  const name = new Uint8Array(BOX_NAME_BYTES);
  name[0] = BOX_NAME_PREFIX;
  new DataView(name.buffer).setBigUint64(1, BigInt(id));
  return name;
}

/** The upkeep id in a box name, or null when the name is not an upkeep's. */
export function upkeepIdFromBoxName(name) {
  if (name.length !== BOX_NAME_BYTES || name[0] !== BOX_NAME_PREFIX) return null;
  return new DataView(name.buffer, name.byteOffset, name.byteLength).getBigUint64(1);
}

/**
 * Decode one box value into an upkeep.
 *
 * Throws rather than guessing. The tail-offset check is the load-bearing
 * part: a box whose offset is not exactly the head size is not this
 * contract's struct, and decoding it anyway yields a plausible-looking upkeep
 * with invented fees. Reading a foreign struct as one of ours is how a board
 * reports numbers that were never on chain.
 */
export function decodeUpkeep(id, raw) {
  if (raw.length < HEAD_BYTES + 2) {
    throw new Error(`Upkeep box ${id} is ${raw.length} bytes, too short to decode`);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const tailOffset = view.getUint16(40);
  if (tailOffset !== HEAD_BYTES) {
    throw new Error(
      `Upkeep box ${id} has a tail offset of ${tailOffset}, not ${HEAD_BYTES}. ` +
        'This is not this contract’s Upkeep struct.',
    );
  }
  const argCount = view.getUint16(tailOffset);
  const callArgs = [];
  for (let index = 0; index < argCount; index += 1) {
    // Offsets are measured from just after the count, hence the +2.
    const argAt = tailOffset + 2 + view.getUint16(tailOffset + 2 + 2 * index);
    const length = view.getUint16(argAt);
    callArgs.push(raw.slice(argAt + 2, argAt + 2 + length));
  }
  return {
    id: BigInt(id),
    creator: encodeAddress(raw.subarray(0, 32)),
    targetApp: view.getBigUint64(32),
    intervalRounds: view.getBigUint64(42),
    nextExecutionRound: view.getBigUint64(50),
    feePerExecution: view.getBigUint64(58),
    balance: view.getBigUint64(66),
    timesExecuted: view.getBigUint64(74),
    policy: view.getBigUint64(82),
    feeCap: view.getBigUint64(90),
    lastServicedRound: view.getBigUint64(98),
    feeAsset: view.getBigUint64(106),
    assetFee: view.getBigUint64(114),
    assetBalance: view.getBigUint64(122),
    callArgs,
  };
}

const max = (a, b) => (a > b ? a : b);
const min = (a, b) => (a < b ? a : b);

/**
 * What one execution would pay at `currentRound`.
 *
 * The twin of `execute`'s escalation arithmetic. The fee rises linearly from
 * the base to the cap over one missed interval and then holds. Lateness is
 * measured from the last service rather than from the schedule, so a keeper
 * draining a backlog is paid the ceiling once and not once per replay, and a
 * replay never escalates at all. An upkeep never bids more than it holds: an
 * escrow below the escalated fee drops back to the base rather than freezing
 * at a price nobody can be paid.
 */
export function effectiveFee(upkeep, currentRound) {
  const base = upkeep.feePerExecution;
  const cap = upkeep.feeCap;
  if (cap <= base || upkeep.nextExecutionRound <= upkeep.lastServicedRound) return base;
  const interval = upkeep.intervalRounds > 0n ? upkeep.intervalRounds : 1n;
  const lateness = max(currentRound - upkeep.lastServicedRound, 0n);
  const excess = min(max(lateness - interval, 0n), interval);
  const fee = base + ((cap - base) * excess) / interval;
  return upkeep.balance < fee ? base : fee;
}

/** True when this upkeep's fee can rise above what its creator wrote down. */
export function escalates(upkeep) {
  return upkeep.feeCap > upkeep.feePerExecution;
}

/** What one execution costs the keeper, in microALGO. */
export function executionCost(upkeep) {
  return upkeep.feeAsset > 0n ? EXECUTE_FEE + 1_000 : EXECUTE_FEE;
}

/**
 * Runs the escrow can still pay for, priced at the cap when one is set:
 * that is the worst case the creator can actually be charged.
 */
export function executionsRemaining(upkeep) {
  const worstCase = upkeep.feeCap > upkeep.feePerExecution ? upkeep.feeCap : upkeep.feePerExecution;
  return worstCase === 0n ? 0n : upkeep.balance / worstCase;
}

export function isDue(upkeep, currentRound) {
  return currentRound >= upkeep.nextExecutionRound;
}

/** Rounds until due; negative once overdue. */
export function roundsUntilDue(upkeep, currentRound) {
  return upkeep.nextExecutionRound - currentRound;
}

/**
 * `dormant` | `due` | `scheduled` — Arcron's own three states.
 *
 * Dormant is tested first: an upkeep that cannot pay its fee is nobody's
 * work, however overdue it looks. Measured against the escalated fee, because
 * that is what a keeper would actually be owed, and an upkeep can starve at a
 * balance its creator counted as several runs.
 */
export function classify(upkeep, currentRound) {
  if (upkeep.balance < effectiveFee(upkeep, currentRound)) return 'dormant';
  return currentRound >= upkeep.nextExecutionRound ? 'due' : 'scheduled';
}

/**
 * The flight-board word for each state, which is a translation and not a
 * new judgement:
 *
 *   scheduled -> ON TIME    not yet due, and funded
 *   due       -> DELAYED    past its round and still unserviced
 *   dormant   -> GROUNDED   escrow below one fee, so no keeper can be paid
 */
export const STATUS_WORD = { scheduled: 'ON TIME', due: 'DELAYED', dormant: 'GROUNDED' };

export function toEntry(upkeep, currentRound) {
  const overdue = currentRound - upkeep.nextExecutionRound;
  const fee = effectiveFee(upkeep, currentRound);
  return {
    upkeep,
    availability: classify(upkeep, currentRound),
    overdueRounds: overdue > 0n ? overdue : 0n,
    netReward: fee - BigInt(executionCost(upkeep)),
    currentFee: fee,
    escalated: escalates(upkeep) && fee > upkeep.feePerExecution,
    runsRemaining: executionsRemaining(upkeep),
    // Read, not derived: the schedule and the service differ by exactly the
    // backlog whenever an upkeep is catching up.
    lastExecutionRound: upkeep.timesExecuted > 0n ? upkeep.lastServicedRound : null,
  };
}

export function summarise(entries) {
  const lateness = entries
    .filter((entry) => entry.availability === 'due')
    .map((entry) => entry.overdueRounds)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    upkeeps: entries.length,
    due: entries.filter((entry) => entry.availability === 'due').length,
    dormant: entries.filter((entry) => entry.availability === 'dormant').length,
    scheduled: entries.filter((entry) => entry.availability === 'scheduled').length,
    totalExecutions: entries.reduce((total, entry) => total + entry.upkeep.timesExecuted, 0n),
    // A floor, not a total: box state records how many times an upkeep ran
    // but not what each run paid, and an escalated run pays more than base.
    paidToKeepers: entries.reduce(
      (total, entry) => total + entry.upkeep.timesExecuted * entry.upkeep.feePerExecution,
      0n,
    ),
    escrowed: entries.reduce((total, entry) => total + entry.upkeep.balance, 0n),
    medianLateness: median(lateness),
  };
}

function median(sorted) {
  if (sorted.length === 0) return 0n;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  // The lower of the two middles, so the figure is one an upkeep actually
  // has rather than an average of two that do not.
  return sorted[middle - 1];
}

/** Board order: the ones anyone can act on first, then the stuck, then the rest. */
const RANK = { due: 0, dormant: 1, scheduled: 2 };

export function sortForBoard(entries) {
  return [...entries].sort((a, b) => {
    if (RANK[a.availability] !== RANK[b.availability]) {
      return RANK[a.availability] - RANK[b.availability];
    }
    // Within due, longest overdue first — that is the departure a reader is
    // looking for. Everywhere else, by the round it is next expected.
    if (a.availability === 'due' && a.overdueRounds !== b.overdueRounds) {
      return a.overdueRounds > b.overdueRounds ? -1 : 1;
    }
    const an = a.upkeep.nextExecutionRound;
    const bn = b.upkeep.nextExecutionRound;
    if (an !== bn) return an < bn ? -1 : 1;
    return a.upkeep.id < b.upkeep.id ? -1 : 1;
  });
}

/* ------------------------------ formatting ------------------------------ */

/** microALGO as ALGO, trimmed. */
export function algos(micro) {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** A round count as an approximate duration. Always approximate; see above. */
export function duration(roundCount) {
  const seconds = Number(roundCount) * SECONDS_PER_ROUND;
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172_800) return `${(seconds / 3_600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

export function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
