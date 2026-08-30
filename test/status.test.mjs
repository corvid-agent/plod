/**
 * Tests for the board's judgement (issue #3).
 *
 * The network half of this board cannot be tested here — it needs a live
 * TestNet node. What is tested is everything that decides what a reader is
 * told: which upkeep is Plod's, and which of the three words applies.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HEAD_BYTES, decodeUpkeep } from '../docs/js/arcron.js';
import { findUpkeep, plodStatus } from '../docs/js/plod-status.js';

const KEEPER = 769891898;

/** Mirrors the contract's ARC-4 encoding so decode is exercised on real bytes. */
function makeUpkeep(id, fields = {}) {
  const args = [new Uint8Array([0x1e, 0x2f, 0x3a, 0x4b])]; // a tick() selector
  const tail = new Uint8Array(4 + 2 + args[0].length);
  const tailView = new DataView(tail.buffer);
  tailView.setUint16(0, 1);
  tailView.setUint16(2, 2);
  tailView.setUint16(4, args[0].length);
  tail.set(args[0], 6);

  const raw = new Uint8Array(HEAD_BYTES + tail.length);
  const view = new DataView(raw.buffer);
  view.setBigUint64(32, fields.targetApp ?? 0n);
  view.setUint16(40, HEAD_BYTES);
  view.setBigUint64(42, fields.intervalRounds ?? 224_000n);
  view.setBigUint64(50, fields.nextExecutionRound ?? 1_000n);
  view.setBigUint64(58, fields.feePerExecution ?? 10_000n);
  view.setBigUint64(66, fields.balance ?? 1_000_000n);
  view.setBigUint64(74, fields.timesExecuted ?? 0n);
  view.setBigUint64(82, fields.policy ?? 1n);
  view.setBigUint64(90, fields.feeCap ?? 0n);
  view.setBigUint64(98, fields.lastServicedRound ?? 900n);
  raw.set(tail, HEAD_BYTES);
  return decodeUpkeep(id, raw);
}

test('not deployed is grounded, and says so in plain words', () => {
  const status = plodStatus({ appId: 0, upkeep: null, currentRound: 100n, keeperAppId: KEEPER });
  assert.equal(status.word, 'GROUNDED');
  assert.match(status.reason, /Not deployed/);
});

test('deployed but unregistered is grounded for a different reason', () => {
  const status = plodStatus({ appId: 12345, upkeep: null, currentRound: 100n, keeperAppId: KEEPER });
  assert.equal(status.word, 'GROUNDED');
  assert.match(status.reason, /no upkeep on keeper 769891898 targets it/);
});

test('funded and not yet due is ON TIME', () => {
  const upkeep = makeUpkeep(42n, { targetApp: 12345n, nextExecutionRound: 5_000n, balance: 1_000_000n });
  const status = plodStatus({ appId: 12345, upkeep, currentRound: 4_000n, keeperAppId: KEEPER });
  assert.equal(status.word, 'ON TIME');
  assert.match(status.reason, /next due at round 5000/);
});

test('past its round and unserviced is LATE', () => {
  const upkeep = makeUpkeep(42n, { targetApp: 12345n, nextExecutionRound: 5_000n, balance: 1_000_000n });
  const status = plodStatus({ appId: 12345, upkeep, currentRound: 5_400n, keeperAppId: KEEPER });
  assert.equal(status.word, 'LATE');
  assert.match(status.reason, /400 rounds/);
});

test('an escrow below one fee is GROUNDED, however overdue', () => {
  const upkeep = makeUpkeep(42n, {
    targetApp: 12345n, nextExecutionRound: 5_000n, balance: 1_000n, feePerExecution: 10_000n,
  });
  const status = plodStatus({ appId: 12345, upkeep, currentRound: 900_000n, keeperAppId: KEEPER });
  assert.equal(status.word, 'GROUNDED');
  assert.match(status.reason, /No keeper can be paid/);
});

test('findUpkeep prefers an explicit id over a scan', () => {
  const upkeeps = [
    makeUpkeep(7n, { targetApp: 12345n, nextExecutionRound: 100n }),
    makeUpkeep(9n, { targetApp: 12345n, nextExecutionRound: 200n }),
  ];
  assert.equal(findUpkeep(upkeeps, 12345, 9)?.id, 9n);
  // Without one, the soonest due wins, so the board reports the next tick.
  assert.equal(findUpkeep(upkeeps, 12345, 0)?.id, 7n);
});

test('findUpkeep ignores upkeeps aimed at other apps', () => {
  const upkeeps = [makeUpkeep(7n, { targetApp: 999n }), makeUpkeep(8n, { targetApp: 770041460n })];
  assert.equal(findUpkeep(upkeeps, 12345, 0), null);
  // An explicit id that is not on the registry must not fall back to a guess.
  assert.equal(findUpkeep(upkeeps, 12345, 55), null);
});
