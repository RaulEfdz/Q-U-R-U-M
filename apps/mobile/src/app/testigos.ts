import type { Naturaleza, Observacion } from '../core/contracts.ts';

/**
 * Los `observadorId` son ids opacos de ~20 caracteres (`core/ids.ts`).
 * Mostrarlos crudos en Cliente 360 hace ilegible justo lo que la pantalla
 * tiene que comunicar: QUIÉN dijo cada versión cuando un campo queda en
 * `Sin quórum`. Este módulo les asigna una etiqueta corta y estable dentro
 * de un grupo, y recupera la naturaleza de su testimonio (eje 1).
 *
 * No hay login en esta versión (ver `identidad.ts`), así que "Vos" se
 * resuelve comparando contra el `observadorId` de esta instalación.
 */
export interface Testigo {
  id: string;
  etiqueta: string;
  /** Eje 1 · naturaleza del testimonio MÁS RECIENTE de este observador.
   *  Mismo criterio que RD-3 en `trust/reconcile.ts`: un observador cuenta
   *  una vez, con lo último que dijo. */
  naturaleza: Naturaleza;
  hedging: boolean;
  esVos: boolean;
}

/** A, B, C… y a partir de la 27ª, A2, B2… (nunca dos etiquetas iguales). */
function letra(i: number): string {
  const base = String.fromCharCode(65 + (i % 26));
  const vuelta = Math.floor(i / 26);
  return vuelta === 0 ? base : `${base}${vuelta + 1}`;
}

/**
 * Ordena por primera aparición cronológica para que la etiqueta no baile
 * entre renders: el que testificó primero es siempre A.
 */
export function mapaTestigos(obs: Observacion[], observadorIdLocal: string): Map<string, Testigo> {
  const ultimoPorObs = new Map<string, Observacion>();
  const primeraVisita = new Map<string, string>();

  for (const o of [...obs].sort((a, b) => a.visitadoEn.localeCompare(b.visitadoEn))) {
    ultimoPorObs.set(o.observadorId, o); // el último gana: orden ascendente
    if (!primeraVisita.has(o.observadorId)) primeraVisita.set(o.observadorId, o.visitadoEn);
  }

  const ordenados = [...ultimoPorObs.keys()].sort((a, b) =>
    (primeraVisita.get(a) ?? '').localeCompare(primeraVisita.get(b) ?? '') || a.localeCompare(b));

  const mapa = new Map<string, Testigo>();
  // El contador de letras avanza SOLO con los testigos que llevan letra: si
  // usara el índice de `ordenados`, el lugar que ocupa "Vos" se saltearía y
  // la lista mostraría un "Testigo B" sin que exista ningún "Testigo A" —
  // se lee como si faltara un testimonio.
  let siguiente = 0;
  for (const id of ordenados) {
    const ultimo = ultimoPorObs.get(id)!;
    const esVos = id === observadorIdLocal;
    mapa.set(id, {
      id,
      etiqueta: esVos ? 'Vos' : `Testigo ${letra(siguiente++)}`,
      naturaleza: ultimo.naturaleza,
      hedging: ultimo.hedging,
      esVos,
    });
  }
  return mapa;
}

/** Para un id que no está en el mapa (no debería pasar, pero la UI no puede
 *  romperse por eso): se muestra el id recortado en vez de `undefined`. */
export function etiquetaDe(mapa: Map<string, Testigo>, id: string): string {
  return mapa.get(id)?.etiqueta ?? `${id.slice(0, 6)}…`;
}
