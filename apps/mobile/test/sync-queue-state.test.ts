import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordenarPendientes, reconstruirCola } from '../src/sync/queue-state.ts';
import { entrada } from './sync-fixture.ts';

test('cola P2P: reconstruye el estado append-only después de reiniciar', () => {
  const a = entrada('obs-mobile-1001');
  const b = entrada('obs-mobile-1002');
  const { mapa, corruptas } = reconstruirCola([
    JSON.stringify({ op: 'upsert', entrada: a }),
    JSON.stringify({ op: 'upsert', entrada: b }),
    JSON.stringify({ op: 'retirar', id: a.observacion.id }),
  ]);
  assert.equal(corruptas, 0);
  assert.deepEqual([...mapa.keys()], [b.observacion.id]);
});

test('cola P2P: una línea corrupta no borra los eventos sanos y queda contabilizada', () => {
  const a = entrada('obs-mobile-1003');
  const { mapa, corruptas } = reconstruirCola([
    JSON.stringify({ op: 'upsert', entrada: a }), '{corte-de-energia',
  ]);
  assert.equal(corruptas, 1);
  assert.equal(mapa.get(a.observacion.id)?.observacion.id, a.observacion.id);
});

test('cola P2P: el último evento del mismo ID prevalece sin duplicarlo', () => {
  const a = entrada('obs-mobile-1004');
  const error = { ...a, estado: 'error-visible' as const, intentos: 1, ultimoError: 'ACK_TIMEOUT' };
  const { mapa } = reconstruirCola([
    JSON.stringify({ op: 'upsert', entrada: a }),
    JSON.stringify({ op: 'upsert', entrada: error }),
  ]);
  assert.equal(mapa.size, 1);
  assert.equal(mapa.get(a.observacion.id)?.ultimoError, 'ACK_TIMEOUT');
});

test('cola P2P: pendientes conserva orden y excluye lo ya recibido', () => {
  const tarde = entrada('obs-mobile-1005', 'error-visible', '2026-09-11T11:00:00.000Z');
  const temprano = entrada('obs-mobile-1006', 'pendiente-local', '2026-09-11T10:00:00.000Z');
  const recibido = entrada('obs-mobile-1007', 'recibida-pendiente-de-revision', '2026-09-11T09:00:00.000Z');
  const mapa = new Map([[tarde.observacion.id, tarde], [recibido.observacion.id, recibido], [temprano.observacion.id, temprano]]);
  assert.deepEqual(ordenarPendientes(mapa).map((e) => e.observacion.id), [temprano.observacion.id, tarde.observacion.id]);
});
