import type { CompletionFinal } from '@qvac/sdk';

/**
 * Log compacto de la respuesta CRUDA de un modelo, al canal `[QUÓRUM·modelo]`
 * (visible con `adb logcat -s ReactNativeJS:V | grep QUÓRUM`). Responde de una
 * vez las preguntas que uno se hace cuando "tarda mucho" o "no extrae":
 *
 *  - **¿está razonando?** → `think=N` es el largo de `final.thinkingText`.
 *    `>0` = el modelo emitió un bloque `<think>…</think>` a pesar de
 *    `reasoning_budget: 0` — hay que reforzar con `/no_think` en el prompt.
 *  - **¿se truncó la respuesta?** → `stop=length` = se quedó sin `predict`
 *    antes de cerrar el tool call → `safeParse` falla → 0 lotes.
 *  - **¿corre en GPU?** → `dev=cpu` en un teléfono con Adreno es el problema
 *    de fondo (llama.cpp cayó a CPU).
 *  - **velocidad real** → `tok/s`, tokens de prompt (prefill) y generados,
 *    y `ttft` (time-to-first-token, domina cuando el prompt es largo).
 *
 * `dumpRaw` vuelca los primeros 280 caracteres del texto crudo — se pasa
 * `true` solo cuando NO hubo tool call utilizable, para no llenar el log.
 */
export function diagModelo(etiqueta: string, final: CompletionFinal, dumpRaw: boolean): void {
  const s = final.stats ?? {};
  const think = final.thinkingText?.length ?? 0;
  const tc = final.toolCalls?.length ?? 0;
  const n = (x: number | undefined): string => (x === undefined ? '?' : String(x));
  // eslint-disable-next-line no-console
  console.log(
    `[QUÓRUM·modelo] ${etiqueta}  toolCalls=${tc} think=${think} stop=${final.stopReason ?? '?'} ` +
    `dev=${s.backendDevice ?? '?'} promptTok=${n(s.promptTokens)} genTok=${n(s.generatedTokens)} ` +
    `tok/s=${s.tokensPerSecond?.toFixed(1) ?? '?'} ttft=${n(s.timeToFirstToken)}ms`,
  );
  if (dumpRaw) {
    const raw = (final.raw?.fullText ?? final.contentText ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);
    // eslint-disable-next-line no-console
    console.log(`[QUÓRUM·modelo] ${etiqueta}  raw="${raw}"`);
  }
}
