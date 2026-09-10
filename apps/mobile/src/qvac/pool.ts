import {
  loadModel, unloadModel, getLoadedModelInfo,
  WHISPER_TINY, QWEN3_5_0_8B_MULTIMODAL_Q4_K_M, QWEN3_1_7B_INST_Q4,
} from '@qvac/sdk';

/**
 * Identificadores reales verificados contra @qvac/sdk@0.18.2 (apps/mobile/CLAUDE.md).
 * Son OBJETOS descriptores del registro (src, sha256Checksum, expectedSize, modelId),
 * no strings — la fuente del Anexo D usaba 'QWEN3_5_0_8B_INST_Q4', que no existe.
 */
export const MODELOS = {
  asr: WHISPER_TINY,
  portero: QWEN3_5_0_8B_MULTIMODAL_Q4_K_M,
  extractor: QWEN3_1_7B_INST_Q4,
} as const;

export type Rol = keyof typeof MODELOS;
const ROLES: readonly Rol[] = ['asr', 'portero', 'extractor'] as const;

/** ctx_size pequeño a propósito: una nota de campo son 2 o 3 frases.
 *  Un contexto grande gasta RAM que en un teléfono no sobra. */
const CONFIG: Partial<Record<Rol, Record<string, unknown>>> = {
  portero: { ctx_size: 1024 },
  extractor: { tools: true, ctx_size: 2048 },
};

/**
 * Presupuesto de RAM — apps/mobile/CLAUDE.md §Presupuesto de memoria.
 * expectedSize de cada descriptor + margen fijo de runtime/KV cache.
 * 8 GB de RAM total: los tres caben. 6 GB: liberar 'asr' bajo presión
 * (whisper solo se usa para transcribir, no vuelve a usarse hasta la
 * próxima nota de voz).
 */
const MARGEN_RUNTIME_BYTES = 450 * 1024 * 1024; // KV cache (~150MB) + runtime Expo/JS/UI (~300MB)

/** Prioridad de eviction bajo presión: 'asr' se libera primero (es el
 *  que menos falta hace mantener caliente entre notas), después
 *  'portero' (más chico y más barato de recargar que 'extractor'). */
const ORDEN_EVICTION: readonly Rol[] = ['asr', 'portero', 'extractor'] as const;

interface Entrada { modelId: string; ultimoUso: number; }

const cargados = new Map<Rol, Entrada>();

/**
 * Corrección #7 (apps/mobile/CLAUDE.md): el Map solo no alcanza. Dos
 * `obtener()` concurrentes para el mismo rol, antes de que el primero
 * termine, cargarían el mismo modelo de 1.1 GB dos veces → OOM. Este mapa
 * de promesas en vuelo hace que la segunda llamada espere a la primera
 * en vez de disparar su propio `loadModel`.
 */
const enVuelo = new Map<Rol, Promise<string>>();

function ramPresupuestoBytes(ramTotalBytes: number): number {
  return Math.max(0, ramTotalBytes - MARGEN_RUNTIME_BYTES);
}

function ramUsadaBytes(excluir?: Rol): number {
  let total = 0;
  for (const rol of cargados.keys()) {
    if (rol === excluir) continue;
    total += MODELOS[rol].expectedSize;
  }
  return total;
}

/**
 * Libera modelos (en orden de `ORDEN_EVICTION`, nunca el que se está por
 * cargar) hasta que quepa `necesarios` bytes dentro de `presupuesto`.
 * No libera nada si ya entra.
 */
async function liberarBajoPresion(
  necesarios: number, presupuesto: number, rolQueEntra: Rol,
): Promise<void> {
  for (const candidato of ORDEN_EVICTION) {
    if (candidato === rolQueEntra) continue;
    if (ramUsadaBytes(rolQueEntra) + necesarios <= presupuesto) return;
    if (cargados.has(candidato)) await liberar(candidato);
  }
}

/**
 * @param ramTotalBytes RAM total del dispositivo (para calcular el
 *   presupuesto disponible). Si se omite, no aplica eviction por presión
 *   — asume que el llamador ya sabe que hay margen (ej. tests).
 */
export async function obtener(rol: Rol, ramTotalBytes?: number): Promise<string> {
  const existente = cargados.get(rol);
  if (existente) { existente.ultimoUso = Date.now(); return existente.modelId; }

  const yaEnVuelo = enVuelo.get(rol);
  if (yaEnVuelo) return yaEnVuelo;

  const promesa = (async () => {
    if (ramTotalBytes !== undefined) {
      await liberarBajoPresion(
        MODELOS[rol].expectedSize, ramPresupuestoBytes(ramTotalBytes), rol);
    }

    // switch explícito (no una llamada genérica sobre `MODELOS[rol]`): con
    // `rol` como unión, TS no resuelve el overload de `loadModel` contra el
    // descriptor correcto y cae al overload de reload-config. Una rama por
    // literal deja que cada llamada infiera su propio tipo.
    const modelId = await (async () => {
      switch (rol) {
        case 'asr':
          return loadModel({ modelSrc: MODELOS.asr });
        case 'portero':
          return loadModel({ modelSrc: MODELOS.portero, modelConfig: CONFIG.portero! });
        case 'extractor':
          return loadModel({ modelSrc: MODELOS.extractor, modelConfig: CONFIG.extractor! });
      }
    })();

    // Aserción del plano de control: en el teléfono NADA se delega.
    // Corrección #5: `if (info.isDelegated)` es fail-open — si el SDK no
    // devuelve el campo, `undefined` es falsy y la carga pasa. La política
    // exige local: cualquier cosa que no sea `false` explícito, rechaza.
    const info = await getLoadedModelInfo({ modelId });
    if (info.isDelegated !== false) {
      await unloadModel({ modelId });
      throw new Error(`El modelo ${rol} resultó delegado (o el SDK no confirmó que es local) y la política exige local`);
    }

    cargados.set(rol, { modelId, ultimoUso: Date.now() });
    return modelId;
  })();

  enVuelo.set(rol, promesa);
  try {
    return await promesa;
  } finally {
    enVuelo.delete(rol);
  }
}

/** Se llama tras transcribir en dispositivos con poca RAM. */
export async function liberar(rol: Rol): Promise<void> {
  const e = cargados.get(rol);
  if (!e) return;
  await unloadModel({ modelId: e.modelId });
  cargados.delete(rol);
}

export async function liberarTodo(): Promise<void> {
  for (const rol of [...cargados.keys()]) await liberar(rol);
}

/** Para diagnóstico/UI: qué hay cargado y cuánta RAM estima ocupar. */
export function estado(): { rol: Rol; modelId: string; expectedSize: number }[] {
  return ROLES
    .filter((r) => cargados.has(r))
    .map((r) => ({ rol: r, modelId: cargados.get(r)!.modelId, expectedSize: MODELOS[r].expectedSize }));
}
