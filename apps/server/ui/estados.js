/**
 * estados.js — los DOS EJES de confianza, y su tratamiento visual.
 *
 * Eje 2 · Quórum (por campo): `Sin datos` → `Estimado` → `Reportado` →
 * `Quórum`, más `Sin quórum` cuando los testimonios discrepan. Glifos y
 * colores literales de §II.20 del doc maestro.
 *
 * El color codifica confianza y NADA MÁS, y nunca es el único portador de
 * significado: cada estado sale siempre como glifo + etiqueta + color.
 * Accesibilidad, y robustez ante la compresión del video.
 *
 * FRESCURA NO ESTÁ ACÁ A PROPÓSITO. Es un eje distinto (cuándo se verificó
 * por última vez, RD-6: desde `visitadoEn`, no desde `capturadaEn`), y
 * pintarla con el color de un estado de confianza es —según §B.2— el error
 * de diseño más fácil de cometer en esta pantalla. Va con su propio token
 * (`--frescura`, deliberadamente fuera de la rampa de confianza) y su
 * propio glifo (`◷`). Ver `insigniaFrescura()`.
 */
import { h } from './dom.js';

const INFO = {
  'Quórum':     { glifo: '●', clase: 'ok' },
  'Reportado':  { glifo: '◐', clase: 'medio' },
  'Estimado':   { glifo: '○', clase: 'bajo' },
  'Sin datos':  { glifo: '·', clase: 'nulo' },
  'Sin quórum': { glifo: '▲', clase: 'sinquorum' },
};
const DESCONOCIDO = { glifo: '·', clase: 'nulo' };

/*
 * El ORDEN de la escalera (`Sin datos` → `Estimado` → `Reportado` →
 * `Quórum`) vive en el motor, no acá: la UI no compara estados entre sí, y
 * `Sin quórum` no está en esa escalera de todos modos — no es "menos que
 * Reportado", es una categoría aparte (RD-2). Esta pantalla solo necesita
 * saber cómo se pinta cada estado, y el glifo nunca sale suelto: siempre va
 * dentro de la insignia, junto a su etiqueta y su color.
 */
export const claseEstado = (estado) => (INFO[estado] ?? DESCONOCIDO).clase;

/** Insignia de estado de quórum: glifo + etiqueta + color. Los tres. */
export function insignia(estado) {
  const info = INFO[estado] ?? DESCONOCIDO;
  return h('span', { clase: `badge ${info.clase}` },
    h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: info.glifo }),
    h('span', { texto: estado }));
}

/** ¿Este cambio de estado es el ASCENSO A QUÓRUM? Es la única transición
 *  animada de toda la app (600 ms, §B.3) y el pico del video. */
export function esAscensoAQuorum(anterior, actual) {
  return actual === 'Quórum' && anterior !== undefined && anterior !== 'Quórum';
}

/* ─────────────── Eje de FRESCURA (independiente del anterior) ─────────────── */

/**
 * Texto de frescura, o `null` si el campo está fresco o no hay nada que
 * fechar. Nunca devuelve color de estado: quien lo pinta usa `.frescura`.
 */
export function textoFrescura(campo) {
  if (!campo || campo.estado === 'Sin datos' || campo.fresco) return null;
  const visita = campo.ultimaVisita;
  if (!visita || visita === 'nunca') return 'sin fecha de visita';
  const ms = Date.now() - new Date(visita).getTime();
  if (!Number.isFinite(ms)) return 'sin verificar recientemente';
  const dias = Math.max(0, Math.floor(ms / 86_400_000));
  const meses = Math.floor(dias / 30);
  return meses >= 1
    ? `sin verificar desde hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`
    : `sin verificar desde hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/** Insignia de frescura. Glifo propio (`◷`) y color propio: el lector no
 *  debe poder confundir "está sin verificar" con "no tiene quórum". */
export function insigniaFrescura(campo) {
  const texto = textoFrescura(campo);
  if (!texto) return null;
  return h('span', { clase: 'frescura', title: 'Frescura: cuándo se verificó por última vez. Eje distinto del estado de confianza.' },
    h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: '◷' }),
    h('span', { texto }));
}
