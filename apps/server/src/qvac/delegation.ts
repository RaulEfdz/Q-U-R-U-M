import { DelegationViolation } from '../core/errors.ts';
import { verificarRuta } from './gateway.ts';

/** Clasificador DETERMINISTA de sensibilidad.
 *  Lo sensible aquí NO son datos de paciente — en este dataset no hay pacientes.
 *  Es lo que su propio brief declara: la identidad del cliente y su panorama
 *  tecnológico. Eso es inteligencia comercial. */
const PATRONES_CLIENTE = [
  /\bhospital\b/i, /\bcl[ií]nica\b/i, /\bcentro m[eé]dico\b/i,
  /\binstituto\b/i, /\bdemocare\b/i, /\bcentro diagn[oó]stico\b/i,
];

export function clasificar(texto: string): 'sensible' | 'no-sensible' {
  return PATRONES_CLIENTE.some((p) => p.test(texto)) ? 'sensible' : 'no-sensible';
}

export interface DecisionRuta {
  ruta: 'local-obligatoria' | 'delegable';
  razon: string; policyId: string;
}

export function decidirRuta(texto: string): DecisionRuta {
  const policyId = 'delegacion-cliente-identificable@1.0.0';
  return clasificar(texto) === 'sensible'
    ? { ruta: 'local-obligatoria', policyId,
        razon: 'El contenido identifica a un cliente. El peer delegado vería el prompt en claro.' }
    : { ruta: 'delegable', policyId, razon: 'Contenido sin identificadores de cliente.' };
}

/**
 * ★ Aserción del plano de control ANTES de enviar el prompt.
 *
 * `verificarRuta().delegado` ya viene fail-closed desde gateway.ts (trata
 * `isDelegated !== false` como delegado, no solo `isDelegated === true`) —
 * misma familia de bug que mobile/CLAUDE.md #5 (`if (info.isDelegated) throw`
 * en vez de `if (info.isDelegated !== false) throw`). Acá no se repite la
 * coerción: se usa el booleano ya corregido tal cual, no se vuelve a
 * `Boolean(...)` sobre él ni se reintroduce una comparación laxa.
 */
export async function asegurarRuta(modelId: string, d: DecisionRuta): Promise<void> {
  const ruta = await verificarRuta(modelId);
  if (d.ruta === 'local-obligatoria' && ruta.delegado) {
    throw new DelegationViolation(
      `Política ${d.policyId} exige inferencia local y el modelo ${modelId} está delegado`);
  }
}
