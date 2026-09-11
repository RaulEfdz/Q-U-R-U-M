import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearHello, crearLote, decodificarAck, VERSION_PROTOCOLO, zHelloAck } from '../src/sync/protocol.ts';
import type { Observacion } from '../src/core/contracts.ts';

const observacion: Observacion = {
  id: 'obs-mobile-0001', sesionId: 'sesion-mobile-0001',
  observadorId: 'persona-1', dispositivoId: 'pixel-7',
  visitadoEn: '2026-09-11T10:00:00.000Z', capturadaEn: '2026-09-11T10:01:00.000Z',
  fuente: 'texto', naturaleza: 'Directo', origen: 'local',
  cliente: { nombre: 'Hospital DemoCare Pacific', ciudad: 'Panamá', pais: 'Panamá' },
  lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 8 },
  hedging: false, evidencia: 'dos MR NovaMed', seguimiento: [],
  textoOriginal: 'Tienen dos MR NovaMed de ocho años.',
  provenance: { hash: 'hash-mobile-0001', delegado: false },
};

test('sync mobile: hello v1 conserva identidad humana y de dispositivo', () => {
  assert.deepStrictEqual(crearHello('pixel-7', 'persona-1'), {
    tipo: 'hello', versionProtocolo: VERSION_PROTOCOLO,
    dispositivoId: 'pixel-7', observadorId: 'persona-1',
  });
});

test('sync mobile: lote v1 conserva IDs para idempotencia', () => {
  const lote = crearLote('lote-1', 'pixel-7', [observacion]);
  assert.strictEqual(lote.loteId, 'lote-1');
  assert.strictEqual((lote.datos[0] as Observacion).id, observacion.id);
});

test('sync mobile: ACK parcial distingue recibidas, duplicadas y rechazadas', () => {
  const ack = decodificarAck(JSON.stringify({
    tipo: 'ack', versionProtocolo: 1, loteId: 'lote-1',
    recibidas: ['obs-1'], duplicadas: ['obs-2'],
    rechazadas: [{ id: 'obs-3', motivo: 'CONTRATO_INVALIDO' }],
  }));
  assert.deepStrictEqual(ack.recibidas, ['obs-1']);
  assert.deepStrictEqual(ack.duplicadas, ['obs-2']);
  assert.deepStrictEqual(ack.rechazadas, [{ id: 'obs-3', motivo: 'CONTRATO_INVALIDO' }]);
});

test('sync mobile: rechaza ACK de una versión incompatible', () => {
  assert.throws(() => decodificarAck(JSON.stringify({
    tipo: 'ack', versionProtocolo: 2, loteId: 'lote-1',
    recibidas: [], duplicadas: [], rechazadas: [],
  })));
});

test('sync mobile: valida el hello_ack usado para verificar conexión', () => {
  const ack = zHelloAck.parse({
    tipo: 'hello_ack', versionProtocolo: 1,
    servidorId: 'quorum-central', sesionId: 'sesion-0001',
  });
  assert.equal(ack.servidorId, 'quorum-central');
});
