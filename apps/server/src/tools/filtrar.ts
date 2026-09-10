// filtrar.ts — el modelo traduce la pregunta a un FILTRO. No ejecuta la búsqueda.
import { z } from 'zod';
import type { Tool } from '@qvac/sdk';
import { MODALIDADES, type GrupoEquipo } from '../core/contracts.ts';
import type { ActionRequest, SecurityContext } from '../core/contracts.ts';
import { aplicar } from '../policy/pep.ts';

export const zFiltro = z.object({
  pais: z.string().optional(),
  ciudad: z.string().optional(),
  modalidad: z.enum(MODALIDADES).optional(),
  marca: z.string().optional(),
  edadMinima: z.number().optional(),
  soloConQuorum: z.boolean().optional(),
  soloOportunidades: z.boolean().optional(),
  soloDesactualizados: z.boolean().optional(),
});
export type Filtro = z.infer<typeof zFiltro>;

/**
 * Corrección #4 de ../../CLAUDE.md, mismo criterio que `qvac/extract.ts`:
 * `Tool` a mano en el formato JSON-Schema-like del SDK, no `zFiltro` crudo.
 * Acá el schema es plano (sin arrays de objetos anidados como `lotes` en
 * extract.ts), pero pasar un `z.ZodObject` de nuestro `zod@3.25` como
 * `parameters` de un `ToolInput` no compila igual: el SDK trae su propia
 * copia de `zod@4` en `node_modules/@qvac/sdk/node_modules/zod` y un
 * `z.ZodObject` de la v3 del proyecto no es asignable al tipo que espera su
 * `ToolInput` (choque de tipos v3/v4, encontrado por el teammate de mobile
 * en el mismo punto). Declarar el `Tool` ya convertido evita el choque.
 */
export const TOOL_FILTRAR: Tool = {
  type: 'function',
  name: 'filtrar_base_instalada',
  description: 'Traduce la pregunta del usuario a un filtro sobre la base instalada. ' +
    'Ejemplo: "clientes en Brasil con resonadores de más de siete años" → ' +
    '{pais:"Brazil", modalidad:"MR", edadMinima:7}',
  parameters: {
    type: 'object',
    properties: {
      pais: { type: 'string' },
      ciudad: { type: 'string' },
      modalidad: { type: 'string', enum: [...MODALIDADES] },
      marca: { type: 'string' },
      edadMinima: { type: 'number', description: 'Antigüedad mínima en años' },
      soloConQuorum: { type: 'boolean' },
      soloOportunidades: { type: 'boolean' },
      soloDesactualizados: { type: 'boolean' },
    },
  },
};

/** Igualdad normalizada (minúsculas, sin acentos) — NO subcadena.
 *  Corrección menor de ../../CLAUDE.md: la versión con `includes` hacía que
 *  filtrar por `pais:"US"` matcheara "Australia" (porque "us" es subcadena
 *  de "australia"). Un filtro sin valor (`a` undefined) siempre pasa. */
const normalizar = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const eq = (a?: string, b?: string): boolean =>
  !a || (b !== undefined && normalizar(b) === normalizar(a));

/** Ejecución DETERMINISTA. El modelo nunca toca los datos ni cuenta. */
export function ejecutarFiltro(grupos: GrupoEquipo[], f: Filtro): GrupoEquipo[] {
  return grupos.filter((g) => {
    if (!eq(f.pais, g.cliente.pais)) return false;
    if (!eq(f.ciudad, g.cliente.ciudad)) return false;
    if (f.modalidad && g.campos.modalidad.valor !== f.modalidad) return false;
    if (f.marca && !eq(f.marca, g.campos.marca.valor as string | undefined)) return false;
    if (f.edadMinima !== undefined) {
      const max = g.cohortes.length
        ? Math.max(...g.cohortes.map((c) => (typeof c.edad === 'number' ? c.edad : c.edad[1])))
        : -1;
      if (max < f.edadMinima) return false;
    }
    if (f.soloConQuorum && g.estadoGeneral !== 'Quórum') return false;
    if (f.soloOportunidades && !g.oportunidadRenovacion) return false;
    if (f.soloDesactualizados && g.campos.modalidad.fresco) return false;
    return true;
  });
}

/**
 * Corrección #10 de ../../CLAUDE.md — la de la trampa: el doc maestro dice en
 * un comentario que el filtro pasa por el PEP y en la línea siguiente llama
 * `ejecutarFiltro()` directo. Esta función (`filtrar`) es la que de verdad
 * enruta por `aplicar()` — es la que hay que exportar y usar desde
 * `server/index.ts` (Fase 8), nunca `ejecutarFiltro` a secas. Sin esto,
 * `filtrar_base_instalada` nunca se audita ni pasa por policy — código
 * muerto con apariencia de estar protegido.
 */
export async function filtrar(
  args: unknown, ctx: SecurityContext, origen: 'usuario' | 'modelo', grupos: GrupoEquipo[],
): Promise<GrupoEquipo[]> {
  const f = zFiltro.parse(args);
  const a: ActionRequest = {
    tool: 'filtrar_base_instalada', args: f as Record<string, unknown>,
    riskLevel: 'low', origenArgumentos: origen,
  };
  return aplicar(a, ctx, async () => ejecutarFiltro(grupos, f));
}
