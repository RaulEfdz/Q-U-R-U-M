import { File, Paths } from 'expo-file-system';
import type { Borrador } from '../core/contracts.ts';

/**
 * Cola de borradores con `estadoRevision: 'pendiente-de-revision'` — la
 * pregunta de seguimiento que el usuario no contestó. `store/expo-store.ts`
 * (congelado, de otro agente) solo sabe guardar `Observacion[]` confirmadas;
 * no tiene lugar para un `Borrador` entero con su pregunta sin responder.
 * Sin este archivo, "nunca se descarta la nota" sería cierto solo para los
 * lotes de equipo, no para la pregunta que quedó pendiente — se perdería
 * al cerrar la app. Mismo patrón de archivo que expo-store.ts (JSONL,
 * append), deliberadamente en un archivo propio para no tocar ese módulo.
 */
const ARCHIVO = new File(Paths.document, 'pendientes.jsonl');

export async function agregarPendiente(borrador: Borrador): Promise<void> {
  try {
    const linea = JSON.stringify(borrador) + '\n';
    if (!ARCHIVO.exists) ARCHIVO.create({ intermediates: true });
    ARCHIVO.write(linea, { append: true });
  } catch {
    // Mejor esfuerzo: si ni esto se puede persistir, el borrador sigue
    // visible en la sesión actual (el llamador no pierde el estado en
    // memoria), aunque no sobreviva a un cierre de la app.
  }
}

export async function contarPendientes(): Promise<number> {
  try {
    if (!ARCHIVO.exists) return 0;
    const txt = await ARCHIVO.text();
    return txt.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}
