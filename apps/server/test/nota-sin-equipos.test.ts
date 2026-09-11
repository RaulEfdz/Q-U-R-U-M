/**
 * nota-sin-equipos.test.ts — la nota que no describe ningún equipo.
 *
 * «Fui y no vi equipo» es información sobre la base instalada, no un error.
 * Antes el servidor abortaba la extracción con `ValidationError` y la pantalla
 * mostraba «El modelo no pudo estructurar la nota» más una promesa que el
 * producto no podía cumplir: «se puede guardar igual y quedar pendiente de
 * revisión», sin borrador y sin ningún botón para hacerlo.
 *
 * Estos tests fijan la parte que se puede probar SIN modelo: el detector
 * determinista que distingue «no hay nada que extraer» de «había qué extraer
 * y el modelo falló». Esa distinción es la que decide si al usuario se le pide
 * reintentar (útil) o se le dice que no hay nada que reintentar (honesto).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hayIndiciosDeEquipo, resumir } from '../src/qvac/extract.ts';

/* ═══════════ Sin indicios: no hay nada que extraer ═══════════ */

test('sin equipos: un saludo no tiene indicios', () => {
  assert.strictEqual(hayIndiciosDeEquipo('Hola'), false);
  assert.strictEqual(hayIndiciosDeEquipo('buenas, probando'), false);
});

test('sin equipos: una visita donde no había equipo instalado', () => {
  assert.strictEqual(
    hayIndiciosDeEquipo('Fui al hospital y no habia nada instalado todavia'),
    false,
    'no nombra modalidad, ni marca, ni cantidad: no hay nada que extraer');
});

/* ═══════════ Con indicios: el modelo tenía trabajo que hacer ═══════════ */

test('con equipos: una modalidad por sinónimo alcanza', () => {
  for (const texto of [
    'vi un resonador',            // sinónimo de MR
    'habia un tomografo',         // sinónimo de CT
    'tienen eco',                 // sinónimo de Ultrasound
    'sala de rayos x',            // XRay — se detecta por la cifra también
    'MR nuevo',
  ]) {
    assert.strictEqual(hayIndiciosDeEquipo(texto), true, `«${texto}» debería tener indicios`);
  }
});

test('con equipos: una marca del vocabulario ficticio alcanza', () => {
  assert.strictEqual(hayIndiciosDeEquipo('todo el parque es NovaMed'), true);
  assert.strictEqual(hayIndiciosDeEquipo('equipos de Aurelia Health'), true,
    'marca de dos palabras');
});

test('con equipos: una cantidad alcanza, en cifra o en letras', () => {
  assert.strictEqual(hayIndiciosDeEquipo('compraron 3 el año pasado'), true, 'cifra');
  assert.strictEqual(hayIndiciosDeEquipo('compraron tres el año pasado'), true, 'letras');
  assert.strictEqual(hayIndiciosDeEquipo('tienen varios'), true);
});

/* ═══════════ Los falsos positivos que importan ═══════════ */

test('sin equipos: la comparación es por palabra completa, no por subcadena', () => {
  // Fue el bug #11 del pipeline móvil. Un falso positivo acá no es cosmético:
  // manda al usuario a reintentar una extracción que nunca va a producir nada,
  // y encima culpa al modelo de algo que no hizo.
  assert.strictEqual(hayIndiciosDeEquipo('hablamos de la economia del pais'), false,
    '«eco» dentro de «economia» no es un ecógrafo');
  assert.strictEqual(hayIndiciosDeEquipo('hay que monitorear la situacion'), false,
    '«monitor» dentro de «monitorear» no es un monitor de paciente');
});

test('sin equipos: los acentos no cambian la decisión', () => {
  assert.strictEqual(hayIndiciosDeEquipo('vi un ecógrafo'), true);
  assert.strictEqual(hayIndiciosDeEquipo('vi un ecografo'), true);
  assert.strictEqual(hayIndiciosDeEquipo('la economía del país'), false);
});

/* ═══════════ El resumen de un borrador vacío ═══════════ */

test('sin equipos: el resumen no suena a falla', () => {
  const texto = resumir([]);
  assert(texto.length > 0, 'siempre devuelve algo: es lo primero que la persona lee');
  assert(/guardarla|guarda/i.test(texto),
    'dice que se puede guardar — y ahora es verdad, porque /api/confirmar la encola');
  assert(!/error|fall|invalid/i.test(texto),
    'no la trata como un error: una visita sin equipo es un dato válido');
});
