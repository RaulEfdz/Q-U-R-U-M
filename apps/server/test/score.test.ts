import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconciliar } from '../src/trust/reconcile.ts';
import { armarObservacion } from './helpers.ts';

test('score.test: puntaje desglosado con completitud, frescura, corroboracion', () => {
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
      lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 5 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
  ];

  const grupos = reconciliar(obs, ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;

  // Puntaje devuelto desglosado
  assert(g.puntaje, 'puntaje existe');
  assert.strictEqual(typeof g.puntaje.total, 'number', 'total es número');
  assert.strictEqual(typeof g.puntaje.completitud, 'number', 'completitud es número');
  assert.strictEqual(typeof g.puntaje.frescura, 'number', 'frescura es número');
  assert.strictEqual(typeof g.puntaje.corroboracion, 'number', 'corroboracion es número');

  // Valores deben estar en rango válido
  assert(g.puntaje.total >= 0 && g.puntaje.total <= 100, 'total en rango [0, 100]');
  assert(g.puntaje.completitud >= 0 && g.puntaje.completitud <= 1, 'completitud en [0, 1]');
  assert(g.puntaje.frescura >= 0 && g.puntaje.frescura <= 1, 'frescura en [0, 1]');
  assert(g.puntaje.corroboracion >= 0 && g.puntaje.corroboracion <= 1, 'corroboracion en [0, 1]');
});

test('score.test: corrección #11 - grupo Sin quórum con contradicción no saca corroboración máxima', () => {
  const ahora = new Date();

  // Tres observadores Directo asertivos, mismo cliente/modalidad/marca
  // pero discrepan en CANTIDAD: 2, 2, 5
  // Esto produce Sin quórum EN totalUnidades (dos clústeres: mayoría 2, minoría 5)
  // La corrección #11 dice: cuenta solo el clúster mayoritario para corroboración
  const obs = [
    armarObservacion({
      observadorId: 'obs-1',
      sesionId: 'sesion-1',
      lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
    armarObservacion({
      observadorId: 'obs-2',
      sesionId: 'sesion-2',
      lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
    armarObservacion({
      observadorId: 'obs-3',
      sesionId: 'sesion-3',
      lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 5 },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }),
  ];

  const grupos = reconciliar(obs, ahora);
  assert.strictEqual(grupos.length, 1);
  const g = grupos[0]!;

  // totalUnidades: 2 vs 2 vs 5 → Sin quórum (dos clústeres: mayoría 2, minoría 5)
  // Pero la corrección #11 cuenta SOLO el clúster mayoritario (los dos 2's)
  // para la corroboración, no todos los 3 testigos
  // Esperamos corroboración = 0.6 (dos testigos en clúster mayoritario)
  assert.strictEqual(g.campos.totalUnidades.estado, 'Sin quórum',
    'cantidad con discrepancia está en Sin quórum');
  assert.strictEqual(g.puntaje.corroboracion, 0.6,
    'corroboración cuenta solo el clúster mayoritario (2 testigos), no todos los 3');
});

test('score.test: frescura decae con tiempo desde visitadoEn', () => {
  const ahora = new Date();
  const hace365dias = new Date(ahora.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const hace180dias = new Date(ahora.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();

  // Visita hace 180 días
  const obs1 = armarObservacion({
    visitadoEn: hace180dias,
    naturaleza: 'Directo',
    hedging: false,
  });

  const grupos1 = reconciliar([obs1], ahora);
  const frescura1 = grupos1[0]!.puntaje.frescura;
  assert(frescura1 > 0 && frescura1 < 1, 'frescura a 180 días está entre 0 y 1');

  // Visita hace 365 días (año completo)
  const obs2 = armarObservacion({
    observadorId: 'obs-viejo',
    sesionId: 'sesion-viejo',
    visitadoEn: hace365dias,
    naturaleza: 'Directo',
    hedging: false,
  });

  const grupos2 = reconciliar([obs2], ahora);
  const frescura2 = grupos2[0]!.puntaje.frescura;
  assert.strictEqual(frescura2, 0, 'frescura a 365 días es 0');

  // La reciente es más fresca que la vieja
  assert(frescura1 > frescura2, 'información más reciente tiene frescura mayor');
});

test('score.test: un campo en `Sin quórum` NO cuenta como completo — la disputa baja el puntaje, no lo sube', () => {
  // Regresión del hallazgo de severidad alta: `puntuar()` solo recortaba el
  // factor `corroboracion`, y `completitud` seguía contando un campo en
  // disputa como dato presente (miraba solo `estado !== 'Sin datos'`).
  // Medido en vivo contra el dataset real, el grupo
  // `Hospital DemoCare Pacific | MR | NovaMed` — con `estadoGeneral: 'Sin
  // quórum'` porque la edad está en disputa (un clúster dice 7 años, otro 12)
  // — sacaba 88/100, el puntaje MÁS ALTO de los 16 grupos, por encima de dos
  // grupos con quórum pleno que sacaban 87 y 84. La pantalla que existe para
  // señalar disputa premiaba la disputa.
  //
  // El puntaje es "calidad del dato". `Sin quórum` significa, por definición
  // del producto (RD-2), que el sistema NO SABE cuál de los dos valores es el
  // bueno: no es un dato de alta calidad, es una pregunta abierta.
  const ahora = new Date();

  const trio = (edades: number[], cliente: string) => edades.map((edadAnios, i) =>
    armarObservacion({
      observadorId: `obs-${cliente}-${i}`,
      sesionId: `sesion-${cliente}-${i}`,
      cliente: { nombre: cliente, ciudad: 'Panamá', pais: 'PA', sitio: 'Planta 2' },
      lote: { modalidad: 'MR', marca: 'NovaMed', modelo: 'Model-X', cantidad: 2, edadAnios },
      naturaleza: 'Directo',
      hedging: false,
      visitadoEn: ahora.toISOString(),
    }));

  // Mismo grupo, misma frescura, mismos campos presentes. Lo ÚNICO que cambia
  // es que en uno la edad está en disputa (7, 7, 12) y en el otro no (7, 7, 7).
  const conDisputa = reconciliar(trio([7, 7, 12], 'Hospital Disputa'), ahora)[0]!;
  const sinDisputa = reconciliar(trio([7, 7, 7], 'Hospital Acuerdo'), ahora)[0]!;

  assert.strictEqual(conDisputa.campos.edad.estado, 'Sin quórum',
    'la edad discrepante queda en Sin quórum');
  assert.notStrictEqual(sinDisputa.campos.edad.estado, 'Sin quórum',
    'la edad concordante NO queda en Sin quórum');

  // El campo en disputa deja de aportar su peso a la completitud.
  assert(conDisputa.puntaje.completitud < sinDisputa.puntaje.completitud,
    `completitud con disputa (${conDisputa.puntaje.completitud}) debe ser menor ` +
    `que sin disputa (${sinDisputa.puntaje.completitud})`);

  // Y el total, que es lo que se muestra y lo que ordena la lista.
  assert(conDisputa.puntaje.total < sinDisputa.puntaje.total,
    `total con disputa (${conDisputa.puntaje.total}) debe ser menor ` +
    `que sin disputa (${sinDisputa.puntaje.total})`);
});
