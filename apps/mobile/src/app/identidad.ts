import { File, Paths } from 'expo-file-system';
import * as Device from 'expo-device';
import { nuevoId } from '../core/ids.ts';

/**
 * `observadorId` identifica a la PERSONA que dicta/escribe (clave de
 * corroboración en RD-7: dos testimonios del mismo `observadorId` no
 * corroboran nada entre sí). `dispositivoId` identifica el TELÉFONO
 * (clave pública del peer, contracts.ts). Ninguno de los dos existe todavía
 * — no hay login en esta versión — así que se genera uno por instalación y
 * se persiste igual que `observaciones.jsonl` (mismo patrón que
 * `store/expo-store.ts`, sin tocar ese archivo).
 */
const ARCHIVO_IDENTIDAD = new File(Paths.document, 'identidad.json');

interface Identidad {
  observadorId: string;
  dispositivoId: string;
}

let cache: Identidad | null = null;
let cargando: Promise<Identidad> | null = null;

export async function obtenerIdentidad(): Promise<Identidad> {
  if (cache) return cache;
  if (cargando) return cargando;

  cargando = (async () => {
    try {
      if (ARCHIVO_IDENTIDAD.exists) {
        const json = JSON.parse(await ARCHIVO_IDENTIDAD.text()) as Partial<Identidad>;
        if (json.observadorId && json.dispositivoId) {
          cache = { observadorId: json.observadorId, dispositivoId: json.dispositivoId };
          return cache;
        }
      }
    } catch {
      // archivo corrupto o ilegible — se regenera identidad abajo, igual
      // que `store/expo-store.ts` regenera datos ante una línea rota.
    }

    const nueva: Identidad = {
      observadorId: nuevoId(),
      dispositivoId: `${Device.modelName ?? 'android'}-${nuevoId()}`,
    };
    try {
      if (!ARCHIVO_IDENTIDAD.exists) ARCHIVO_IDENTIDAD.create({ intermediates: true });
      ARCHIVO_IDENTIDAD.write(JSON.stringify(nueva));
    } catch {
      // si no se pudo persistir, se sigue con la identidad en memoria por
      // esta sesión — mejor un observadorId inestable que bloquear la app.
    }
    cache = nueva;
    return nueva;
  })();

  try {
    return await cargando;
  } finally {
    cargando = null;
  }
}
