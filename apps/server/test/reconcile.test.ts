import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconciliar } from '../src/trust/reconcile.ts';
import { armarObservacion, hacerObservaciones } from './helpers.ts';

test('RD-0: sin datos, el campo queda Sin datos', () => {
  const obs = hacerObservaciones(0);
  const grupos = reconciliar(obs);
  assert.strictEqual(grupos.length, 0, 'sin observaciones, sin grupos');
});

test('RD-1: un solo observador nunca produce quórum', () => {
  const obs = hacerObservaciones(1, {
    observadorId: 'obs-solo',
    naturaleza: 'Directo',
    hedging: false,
  });

  const grupos = reconciliar(obs);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;
  assert.notStrictEqual(g.campos.modalidad.estado, 'Quórum',
    'modalidad: un observador no da quórum');
  assert.strictEqual(g.campos.modalidad.estado, 'Reportado',
    'modalidad: queda en Reportado');
});

test('RD-2: discrepancia produce Sin quórum, no promedio', () => {
  const ahora = new Date();
  const obs = [
    armarObservacion({
      observadorId: 'obs-1',
      lote: { modalidad: 'MR', cantidad: 2, edadAnios: 5 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
    armarObservacion({
      observadorId: 'obs-2',
      sesionId: 'sesion-diferente',
      lote: { modalidad: 'MR', cantidad: 3, edadAnios: 5 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
  ];

  const grupos = reconciliar(obs, ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;
  assert.strictEqual(g.campos.totalUnidades.estado, 'Sin quórum',
    'discrepancia 2 vs 3 produce Sin quórum');
  assert(g.campos.totalUnidades.clusters && g.campos.totalUnidades.clusters.length === 2,
    'ambos clústeres visibles');
});

test('RD-3: un observador cuenta una vez (su testimonio más reciente)', () => {
  const ahora = new Date();
  const hace1dia = new Date(ahora.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const hace0dias = ahora.toISOString();

  const obs = [
    armarObservacion({
      observadorId: 'obs-mismo',
      lote: { modalidad: 'MR', cantidad: 2 },
      visitadoEn: hace1dia,
      naturaleza: 'Directo',
      hedging: false,
    }),
    armarObservacion({
      observadorId: 'obs-mismo',
      sesionId: 'sesion-2',
      lote: { modalidad: 'MR', cantidad: 3 },
      visitadoEn: hace0dias,
      naturaleza: 'Directo',
      hedging: false,
    }),
  ];

  const grupos = reconciliar(obs, ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;
  assert.strictEqual(g.campos.totalUnidades.valor, 3,
    'solo el testimonio más reciente (cantidad 3) cuenta');
  assert.notStrictEqual(g.campos.totalUnidades.estado, 'Quórum',
    'un observador con un testimonio no da quórum');
});

test('RD-4: confianza por campo - discrepancia de edad no afecta marca', () => {
  const ahora = new Date();
  const obs = [
    armarObservacion({
      observadorId: 'obs-1',
      lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 5 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
    armarObservacion({
      observadorId: 'obs-2',
      sesionId: 'sesion-2',
      lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 10 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
  ];

  const grupos = reconciliar(obs, ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;
  // Marca debería estar en Quórum aunque edad discrepe
  assert.strictEqual(g.campos.marca.estado, 'Quórum',
    'marca en quórum (dos directo, no hedgeados)');
  // Edad en Sin quórum (discrepancia)
  assert.strictEqual(g.campos.edad.estado, 'Sin quórum',
    'edad en Sin quórum (rango [5, 10] incompatible)');
});

test('RD-5: todos hedgeados produce techo Reportado', () => {
  const ahora = new Date();
  const obs = [
    armarObservacion({
      observadorId: 'obs-1',
      lote: { modalidad: 'MR', cantidad: 2 },
      naturaleza: 'Directo',
      hedging: true,
      visitadoEn: ahora.toISOString(),
    }),
    armarObservacion({
      observadorId: 'obs-2',
      sesionId: 'sesion-2',
      lote: { modalidad: 'MR', cantidad: 2 },
      naturaleza: 'Directo',
      hedging: true,
      visitadoEn: ahora.toISOString(),
    }),
  ];

  const grupos = reconciliar(obs, ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;
  assert.strictEqual(g.campos.totalUnidades.estado, 'Reportado',
    'dos hedgeados nunca alcanzan Quórum, techo es Reportado');
});

test('RD-6: frescura se mide desde visitadoEn, no capturadaEn', () => {
  const ahora = new Date();
  const hace190dias = new Date(ahora.getTime() - 190 * 24 * 60 * 60 * 1000).toISOString();
  const recientemente = new Date(ahora.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

  // Visita vieja, captura reciente
  const obs = hacerObservaciones(1, {
    visitadoEn: hace190dias,
    capturadaEn: recientemente,
    naturaleza: 'Directo',
    hedging: false,
  });

  const grupos = reconciliar(obs, ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;
  assert.strictEqual(g.campos.modalidad.fresco, false,
    'visita de hace 190 días no es fresca (umbral 180 días)');
});

test('RD-7: solo testimonio Directo y asertivo da quórum', () => {
  const ahora = new Date();

  // Caso 1: dos Referido no dan quórum
  const obs1 = [
    armarObservacion({
      observadorId: 'obs-1',
      naturaleza: 'Referido',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
    armarObservacion({
      observadorId: 'obs-2',
      sesionId: 'sesion-2',
      naturaleza: 'Referido',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
  ];

  const grupos1 = reconciliar(obs1, ahora);
  assert.strictEqual(grupos1[0]!.campos.modalidad.estado, 'Reportado',
    'dos Referido (no pueden dar quórum) quedan en Reportado');

  // Caso 2: dos Directo pero hedgeados no dan quórum
  const obs2 = [
    armarObservacion({
      observadorId: 'obs-1',
      naturaleza: 'Directo',
      hedging: true,
      visitadoEn: ahora.toISOString(),
    }),
    armarObservacion({
      observadorId: 'obs-2',
      sesionId: 'sesion-2',
      naturaleza: 'Directo',
      hedging: true,
      visitadoEn: ahora.toISOString(),
    }),
  ];

  const grupos2 = reconciliar(obs2, ahora);
  assert.strictEqual(grupos2[0]!.campos.modalidad.estado, 'Reportado',
    'dos Directo hedgeados quedan en Reportado');

  // Caso 3: dos Directo asertivos dan quórum
  const obs3 = [
    armarObservacion({
      observadorId: 'obs-1',
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
    armarObservacion({
      observadorId: 'obs-2',
      sesionId: 'sesion-2',
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
  ];

  const grupos3 = reconciliar(obs3, ahora);
  assert.strictEqual(grupos3[0]!.campos.modalidad.estado, 'Quórum',
    'dos Directo asertivos alcanzan Quórum');
});
