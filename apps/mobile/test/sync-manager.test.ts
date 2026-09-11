import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutarSincronizacion, type OperacionesCola, type SyncTransport } from '../src/sync/manager-core.ts';
import type { Ack } from '../src/sync/protocol.ts';
import type { EntradaSync } from '../src/sync/queue-state.ts';
import { entrada } from './sync-fixture.ts';

function escenario(iniciales: EntradaSync[]) {
  let pendientes = [...iniciales];
  const enviando: string[][] = [];
  const retirados: Array<{ recibidas: string[]; duplicadas: string[] }> = [];
  const errores: Array<{ id: string; mensaje: string }> = [];
  const mensajes: string[] = [];
  const cola: OperacionesCola = {
    async listarPendientes() { return pendientes; },
    async marcarEnviando(ids) { enviando.push(ids); },
    async aplicarAck(recibidas, duplicadas) {
      retirados.push({ recibidas, duplicadas });
      const ids = new Set([...recibidas, ...duplicadas]);
      pendientes = pendientes.filter((e) => !ids.has(e.observacion.id));
    },
    async marcarError(id, mensaje) { errores.push({ id, mensaje }); },
  };
  const transporte: SyncTransport = {
    async enviar(linea) { mensajes.push(linea); },
    async cerrar() {},
  };
  return { cola, transporte, enviando, retirados, errores, mensajes, pendientes: () => pendientes };
}

const identidad = { dispositivoId: 'pixel-7', observadorId: 'persona-1' };

test('manager P2P: sin pendientes no abre un lote ni espera ACK', async () => {
  const e = escenario([]);
  let espero = false;
  const resultado = await ejecutarSincronizacion(identidad, e.transporte, async () => { espero = true; throw new Error('NO'); }, e.cola);
  assert.equal(resultado, null);
  assert.equal(espero, false);
  assert.deepEqual(e.mensajes, []);
});

test('manager P2P: envía hello antes del lote y conserva los IDs originales', async () => {
  const item = entrada('obs-mobile-2001');
  const e = escenario([item]);
  await ejecutarSincronizacion(identidad, e.transporte, async (loteId) => ({
    tipo: 'ack', versionProtocolo: 1, loteId,
    recibidas: [item.observacion.id], duplicadas: [], rechazadas: [],
  }), e.cola);
  const [hello, lote] = e.mensajes.map((m) => JSON.parse(m));
  assert.equal(hello.tipo, 'hello');
  assert.equal(lote.tipo, 'observaciones');
  assert.equal(lote.datos[0].id, item.observacion.id);
  assert.deepEqual(e.enviando, [[item.observacion.id]]);
});

test('manager P2P: ACK parcial retira recibidas y duplicadas, pero conserva rechazada con motivo', async () => {
  const items = ['obs-mobile-2002', 'obs-mobile-2003', 'obs-mobile-2004'].map((id) => entrada(id));
  const e = escenario(items);
  await ejecutarSincronizacion(identidad, e.transporte, async (loteId): Promise<Ack> => ({
    tipo: 'ack', versionProtocolo: 1, loteId,
    recibidas: [items[0]!.observacion.id], duplicadas: [items[1]!.observacion.id],
    rechazadas: [{ id: items[2]!.observacion.id, motivo: 'CONTRATO_INVALIDO' }],
  }), e.cola);
  assert.deepEqual(e.retirados[0], {
    recibidas: [items[0]!.observacion.id], duplicadas: [items[1]!.observacion.id],
  });
  assert.deepEqual(e.errores, [{ id: items[2]!.observacion.id, mensaje: 'CONTRATO_INVALIDO' }]);
  assert.deepEqual(e.pendientes().map((x) => x.observacion.id), [items[2]!.observacion.id]);
});

test('manager P2P: timeout de ACK deja todas las observaciones recuperables y con error visible', async () => {
  const items = ['obs-mobile-2005', 'obs-mobile-2006'].map((id) => entrada(id));
  const e = escenario(items);
  const resultado = await ejecutarSincronizacion(identidad, e.transporte, async () => { throw new Error('ACK_TIMEOUT'); }, e.cola);
  assert.equal(resultado, null);
  assert.deepEqual(e.errores, items.map((x) => ({ id: x.observacion.id, mensaje: 'ACK_TIMEOUT' })));
  assert.equal(e.pendientes().length, 2);
});

test('manager P2P: una caída al enviar tampoco retira datos sin ACK', async () => {
  const item = entrada('obs-mobile-2007');
  const e = escenario([item]);
  let n = 0;
  e.transporte.enviar = async () => { if (++n === 2) throw new Error('PEER_DESCONECTADO'); };
  const resultado = await ejecutarSincronizacion(identidad, e.transporte, async () => { throw new Error('INALCANZABLE'); }, e.cola);
  assert.equal(resultado, null);
  assert.deepEqual(e.errores, [{ id: item.observacion.id, mensaje: 'PEER_DESCONECTADO' }]);
  assert.equal(e.pendientes().length, 1);
});

test('manager P2P: reenviar tras un corte usa otro lote pero la misma evidencia', async () => {
  const item = entrada('obs-mobile-2008');
  const e = escenario([item]);
  await ejecutarSincronizacion(identidad, e.transporte, async () => { throw new Error('ACK_TIMEOUT'); }, e.cola);
  await ejecutarSincronizacion(identidad, e.transporte, async (loteId) => ({
    tipo: 'ack', versionProtocolo: 1, loteId,
    recibidas: [], duplicadas: [item.observacion.id], rechazadas: [],
  }), e.cola);
  const lotes = e.mensajes.map((m) => JSON.parse(m)).filter((m) => m.tipo === 'observaciones');
  assert.notEqual(lotes[0].loteId, lotes[1].loteId);
  assert.equal(lotes[0].datos[0].id, lotes[1].datos[0].id);
  assert.equal(e.pendientes().length, 0);
});
