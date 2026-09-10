import { z } from 'zod';
import { completion, type CompletionFinal, type Tool } from '@qvac/sdk';
import { obtener } from '../qvac/pool.ts';

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
const SISTEMA = `Decides UNA cosa: si la nota describe equipos medicos INSTALADOS
en un hospital o clinica.

hayEquipo = true  -> menciona resonadores, tomografos, ecografos, rayos X,
                     monitores u otro equipo medico presente en el sitio.
hayEquipo = false -> solo habla de la visita, de personas, de logistica,
                     o no pudo entrar y no vio nada.

No extraigas datos. Solo responde con la herramienta.`;

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
        { role: 'system', content: SISTEMA },
        { role: 'user', content: nota },
      ],
      stream: false,
      tools: [TOOL_PORTERO],
      generationParams: { temp: 0, seed: 42, predict: 80 },
    });
    final = await run.final;
  } catch {
    // Fail-open hacia el extractor: si la inferencia falla, NO bloqueamos
    // la nota. Un portero roto nunca puede impedir que se capture info.
    return { hayEquipo: true, motivo: 'portero fallo en inferencia' };
  }

  const call = final.toolCalls?.find((c) => c.name === 'responder');
  const p = zVeredicto.safeParse(truncarMotivo(call?.arguments));

  // Fail-open hacia el extractor: si el portero no devuelve forma valida,
  // NO bloqueamos la nota. La accion peligrosa aca es DESCARTAR, no
  // capturar de mas.
  if (!p.success) return { hayEquipo: true, motivo: 'portero sin respuesta valida' };
  return p.data;
}
