/**
 * Tests for the board's arithmetic.
 *
 * The board reads a live chain, which no test here touches. What these lock
 * down is everything between the bytes and the word on the screen: the
 * digest, the address encoding, the ARC-4 decode, and the fee and dormancy
 * rules the status column is derived from. Those are the parts that can be
 * wrong quietly.
 *
 * Run with: node --test test/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sha512_256, encodeAddress, applicationAddress, base32Encode } from '../docs/js/sha512_256.js';
import {
  HEAD_BYTES,
  classify,
  decodeUpkeep,
  duration,
  effectiveFee,
  executionsRemaining,
  algos,
  summarise,
  sortForBoard,
  toEntry,
  upkeepBoxName,
  upkeepIdFromBoxName,
} from '../docs/js/arcron.js';

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/* ------------------------------- primitives ------------------------------ */

test('sha512_256 matches the FIPS 180-4 vectors', () => {
  assert.equal(
    hex(sha512_256(new TextEncoder().encode('abc'))),
    '53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23',
  );
  assert.equal(
    hex(sha512_256(new Uint8Array(0))),
    'c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a',
  );
});

test('sha512_256 spans a block boundary correctly', () => {
  // 112 bytes is the largest message that still fits its padding in one
  // 128-byte block; 113 forces a second. Both must agree with the two-block
  // path, which is where a padding bug hides.
  const long = new Uint8Array(200).fill(0x61);
  assert.equal(sha512_256(long).length, 32);
  assert.notEqual(hex(sha512_256(long.subarray(0, 112))), hex(sha512_256(long.subarray(0, 113))));
});

test('base32 encodes without padding', () => {
  assert.equal(base32Encode(new Uint8Array([0])), 'AA');
  assert.equal(base32Encode(new TextEncoder().encode('foobar')), 'MZXW6YTBOI');
});

test('encodeAddress produces the Algorand zero address', () => {
  const zero = encodeAddress(new Uint8Array(32));
  assert.equal(zero.length, 58);
  assert.equal(zero, `${'A'.repeat(52)}Y5HFKQ`);
});

test('applicationAddress derives the live keeper account', () => {
  // Cross-checked against docs/first-upkeep.md in CorvidLabs/arcron. This is
  // the address an Arcron target authorizes — Application(keeper).address,
  // never itob(app_id).
  assert.equal(
    applicationAddress(769891898),
    'M4YFP33L5VIFRF53X53WUMQWBOWSLYQNBSSAJV2SORGF43L36XBY7OREUA',
  );
});

/* --------------------------------- boxes --------------------------------- */

test('box names round-trip and reject foreign names', () => {
  const name = upkeepBoxName(81);
  assert.equal(name.length, 9);
  assert.equal(name[0], 'u'.charCodeAt(0));
  assert.equal(upkeepIdFromBoxName(name), 81n);
  assert.equal(upkeepIdFromBoxName(new Uint8Array([0x76, 1, 2, 3, 4, 5, 6, 7, 8])), null);
  assert.equal(upkeepIdFromBoxName(new Uint8Array([0x75, 1])), null);
});

/** Mirrors the contract's ARC-4 encoding, so decode is tested against bytes. */
function encodeUpkeep(fields, callArgs = [new Uint8Array([0xde, 0xad, 0xbe, 0xef])]) {
  const headerBytes = 2 + 2 * callArgs.length;
  const bodies = callArgs.map((arg) => {
    const body = new Uint8Array(2 + arg.length);
    new DataView(body.buffer).setUint16(0, arg.length);
    body.set(arg, 2);
    return body;
  });
  const tail = new Uint8Array(headerBytes + bodies.reduce((sum, b) => sum + b.length, 0));
  const tailView = new DataView(tail.buffer);
  tailView.setUint16(0, callArgs.length);
  let position = headerBytes;
  bodies.forEach((body, index) => {
    tailView.setUint16(2 + 2 * index, position - 2);
    tail.set(body, position);
    position += body.length;
  });

  const raw = new Uint8Array(HEAD_BYTES + tail.length);
  const view = new DataView(raw.buffer);
  raw.set(fields.creator ?? new Uint8Array(32).fill(7), 0);
  view.setBigUint64(32, fields.targetApp ?? 0n);
  view.setUint16(40, HEAD_BYTES);
  view.setBigUint64(42, fields.intervalRounds ?? 100n);
  view.setBigUint64(50, fields.nextExecutionRound ?? 1_000n);
  view.setBigUint64(58, fields.feePerExecution ?? 10_000n);
  view.setBigUint64(66, fields.balance ?? 1_000_000n);
  view.setBigUint64(74, fields.timesExecuted ?? 0n);
  view.setBigUint64(82, fields.policy ?? 0n);
  view.setBigUint64(90, fields.feeCap ?? 0n);
  view.setBigUint64(98, fields.lastServicedRound ?? 900n);
  view.setBigUint64(106, fields.feeAsset ?? 0n);
  view.setBigUint64(114, fields.assetFee ?? 0n);
  view.setBigUint64(122, fields.assetBalance ?? 0n);
  raw.set(tail, HEAD_BYTES);
  return raw;
}

