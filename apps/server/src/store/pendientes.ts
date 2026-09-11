/**
 * pendientes.ts — cola de borradores confirmados con una pregunta de
 * seguimiento SIN RESPONDER (`estadoRevision: 'pendiente-de-revision'`).
 *
 * ══════════════ Por qué existe este archivo ══════════════
 *
 * Regla dura del producto: máximo UNA pregunta de seguimiento por nota, y
 * responderla es OPCIONAL — si el usuario no contesta, la nota se guarda
 * igual y queda `pendiente-de-revision`. Nunca se descarta (eso sería un DoS
 * por fricción: el sistema castigando al colaborador por no saber un dato).
 *
 * El problema que resuelve: `store/observations.ts` solo sabe guardar
 * `Observacion[]` confirmadas, y `Observacion` —el contrato congelado,
 * idéntico byte a byte con `apps/mobile`— NO tiene campo para el estado de
 * revisión. Así que al persistir, la distinción se perdía: nada en el store
 * recordaba que esa nota había quedado con una pregunta abierta, aunque la
 * interfaz se lo prometiera al usuario por escrito. Los lotes de equipo
 * sobrevivían; la pregunta pendiente, no.
 *
 * La alternativa era agregar el campo a `core/contracts.ts`. Se descartó: ese
 * archivo se toca solo si cambia el doc maestro, y el cambio habría que
 * replicarlo en las dos apps. No hace falta — porque la app móvil ya resolvió
 * esto mismo con un store aparte (`apps/mobile/src/app/pendientes-store.ts`),
 * y ESE es el punto: este archivo es la contraparte de servidor de ese
 * módulo, con la misma decisión de diseño y el mismo formato (JSONL, append,
 * el `Borrador` entero). Antes el servidor no tenía nada equivalente, y eso
 * era drift real entre las dos superficies: la misma regla dura cumplida en
 * el teléfono e incumplida en el escritorio.
 *
 * Se guarda el `Borrador` COMPLETO y no solo su id: es lo único que conserva
 * la pregunta que quedó abierta junto a las observaciones a las que se
 * refiere. Con el id solo, la pregunta se va con el borrador cuando expira su
 * TTL en memoria (`store/drafts.ts`, 30 min) y queda una referencia a algo
 * que ya no existe.
 *
 * No es una segunda fuente de verdad de la base instalada: las observaciones
 * ya se persistieron por `store/observations.ts` cuando el humano confirmó.
 * Esto es la lista de trabajo pendiente — qué notas conviene volver a
 * visitar, y con qué pregunta.
 */
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import type { Borrador } from '../core/contracts.ts';

const DIR = 'data';
const RUTA = `${DIR}/pendientes.jsonl`;

/**
 * Encola un borrador pendiente de revisión. Append-only, igual que los otros
 * dos stores del proyecto.
 *
 * Mejor esfuerzo a propósito, y esto es una decisión de producto, no
 * pereza: el momento en que se llama es DESPUÉS de que las observaciones ya
 * se persistieron y el usuario ya vio su confirmación. Si el disco falla acá,
 * la alternativa sería hacer fallar una confirmación que en los hechos ya
 * ocurrió — perder el dato bueno por no poder anotar el pendiente. Se
 * devuelve `false` para que el llamador pueda registrarlo en la cadena de
 * auditoría, que es append-only y encadenada por hash: ahí la pérdida queda
 * asentada aunque este archivo no se haya podido escribir.
 */
export async function agregarPendiente(b: Borrador): Promise<boolean> {
  try {
    await mkdir(DIR, { recursive: true });
    await appendFile(RUTA, JSON.stringify(b) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Los borradores pendientes, del más viejo al más nuevo.
 *
 * Carga TOLERANTE, mismo criterio que `store/observations.ts` y
 * `store/audit.ts`: una línea corrupta se descarta y las buenas sobreviven —
 * nunca se pierde la cola entera por una escritura a medias. La guarda de
 * forma es mínima (`id` y `observaciones` como array) porque `Borrador` es un
 * tipo interno, no input de usuario: lo escribe este mismo proceso.
 */
export async function listarPendientes(): Promise<Borrador[]> {
  let contenido: string;
  try {
    contenido = await readFile(RUTA, 'utf8');
  } catch {
    return [];                     // todavía no hubo ninguna nota pendiente
  }
  const out: Borrador[] = [];
  for (const linea of contenido.trim().split('\n')) {
    if (!linea.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(linea);
      if (typeof parsed === 'object' && parsed !== null
        && typeof (parsed as Borrador).id === 'string'
        && Array.isArray((parsed as Borrador).observaciones)) {
        out.push(parsed as Borrador);
      }
    } catch { /* línea corrupta: se descarta, no rompe la cola */ }
  }
  return out;
}

/** Cuántas notas quedaron con una pregunta sin responder. Es el número que la
 *  interfaz puede mostrar como trabajo pendiente — el equivalente de
 *  `contarPendientes()` en la app móvil. */
export async function contarPendientes(): Promise<number> {
  return (await listarPendientes()).length;
}
