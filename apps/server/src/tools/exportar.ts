// exportar.ts — "la tool peligrosa". riskLevel crítico, el criterio no se
// delega: es la que el video de la demo usa para mostrar que la inyección
// se bloquea (ver ../../CLAUDE.md §Modelo de confianza y policy/engine.ts).
import { z } from 'zod';
import type { Tool } from '@qvac/sdk';
import type { ActionRequest, SecurityContext, Observacion } from '../core/contracts.ts';
import { aplicar } from '../policy/pep.ts';
import { exportarCSV } from '../export/philips.ts';

export const zExportar = z.object({
  filtro: z.object({ pais: z.string().optional(), modalidad: z.string().optional() }).default({}),
  destino: z.string().describe("Destino de la exportación. 'local' descarga el archivo."),
});
export type Exportar = z.infer<typeof zExportar>;

// Corrección #4 de ../../CLAUDE.md (mismo criterio que extract.ts/filtrar.ts):
// `Tool` a mano, no `zExportar` crudo como `parameters` — evita el choque
// zod v3 (proyecto) / v4 (copia interna del SDK) al pasarla en `tools:[...]`.
export const TOOL_EXPORTAR: Tool = {
  type: 'function',
  name: 'exportar_dataset',
  description: 'Exporta la base instalada a CSV.',
  parameters: {
    type: 'object',
    properties: {
      filtro: { type: 'object', description: 'Filtro opcional: { pais?, modalidad? }' },
      destino: { type: 'string', description: "Destino de la exportación. 'local' descarga el archivo." },
    },
    required: ['destino'],
  },
};

/**
 * Legítima para un humano hacia 'local'; catastrófica si un atacante
 * controla `destino` — es el vector de exfiltración de la cartera de
 * clientes (egress allowlist vacía + riskLevel critical la mitigan en
 * `policy/engine.ts`, no acá).
 *
 * Corrección #5 de ../../CLAUDE.md aplicada del lado de la FIRMA, no como
 * parche en `server/index.ts`: el bug real era `zExportar.parse(args)` ANTES
 * de `aplicar()` — un export malformado o inyectado tiraba `ZodError` sin
 * pasar nunca por el PEP, así que no había evento `policy-denied` ni banner
 * que mostrar, solo un 500 crudo. Acá el orden correcto es el único posible:
 * `args` (crudo, `unknown`) se envuelve SIN VALIDAR para que el PEP pueda
 * evaluar y auditar la decisión pase lo que pase, y `zExportar.parse(args)`
 * recién corre DENTRO del callback que `aplicar()` ejecuta — es decir, solo
 * después de que la decisión ya fue 'allow' y ya quedó auditada. Un
 * `ZodError` ahí adentro es un caso raro (un humano con `destino:'local'`
 * mal tipeado) y no un vector para saltarse la auditoría.
 *
 * No lee del store: recibe `obs` ya cargadas (mismo patrón que
 * `tools/filtrar.ts` recibe `grupos` en vez de leer `store/observations.ts`
 * él mismo) — ese store es de la Fase 6 de otro agente y no existe todavía;
 * quien orqueste el endpoint (`server/index.ts`, Fase 8) es quien lo carga.
 */
export async function exportarDataset(
  args: unknown, ctx: SecurityContext, origen: 'usuario' | 'modelo', obs: Observacion[],
): Promise<{ csv: string; filas: number }> {
  const a: ActionRequest = {
    tool: 'exportar_dataset', args: envolverSinValidar(args),
    riskLevel: 'critical', origenArgumentos: origen,
  };
  return aplicar(a, ctx, async () => {
    zExportar.parse(args);           // recién ACÁ, con el PEP ya aprobado — puede tirar ZodError, no rompe la auditoría
    return { csv: exportarCSV(obs), filas: obs.length };
  });
}

/**
 * Envuelve `args` en un `Record<string, unknown>` SIN validar su forma — a
 * propósito. El PEP necesita poder leer `args['destino']` (lo usan las
 * reglas `egress-no-autorizado` y `export-local-por-humano` de
 * `policy/engine.ts`) para decidir y auditar, incluso cuando `args` viene
 * malformado o de un origen hostil. Si acá adentro se llamara a
 * `zExportar.parse()`, se reintroduce exactamente el bug #5: un `ZodError`
 * antes de que la política se evalúe.
 */
function envolverSinValidar(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : { valor: args };
}
