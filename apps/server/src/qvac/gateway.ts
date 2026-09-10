/**
 * ★ La única puerta al SDK. Ningún otro módulo importa `@qvac/sdk` directo.
 *
 * Verificado contra apps/mobile/node_modules/@qvac/sdk@0.18.2/dist/**\/*.d.ts
 * (mismo SDK, misma versión pineada en ../../CLAUDE.md). Usamos `events`/`final`,
 * nunca `tokenStream`/`toolCallStream` (deprecados, ver doc del SDK).
 *
 * Corrección #4 de ../../CLAUDE.md: las tools se declaran como `Tool` (el tipo
 * exportado por el SDK, forma JSON-Schema-like), no como Zod crudo. El SDK
 * acepta también `ToolInput` (Zod) y lo convierte con `convertToolInput`, pero
 * esa conversión es un *best-effort* superficial (solo mira las keys de primer
 * nivel del shape, no soporta `items` de array ni objetos anidados, y su
 * detección de opcionalidad/enum depende de la forma interna de Zod v4) — no
 * es apta para el schema de extracción real, que tiene un array de objetos
 * anidados (`lotes`). Construimos el `Tool` a mano en `extract.ts` y usamos
 * Zod solo para validar en runtime lo que el modelo devuelve.
 */
import {
  loadModel, completion, unloadModel,
  getLoadedModelInfo, getModelInfo, heartbeat, transcribe,
} from '@qvac/sdk';
import type { Tool, LoadModelOptions } from '@qvac/sdk';

export interface RutaInferencia {
  readonly modelId: string;
  readonly delegado: boolean;
  readonly modeloSha256?: string;
}

/**
 * modelSrc de un modelo built-in: ruta/URL (string) o descriptor de registro
 * del SDK (objeto, p. ej. `WHISPER_TINY`, `QWEN3_1_7B_INST_Q4`).
 *
 * Deliberadamente permisivo (no indexado en `LoadModelOptions['modelSrc']`
 * ni derivado de `Parameters<typeof loadModel>[0]`): `loadModel` está
 * sobrecargado 4 veces (una de ellas genérica por descriptor) con un
 * `modelSrc`/`modelConfig` propio por cada tipo de modelo (llm, whisper,
 * embeddings, nmt, tts, …). Indexar sobre la unión completa de
 * `LoadModelOptions` no preserva qué campos de `modelConfig` van con qué
 * `modelSrc` — el compilador termina intentando encajar nuestro
 * `modelConfig` de LLM contra el arm de whisper y viceversa. Se resuelve acá
 * con un tipo local ancho y un cast puntual a `LoadModelOptions` en cada
 * llamada real a `loadModel` (ver `cargarLLMLocal`/`cargarLLMDelegado`/
 * `cargarASR`) — el único lugar del proyecto que toca el SDK.
 */
export type ModeloSrc = string | Record<string, unknown>;
export type ModeloLLM = ModeloSrc;
export type ModeloASR = ModeloSrc;

let cacheLLMLocal: RutaInferencia | null = null;
// Corrección #15 de ../../CLAUDE.md: cargarLLMDelegado no cacheaba y se
// llamaba por request → fuga de instancias. Se cachea por par
// (modelSrc, providerPublicKey): un proveedor distinto es una ruta distinta.
const cacheLLMDelegado = new Map<string, RutaInferencia>();
let cacheASR: string | null = null;

/** Promesas en vuelo para no cargar el mismo modelo dos veces en paralelo
 *  (dos requests concurrentes a /api/observar antes de que la primera termine
 *  de cargar). Mismo espíritu que la corrección #7 de mobile/CLAUDE.md. */
const cargasLocalEnVuelo = new Map<string, Promise<RutaInferencia>>();
const cargasDelegadoEnVuelo = new Map<string, Promise<RutaInferencia>>();

function claveModelo(modelSrc: unknown): string {
  // Los descriptores del SDK son objetos estables (src/sha256Checksum/...):
  // JSON.stringify alcanza como clave de caché, no hace falta un hash propio.
  return typeof modelSrc === 'string' ? modelSrc : JSON.stringify(modelSrc);
}

export async function cargarLLMLocal(modelSrc: ModeloLLM): Promise<RutaInferencia> {
  if (cacheLLMLocal) return cacheLLMLocal;
  const clave = claveModelo(modelSrc);
  const enVuelo = cargasLocalEnVuelo.get(clave);
  if (enVuelo) return enVuelo;

  const promesa = (async () => {
    const modelId = await loadModel({
      modelSrc, modelType: 'llm',
      // tools:true habilita el tool calling nativo.
      // ctx_size se DIVIDE entre slots: parallel 2 sobre 4096 da ~2048 por request.
      modelConfig: { tools: true, ctx_size: 4096, parallel: 2 },
    } as LoadModelOptions);
    const ruta = await verificarRuta(modelId);
    if (ruta.delegado) throw new Error('Se pidió carga local y el modelo resultó delegado');
    cacheLLMLocal = ruta;
    return ruta;
  })();

  cargasLocalEnVuelo.set(clave, promesa);
  try { return await promesa; } finally { cargasLocalEnVuelo.delete(clave); }
}

