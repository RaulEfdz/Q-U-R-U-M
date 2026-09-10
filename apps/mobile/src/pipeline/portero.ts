import { z } from 'zod';
import { completion, type CompletionFinal, type Tool } from '@qvac/sdk';
import { obtener } from '../qvac/pool.ts';
import { diagModelo } from './_diag.ts';

/**
 * Tope de `motivo` — corrección #8 (apps/mobile/CLAUDE.md).
 * La fuente usaba `z.string().max(120)`: un motivo de 130 caracteres tira
 * `safeParse` ENTERO (no solo el campo), y el fail-open resultante se
 * traduce en una pregunta extra al usuario por nota. `motivo` es texto
 * libre de depuración, no un campo que el motor de quórum consuma, así
 * que la corrección correcta es truncarlo ANTES de validar — nunca
 * dejar que la validación completa dependa de su longitud.
 */
const MOTIVO_MAX = 500;

const zVeredicto = z.object({
  hayEquipo: z.boolean().describe('true si la nota describe equipos medicos instalados'),
  motivo: z.string().max(MOTIVO_MAX),
});

/**
 * Tool declarado a mano como JSON-schema plano (`Tool` del SDK), NO como
 * `ToolInput` con un objeto Zod. El SDK empaqueta su PROPIA copia de zod v4
 * (`@qvac/sdk/node_modules/zod`) y el proyecto tiene zod 3.25.76 anclado
 * arriba (contracts.ts congelado la usa) — un `z.ZodObject` construido con
 * nuestro zod no es asignable estructuralmente al `ZodObjectType` que
 * espera `ToolInput` porque son dos v4/v3 distintos. En vez de tocar la
 * versión de zod del proyecto (fuera de alcance, rompería contracts.ts),
 * se declara el `Tool` en su forma final — la validación de la respuesta
 * del modelo sigue siendo con `zVeredicto` (nuestro zod), que no tiene
 * ninguna dependencia de la versión que use el SDK.
 */
const TOOL_PORTERO: Tool = {
  type: 'function',
  name: 'responder',
  description: 'Responde si la nota describe equipos medicos instalados en un cliente.',
  parameters: {
    type: 'object',
    properties: {
      hayEquipo: { type: 'boolean', description: 'true si la nota describe equipos medicos instalados' },
      motivo: { type: 'string' },
    },
    required: ['hayEquipo', 'motivo'],
  },
};

/** Prompt corto A PROPOSITO: 0.8B con prompt largo se pierde. */
export const SYSTEM_PORTERO = `Decides UNA cosa: si la nota dice qué equipo médico hay instalado en el hospital.

Equipos: resonador o RM, tomógrafo o TAC o TC, ecógrafo o ultrasonido,
rayos X o radiografía, monitor de paciente, angiógrafo, arco en C, hemodinamia.

hayEquipo = true  -> la nota dice qué hay, porque el colaborador lo vio,
                     lo contó o se lo dijeron.
hayEquipo = false -> nombra un equipo pero no dice qué hay, o no habla de equipo.

Vi dos resonadores en la planta baja. -> true
La sala de resonancia estaba cerrada. -> false
Me dijeron que tienen tres tomógrafos. -> true
Conté 5 ecógrafos, uno en mantenimiento. -> true
Reunión con el jefe de radiología. -> false
Tienen un servicio de imagen muy completo. -> false
Un arco en C nuevo, no vi la marca. -> true
No me dejaron pasar a imagenología. -> false

Si dudas, true.`;

export interface Veredicto {
  hayEquipo: boolean;
  motivo: string;
}

/** Trunca ANTES de que la forma llegue a Zod — ver MOTIVO_MAX arriba. */
function truncarMotivo(args: unknown): unknown {
  if (
    typeof args === 'object' && args !== null &&
    'motivo' in args && typeof (args as { motivo: unknown }).motivo === 'string'
  ) {
    const a = args as { motivo: string };
    if (a.motivo.length > MOTIVO_MAX) {
      return { ...a, motivo: a.motivo.slice(0, MOTIVO_MAX) };
    }
  }
  return args;
}

export async function portero(nota: string): Promise<Veredicto> {
  const modelId = await obtener('portero');

  // Toda salida de modelo es input hostil: se valida con Zod o se rechaza.
  // No hay `try` porque no hay nada async-riesgoso fuera de `completion`/
  // `run.final` que no esté ya cubierto por el fail-open de abajo — un
  // throw de `obtener()` (ej. modelo delegado, corrección #5 en pool.ts)
  // debe propagarse: eso SÍ tiene que frenar el pipeline, no degradar.
  let final: CompletionFinal;
  try {
    // Corrección #6: `completion()` NO es async — devuelve `CompletionRun`
    // de forma síncrona (`requestId` disponible al toque). Lo que sí es
    // una Promise es `run.final`. La fuente ya tenía esta parte bien en
    // el fondo (no había `await` sobre `completion(...)` en sí), pero el
    // cast `as {...}` ad-hoc escondía el bug real: si algún día alguien
    // "arregla" esto poniendo `await completion(...)`, `run` pasa a ser
    // `CompletionFinal` y `run.final` es `undefined` → TypeError sin
    // cubrir. Tipar explícito con `CompletionFinal` del SDK lo previene:
    // TS marca el error en compilación, no en runtime.
    const run = completion({
      modelId,
      history: [
        // `/no_think`: switch suave entrenado de Qwen3 (el tag exacto, no
        // `/nothink`). Va en el system y hace que el modelo NO emita bloque
        // `<think>…</think>`. Refuerza a `reasoning_budget: 0` de abajo: son
        // dos mecanismos distintos (uno a nivel plantilla/prompt, el otro a
        // nivel addon) y el bug de fondo — Qwen3 razonando y quemando
        // `predict` sin emitir el tool call — ya nos costó una vez.
        // `SISTEMA` se renombró a `SYSTEM_PORTERO`.
        { role: 'system', content: `${SYSTEM_PORTERO}\n\n/no_think` },
        { role: 'user', content: nota },
      ],
      stream: false,
      tools: [TOOL_PORTERO],
      // `reasoning_budget: 0`: Qwen3 arranca en modo *thinking* y gasta todo
      // el presupuesto de `predict` razonando en prosa (`<think>…`) sin llegar
      // a emitir el tool call — `toolCalls: []` y el fail-open de abajo lo
      // enmascara como "portero sin respuesta valida" → hayEquipo:true siempre.
      // Doc del schema: `0` desactiva el canal de razonamiento para este
      // request (equivale al config de load-time pero por llamada). El schema
      // de `generationParams` es `$strict` — verificado contra
      // node_modules/@qvac/sdk/dist/schemas/completion-stream.d.ts.
      generationParams: { temp: 0, seed: 42, predict: 80, reasoning_budget: 0 },
    });
    final = await run.final;
  } catch {
    // Fail-open hacia el extractor: si la inferencia falla, NO bloqueamos
    // la nota. Un portero roto nunca puede impedir que se capture info.
    return { hayEquipo: true, motivo: 'portero fallo en inferencia' };
  }

  const call = final.toolCalls?.find((c) => c.name === 'responder');
  diagModelo('portero', final, !call);
  const p = zVeredicto.safeParse(truncarMotivo(call?.arguments));

  // Fail-open hacia el extractor: si el portero no devuelve forma valida,
  // NO bloqueamos la nota. La accion peligrosa aca es DESCARTAR, no
  // capturar de mas.
  if (!p.success) return { hayEquipo: true, motivo: 'portero sin respuesta valida' };
  return p.data;
}
