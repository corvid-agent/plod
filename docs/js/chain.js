/**
 * Reading TestNet from a static page.
 *
 * algod only, no indexer and no SDK. Arcron stores upkeeps in boxes, and box
 * state is something any algod serves for free — a property worth keeping,
 * because it means this board needs no backend, no key and no archival node.
 */

import { decodeUpkeep, upkeepIdFromBoxName, upkeepBoxName } from './arcron.js';

export function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

/** The round the node is on. Everything on the board is relative to this. */
export async function currentRound(algod) {
  const status = await getJson(`${algod}/v2/status`);
  return BigInt(status['last-round']);
}

export async function globalState(algod, appId) {
  const body = await getJson(`${algod}/v2/applications/${appId}`);
  const entries = body?.params?.['global-state'] ?? [];
  const out = {};
  for (const kv of entries) {
    const key = new TextDecoder().decode(base64ToBytes(kv.key));
    out[key] = kv.value?.type === 2 ? BigInt(kv.value.uint) : kv.value?.bytes ?? null;
  }
  return out;
}

/** One upkeep by id, or null when the box is not there. */
export async function fetchUpkeep(algod, keeperAppId, upkeepId) {
  const name = encodeURIComponent(`b64:${bytesToBase64(upkeepBoxName(upkeepId))}`);
  try {
    const body = await getJson(`${algod}/v2/applications/${keeperAppId}/box?name=${name}`);
    return decodeUpkeep(BigInt(upkeepId), base64ToBytes(body.value));
  } catch {
    return null;
  }
}

/**
 * Every upkeep on the registry.
 *
 * Boxes that are not this contract's `Upkeep` are skipped rather than
 * guessed at: `decodeUpkeep` throws on a struct whose shape does not match,
 * and swallowing that here is the difference between an incomplete board and
 * a board that invents rows.
 */
export async function fetchUpkeeps(algod, keeperAppId) {
  const listing = await getJson(`${algod}/v2/applications/${keeperAppId}/boxes`);
  const names = (listing.boxes ?? [])
    .map((box) => upkeepIdFromBoxName(base64ToBytes(box.name)))
    .filter((id) => id !== null);

  const results = await Promise.all(
    names.map(async (id) => {
      try {
        const encoded = encodeURIComponent(`b64:${bytesToBase64(upkeepBoxName(id))}`);
        const body = await getJson(`${algod}/v2/applications/${keeperAppId}/box?name=${encoded}`);
        return decodeUpkeep(id, base64ToBytes(body.value));
      } catch {
        return null;
      }
    }),
  );
  return results.filter((upkeep) => upkeep !== null);
}