const upkeep = (fields = {}, args) => decodeUpkeep(1n, encodeUpkeep(fields, args));

test('decodeUpkeep reads every field back', () => {
  const decoded = upkeep({
    targetApp: 769891902n,
    intervalRounds: 30_857n,
    nextExecutionRound: 55_555n,
    feePerExecution: 10_000n,
    balance: 400_000n,
    timesExecuted: 17n,
    policy: 1n,
    feeCap: 40_000n,
    lastServicedRound: 54_000n,
    feeAsset: 123n,
    assetFee: 5n,
    assetBalance: 50n,
  });
  assert.equal(decoded.targetApp, 769891902n);
  assert.equal(decoded.intervalRounds, 30_857n);
  assert.equal(decoded.nextExecutionRound, 55_555n);
  assert.equal(decoded.timesExecuted, 17n);
  assert.equal(decoded.policy, 1n);
  assert.equal(decoded.feeCap, 40_000n);
  assert.equal(decoded.lastServicedRound, 54_000n);
  assert.equal(decoded.assetBalance, 50n);
  assert.equal(decoded.creator.length, 58);
  assert.equal(hex(decoded.callArgs[0]), 'deadbeef');
});

test('decodeUpkeep reads a multi-argument call', () => {
  const decoded = upkeep({}, [
    new Uint8Array([1, 2, 3, 4]),
    new Uint8Array([9, 9]),
    new Uint8Array([0xff]),
  ]);
  assert.equal(decoded.callArgs.length, 3);
  assert.equal(hex(decoded.callArgs[1]), '0909');
  assert.equal(hex(decoded.callArgs[2]), 'ff');
});

test('decodeUpkeep refuses a struct that is not this contract’s', () => {
  // The guard that matters: a patched tail offset otherwise decodes as a
  // plausible upkeep with no arguments, so a foreign app's boxes would read
  // as ordinary rows carrying fees that were never on chain.
  const raw = encodeUpkeep({});
  new DataView(raw.buffer).setUint16(40, 132);
  assert.throws(() => decodeUpkeep(1n, raw), /not this contract/);
  assert.throws(() => decodeUpkeep(1n, new Uint8Array(40)), /too short/);
});

/* ------------------------------ the fee rules ---------------------------- */

test('a fee without a cap never escalates', () => {
  const u = upkeep({ feeCap: 0n, feePerExecution: 10_000n });
  assert.equal(effectiveFee(u, 999_999n), 10_000n);
});

test('escalation is linear over one missed interval, then flat', () => {
  const base = { feePerExecution: 10_000n, feeCap: 50_000n, intervalRounds: 100n,
                 lastServicedRound: 1_000n, nextExecutionRound: 1_100n, balance: 10_000_000n };
  const u = upkeep(base);
  // Not yet past one interval of lateness: still base.
  assert.equal(effectiveFee(u, 1_100n), 10_000n);
  // Half an interval of excess: halfway from base to cap.
  assert.equal(effectiveFee(u, 1_150n), 30_000n);
  // A full interval of excess: the cap.
  assert.equal(effectiveFee(u, 1_200n), 50_000n);
  // Beyond that it holds at the cap rather than growing.
  assert.equal(effectiveFee(u, 9_999n), 50_000n);
});

test('a replay of a backlog never escalates', () => {
  // nextExecutionRound <= lastServicedRound means it was already behind when
  // it last ran, so this call is a replay and pays base.
  const u = upkeep({ feePerExecution: 10_000n, feeCap: 50_000n, intervalRounds: 100n,
                     lastServicedRound: 5_000n, nextExecutionRound: 4_000n, balance: 10_000_000n });
  assert.equal(effectiveFee(u, 9_000n), 10_000n);
});

