import test from 'node:test';
import assert from 'node:assert/strict';
import { construirInteligencia } from '../src/intelligence/central.ts';
import { reconciliar } from '../src/trust/reconcile.ts';
import { armarObservacion } from './helpers.ts';

const AHORA = new Date('2026-09-10T12:00:00.000Z');

function grupoDe(...observaciones: ReturnType<typeof armarObservacion>[]) {
  return reconciliar(observaciones, AHORA);
}

test('intelligence: refresh explica evidencia, puntaje y verificación cuando el parque es viejo', () => {
  const base = {
    cliente: { nombre: 'Hospital Horizonte', ciudad: 'Panamá', pais: 'Panamá', sitio: 'Imagenología' },
    lote: { modalidad: 'MR' as const, marca: 'NovaMed', modelo: 'NX-8', cantidad: 2, edadAnios: [10, 12] as [number, number] },
    visitadoEn: '2026-08-01T12:00:00.000Z', naturaleza: 'Directo' as const, hedging: false,
  };
  const a = armarObservacion({ ...base, observadorId: 'ana', dispositivoId: 'ana-1' });
  const b = armarObservacion({ ...base, observadorId: 'bruno', dispositivoId: 'bruno-1' });
  const inteligencia = construirInteligencia(grupoDe(a, b), [a, b], AHORA);
  const refresh = inteligencia.oportunidades.find((o) => o.tipo === 'potential_refresh');

  assert.ok(refresh);
  assert.equal(refresh.prioridad, 'alta');
  assert.deepEqual(refresh.evidenciaIds, [a.id, b.id].sort());
  assert.equal(refresh.puntaje.edad, 30);
  assert.equal(refresh.puntaje.relevanciaNegocio, 0);
  assert.match(refresh.proximaAccion, /Verificar el estado actual/);
});

test('intelligence: un conflicto se convierte en trabajo de validación sin inventar unidades', () => {
  const base = {
    cliente: { nombre: 'Clínica Norte', ciudad: 'Bogotá', pais: 'Colombia', sitio: 'Piso 1' },
    lote: { modalidad: 'CT' as const, marca: 'BluePeak Medical', modelo: 'BP-4', cantidad: 3, edadAnios: 6 },
    visitadoEn: '2026-08-15T12:00:00.000Z', naturaleza: 'Directo' as const, hedging: false,
  };
  const a = armarObservacion({ ...base, observadorId: 'ana', dispositivoId: 'ana-1' });
  const b = armarObservacion({ ...base, observadorId: 'bruno', dispositivoId: 'bruno-1', lote: { ...base.lote, cantidad: 4 } });
  const inteligencia = construirInteligencia(grupoDe(a, b), [a, b], AHORA);
  const conflicto = inteligencia.oportunidades.find((o) => o.tipo === 'conflicting_installed_base');
  const grupoGeo = inteligencia.geografia[0]!.ciudades[0]!.clientes[0]!.grupos[0]!;

  assert.ok(conflicto);
  assert.match(conflicto.razon.join(' '), /cantidad/);
  assert.equal('unidades' in grupoGeo, false);
  assert.deepEqual(conflicto.evidenciaIds, [a.id, b.id].sort());
});

test('intelligence: información incompleta y stale generan tareas distintas, con sitios solo observados', () => {
  const o = armarObservacion({
    cliente: { nombre: 'Centro Sur', ciudad: 'São Paulo', pais: 'Brasil', sitio: 'Radiología' },
    lote: { modalidad: 'Ultrasound', cantidad: 5 },
    visitadoEn: '2024-01-10T12:00:00.000Z', naturaleza: 'Directo', hedging: false,
  });
  const inteligencia = construirInteligencia(grupoDe(o), [o], AHORA);
  const tipos = inteligencia.oportunidades.map((x) => x.tipo);

  assert.ok(tipos.includes('missing_critical_information'));
  assert.ok(tipos.includes('requires_verification'));
  assert.equal(inteligencia.calidad.faltantesCriticos, 1);
  assert.equal(inteligencia.calidad.desactualizados, 1);
  assert.equal(inteligencia.resumen.sitiosObservados, 1);
  assert.deepEqual(inteligencia.geografia[0]!.ciudades[0]!.clientes[0]!.grupos[0]!.sitiosObservados, ['Radiología']);
});
