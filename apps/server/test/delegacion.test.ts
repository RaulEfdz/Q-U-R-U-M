import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificar, decidirRuta } from '../src/qvac/delegation.ts';

test('delegación: identidad de cliente obliga inferencia local', () => {
  for (const texto of ['Hospital DemoCare Pacific', 'Clínica Central', 'Centro Médico Norte']) {
    assert.equal(clasificar(texto), 'sensible');
    assert.equal(decidirRuta(texto).ruta, 'local-obligatoria');
  }
});

test('delegación: texto sin identidad de cliente puede delegarse, pero conserva policyId explícito', () => {
  const d = decidirRuta('Vi dos MR de unos ocho años');
  assert.equal(d.ruta, 'delegable');
  assert.match(d.policyId, /^delegacion-cliente-identificable@/);
});
