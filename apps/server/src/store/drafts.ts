// drafts.ts — H-03. Borradores EN MEMORIA, nunca a disco.
//
// Regla dura del monorepo (../../CLAUDE.md raíz): "nada se persiste sin
// confirmación humana". Todo lo que el modelo extrae es borrador hasta que
// `/api/confirmar` lo valida (contra `zObservacion`) y lo pasa a
// `store/observations.ts`. Este archivo NO tiene función de escritura a
// disco a propósito — si algún día hace falta persistir un borrador, es una
// decisión de producto que rompe esta regla y tiene que pasar por el equipo,
// no colarse acá como "optimización".
import type { Borrador } from '../core/contracts.ts';

const borradores = new Map<string, Borrador>();
const temporizadores = new Map<string, NodeJS.Timeout>();
const TTL_MS = 30 * 60_000;

/** Guarda (o reemplaza) un borrador y (re)arranca su TTL. `unref()` para que
 *  el timer no mantenga vivo el proceso en tests/scripts cortos. */
export function guardarBorrador(b: Borrador): void {
  const previo = temporizadores.get(b.id);
  if (previo) clearTimeout(previo);
  borradores.set(b.id, b);
  const t = setTimeout(() => {
    borradores.delete(b.id);
    temporizadores.delete(b.id);
  }, TTL_MS);
  t.unref();
  temporizadores.set(b.id, t);
}

export const obtenerBorrador = (id: string): Borrador | undefined => borradores.get(id);

/** Descarta un borrador antes de tiempo (usuario rechaza, o `/api/confirmar`
 *  lo promovió a `Observacion` y ya no hace falta mantenerlo en memoria). */
export function descartarBorrador(id: string): boolean {
  const t = temporizadores.get(id);
  if (t) {
    clearTimeout(t);
    temporizadores.delete(id);
  }
  return borradores.delete(id);
}
