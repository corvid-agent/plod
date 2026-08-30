/**
 * What the board says, and why.
 *
 * Kept pure and separate from the DOM and the network so the decision can be
 * tested without either. This is the whole of issue #3's judgement: given a
 * deploy config, the upkeep box that points at Plod (if there is one) and the
 * current round, produce one of three words and a sentence explaining it.
 *
 * The three words are Plod's, and they are a translation of Arcron's own
 * three states rather than a second opinion:
 *
 *   scheduled -> ON TIME    funded and not yet due; a keeper is expected
 *   due       -> LATE       past its round and still unserviced
 *   dormant   -> GROUNDED   escrow below one fee, so no keeper can be paid
 *
 * Two cases have no upkeep at all and are grounded for a plainer reason:
 * Plod is not deployed, or it is deployed and nobody has registered it.
 */

import { classify, duration, algos, effectiveFee } from './arcron.js';

/** @returns {{word: string, state: string, reason: string}} */
export function plodStatus({ appId, upkeep, currentRound, keeperAppId }) {
  if (!appId || appId <= 0) {
    return {
      word: 'GROUNDED',
      state: 'grounded',
      reason:
        'Not deployed. There is no Plod app on TestNet yet, so there is nothing for a keeper to call.',
    };
  }
  if (!upkeep) {
    return {
      word: 'GROUNDED',
      state: 'grounded',
      reason:
        `App ${appId} is deployed, but no upkeep on keeper ${keeperAppId} targets it. ` +
        'Nobody is scheduled to call tick().',
    };
  }

  const availability = classify(upkeep, currentRound);
  if (availability === 'dormant') {
    const fee = effectiveFee(upkeep, currentRound);
    return {
      word: 'GROUNDED',
      state: 'grounded',
      reason:
        `Upkeep ${upkeep.id} holds ${algos(upkeep.balance)} ALGO, below the ` +
        `${algos(fee)} one execution owes. No keeper can be paid to run it, so the schedule has stopped.`,
    };
  }
  if (availability === 'due') {
    const late = currentRound - upkeep.nextExecutionRound;
    return {
      word: 'LATE',
      state: 'late',
      reason:
        `Upkeep ${upkeep.id} came due at round ${upkeep.nextExecutionRound} and is ` +
        `${late} round${late === 1n ? '' : 's'} (~${duration(late)}) past it. Any keeper may take it now.`,
    };
  }
  const until = upkeep.nextExecutionRound - currentRound;
  return {
    word: 'ON TIME',
    state: 'ontime',
    reason:
      `Upkeep ${upkeep.id} is funded and next due at round ${upkeep.nextExecutionRound}, ` +
      `in ${until} round${until === 1n ? '' : 's'} (~${duration(until)}).`,
  };
}

/**
 * The upkeep pointing at Plod, or null.
 *
 * Prefers an explicit id from deploy.json, because that is unambiguous: more
 * than one upkeep may target the same app, and a board that silently picks
 * the first is telling a half-truth. Without one, take the soonest-due match
 * so the board reports the next tick anyone should expect.
 */
export function findUpkeep(upkeeps, appId, upkeepId = 0) {
  if (upkeepId > 0) return upkeeps.find((u) => u.id === BigInt(upkeepId)) ?? null;
  const mine = upkeeps.filter((u) => u.targetApp === BigInt(appId));
  if (mine.length === 0) return null;
  return mine.reduce((soonest, u) => (u.nextExecutionRound < soonest.nextExecutionRound ? u : soonest));
}
