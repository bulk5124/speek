/**
 * Speek room / safe codes — shared by the join UI and pairing agents.
 *
 * Uniqueness is probabilistic (birthday bound), not a stored used-codes DB.
 * That is intentional for serverless Speek: no central registry of issued codes.
 *
 * Space: |alphabet|^length = 32^6 ≈ 1.07e9. Birthday collision ≈ 50% only after
 * ~√(π·N/2) ≈ 4e4 concurrent live codes — negligible for practical firm use.
 * Each call to generateRoomCode() draws fresh CSPRNG bytes (no word list, no cycle).
 */

/** Unambiguous alphabet (no I/O/0/1) — length 32 so one byte maps with `b & 31`. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Default spoken length (6–8 is the practical band). */
export const CODE_LENGTH = 6;

/**
 * @param {number} [length=CODE_LENGTH]
 * @param {{ getRandomValues?: (arr: Uint8Array) => Uint8Array }} [rng]
 * @returns {string}
 */
export function generateRoomCode(length = CODE_LENGTH, rng = globalThis.crypto) {
  if (!rng || typeof rng.getRandomValues !== 'function') {
    throw new Error('Web Crypto getRandomValues required for room codes');
  }
  const n = Math.max(4, Math.min(8, length | 0));
  const alphabet = CODE_ALPHABET;
  const mask = alphabet.length - 1; // 31 — alphabet length is a power of two
  let out = '';
  // Draw independently each time; never index a predetermined list.
  while (out.length < n) {
    const bytes = rng.getRandomValues(new Uint8Array(n - out.length));
    for (const b of bytes) {
      // Bias-free: alphabet length divides 256.
      out += alphabet[b & mask];
      if (out.length >= n) break;
    }
  }
  return out;
}
