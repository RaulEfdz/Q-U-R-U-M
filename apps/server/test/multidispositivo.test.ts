/**
 * multidispositivo.test.ts — el caso real del reto: la misma base instalada
 * llega en pedazos, desde varios teléfonos, y el sistema tiene que
 * CONSOLIDARLA en una sola verdad sin inventar nada.
 *
 * Los tests de `reconcile.test.ts` fijan las reglas duras una por una (RD-0
 * a RD-7) con observaciones armadas a mano. Estos fijan el escenario
 * COMPUESTO que ninguna de esas reglas cubre sola: N dispositivos, algunos
 * locales y otros que entraron por sync P2P, con testimonios que se
 * corroboran, se contradicen y se repiten — y el resultado agregado que la
 * pantalla Cliente 360 y el CSV de Philips van a mostrar.
 *
 * Por qué merece archivo aparte: la trampa de este producto no es una regla
 * mal implementada, es la CONFUSIÓN ENTRE DISPOSITIVO Y OBSERVADOR. Dos
 * teléfonos no son dos testigos si detrás hay una sola persona; el quórum lo
 * dan observadores independientes (RD-1/RD-3), no aparatos. Un sistema que
 * cuente dispositivos se auto-corrobora, y eso es exactamente lo que el
 * proyecto declara que no hace.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconciliar } from '../src/trust/reconcile.ts';
import { exportarCSV } from '../src/export/philips.ts';
import { armarObservacion } from './helpers.ts';
import type { Observacion } from '../src/core/contracts.ts';

/** Cliente común: la clave de grupo se arma con nombre + ubicación +
 *  modalidad + marca, así que todo lo que se quiera consolidar en UN grupo
 *  tiene que compartir esos cuatro. */
const CLIENTE = {
  nombre: 'Hospital DemoCare Pacific',
  ciudad: 'Panama City',
  pais: 'Panama',
} as const;

/**
 * Un testimonio tal como llega de UN dispositivo concreto.
 *
 * `dispositivoId` y `observadorId` se piden por separado a propósito: que
 * sean dos parámetros distintos es lo que permite escribir el caso "una
 * persona, dos teléfonos", que es el que se cuela solo.
 */
function testimonio(opts: {
  observador: string;
  dispositivo: string;
  cantidad?: number;
  edad?: number | [number, number];
  marca?: string;
  modelo?: string;
  visitadoEn: string;
  origen?: 'local' | 'peer';
  naturaleza?: Observacion['naturaleza'];
  hedging?: boolean;
  sesionId?: string;
}): Observacion {
  return armarObservacion({
    observadorId: opts.observador,
    dispositivoId: opts.dispositivo,
    visitadoEn: opts.visitadoEn,
    capturadaEn: opts.visitadoEn,
    origen: opts.origen ?? 'local',
    naturaleza: opts.naturaleza ?? 'Directo',
    hedging: opts.hedging ?? false,
    cliente: { ...CLIENTE },
    lote: {
      modalidad: 'MR',
      marca: opts.marca ?? 'NovaMed',
      ...(opts.modelo ? { modelo: opts.modelo } : {}),
      ...(opts.cantidad !== undefined ? { cantidad: opts.cantidad } : {}),
      ...(opts.edad !== undefined ? { edadAnios: opts.edad } : {}),
    },
    ...(opts.sesionId ? { sesionId: opts.sesionId } : {}),
  });
}

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const dias = (n: number): string =>
  new Date(AHORA.getTime() - n * 86_400_000).toISOString();

/* ═══════════════════ Consolidación que SÍ debe ocurrir ═══════════════════ */

