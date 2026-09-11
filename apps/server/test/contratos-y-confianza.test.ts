import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zObservacion } from '../src/core/contracts.ts';
import { armarObservacion } from './helpers.ts';
import {
  detectarHedging, inferirNaturaleza, normalizarCliente, normalizarMarca, normalizarModalidad,
} from '../src/trust/normalize.ts';
import { jaroWinkler } from '../src/trust/similarity.ts';
import { candidatosFusion, claveGrupo } from '../src/trust/entity.ts';

test('contrato: rechaza evidencia, fecha y cantidad fuera de los límites de evidencia', () => {
  assert.equal(zObservacion.safeParse(armarObservacion({ evidencia: '' })).success, false);
  assert.equal(zObservacion.safeParse(armarObservacion({ visitadoEn: 'ayer' })).success, false);
  assert.equal(zObservacion.safeParse(armarObservacion({ lote: { modalidad: 'MR', cantidad: 0 } })).success, false);
});

test('normalización: cliente, marca y modalidades no dependen de mayúsculas ni acentos', () => {
  assert.equal(normalizarCliente('Hospital Clínico de La Paz S.A.'), 'clinico paz s a');
  assert.equal(normalizarMarca('Nova-Méd!'), 'novamed');
  assert.equal(normalizarModalidad('Resonadores'), 'MR');
  assert.equal(normalizarModalidad('Tomógrafo'), 'CT');
  assert.equal(normalizarModalidad('equipo inventado'), undefined);
});

test('confianza lingüística: referido prevalece sobre hedging y el texto directo queda directo', () => {
  assert.equal(detectarHedging('Parece que hay dos MR'), true);
  assert.equal(inferirNaturaleza('Me dijeron que hay dos MR', true), 'Referido');
  assert.equal(inferirNaturaleza('Vi dos MR', false), 'Directo');
  assert.equal(inferirNaturaleza('Hay unos dos MR', true), 'Estimado');
});

test('entidad: la clave no mezcla cohortes y los nombres parecidos se proponen, no se fusionan', () => {
  const a = armarObservacion({ cliente: { nombre: 'Hospital DemoCare', ciudad: 'Panamá', pais: 'PA' }, lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 1, edadAnios: 2 } });
  const b = armarObservacion({ cliente: { nombre: 'Hospital DemoCare', ciudad: 'Panamá', pais: 'PA' }, lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 1, edadAnios: 12 } });
  assert.equal(claveGrupo(a), claveGrupo(b), 'la edad es cohorte, no identidad');

  const grupos = new Map([
    ['democare pacific|panama|pa|MR|novamed', { cliente: { nombre: 'DemoCare Pacific' } }],
    ['democare pasific|panama|pa|MR|novamed', { cliente: { nombre: 'DemoCare Pasific' } }],
  ]);
  assert.equal(candidatosFusion(grupos).length, 1);
  assert(jaroWinkler('democare pacific', 'democare pasific') > 0.88);
});
