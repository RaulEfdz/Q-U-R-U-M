// peer.test.ts — hallazgo A-8: el acumulador de líneas del transporte P2P.
//
// No se levanta un swarm ni se toca la red: `crearAcumuladorLineas()` está
// extraído justamente para que la decisión de "cuándo descarto y destruyo" se
// pueda probar sin dos peers reales conectados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearAcumuladorLineas, MAX_BYTES_LINEA } from '../src/sync/peer.ts';

test('peer.test: A-8 el caso normal — líneas completas salen enteras y en orden', () => {
  const a = crearAcumuladorLineas();
  const r = a.alRecibir(Buffer.from('{"a":1}\n{"b":2}\n'));
  assert.strictEqual(r.excedido, false);
  assert.deepStrictEqual(r.lineas, ['{"a":1}', '{"b":2}']);
  assert.strictEqual(a.pendientes(), 0, 'no queda residuo');
});

test('peer.test: A-8 una línea partida en chunks se reensambla', () => {
  const a = crearAcumuladorLineas();
  assert.deepStrictEqual(a.alRecibir(Buffer.from('{"a":')).lineas, []);
  assert.deepStrictEqual(a.alRecibir(Buffer.from('1}')).lineas, []);
  assert.deepStrictEqual(a.alRecibir(Buffer.from('\nresto')).lineas, ['{"a":1}']);
  assert.strictEqual(a.pendientes(), 'resto'.length, 'el residuo queda pendiente');
});

test('peer.test: A-8 un peer que nunca manda \\n se corta al tope, no come la RAM', () => {
  // El ataque: socket abierto, escritura infinita, ningún delimitador. Antes
  // `buffer += chunk.toString()` crecía sin techo. Se usa un tope chico para
  // que el test no aloque 16 MB.
  const tope = 1024;
  const a = crearAcumuladorLineas(tope);

  const chunk = Buffer.alloc(256, 0x41); // 'A' x256, sin un solo '\n'
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(a.alRecibir(chunk).excedido, false, `chunk ${i} todavía cabe`);
  }
  // El quinto pasa el tope.
  const r = a.alRecibir(chunk);
  assert.strictEqual(r.excedido, true, 'se declara excedido');
  assert.deepStrictEqual(r.lineas, [], 'no se entrega nada al procesador');
  assert.strictEqual(a.pendientes(), 0, 'el buffer se descarta: la memoria se libera ya');
});

test('peer.test: A-8 el tope cuenta BYTES, no caracteres', () => {
  // En UTF-8 un carácter puede ocupar 4 bytes. Contar `string.length` dejaría
  // pasar hasta 4x el tope de memoria real.
  const tope = 100;
  const a = crearAcumuladorLineas(tope);
  // 40 caracteres de 4 bytes = 160 bytes, muy por encima de 100.
  const emoji = Buffer.from('🧿'.repeat(40), 'utf8');
  assert(emoji.length > tope);
  assert.strictEqual(a.alRecibir(emoji).excedido, true);
});

test('peer.test: A-8 muchas líneas legítimas grandes NO disparan el tope', () => {
  // El tope es por LÍNEA acumulada, no por conexión: un peer puede mandar el
  // dataset entero, cerrar la línea, y seguir mandando más.
  const tope = 1024;
  const a = crearAcumuladorLineas(tope);
  for (let i = 0; i < 50; i++) {
    const linea = Buffer.from('x'.repeat(500) + '\n');
    const r = a.alRecibir(linea);
    assert.strictEqual(r.excedido, false, `línea ${i} legítima`);
    assert.strictEqual(r.lineas.length, 1);
  }
});

test('peer.test: A-8 el tope por defecto es holgado — enviarPropias manda el dataset en UNA línea', () => {
  // `enviarPropias()` serializa TODAS las observaciones en un solo mensaje
  // JSON terminado en '\n'. Una observación ronda 700-900 bytes, así que el
  // tope tiene que estar en megabytes y no en kilobytes: un tope chico
  // rompería el sync legítimo el día que la base crezca.
  assert(MAX_BYTES_LINEA >= 8 * 1024 * 1024, 'el tope tiene que ser de megabytes');
  assert(MAX_BYTES_LINEA <= 64 * 1024 * 1024, 'pero seguir siendo un techo real');

  // ~20.000 testimonios de 900 bytes tienen que caber.
  assert(MAX_BYTES_LINEA / 900 > 15_000);
});

test('peer.test: A-8 después de excederse el acumulador queda limpio (el socket se destruye igual)', () => {
  // `excedido` es terminal para la conexión: el llamador destruye el socket y
  // no se intenta resincronizar buscando el próximo '\n' — un peer que mandó
  // el tope sin delimitador no está teniendo un problema de red.
  const a = crearAcumuladorLineas(64);
  assert.strictEqual(a.alRecibir(Buffer.alloc(128, 0x41)).excedido, true);
  assert.strictEqual(a.pendientes(), 0);
  // Y si por lo que sea llegara otro chunk antes del destroy, no arrastra
  // basura de la línea abortada.
  assert.deepStrictEqual(a.alRecibir(Buffer.from('{"a":1}\n')).lineas, ['{"a":1}']);
});
