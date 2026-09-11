import {
  loadModel, unloadModel, getLoadedModelInfo,
  WHISPER_BASE_Q8_0, QWEN3_5_0_8B_MULTIMODAL_Q4_K_M, QWEN3_1_7B_INST_Q4,
  VAD_SILERO_5_1_2,
} from '@qvac/sdk';
import { PROMPT_ASR } from '../pipeline/lexico.ts';

/**
 * Identificadores reales verificados contra @qvac/sdk@0.18.2 (apps/mobile/CLAUDE.md).
 * Son OBJETOS descriptores del registro (src, sha256Checksum, expectedSize, modelId),
 * no strings — la fuente del Anexo D usaba 'QWEN3_5_0_8B_INST_Q4', que no existe.
 *
 * ★ ASR — la escalera de whisper, para poder subir o bajar cambiando ESTA línea:
 *
 * | Constante                  | RAM    | Nota                                    |
 * |----------------------------|--------|-----------------------------------------|
 * | `WHISPER_TINY_Q8_0`        |  42 MB | el piso; solo si la RAM aprieta de verdad |
 * | `WHISPER_TINY`             |  74 MB | lo que usábamos hasta v0.5.0            |
 * | `WHISPER_BASE_Q8_0`        |  78 MB | **actual** — +4 MB sobre tiny           |
 * | `WHISPER_SMALL_Q8_0`       | 252 MB | el siguiente escalón real de precisión  |
 * | `WHISPER_SPANISH_TINY_Q8_0`|  42 MB | finetune en español de tiny, sin medir   |
 *
 * `WHISPER_BASE_Q8_0` en vez de `WHISPER_TINY` es el cambio más barato que hay
 * acá: cuesta CUATRO megabytes (78 vs 74) porque el base viene cuantizado a
 * q8_0 y el tiny que traíamos era f16 sin cuantizar, y base es el escalón
 * siguiente de whisper. En un presupuesto donde el extractor solo ya se lleva
 * 1057 MB, no mueve la aguja de la RAM.
 *
 * El siguiente escalón (`WHISPER_SMALL_Q8_0`, +174 MB sobre base) es el que de
 * verdad cambia las cifras, pero hay que MEDIRLO en el teléfono antes de
 * dejarlo: el dictado es en vivo, small decodifica bastante más lento que base
 * y si el texto llega tarde a la pantalla la mejora de precisión no se nota.
 * Cambiar esta línea, correr un dictado y mirar el `ms` del paso «dictando».
 *
 * `WHISPER_SPANISH_TINY_Q8_0` (finetune en castellano, mismo tamaño que tiny)
 * es el otro candidato a probar; no está medido y no hay tarjeta del modelo,
 * por eso no es el default.
 */
