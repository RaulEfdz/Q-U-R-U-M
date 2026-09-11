import test from 'node:test';
import assert from 'node:assert/strict';
import { corregirLexico } from '../src/pipeline/lexico.ts';

/**
 * Corrección léxica post-ASR (`pipeline/lexico.ts`).
 *
 * Los casos de entrada NO son inventados a gusto: son las formas en que un
 * whisper chico escribe este vocabulario en castellano — siglas deletreadas
 * («ce te»), marcas partidas («Blue Peak Medical»), marcas fonéticas («Senit
 * Medtec»). El grupo «no toca lo que no es suyo» es el que importa de verdad:
 * la nota la confirma la persona como propia, así que un falso positivo acá le
 * mete en la boca algo que no dijo.
 */

function corregido(t: string): string { return corregirLexico(t).texto; }

test('siglas deletreadas vuelven a su forma canónica', () => {
  assert.equal(corregido('vi dos ce te nuevos'), 'vi dos CT nuevos');
  assert.equal(corregido('un eme erre del 2019'), 'un MR del 2019');
  assert.equal(corregido('hay tres rayos equis'), 'hay tres rayos X');
});

test('la sigla con puntos se normaliza y conserva el cierre de la frase', () => {
  // Sin esto, el `\bct\b` de precheck.ts no matchea «C.T.» y la nota se va
  // sin indicios.
  assert.equal(corregido('el C.T. es nuevo.'), 'el CT es nuevo.');
  assert.equal(corregido('trajeron un M.R.'), 'trajeron un MR.');
});

test('marcas partidas o pegadas se unifican', () => {
  assert.equal(corregido('equipo Nova Med viejo'), 'equipo NovaMed viejo');
  assert.equal(corregido('dos novamed'), 'dos NovaMed');
  assert.equal(corregido('un Helix Care'), 'un HelixCare');
});

test('marcas mal oídas se corrigen por similitud', () => {
  assert.equal(corregido('tres Blue Pick Medical'), 'tres BluePeak Medical');
  assert.equal(corregido('un Senit Medtec'), 'un Zenith MedTech');
  assert.equal(corregido('el Orion Imaching'), 'el Orion Imaging');
});

test('la ventana más larga gana', () => {
  // «Blue Peak» solo también matchearía; tiene que ganar la de tres palabras.
  assert.equal(corregido('Blue Peak Medical'), 'BluePeak Medical');
});

test('no se come la palabra de al lado', () => {
  // Regresión del barrido ingenuo (izquierda a derecha, ventana más larga
  // primero): «un Helix Care» da 0.939 contra «HelixCare» —una palabra de más
  // casi no mueve el Jaro-Winkler— y disparaba ANTES de que se probara «Helix
  // Care», que da 1.000. El artículo desaparecía de la nota.
  assert.equal(corregido('un Helix Care'), 'un HelixCare');
  assert.equal(corregido('dos Nova Med'), 'dos NovaMed');
  assert.equal(corregido('el Orion Imaging'), 'el Orion Imaging');
});

test('devuelve qué cambió, para poder mostrárselo a la persona', () => {
  const r = corregirLexico('dos ce te Nova Med');
  assert.deepEqual(r.correcciones, [
    { desde: 'ce te', hasta: 'CT' },
    { desde: 'Nova Med', hasta: 'NovaMed' },
  ]);
});

test('es idempotente: sobre su propia salida no cambia ni registra nada', () => {
  const una = corregirLexico('vi dos ce te y un Blue Pick Medical');
  const dos = corregirLexico(una.texto);
  assert.equal(dos.texto, una.texto);
  assert.deepEqual(dos.correcciones, []);
});

test('no toca lo que no es suyo', () => {
  // Ninguna de estas palabras pertenece al vocabulario cerrado. Si alguna se
  // convierte en marca o sigla, el corrector está inventando testimonio.
  for (const frase of [
    'me dijeron que estaba nuevo',
    'la sala de espera es chica',
    'no vi ningún equipo de imagen',
    'compramos tres el año pasado',
    'el monitor de paciente no enciende',
    'nueva medida de seguridad en el pasillo',
    'hablé con la jefa de enfermería',
  ]) {
    assert.equal(corregido(frase), frase, `no debía tocar: "${frase}"`);
  }
});

test('conserva espaciado, puntuación y el texto entre correcciones', () => {
  assert.equal(
    corregido('Visita al Hospital San José. Vi dos ce te, un Nova Med y nada más.'),
    'Visita al Hospital San José. Vi dos CT, un NovaMed y nada más.',
  );
});

test('texto vacío o solo espacios no rompe nada', () => {
  assert.equal(corregido(''), '');
  assert.equal(corregido('   '), '   ');
  assert.deepEqual(corregirLexico('').correcciones, []);
});
