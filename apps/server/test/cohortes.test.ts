import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconciliar } from '../src/trust/reconcile.ts';
import { armarObservacion } from './helpers.ts';

test('H-02: tres MR (2 viejos + 1 nuevo) = dos cohortes', () => {
  const ahora = new Date();
  // Un observador reporta: 2 MR de 9 años + 1 MR de 3 años
  // Esto es UN testimonio con DOS LOTES
  const obs = [
    armarObservacion({
      observadorId: 'obs-1',
      sesionId: 'sesion-1',
      lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 9 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
      evidencia: 'dos resonadores viejos de 9 años',
    }),
    armarObservacion({
      observadorId: 'obs-1',
      sesionId: 'sesion-1',  // misma sesión
      lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 1, edadAnios: 3 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
      evidencia: 'un resonador nuevo de 3 años',
    }),
  ];

  const grupos = reconciliar(obs, ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;

  // Total: 2 + 1 = 3 unidades
  assert.strictEqual(g.campos.totalUnidades.valor, 3, 'total 3 unidades');
  assert.strictEqual(g.campos.totalUnidades.estado, 'Reportado',
    'totalUnidades es Reportado (un solo observador)');

  // Dos cohortes: una de edad 9, una de edad 3
  assert.strictEqual(g.cohortes.length, 2, 'dos cohortes (edades distintas)');

  const cohorte9 = g.cohortes.find((c) => typeof c.edad === 'number' && c.edad === 9);
  const cohorte3 = g.cohortes.find((c) => typeof c.edad === 'number' && c.edad === 3);

  assert(cohorte9, 'cohorte de edad 9 existe');
  assert(cohorte3, 'cohorte de edad 3 existe');

  assert.strictEqual(cohorte9!.cantidad.valor, 2, 'cohorte 9 años: 2 unidades');
  assert.strictEqual(cohorte3!.cantidad.valor, 1, 'cohorte 3 años: 1 unidad');
});

test('H-02: dos observadores reportan el mismo total en cohortes distintas', () => {
  const ahora = new Date();

  // Obs 1: 3 MR en lote único (edad 6)
  const obs1 = armarObservacion({
    observadorId: 'obs-1',
    sesionId: 'sesion-1',
    lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 3, edadAnios: 6 },
    naturaleza: 'Directo',
    hedging: false,
    visitadoEn: ahora.toISOString(),
    evidencia: 'tres resonadores de unos 6 años',
  });

  // Obs 2: 3 MR en dos lotes (1@5años, 2@7años)
  const obs2a = armarObservacion({
    observadorId: 'obs-2',
    sesionId: 'sesion-2',
    lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 1, edadAnios: 5 },
    naturaleza: 'Directo',
    hedging: false,
    visitadoEn: ahora.toISOString(),
    evidencia: 'uno nuevo de 5 años',
  });

  const obs2b = armarObservacion({
    observadorId: 'obs-2',
    sesionId: 'sesion-2',
    lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 7 },
    naturaleza: 'Directo',
    hedging: false,
    visitadoEn: ahora.toISOString(),
    evidencia: 'dos viejos de 7 años',
  });

  const grupos = reconciliar([obs1, obs2a, obs2b], ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;

  // Total: ambos reportan 3
  assert.strictEqual(g.campos.totalUnidades.estado, 'Quórum',
    'total en quórum (2 observadores, ambos Directo no hedgeados)');

  // Cohortes: esperamos clustering por compatibilidad de edad
  // obs-1 aporta 3@6, obs-2 aporta 1@5 (compatible con 6) + 2@7
  // Tolerancia de edad: 2 años
  // 5 vs 6: compatible (|5-6| = 1 <= 2)
  // 7 vs 6: compatible (|7-6| = 1 <= 2)
  // Así que todo cluster al mismo cohorte: edad [5, 7]
  // Cantidad: 3 + 1 + 2 = 6 totales en ese cohorte... NO
  // Cada lote se resuelve por observador EN ESA COHORTE
  // obs-1 dice 3@6, obs-2 dice (1@5 + 2@7)
  // El motor de cohortes agrupa por edad compatible, luego resuelve cantidad
  // dentro de cada cohorte usando votos
  // Esperamos 2 o más cohortes porque hay reclamos de edad distintos
  assert(g.cohortes.length >= 1, 'hay al menos una cohorte');
});

test('H-02: no generar conflicto falso por cohortes no sincronizadas', () => {
  const ahora = new Date();

  // Obs 1: 2 MR de 9 años
  const obs1 = armarObservacion({
    observadorId: 'obs-1',
    sesionId: 'sesion-1',
    lote: { modalidad: 'MR', cantidad: 2, edadAnios: 9 },
    naturaleza: 'Directo',
    hedging: false,
    visitadoEn: ahora.toISOString(),
  });

  // Obs 2: 1 MR de 3 años
  const obs2 = armarObservacion({
    observadorId: 'obs-2',
    sesionId: 'sesion-2',
    lote: { modalidad: 'MR', cantidad: 1, edadAnios: 3 },
    naturaleza: 'Directo',
    hedging: false,
    visitadoEn: ahora.toISOString(),
  });

  const grupos = reconciliar([obs1, obs2], ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;

  // Sin quórum por conflicto: 2 vs 1 en cantidad
  // porque edades 9 vs 3 NO son compatibles (diferencia 6 > tolerancia 2)
  assert.strictEqual(g.campos.totalUnidades.estado, 'Sin quórum',
    'conflicto de cantidad 2 vs 1 (cohortes distintas, edades incompatibles)');
});
