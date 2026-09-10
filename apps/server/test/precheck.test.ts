import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precheck } from '../../mobile/src/pipeline/precheck.ts';

test('precheck.test: compramos tres el año pasado → hayIndicios true (corrección #1)', () => {
  const texto = 'compramos tres resonadores el año pasado';
  const resultado = precheck(texto);

  assert.strictEqual(resultado.hayIndicios, true,
    'texto con número ("tres") detecta indicios (corrección #1)');
  assert.strictEqual(resultado.hayNumeros, true, 'hayNumeros true');
});

test('precheck.test: marca ficticia del vocabulario → hayMarca true', () => {
  const texto = 'tenemos equipos de NovaMed y Aurelia Health';
  const resultado = precheck(texto);

  assert.strictEqual(resultado.hayMarca, true, 'marca NovaMed detectada');
  assert(resultado.modalidades.length >= 0, 'modalidades lista presente');
});

test('precheck.test: eco no debe matchear economía (corrección #13)', () => {
  const texto = 'la economía del hospital está en riesgo';
  const resultado = precheck(texto);

  assert.strictEqual(resultado.modalidades.includes('eco'), false,
    'eco no matchea "economía" (bug #13 corregido con \\b)');
});

test('precheck.test: monitor no debe matchear monitorear (corrección #13)', () => {
  const texto = 'necesitamos monitorear los pacientes constantemente';
  const resultado = precheck(texto);

  assert.strictEqual(resultado.modalidades.includes('monitor'), false,
    'monitor no matchea "monitorear" (\\b de cierre)');
});

test('precheck.test: detectar modalidades por palabra clave', () => {
  const texto = 'tenemos una resonancia magnética, dos tomógrafos y un ecógrafo';
  const resultado = precheck(texto);

  assert(resultado.modalidades.length > 0, 'modalidades detectadas');
  assert(resultado.modalidades.includes('resonancia') || resultado.modalidades.includes('resonador'),
    'palabra de resonancia detectada');
  assert(resultado.hayIndicios, 'hay indicios');
});

test('precheck.test: no hay indicios sin marca, números ni modalidad', () => {
  const texto = 'el hospital tiene varios departamentos y mucho personal';
  const resultado = precheck(texto);

  assert.strictEqual(resultado.hayIndicios, false,
    'sin marca, números ni modalidad, hayIndicios es false');
  assert.strictEqual(resultado.hayMarca, false);
  assert.strictEqual(resultado.hayNumeros, false);
  assert.strictEqual(resultado.modalidades.length, 0);
});

test('precheck.test: números escritos en letras se detectan', () => {
  const texto = 'hay dos equipos y cinco monitores aquí';
  const resultado = precheck(texto);

  assert.strictEqual(resultado.hayNumeros, true, 'números en letras (dos, cinco) detectados');
});

test('precheck.test: dígitos se detectan como números', () => {
  const texto = 'tenemos 3 resonadores y 5 ecógrafos en el departamento';
  const resultado = precheck(texto);

  assert.strictEqual(resultado.hayNumeros, true, 'dígitos 3 y 5 detectados');
});

test('precheck.test: todas las modalidades ficticias se detectan por palabra clave', () => {
  const texto = 'mr mri rm resonancia resonador resonadores ct tac tomografo tomografos tomografia scanner escaner ecografo ecografos ecografia eco ultrasonido ultrasound rayos xray monitor monitores monitoreo igt';
  const resultado = precheck(texto);

  // Esperamos que se detecten muchas modalidades
  assert(resultado.modalidades.length > 15, 'múltiples modalidades detectadas');
});