test('multidispositivo: dos dispositivos de dos personas distintas consolidan en un grupo con quórum', () => {
  const obs = [
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 2, edad: 7, visitadoEn: dias(5) }),
    testimonio({ observador: 'Sales User 14', dispositivo: 'pixel-b', cantidad: 2, edad: 7, visitadoEn: dias(2) }),
  ];

  const grupos = reconciliar(obs, AHORA);

  assert.strictEqual(grupos.length, 1,
    'dos dispositivos sobre el mismo cliente y modalidad son UN grupo, no dos');
  const g = grupos[0]!;
  assert.strictEqual(g.campos.modalidad.estado, 'Quórum');
  assert.strictEqual(g.campos.totalUnidades.estado, 'Quórum');
  assert.strictEqual(g.campos.totalUnidades.valor, 2,
    'coinciden en 2 unidades: se sostiene el valor, no se suma dos veces');
  assert.strictEqual(g.observacionesIds.length, 2,
    'los dos testimonios quedan trazables desde el grupo');
  assert.deepStrictEqual([...g.campos.modalidad.observadores].sort(),
    ['Field User 01', 'Sales User 14'],
    'los dos observadores figuran como quienes lo sostienen');
});

test('multidispositivo: un testimonio local y otro que entró por sync P2P consolidan igual', () => {
  // El `origen` decide si el texto va con spotlighting antes de llegar a un
  // modelo (`context/spotlight.ts`), NO cuánto vale como testimonio: un
  // testigo directo no es menos testigo por haber llegado por la red.
  const obs = [
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 3, edad: 4, visitadoEn: dias(4), origen: 'local' }),
    testimonio({ observador: 'Field User 22', dispositivo: 'pixel-remoto', cantidad: 3, edad: 4, visitadoEn: dias(1), origen: 'peer' }),
  ];

  const g = reconciliar(obs, AHORA)[0]!;

  assert.strictEqual(g.campos.totalUnidades.estado, 'Quórum',
    'local + peer, dos observadores directos: hay quórum');
  assert.strictEqual(g.campos.totalUnidades.valor, 3);
});

test('multidispositivo: tres dispositivos consolidan las cohortes del mismo parque', () => {
  // El caso H-02 del doc: "tres MR, dos viejos y uno nuevo". Cada dispositivo
  // aporta lo que vio; la consolidación tiene que contar 3 unidades y DOS
  // cohortes, no promediar las edades ni quedarse con una sola.
  const sesionA = 'sesion-pixel-a';
  const sesionB = 'sesion-pixel-b';
  const obs = [
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 2, edad: 9, visitadoEn: dias(6), sesionId: sesionA }),
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 1, edad: 3, visitadoEn: dias(6), sesionId: sesionA }),
    testimonio({ observador: 'Sales User 14', dispositivo: 'pixel-b', cantidad: 2, edad: 9, visitadoEn: dias(3), sesionId: sesionB }),
    testimonio({ observador: 'Sales User 14', dispositivo: 'pixel-b', cantidad: 1, edad: 3, visitadoEn: dias(3), sesionId: sesionB }),
  ];

  const g = reconciliar(obs, AHORA)[0]!;

  assert.strictEqual(g.campos.totalUnidades.valor, 3,
    'los lotes de una misma sesión se suman: 2 viejos + 1 nuevo = 3 unidades');
  assert.strictEqual(g.campos.totalUnidades.estado, 'Quórum',
    'los dos dispositivos llegan al mismo total de forma independiente');
  assert.strictEqual(g.cohortes.length, 2,
    'dos edades distintas son DOS cohortes, no una contradicción');
  const edades = g.cohortes.map((c) => (Array.isArray(c.edad) ? c.edad[1] : c.edad)).sort((a, b) => a - b);
  assert.deepStrictEqual(edades, [3, 9], 'las dos cohortes conservan su edad');
  for (const c of g.cohortes) {
    assert.strictEqual(c.estado, 'Quórum',
      'cada cohorte la corroboran los dos observadores');
  }
});

/* ═══════════════ Consolidación que NO debe ocurrir (la trampa) ═══════════════ */

