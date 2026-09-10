import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificarEvidencia } from '../../mobile/src/pipeline/verificar.ts';

test('verificar.test: cita literal exacta presente en la nota → válida', () => {
  const nota = 'tenemos un resonador nuevo de NovaMed en la sala de resonancia';
  const evidencia = 'un resonador nuevo de NovaMed';

  const resultado = verificarEvidencia(nota, evidencia);
  assert.strictEqual(resultado.valida, true, 'cita exacta es válida');
});

test('verificar.test: cita con tilde donde la nota no tiene → válida (normalización)', () => {
  const nota = 'tenemos una resonancia magnetica antigua';
  const evidencia = 'resonancia magnética';

  const resultado = verificarEvidencia(nota, evidencia);
  assert.strictEqual(resultado.valida, true, 'tilde absorbida por normalización');
});

test('verificar.test: cita fabricada (dos resonadores vs todos los equipos viejos) → inválida', () => {
  const nota = 'todos los equipos están viejos y antiguos';
  const evidencia = 'dos resonadores';

  const resultado = verificarEvidencia(nota, evidencia);
  assert.strictEqual(resultado.valida, false,
    'cita fabricada rechazada (palabras presentes pero no secuencia)');
});

test('verificar.test: cita de 1-2 palabras que no aparece tal cual → inválida', () => {
  const nota = 'tenemos tres equipos nuevos en el departamento';
  const evidencia = 'cinco tomógrafos';

  const resultado = verificarEvidencia(nota, evidencia);
  assert.strictEqual(resultado.valida, false,
    'cita de 2 palabras rechazada si no aparece exacta tras normalizar');

  const evidencia2 = 'diagnostico';
  const resultado2 = verificarEvidencia(nota, evidencia2);
  assert.strictEqual(resultado2.valida, false,
    'cita de 1 palabra rechazada si no aparece en la nota');
});

test('verificar.test: cita de 3+ palabras donde todas están pero sin secuencia de 3 → inválida', () => {
  const nota = 'los resonadores son de Aurelia y están viejos ahora';
  const evidencia = 'resonadores viejos Aurelia';

  const resultado = verificarEvidencia(nota, evidencia);
  assert.strictEqual(resultado.valida, false,
    'palabras presentes pero dispersas, sin secuencia consecutiva de 3');
});

test('verificar.test: cita de 3 palabras que aparece como subcadena → válida', () => {
  const nota = 'tenemos dos resonadores magnéticos nuevos en la sala principal';
  const evidencia = 'dos resonadores magnéticos';

  const resultado = verificarEvidencia(nota, evidencia);
  assert.strictEqual(resultado.valida, true,
    'secuencia de 3 palabras encontrada');
});

test('verificar.test: evidencia vacía o trivial → inválida', () => {
  const nota = 'algún texto';
  const evidencia = '';

  const resultado = verificarEvidencia(nota, evidencia);
  assert.strictEqual(resultado.valida, false, 'evidencia vacía es inválida');

  const evidencia2 = 'x';
  const resultado2 = verificarEvidencia(nota, evidencia2);
  assert.strictEqual(resultado2.valida, false, 'evidencia trivial (<3 chars) es inválida');
});

test('verificar.test: "dos" no debe matchear "todos"', () => {
  const nota = 'todos los equipos están aquí';
  const evidencia = 'dos equipos';

  const resultado = verificarEvidencia(nota, evidencia);
  assert.strictEqual(resultado.valida, false,
    'palabra "dos" (como subcadena de "todos") no valida: comparación POR PALABRA');
});
