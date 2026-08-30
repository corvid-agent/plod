/**
 * SHA-512/256, and just enough of it to turn 32 public-key bytes into an
 * Algorand address.
 *
 * This exists so the board has no dependencies. An Algorand address is
 * base32(pubkey || checksum) where the checksum is the last four bytes of
 * SHA-512/256(pubkey), and SHA-512/256 is the one primitive the platform
 * does not give us: WebCrypto ships SHA-256, SHA-384 and SHA-512, but not
 * the 512/256 truncation, which is a different initial state rather than a
 * slice of SHA-512. Pulling algosdk into a static page to encode a handful
 * of addresses is not a trade worth making.
 *
 * FIPS 180-4. Verified against the standard "abc" vector and against
 * Algorand's zero address in test/arcron.test.mjs.
 */

const MASK = (1n << 64n) - 1n;

// SHA-512/256 initial hash value: SHA-512's IV with each word XORed against
// 0xa5a5a5a5a5a5a5a5, then run over the string "SHA-512/256". FIPS 180-4 5.3.6.2
// publishes the result, which is what is written out here.
const IV = [
  0x22312194fc2bf72cn, 0x9f555fa3c84c64c2n, 0x2393b86b6f53b151n, 0x963877195940eabdn,
  0x96283ee2a88effe3n, 0xbe5e1e2553863992n, 0x2b0199fc2c85b8aan, 0x0eb72ddc81c52ca2n,
];

const K = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

const rotr = (x, n) => ((x >> n) | (x << (64n - n))) & MASK;

/** @param {Uint8Array} message @returns {Uint8Array} the 32-byte digest */
export function sha512_256(message) {
  // Pad to a multiple of 128 bytes: a 0x80 byte, zeroes, then the length in
  // bits as a big-endian 128-bit integer. Messages here are 32-40 bytes, so
  // the high half of that length is always zero, but it is written properly
  // rather than assumed.
  const bitLength = BigInt(message.length) * 8n;
  const padded = new Uint8Array(((message.length + 16) >> 7 << 7) + 128);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, bitLength & MASK);
  view.setBigUint64(padded.length - 16, bitLength >> 64n);

  const h = [...IV];
  const w = new Array(80);

  for (let block = 0; block < padded.length; block += 128) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getBigUint64(block + t * 8);
    for (let t = 16; t < 80; t += 1) {
      const s0 = rotr(w[t - 15], 1n) ^ rotr(w[t - 15], 8n) ^ (w[t - 15] >> 7n);
      const s1 = rotr(w[t - 2], 19n) ^ rotr(w[t - 2], 61n) ^ (w[t - 2] >> 6n);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & MASK;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 80; t += 1) {
      const S1 = rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n);
      const ch = (e & f) ^ (~e & MASK & g);
      const temp1 = (hh + S1 + ch + K[t] + w[t]) & MASK;
      const S0 = rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK;
      hh = g; g = f; f = e;
      e = (d + temp1) & MASK;
      d = c; c = b; b = a;
      a = (temp1 + temp2) & MASK;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i += 1) h[i] = (h[i] + next[i]) & MASK;
  }

  // 512/256 truncates to the first four words rather than hashing differently.
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) outView.setBigUint64(i * 8, h[i]);
  return out;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, unpadded — what Algorand uses for addresses. */
export function base32Encode(bytes) {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

/**
 * A 32-byte public key as an Algorand address: base32 of the key followed by
 * the last four bytes of its SHA-512/256 digest.
 */
export function encodeAddress(publicKey) {
  if (publicKey.length !== 32) throw new Error(`Expected 32 key bytes, got ${publicKey.length}`);
  const checksum = sha512_256(publicKey).subarray(28);
  const full = new Uint8Array(36);
  full.set(publicKey);
  full.set(checksum, 32);
  return base32Encode(full);
}

/**
 * The account an application signs its inner transactions from.
 *
 * SHA-512/256 of "appID" followed by the id as a big-endian uint64. This is
 * the address an Arcron target must authorize — `Application(keeper).address`
 * in Puya — and computing it here lets the board show the real value instead
 * of asking a reader to trust a number typed into a README.
 */
export function applicationAddress(appId) {
  const prefix = new TextEncoder().encode('appID');
  const buffer = new Uint8Array(prefix.length + 8);
  buffer.set(prefix);
  new DataView(buffer.buffer).setBigUint64(prefix.length, BigInt(appId));
  return encodeAddress(sha512_256(buffer));
}