test('multidispositivo: la MISMA persona desde dos dispositivos no se autocorrobora', () => {
  // ★ El test que justifica este archivo. Dos `dispositivoId` distintos, un
  // solo `observadorId`: si el motor contara aparatos en vez de personas,
  // esto daría Quórum y el sistema se estaría corroborando a sí mismo.
  // RD-1 + RD-3: el quórum lo dan observadores independientes.
  const obs = [
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-personal', cantidad: 2, edad: 7, visitadoEn: dias(6) }),
    testimonio({ observador: 'Field User 01', dispositivo: 'tablet-de-la-empresa', cantidad: 2, edad: 7, visitadoEn: dias(2) }),
  ];

  const g = reconciliar(obs, AHORA)[0]!;

  assert.strictEqual(g.campos.totalUnidades.estado, 'Reportado',
    'un observador con dos dispositivos sigue siendo UN testigo: nunca Quórum');
  assert.strictEqual(g.campos.modalidad.estado, 'Reportado');
  assert.deepStrictEqual(g.campos.totalUnidades.observadores, ['Field User 01'],
    'el observador se cuenta una sola vez, no una por dispositivo');
  assert.strictEqual(g.puntaje.corroboracion, 0,
    'sin un segundo testigo independiente, la corroboración es cero');
});

test('multidispositivo: el testimonio más reciente de cada dispositivo es el que cuenta', () => {
  // Dos personas, y una de ellas volvió a visitar con otro número. RD-3: de
  // cada observador vale su testimonio más reciente — y acá eso convierte
  // una coincidencia vieja en una discrepancia actual, que es justo lo que
  // el producto tiene que mostrar en vez de esconder.
  const obs = [
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 2, edad: 7, visitadoEn: dias(20) }),
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 5, edad: 7, visitadoEn: dias(1) }),
    testimonio({ observador: 'Sales User 14', dispositivo: 'pixel-b', cantidad: 2, edad: 7, visitadoEn: dias(3) }),
  ];

  const g = reconciliar(obs, AHORA)[0]!;

  assert.strictEqual(g.campos.totalUnidades.estado, 'Sin quórum',
    '5 (lo último que dijo el primero) contra 2 del segundo: discrepan');
  assert.strictEqual(g.campos.totalUnidades.valor, undefined,
    'Sin quórum no expone un valor: no se elige ni se promedia (RD-2)');
  const clusters = g.campos.totalUnidades.clusters ?? [];
  assert.strictEqual(clusters.length, 2, 'las dos versiones quedan visibles');
  assert.deepStrictEqual(clusters.map((c) => c.valor).sort(), [2, 5],
    'se muestran los dos valores tal como se dijeron');
});

test('multidispositivo: tres dispositivos con uno que discrepa muestran las dos versiones y quién las sostiene', () => {
  const obs = [
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 2, edad: 7, visitadoEn: dias(8) }),
    testimonio({ observador: 'Sales User 14', dispositivo: 'pixel-b', cantidad: 2, edad: 7, visitadoEn: dias(5) }),
    testimonio({ observador: 'Field User 15', dispositivo: 'pixel-c', cantidad: 2, edad: 12, visitadoEn: dias(2) }),
  ];

  const g = reconciliar(obs, AHORA)[0]!;

  assert.strictEqual(g.campos.totalUnidades.estado, 'Quórum',
    'en el total sí coinciden los tres: ese campo tiene quórum');
  assert.strictEqual(g.campos.edad.estado, 'Sin quórum',
    'la confianza es POR CAMPO: la edad discrepa aunque el total no (RD-4)');
  assert.strictEqual(g.estadoGeneral, 'Sin quórum',
    'un campo en disputa arrastra el estado general del grupo');

  const clusters = g.campos.edad.clusters ?? [];
  assert.strictEqual(clusters.length, 2);
  const mayoritario = clusters.find((c) => c.observadores.length === 2)!;
  const minoritario = clusters.find((c) => c.observadores.length === 1)!;
  assert.deepStrictEqual([...mayoritario.observadores].sort(),
    ['Field User 01', 'Sales User 14'],
    'se puede ver quién sostiene la versión de 7 años');
  assert.deepStrictEqual(minoritario.observadores, ['Field User 15'],
    'y quién sostiene la de 12 — el disidente no se borra');
});

test('multidispositivo: dispositivos que reportan clientes distintos no se consolidan entre sí', () => {
  const obs = [
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 2, edad: 7, visitadoEn: dias(3) }),
    armarObservacion({
      observadorId: 'Field User 09',
      dispositivoId: 'pixel-b',
      visitadoEn: dias(3),
      capturadaEn: dias(3),
      cliente: { nombre: 'Instituto DemoCare Sierra', ciudad: 'Santiago', pais: 'Chile' },
      lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 7 },
    }),
  ];

  const grupos = reconciliar(obs, AHORA);

  assert.strictEqual(grupos.length, 2,
    'dos clientes son dos grupos: la ubicación desambigua, no se fusiona sola');
  for (const g of grupos) {
    assert.notStrictEqual(g.campos.totalUnidades.estado, 'Quórum',
      'ningún grupo hereda corroboración del otro');
  }
});

