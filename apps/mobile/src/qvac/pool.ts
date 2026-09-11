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
 *  Un contexto grande gasta RAM que en un teléfono no sobra.
 *
 *  `device: 'gpu'` + `gpu_layers: 99`: OBLIGATORIO. Sin esto la inferencia
 *  corre en CPU (`dev=cpu` en `diagModelo`) a 0.5-1.4 tok/s → ~4 min por
 *  nota. El plugin LLM de QVAC NO aplica los defaults de `LLM_CONFIG_DEFAULTS`
 *  (`gpu_layers: 99, device: 'gpu'`) — su `loadConfigSchema` es
 *  `llmConfigBaseSchema` (sin `.transform`), así que si no lo pasás explícito
 *  el addon arranca en CPU. Con esto, el backend Vulkan
 *  (`libqvac-ggml-vulkan.so`, está en el APK) engancha en el Immortalis-G715
 *  del Pixel 8 Pro: `dev=gpu`, portero 17 tok/s, extractor 11 tok/s (verificado
 *  2026-09-10). El doc dice "Adreno 800+" pero el Mali/Immortalis funciona
 *  forzándolo.
 *
 *  NOTA: NO poner `reasoning_budget` acá — en el config de LOAD tira
 *  `Cannot read property 'reload' of undefined` (el addon Bare intenta un
 *  `model.reload()` con el handle sin crear). El apagado de razonamiento va
 *  por request en `generationParams` + `/no_think` en el prompt. */
const CONFIG: Partial<Record<Rol, Record<string, unknown>>> = {
  portero: { ctx_size: 1024, device: 'gpu', gpu_layers: 99 },
  extractor: { tools: true, ctx_size: 2048, device: 'gpu', gpu_layers: 99 },
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
/**
 * ★ Configuración de whisper. Lo importante es `language: 'es'`.
 *
 * Sin esto whisper AUTODETECTA el idioma, y con audio corto o flojo elige mal:
 * medido en el Pixel, sobre una grabación en silencio devolvió una frase en
 * INGLÉS repetida quince veces. Un `initial_prompt` en castellano ayuda pero
 * es solo una pista — el idioma se fija acá, al cargar el modelo, y
 * `detect_language: false` apaga la detección para que no lo pise.
 *
 * El resto son defensas contra el mismo modo de falla del modelo:
 *   `suppress_blank` / `suppress_nst`  no emitir sobre silencio ni sobre
 *                                     segmentos sin habla
 *   `temperature: 0`                   determinismo, igual que en el resto
 *                                     del pipeline
 *   `no_speech_thold`                  umbral por encima del cual un segmento
 *                                     se considera sin voz
 *
 * `initial_prompt` se queda igual: además del idioma, mete el vocabulario del
 * dominio (siglas de modalidad y las marcas del vocabulario ficticio), que es
 * lo que un modelo tiny no conoce.
 */
const CONFIG_ASR = {
  /*
   * ★ `translate: false` — ESTE era el problema real.
   *
   * whisper tiene dos tareas: `transcribe` (texto en el idioma hablado) y
   * `translate` (traduce SIEMPRE al inglés). Sin declararlo, tomaba el default
   * y traducía: se le hablaba en español y devolvía inglés. No era detección
   * de idioma fallando — era el modelo haciendo bien un trabajo que nadie le
   * pidió.
   *
   * Con `language: 'es'` sin `translate: false`, whisper entiende que la
   * ENTRADA es español y traduce la salida al inglés igual. Los dos parámetros
   * hacen falta: uno dice en qué idioma se habla, el otro que no lo traduzca.
   */
  translate: false,
  language: 'es',
  detect_language: false,
  suppress_blank: true,
  suppress_nst: true,
  temperature: 0,
  no_speech_thold: 0.6,
  initial_prompt:
    'Nota de campo en español sobre equipos médicos instalados en un hospital. ' +
    'Modalidades: MR, CT, ecógrafo, rayos X, monitor de paciente. ' +
    'Marcas: NovaMed, Aurelia Health, BluePeak Medical, Orion Imaging, HelixCare, Zenith MedTech.',
} as const;

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
          return loadModel({ modelSrc: MODELOS.asr, modelConfig: CONFIG_ASR });
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

/** ¿Está el rol listo para procesar YA (cargado, no solo en vuelo)? */
export function estaListo(rol: Rol): boolean {
  return cargados.has(rol);
}

/**
 * Precarga portero + extractor a memoria/GPU en segundo plano, para que la
 * primera nota no pague los ~25 s de carga (portero ~11 s + extractor ~13 s
 * en el Pixel 8 Pro). Se llama una vez al montar la app (`App.tsx`).
 *
 * - **Fire-and-forget:** los errores se loguean y no rompen nada. Si un
 *   modelo falla acá, `obtener()` lo reintenta cuando el pipeline lo pida
 *   de verdad, y `CapturarScreen` muestra el error ahí si persiste.
 * - **Idempotente:** el cache y el mapa `enVuelo` de `obtener()` hacen que
 *   llamarla dos veces, o llamarla mientras el usuario ya tocó "Interpretar",
 *   no dispare cargas duplicadas — la segunda espera a la primera.
 * - **Secuencial** (portero y después extractor): es el mismo orden que usa
 *   `procesarNota`, deja el portero (el que se usa primero) listo antes, y
 *   evita crear dos contextos Vulkan a la vez en el Mali.
 * - No precarga `asr` (whisper): el dictado todavía no está integrado.
 */
export async function precargarModelos(): Promise<void> {
  for (const rol of ['portero', 'extractor'] as const) {
    if (cargados.has(rol)) continue;
    try {
      const t = Date.now();
      await obtener(rol);
      // eslint-disable-next-line no-console
      console.log(`[QUÓRUM·precarga] ${rol} listo en ${Date.now() - t} ms`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[QUÓRUM·precarga] ${rol} falló (se reintenta al usarlo): ` +
        (e instanceof Error ? e.message : String(e)),
      );
    }
  }
}