export const MODELOS = {
  asr: WHISPER_BASE_Q8_0,
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
 *
 * `initial_prompt` además del idioma mete el vocabulario del dominio (siglas
 * de modalidad y marcas del vocabulario ficticio), que es lo que un modelo
 * chico no conoce. Vive en `pipeline/lexico.ts`, junto al corrector que limpia
 * lo que el prompt no alcanza a arreglar.
 *
 * ★ El resto de los parámetros de decodificación —`strategy`,
 * `beam_search_beam_size`, `no_context`, el fallback por temperatura— están
 * comentados uno por uno abajo, en el objeto. Van todos en el config de CARGA
 * y no por llamada: el driver arma la config de whisper una sola vez, al
 * configurar el modelo (`_buildConfigurationParams` →`_buildWhisperConfig`,
 * `node_modules/@qvac/asr-ggml/engines/whisper/driver.js`), y de ahí la usan
 * tanto `transcribe()` como las sesiones de streaming. Cambiar acá cambia los
 * dos modos.
 *
 * ★ `contextParams.use_gpu`: OBLIGATORIO, mismo motivo que `device: 'gpu'` +
 * `gpu_layers: 99` en `CONFIG` más abajo para portero/extractor — sin esto la
 * inferencia de whisper corre en CPU y una nota de campo tarda mucho más de
 * lo esperable. El shape es DISTINTO al del addon LLM: acá la llave es
 * `contextParams: { use_gpu, flash_attn, gpu_device }`, verificado contra
 * `node_modules/@qvac/asr-ggml/engines/whisper/configChecker.js`
 * (`CONTEXT_PARAM_KEYS`) y `node_modules/@qvac/sdk/dist/schemas/transcription-config.js`.
 * `flash_attn` se deja fuera a propósito: es una llave válida pero sin
 * evidencia de que el backend Vulkan del Mali/Immortalis la soporte bien para
 * whisper — queda como experimento aparte, no parte de este fix.
 *
 * ★ `vadModelSrc` (Silero VAD, ~0.86 MB, negligible en el presupuesto de RAM):
 * hace que whisper.cpp segmente el audio por voz ANTES de transcribir, en
 * vez de procesar silencio como si fuera habla. Es puramente una mejora de
 * calidad/robustez en el modo batch (`transcribe()`, lo que usa
 * `transcribirLocal()`) — pero además es un REQUISITO DURO para abrir una
 * sesión de streaming (`transcribeStream`): sin `vadModelSrc` cargado, el
 * addon tira `VAD_MODEL_REQUIRED` (`node_modules/@qvac/asr-ggml/engines/whisper/driver.js`,
 * `createStreamingSession()`). `vad_params` con los valores de los ejemplos
 * oficiales del SDK (`examples/asr/whispercpp-microphone-conversation.js`,
 * `whispercpp-filesystem-streaming.js`), no inventados — ajustar tras prueba
 * de campo si cortan frases de más o de menos.
 *
 * ★ `no_speech_thold` (el umbral de whisper.cpp para "segmento sin voz") NO
 * va acá: `whisperConfigSchema` de este SDK (0.18.2) no lo declara —
 * verificado contra `node_modules/@qvac/sdk/dist/schemas/transcription-config.js`,
 * que expone `thold_pt`/`thold_ptsum`/`entropy_thold`/`logprob_thold` pero no
 * `no_speech_thold`. Pasarlo tira "Unrecognized key" al cargar el modelo y
 * `loadModel` falla ANTES de grabar nada — el dictado queda roto de punta a
 * punta. La defensa contra alucinación sobre silencio ya la hacen, en código
 * y de forma determinista, `pareceAlucinacion()`/`esFraseBasura()` en
 * `pipeline/dictar.ts` (el VAD la reduce, no la reemplaza — sigue habiendo
 * ruido no-silencioso, como toses o TV de fondo, sobre el que whisper puede
 * seguir alucinando); no hace falta el parámetro del modelo.
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
  audio_format: 's16le',

  /*
   * ★ Estrategia de decodificación: búsqueda en haz, no codicioso.
   *
   * El default de whisper.cpp es `greedy` — en cada paso se queda con el token
   * más probable y no vuelve atrás. Es la razón de una clase entera de errores
   * que en esta app duelen el doble: una sílaba mal resuelta al principio de
   * una palabra arrastra el resto («Blue Pick» en vez de «BluePeak») porque el
   * modelo nunca reconsidera. `beam_search` mantiene 5 hipótesis en paralelo y
   * se queda con la de mejor probabilidad TOTAL de la frase, que es justo lo
   * que hace falta cuando la palabra rara está rodeada de contexto que sí se
   * entendió bien.
   *
   * Cuesta tiempo de decodificación (no de encoder, que es la parte cara y no
   * cambia). Si el dictado en vivo empieza a llegar tarde a la pantalla, esto
   * es lo PRIMERO que hay que bajar —a 3, y después a `greedy`— antes de tocar
   * el modelo: ver el `ms` del paso «dictando» en la pantalla de captura.
   */
  strategy: 'beam_search',
  beam_search_beam_size: 5,

  /*
   * ★ `no_context: true` — cada segmento se decodifica solo.
   *
   * Por default whisper le pasa el texto del segmento anterior como contexto al
   * siguiente. Suena bien y es exactamente el mecanismo por el que se enganchan
   * los bucles de repetición que `pareceAlucinacion()` (`pipeline/dictar.ts`)
   * tiene que salir a atrapar después: una frase inventada entra al contexto,
   * sube su propia probabilidad, y se repite quince veces.
   *
   * Acá el contexto no aporta: una nota de campo son dos o tres frases sueltas
   * («vi dos MR. El CT es nuevo.»), no un discurso donde la coherencia entre
   * segmentos ayude a desambiguar. Y cortarlo tiene una segunda ventaja: con
   * `no_context`, el `initial_prompt` —el vocabulario de marcas y siglas— se
   * vuelve a aplicar en CADA segmento en vez de diluirse detrás del texto ya
   * transcrito.
   */
  no_context: true,

  /*
   * ★ Fallback por temperatura — la defensa que trae el propio whisper.
   *
   * `temperature: 0` sola no alcanza: si la decodificación sale degenerada
   * (entropía alta = bucle de repetición, o log-prob promedio muy bajo = el
   * modelo no entendió nada), whisper puede REINTENTAR el segmento subiendo la
   * temperatura de a `temperature_inc`. Sin `temperature_inc` no hay reintento
   * y el segmento degenerado sale tal cual.
   *
   * Los tres valores son los del whisper original (0.2 / 2.4 / -1.0), no
   * inventados. Y sí: el reintento rompe el determinismo estricto que pide
   * `apps/mobile/CLAUDE.md §Determinismo`, pero SOLO en la rama de fallo —
   * un segmento que decodifica limpio a temperatura 0 sigue siendo
   * reproducible. Cambiar una alucinación determinista por una transcripción
   * no determinista es el negocio correcto.
   */
  temperature_inc: 0.2,
  entropy_thold: 2.4,
  logprob_thold: -1.0,

  contextParams: { use_gpu: true, gpu_device: 0 },
  vadModelSrc: VAD_SILERO_5_1_2,
  vad_params: {
    /*
     * `threshold` 0.6 → 0.5 (el default de Silero, y el que usa el propio
     * driver en modo streaming: `DEFAULT_STREAMING_VAD_CONFIG.vadThreshold`).
     * A 0.6 el VAD exige bastante energía para declarar «esto es voz», y lo
     * que se pierde no es ruido: es el ARRANQUE de la frase, que es la parte
     * más floja de una nota dictada de pie en un pasillo. Con la primera
     * palabra recortada, «dos MR» llega como «MR» — y la cantidad es
     * justamente uno de los campos que después reconcilia el quórum.
     */
    threshold: 0.5,
    min_speech_duration_ms: 250,
    min_silence_duration_ms: 500,
    /*
     * 15 s → 20 s. Es un corte DURO: al llegar al tope el VAD cierra el
     * segmento esté donde esté, y si cae a mitad de «BluePeak Medical» whisper
     * decodifica dos mitades sin sentido. Una frase de nota rara vez pasa de
     * 20 s, así que el tope casi no se toca; cuando se toca, corta menos veces.
     */
    max_speech_duration_s: 20.0,
    /*
     * 200 → 300 ms de colchón a cada lado del segmento detectado. El VAD marca
     * dónde hay energía de voz, no dónde empieza la PALABRA: las consonantes
     * iniciales sordas (la «c» de «CT», la «p» de «paciente») tienen poca
     * energía y quedan del lado de afuera del corte.
     */
    speech_pad_ms: 300,
    /*
     * Solapa 0.1 s entre segmentos consecutivos, para que una palabra partida
     * por el corte aparezca entera en al menos uno de los dos. Es el default
     * del driver en streaming; acá se declara para que el modo archivo
     * (`transcribirLocal`) lo tenga también.
     */
    samples_overlap: 0.1,
  },
  /*
   * Fuente única en `pipeline/lexico.ts`. OJO: este `initial_prompt` NO
   * sobrevive a la primera nota — el SDK, cuando `transcribe()`/
   * `transcribeStream()` reciben `prompt`, recarga el modelo y al terminar lo
   * deja en cadena vacía (ver el comentario de `PROMPT_ASR`). Queda acá para
   * que el modelo arranque bien configurado; el que gobierna de la primera
   * nota en adelante es el que pasa `dictar.ts`, y por eso es el mismo.
   */
  initial_prompt: PROMPT_ASR,
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
 * Precarga asr + portero + extractor a memoria/GPU en segundo plano, para que
 * la primera nota no pague la carga (portero ~11 s + extractor ~13 s en el
 * Pixel 8 Pro; whisper+VAD es liviano, ~79 MB, mucho más rápido de cargar).
 * Se llama una vez al montar la app (`App.tsx`).
 *
 * - **Fire-and-forget:** los errores se loguean y no rompen nada. Si un
 *   modelo falla acá, `obtener()` lo reintenta cuando el pipeline lo pida
 *   de verdad, y `CapturarScreen` muestra el error ahí si persiste.
 * - **Idempotente:** el cache y el mapa `enVuelo` de `obtener()` hacen que
 *   llamarla dos veces, o llamarla mientras el usuario ya tocó "Interpretar"
 *   o "Dictar", no dispare cargas duplicadas — la segunda espera a la primera.
 * - **Secuencial** (asr, portero y después extractor): asr primero porque es
 *   el más liviano y el que hace falta apenas el usuario toca el micrófono;
 *   portero y extractor en el mismo orden que usa `procesarNota`, y evita
 *   crear varios contextos Vulkan a la vez en el Mali.
 * - `asr` ya está integrado (dictado por voz, Fase 11) — precargarlo evita
 *   que la primera nota de voz pague la carga del modelo además de la
 *   inferencia. `ORDEN_EVICTION` ya lo libera primero bajo presión de RAM, así
 *   que el riesgo de competir por memoria con portero/extractor es acotado.
 */
export async function precargarModelos(): Promise<void> {
  for (const rol of ['asr', 'portero', 'extractor'] as const) {
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
