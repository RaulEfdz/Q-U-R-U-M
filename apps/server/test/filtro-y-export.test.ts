import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconciliar } from '../src/trust/reconcile.ts';
import { ejecutarFiltro, zFiltro } from '../src/tools/filtrar.ts';
import { exportarCSV } from '../src/export/philips.ts';
import { armarObservacion } from './helpers.ts';

test('filtro determinista: igualdad normalizada, edad, oportunidad y frescura se aplican en código', () => {
  const ahora = new Date('2026-09-10T00:00:00.000Z');
  const obs = [
    armarObservacion({ observadorId: 'a', cliente: { nombre: 'Hospital Uno', ciudad: 'São Paulo', pais: 'Brazil' }, lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 9 }, visitadoEn: '2025-01-01T00:00:00.000Z' }),
    armarObservacion({ observadorId: 'b', sesionId: 'sesion-b', cliente: { nombre: 'Hospital Uno', ciudad: 'São Paulo', pais: 'Brazil' }, lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 9 }, visitadoEn: '2025-01-01T00:00:00.000Z' }),
    armarObservacion({ observadorId: 'c', cliente: { nombre: 'Hospital Dos', ciudad: 'Lima', pais: 'Peru' }, lote: { modalidad: 'CT', cantidad: 1, edadAnios: 2 } }),
  ];
  const grupos = reconciliar(obs, ahora);
  assert.equal(ejecutarFiltro(grupos, { pais: 'brázil', ciudad: 'sao paulo', modalidad: 'MR', edadMinima: 7, soloConQuorum: true }).length, 1);
  assert.equal(ejecutarFiltro(grupos, { pais: 'US' }).length, 0, 'US no puede matchear Australia ni otro país por subcadena');
  assert.equal(ejecutarFiltro(grupos, { soloDesactualizados: true }).length, 1);
  assert.equal(zFiltro.safeParse({ modalidad: 'MR', edadMinima: 'siete' }).success, false);
});

test('export Philips: conserva 19 columnas, escapa CSV y mapea estado y fuente', () => {
  const o = armarObservacion({
    naturaleza: 'Referido', fuente: 'voz', textoOriginal: 'dijo "dos MR", en visita',
    notas: 'línea uno\nlínea dos', seguimiento: [{ pregunta: '¿Edad?', respuesta: '8' }],
  });
  const csv = exportarCSV([o], new Date(o.visitadoEn));
  const [cabecera] = csv.split('\n');
  assert.equal(cabecera!.split(',').length, 19);
  assert.match(csv, /"dijo ""dos MR"", en visita"/);
  assert.match(csv, /Reported/);
  assert.match(csv, /Voice/);
  assert.match(csv, /"línea uno/);
});
