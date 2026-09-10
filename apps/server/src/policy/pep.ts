// pep.ts — punto de aplicación de políticas. Fail-closed: `evaluar()` decide,
// acá se hace cumplir. Nunca se ejecuta la acción sin pasar por esto primero.
import type { ActionRequest, SecurityContext } from '../core/contracts.ts';
import { PolicyDenied } from '../core/errors.ts';
import { evaluar } from './engine.ts';
import { registrarAuditoria } from '../store/audit.ts';

export async function aplicar<T>(
  a: ActionRequest, c: SecurityContext, ejecutar: () => Promise<T>,
): Promise<T> {
  const d = evaluar(a, c);

  await registrarAuditoria({
    traceId: c.traceId, accion: `policy:${d.decision}`,
    detalle: {
      tool: a.tool, riskLevel: a.riskLevel, origen: a.origenArgumentos,
      policyId: d.policyId, version: d.version, reason: d.reason, args: redactar(a.args),
    },
  });

  // `require-approval` no es un estado intermedio que este PEP resuelva: hoy
  // no hay un canal de aprobación fuera de banda modelado, así que se trata
  // como bloqueo — el llamador ve el mismo `PolicyDenied` que un `deny`, con
  // el `reason`/`policyId` de la regla real (`critico-requiere-aprobacion`
  // u otra) para que la UI pueda distinguir el motivo si hace falta.
  if (d.decision !== 'allow') throw new PolicyDenied(d.reason, d.policyId, d.version);

  const r = await ejecutar();
  await registrarAuditoria({ traceId: c.traceId, accion: 'tool:ok', detalle: { tool: a.tool } });
  return r;
}

/** Logs útiles, sin filtrar contenido sensible (notas, textoOriginal, etc.
 *  pueden traer datos de cliente — H-08, superficie de inyección). */
function redactar(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === 'string' && v.length > 80 ? `<${v.length} chars>` : v;
  }
  return out;
}
