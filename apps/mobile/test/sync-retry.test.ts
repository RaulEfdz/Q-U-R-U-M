import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoraReintento } from '../src/sync/retry.ts';

test('reintento P2P: backoff exponencial empieza en 2 segundos', () => {
  assert.deepEqual([0, 1, 2, 3].map(demoraReintento), [2_000, 4_000, 8_000, 16_000]);
});

test('reintento P2P: el backoff queda acotado a un minuto', () => {
  assert.equal(demoraReintento(20), 60_000);
});
