/**
 * Unit tests for crypto room-code generation (no browser / PeerJS).
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { CODE_ALPHABET, CODE_LENGTH, generateRoomCode } from '../room-code.js';

const alphabetSet = new Set(CODE_ALPHABET);

assert.equal(CODE_ALPHABET.length, 32, 'alphabet must be power-of-two length');
assert.equal(CODE_LENGTH, 6);

const sample = generateRoomCode();
assert.equal(sample.length, CODE_LENGTH);
assert.ok([...sample].every((c) => alphabetSet.has(c)), `unexpected chars in ${sample}`);

const many = new Set();
for (let i = 0; i < 400; i++) many.add(generateRoomCode());
assert.ok(many.size >= 395, `expected near-unique draws, got ${many.size}/400 — looks like a fixed list`);

const custom = generateRoomCode(8, webcrypto);
assert.equal(custom.length, 8);

assert.throws(() => generateRoomCode(6, {}), /getRandomValues/);

// Sequence of Neu clicks must not follow a predetermined cycle (spot-check vs sorted entropy).
const sequential = Array.from({ length: 20 }, () => generateRoomCode());
assert.notDeepEqual(sequential, [...sequential].sort(), 'codes should not look ordered/cycled');

console.log('ok — room-code crypto helper (%d unique / 400)', many.size);
