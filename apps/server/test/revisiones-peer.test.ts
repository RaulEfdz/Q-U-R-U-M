import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarObservacion } from './helpers.ts';
import {
  descartarRevisionPeer, encolarRevisionPeer, listarRevisionesPeer, obtenerRevisionPeer,
} from '../src/store/revisiones-peer.ts';

test('revisiones peer: recibir no persiste evidencia; queda en inbox hasta revisión humana', () => {
  const id = `revision-peer-${Date.now()}`;
  const observacion = armarObservacion({ origen: 'peer' });
  encolarRevisionPeer({
    id, clavePeer: 'peer-autorizado', observaciones: [observacion], recibidoEn: new Date().toISOString(),
  });

  assert.strictEqual(obtenerRevisionPeer(id)?.observaciones[0]?.id, observacion.id);
  assert(listarRevisionesPeer().some((r) => r.id === id), 'la interfaz puede encontrar el ítem pendiente');
  assert.strictEqual(descartarRevisionPeer(id)?.id, id, 'solo la decisión humana lo retira de la inbox');
  assert.strictEqual(obtenerRevisionPeer(id), undefined);
});
