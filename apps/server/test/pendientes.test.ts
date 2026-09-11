/**
 * pendientes.test.ts — la nota que se guarda con una pregunta sin responder.
 *
 * Regla dura del producto: máximo UNA pregunta de seguimiento por nota, y
 * responderla es opcional — si el usuario no contesta, la nota se guarda
 * igual y queda `pendiente-de-revision`. NUNCA se descarta.
 *
 * Estos tests fijan la mitad que faltaba: que ese estado SOBREVIVA al
 * guardado. `Observacion` no tiene campo para él (contrato congelado), así
 * que el pendiente vive en su propio store — igual que en la app móvil.
 *
 * Todo corre en un directorio temporal: el store resuelve `data/` contra el
 * cwd y estos tests escriben de verdad.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Borrador, Observacion } from '../src/core/contracts.ts';
import { armarObservacion } from './helpers.ts';

const cwdOriginal = process.cwd();

before(async () => {
  process.chdir(await mkdtemp(join(tmpdir(), 'quorum-pendientes-')));
});

after(() => {
  process.chdir(cwdOriginal);
});

function armarBorrador(overrides?: Partial<Borrador>): Borrador {
  const obs: Observacion[] = [armarObservacion()];
  return {
    id: 'borrador-' + String(Math.random()).slice(2, 10),
    sesionId: obs[0]!.sesionId,
    observaciones: obs,
    resumen: 'Registré en Hospital Ejemplo: 1 MR, NovaMed. ¿Es correcto?',
    siguientePregunta: '¿Aproximadamente qué antigüedad tiene?',
    creadoEn: new Date().toISOString(),
    estadoRevision: 'pendiente-de-revision',
    ...overrides,
  };
}

test('pendientes: la cola arranca vacía y no falla si el archivo no existe', async () => {
  const { listarPendientes, contarPendientes } = await import('../src/store/pendientes.ts');

  assert.deepStrictEqual(await listarPendientes(), [],
    'sin archivo todavía: cola vacía, no una excepción');
  assert.strictEqual(await contarPendientes(), 0);
});

test('pendientes: encola el borrador COMPLETO, con su pregunta abierta', async () => {
  const { agregarPendiente, listarPendientes } = await import('../src/store/pendientes.ts');
  const b = armarBorrador();

  assert.strictEqual(await agregarPendiente(b), true, 'se pudo escribir');

  const cola = await listarPendientes();
  assert.strictEqual(cola.length, 1);
  const guardado = cola[0]!;
  assert.strictEqual(guardado.id, b.id);
  assert.strictEqual(guardado.siguientePregunta, b.siguientePregunta,
    '★ la pregunta sin responder sobrevive al guardado: es lo único que este store existe para no perder');
  assert.strictEqual(guardado.estadoRevision, 'pendiente-de-revision');
  assert.strictEqual(guardado.observaciones.length, 1,
    'las observaciones viajan con el borrador, no solo su id');
  assert.strictEqual(guardado.observaciones[0]!.id, b.observaciones[0]!.id);
});

test('pendientes: append-only, y el orden es del más viejo al más nuevo', async () => {
  const { agregarPendiente, listarPendientes, contarPendientes } = await import('../src/store/pendientes.ts');
  const antes = await contarPendientes();

  const primero = armarBorrador({ siguientePregunta: '¿En qué ciudad y país está el cliente?' });
  const segundo = armarBorrador({ siguientePregunta: '¿Conoces la marca o fabricante?' });
  await agregarPendiente(primero);
  await agregarPendiente(segundo);

  const cola = await listarPendientes();
  assert.strictEqual(cola.length, antes + 2, 'se agregan, no se reemplazan');
  assert.strictEqual(cola[cola.length - 2]!.id, primero.id);
  assert.strictEqual(cola[cola.length - 1]!.id, segundo.id,
    'el último encolado queda último: la cola conserva el orden de llegada');
  assert.strictEqual(await contarPendientes(), cola.length);
});

test('pendientes: una línea corrupta no se lleva la cola entera', async () => {
  // Mismo criterio que `store/observations.ts` y `store/audit.ts`: cargar
  // TOLERANTE. Una escritura a medias (disco lleno, proceso muerto en mitad
  // del append) no puede borrar el trabajo pendiente que sí está bueno.
  const { agregarPendiente, listarPendientes } = await import('../src/store/pendientes.ts');
  const bueno = armarBorrador();
  await agregarPendiente(bueno);

  await appendFile('data/pendientes.jsonl', '{"id":"cortado a la mitad"\n', 'utf8');
  await appendFile('data/pendientes.jsonl', 'esto no es JSON\n', 'utf8');
  // JSON válido pero que no es un Borrador: se descarta igual, no se cuela
  // como pendiente fantasma.
  await appendFile('data/pendientes.jsonl', '{"otra":"cosa"}\n', 'utf8');

  const otro = armarBorrador();
  await agregarPendiente(otro);

  const cola = await listarPendientes();
  const ids = cola.map((x) => x.id);
  assert(ids.includes(bueno.id), 'el pendiente anterior a la corrupción sobrevive');
  assert(ids.includes(otro.id), 'y el posterior también');
  assert(!ids.includes(undefined as unknown as string),
    'nada sin id entra en la cola');
  for (const x of cola) {
    assert(Array.isArray(x.observaciones),
      'todo lo que sale de la cola tiene forma de Borrador');
  }
});

test('pendientes: lo que se encola son las observaciones CORREGIDAS por el humano', async () => {
  // El endpoint encola `{...borrador, observaciones: validas}` — las que el
  // humano confirmó, no las crudas del modelo. Si mañana alguien retoma este
  // pendiente tiene que ver lo aprobado, no lo propuesto.
  const { agregarPendiente, listarPendientes } = await import('../src/store/pendientes.ts');

  const delModelo = armarObservacion({ lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2 } });
  const corregida: Observacion = { ...delModelo, lote: { ...delModelo.lote, cantidad: 5 } };

  const b = armarBorrador({ observaciones: [delModelo] });
  await agregarPendiente({ ...b, observaciones: [corregida] });

  const guardado = (await listarPendientes()).find((x) => x.id === b.id)!;
  assert.strictEqual(guardado.observaciones[0]!.lote.cantidad, 5,
    'quedó el 5 del humano, no el 2 del modelo');
});

test('pendientes: `agregarPendiente` devuelve false en vez de tirar cuando no puede escribir', async () => {
  // Contrato deliberado: se llama DESPUÉS de que las observaciones ya se
  // persistieron y el usuario ya vio su confirmación. Hacer fallar acá sería
  // perder el dato bueno por no poder anotar el pendiente. El `false` es lo
  // que el endpoint registra en la cadena de auditoría.
  const { agregarPendiente } = await import('../src/store/pendientes.ts');

  // `data` como ARCHIVO en vez de directorio: `mkdir` falla con EEXIST-no-dir
  // y el append tampoco puede resolver la ruta.
  const previo = await readFile('data/pendientes.jsonl', 'utf8').catch(() => null);
  const { mkdtemp } = await import('node:fs/promises');
  const jaula = await mkdtemp(join(tmpdir(), 'quorum-pendientes-jaula-'));
  const cwdAntes = process.cwd();
  process.chdir(jaula);
  try {
    await writeFile('data', 'no soy un directorio', 'utf8');
    assert.strictEqual(await agregarPendiente(armarBorrador()), false,
      'devuelve false, no lanza: la confirmación ya ocurrida no se rompe');
  } finally {
    process.chdir(cwdAntes);
  }
  assert.notStrictEqual(previo, null, 'la cola real del test anterior sigue ahí');
});