export async function cargarLLMDelegado(
  modelSrc: ModeloLLM, providerPublicKey: string, timeout = 30_000,
): Promise<RutaInferencia> {
  const clave = `${claveModelo(modelSrc)}::${providerPublicKey}`;
  const cacheada = cacheLLMDelegado.get(clave);
  if (cacheada) return cacheada;
  const enVuelo = cargasDelegadoEnVuelo.get(clave);
  if (enVuelo) return enVuelo;

  const promesa = (async () => {
    // El consumer de ejemplo de QVAC no maneja reconexión: health-check antes.
    const sano = await heartbeat({ delegate: { providerPublicKey, healthCheckTimeout: 5_000 } })
      .then(() => true).catch(() => false);
    if (!sano) throw new Error('Peer proveedor no responde');

    const modelId = await loadModel({
      modelSrc, modelType: 'llm',
      modelConfig: { tools: true, ctx_size: 4096 },
      delegate: { providerPublicKey, fallbackToLocal: true, timeout },
    } as LoadModelOptions);
    const ruta = await verificarRuta(modelId);
    cacheLLMDelegado.set(clave, ruta);
    return ruta;
  })();

  cargasDelegadoEnVuelo.set(clave, promesa);
  try { return await promesa; } finally { cargasDelegadoEnVuelo.delete(clave); }
}

/**
 * ★ Verificación, no promesa: preguntamos al SDK dónde corre de verdad.
 *
 * `isDelegated` se trata **fail-closed**: solo `false` explícito cuenta como
 * "no delegado". Si el campo viene `undefined` (SDK no lo informó) se
 * considera delegado. La versión ingenua `Boolean(info.isDelegated)` colapsa
 * `undefined` a `false` — exactamente el fail-open que abre el bug #5 de
 * ../../../mobile/CLAUDE.md (`if (info.isDelegated) throw` en vez de
 * `if (info.isDelegated !== false) throw`). Acá es la misma familia de bug:
 * `delegation.ts#asegurarRuta` depende de este booleano para decidir si un
 * modelo puede procesar contenido sensible de cliente.
 */
export async function verificarRuta(modelId: string): Promise<RutaInferencia> {
  const info = await getLoadedModelInfo({ modelId });
  let sha: string | undefined;
  try {
    // getModelInfo se indexa por `name`, no por `modelId` (nombres de campo
    // distintos entre las dos llamadas — verificado en el .d.ts real).
    // `sha256Checksum` es requerido en `ModelInfo`, no hace falta castear.
    sha = (await getModelInfo({ name: modelId })).sha256Checksum;
  } catch { /* no bloqueante */ }
  return {
    modelId,
    // `LoadedModelInfo` es una unión discriminada por `isDelegated` (siempre
    // `true` o `false`, nunca `undefined`) — el `!== false` de más arriba ya
    // no depende de una coerción insegura, queda como refuerzo explícito del
    // mismo principio fail-closed.
    delegado: info.isDelegated !== false,
    modeloSha256: sha,
  };
}

export async function cargarASR(modelSrc: ModeloASR): Promise<string> {
  if (cacheASR) return cacheASR;
  cacheASR = await loadModel({ modelSrc, modelType: 'whisper' } as LoadModelOptions);
  return cacheASR;
}

export async function transcribirLocal(audioPath: string, modelSrc: ModeloASR): Promise<string> {
  const modelId = await cargarASR(modelSrc);
  // El campo es `audioChunk` (string ruta o Buffer), no `audio` — y sin
  // `metadata:true` el overload resuelve directo a `Promise<string>`, sin
  // envoltorio `{ text }` que castear.
  return await transcribe({ modelId, audioChunk: audioPath });
}

/** Completion con presupuesto. Devuelve tool calls SIN ejecutarlas:
 *  quien decide ejecutar es el PEP, nunca el gateway. */
export async function completar(params: {
  modelId: string;
  history: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  tools?: Tool[]; maxTokens?: number;
}): Promise<{ texto: string; toolCalls: Array<{ name: string; arguments: unknown }> }> {
  const run = completion({
    modelId: params.modelId, history: params.history, stream: false,
    ...(params.tools ? { tools: params.tools } : {}),
    // temp 0 + seed fijo = reproducibilidad de la demo
    generationParams: { temp: 0, seed: 42, predict: params.maxTokens ?? 512 },
  });
  // CompletionFinal.contentText / .toolCalls son campos requeridos del SDK
  // (no hace falta castear ni parentizar mal el `await` como en el doc maestro).
  const final = await run.final;
  return { texto: final.contentText, toolCalls: final.toolCalls };
}

export async function descargar(modelId: string): Promise<void> {
  await unloadModel({ modelId });
  if (cacheLLMLocal?.modelId === modelId) cacheLLMLocal = null;
  for (const [clave, ruta] of cacheLLMDelegado) {
    if (ruta.modelId === modelId) cacheLLMDelegado.delete(clave);
  }
  if (cacheASR === modelId) cacheASR = null;
}
