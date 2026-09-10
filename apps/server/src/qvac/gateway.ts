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
import type { Tool } from '@qvac/sdk';

export interface RutaInferencia {
  readonly modelId: string;
  readonly delegado: boolean;
  readonly modeloSha256?: string;
}

/** modelSrc de un LLM: descriptor de registro del SDK (objeto), no string. */
export type ModeloLLM = Parameters<typeof loadModel>[0]['modelSrc'];
export type ModeloASR = Parameters<typeof loadModel>[0]['modelSrc'];

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
    });
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
    });
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
    sha = (await getModelInfo({ modelId }) as { sha256Checksum?: string }).sha256Checksum;
  } catch { /* no bloqueante */ }
  return {
    modelId,
    delegado: (info as { isDelegated?: boolean }).isDelegated !== false,
    modeloSha256: sha,
  };
}

export async function cargarASR(modelSrc: ModeloASR): Promise<string> {
  if (cacheASR) return cacheASR;
  cacheASR = await loadModel({ modelSrc, modelType: 'whisper' });
  return cacheASR;
}

export async function transcribirLocal(audioPath: string, modelSrc: ModeloASR): Promise<string> {
  const modelId = await cargarASR(modelSrc);
  const r = await transcribe({ modelId, audio: audioPath }) as { text?: string };
  return r.text ?? '';
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