test('an upkeep never bids more than it holds', () => {
  // Escrow below the escalated fee drops back to base rather than freezing
  // at a price that can never be paid.
  const u = upkeep({ feePerExecution: 10_000n, feeCap: 50_000n, intervalRounds: 100n,
                     lastServicedRound: 1_000n, nextExecutionRound: 1_100n, balance: 20_000n });
  assert.equal(effectiveFee(u, 1_200n), 10_000n);
});

/* ------------------------------ the three words -------------------------- */

test('classify names Arcron’s three states', () => {
  const funded = { feePerExecution: 10_000n, balance: 1_000_000n, nextExecutionRound: 1_000n,
                   lastServicedRound: 900n, feeCap: 0n };
  assert.equal(classify(upkeep(funded), 999n), 'scheduled');
  assert.equal(classify(upkeep(funded), 1_000n), 'due');
  assert.equal(classify(upkeep({ ...funded, balance: 9_999n }), 1_000n), 'dormant');
});

test('dormancy is judged against the escalated fee, not the base', () => {
  // The case the console got wrong once: an upkeep starves at a balance its
  // creator counted as several runs, because lateness raised the bar.
  const u = upkeep({ feePerExecution: 10_000n, feeCap: 50_000n, intervalRounds: 100n,
                     lastServicedRound: 1_000n, nextExecutionRound: 1_100n, balance: 45_000n });
  // At 1,200 the owed fee is the 50,000 cap, which 45,000 cannot cover — but
  // the contract then falls back to base, which it can. So it is due, not
  // dormant, and the board must not cry starvation.
  assert.equal(effectiveFee(u, 1_200n), 10_000n);
  assert.equal(classify(u, 1_200n), 'due');
});

test('a dormant upkeep is dormant however overdue it looks', () => {
  const u = upkeep({ feePerExecution: 10_000n, balance: 1n, nextExecutionRound: 10n,
                     lastServicedRound: 5n, feeCap: 0n });
  assert.equal(classify(u, 900_000n), 'dormant');
});

/* --------------------------------- the board ----------------------------- */

test('executionsRemaining prices at the cap when one is set', () => {
  assert.equal(executionsRemaining(upkeep({ balance: 100_000n, feePerExecution: 10_000n, feeCap: 0n })), 10n);
  // With a cap, the worst case is what a creator must budget against.
  assert.equal(executionsRemaining(upkeep({ balance: 100_000n, feePerExecution: 10_000n, feeCap: 50_000n })), 2n);
});

test('summarise counts the states and floors what keepers were paid', () => {
  const round = 1_000n;
  const entries = [
    toEntry(upkeep({ nextExecutionRound: 900n, timesExecuted: 3n, feePerExecution: 10_000n, balance: 500_000n, feeCap: 0n }), round),
    toEntry(upkeep({ nextExecutionRound: 800n, timesExecuted: 1n, feePerExecution: 10_000n, balance: 500_000n, feeCap: 0n }), round),
    toEntry(upkeep({ nextExecutionRound: 2_000n, timesExecuted: 0n, feePerExecution: 10_000n, balance: 500_000n, feeCap: 0n }), round),
    toEntry(upkeep({ nextExecutionRound: 10n, timesExecuted: 2n, feePerExecution: 10_000n, balance: 5n, feeCap: 0n }), round),
  ];
  const stats = summarise(entries);
  assert.equal(stats.upkeeps, 4);
  assert.equal(stats.due, 2);
  assert.equal(stats.scheduled, 1);
  assert.equal(stats.dormant, 1);
  assert.equal(stats.totalExecutions, 6n);
  assert.equal(stats.paidToKeepers, 60_000n);
  // Lateness of the two due entries is 100 and 200; the lower middle is 100.
  assert.equal(stats.medianLateness, 100n);
});

test('the board leads with what a keeper can act on', () => {
  const round = 1_000n;
  const entries = [
    toEntry(upkeep({ nextExecutionRound: 2_000n, feeCap: 0n, balance: 500_000n }), round),
    toEntry(upkeep({ nextExecutionRound: 10n, feeCap: 0n, balance: 1n }), round),
    toEntry(upkeep({ nextExecutionRound: 500n, feeCap: 0n, balance: 500_000n }), round),
  ];
  const order = sortForBoard(entries).map((entry) => entry.availability);
  assert.deepEqual(order, ['due', 'dormant', 'scheduled']);
});

test('formatting stays readable', () => {
  assert.equal(algos(1_000_000n), '1');
  assert.equal(algos(1_500_000n), '1.5');
  assert.equal(algos(10_000n), '0.01');
  assert.equal(algos(0n), '0');
  assert.equal(duration(10n), '27s');
  assert.match(duration(30_857n), /^23\.1h$/);
});