/* ═══════════ Reenvío: el peer que se reconecta y manda todo otra vez ═══════════ */

test('multidispositivo: el mismo testimonio recibido dos veces no duplica ni cambia el estado', async () => {
  // `sync/peer.ts` manda el dataset COMPLETO en cada conexión
  // (`enviarPropias`), así que en una demo con dos equipos reconectando, cada
  // observación llega varias veces. La consolidación tiene que ser
  // idempotente por `id` o el sistema se autocorrobora con copias de sí mismo.
  //
  // El store escribe en `data/` relativo al cwd: se corre en un directorio
  // temporal para no tocar el dataset real del proyecto.
  const cwdOriginal = process.cwd();
  const temporal = await mkdtemp(join(tmpdir(), 'quorum-multidispositivo-'));
  process.chdir(temporal);

  try {
    const { agregar, cargar } = await import('../src/store/observations.ts');

    const deA = testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 2, edad: 7, visitadoEn: dias(5) });
    const deB = testimonio({ observador: 'Sales User 14', dispositivo: 'pixel-b', cantidad: 2, edad: 7, visitadoEn: dias(2), origen: 'peer' });

    assert.strictEqual(await agregar([deA, deB]), 2, 'la primera vez entran los dos');
    assert.strictEqual(await agregar([deA, deB]), 0,
      'el reenvío completo del peer no agrega nada: dedup por id');
    assert.strictEqual(await agregar([deB]), 0, 'ni uno suelto ya visto');

    const persistidas = await cargar();
    assert.strictEqual(persistidas.length, 2, 'siguen siendo dos testimonios');

    const g = reconciliar(persistidas, AHORA)[0]!;
    assert.strictEqual(g.campos.totalUnidades.estado, 'Quórum');
    assert.strictEqual(g.observacionesIds.length, 2,
      'el grupo no acumula copias del mismo testimonio');
    assert.strictEqual(g.puntaje.corroboracion, 0.6,
      'dos testigos independientes: la corroboración no sube por el reenvío');
  } finally {
    process.chdir(cwdOriginal);
  }
});

/* ═══════════════ Lo que el cliente final se lleva: el CSV ═══════════════ */

test('multidispositivo: el CSV exporta una fila por testimonio, con su dispositivo y su observador', () => {
  const obs = [
    testimonio({ observador: 'Field User 01', dispositivo: 'pixel-a', cantidad: 2, edad: 7, visitadoEn: dias(5) }),
    testimonio({ observador: 'Sales User 14', dispositivo: 'pixel-b', cantidad: 2, edad: 7, visitadoEn: dias(2) }),
    testimonio({ observador: 'Field User 15', dispositivo: 'pixel-c', cantidad: 2, edad: 7, visitadoEn: dias(1), naturaleza: 'Referido' }),
  ];

  const csv = exportarCSV(obs, AHORA);
  const lineas = csv.trim().split('\n');

  assert.strictEqual(lineas.length, 4,
    'cabecera + una fila por testimonio: el CSV NO consolida, preserva cada testimonio');
  assert.strictEqual(lineas[0]!.split(',').length, 19,
    'el esquema del workbook son 19 columnas exactas');

  for (const observador of ['Field User 01', 'Sales User 14', 'Field User 15']) {
    assert(csv.includes(observador), `el observador ${observador} figura en su fila`);
  }
  // La naturaleza de cada testimonio viaja al vocabulario de Philips, por
  // fila: dos observaciones directas y una referida no se promedian en una
  // sola etiqueta de estado.
  assert.strictEqual(csv.split('Confirmed').length - 1, 2, 'dos filas Confirmed');
  assert.strictEqual(csv.split('Reported').length - 1, 1, 'una fila Reported');
});
