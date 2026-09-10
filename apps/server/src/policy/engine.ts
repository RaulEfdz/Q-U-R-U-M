// engine.ts — PDP determinista, deny-overrides, deny-by-default
import type { ActionRequest, PolicyDecision, SecurityContext } from '../core/contracts.ts';

interface Regla {
  id: string; efecto: 'allow' | 'deny' | 'require-approval';
  razon: string; aplica(a: ActionRequest, c: SecurityContext): boolean;
}

export const VERSION_POLITICA = '1.0.0';

const TOOLS_POR_AGENTE: Record<string, string[]> = {
  'agente-captura': ['registrar_observacion'],
  'agente-consulta': ['filtrar_base_instalada'],        // SOLO LECTURA
  'ui-humano': ['filtrar_base_instalada', 'exportar_dataset'],
};

const EGRESS_PERMITIDO: string[] = [];                   // vacío = nada externo

const REGLAS: Regla[] = [
  { id: 'tool-fuera-de-allowlist', efecto: 'deny',
    razon: 'La herramienta no está en la allowlist del agente',
    aplica: (a, c) => !(TOOLS_POR_AGENTE[c.agenteId] ?? []).includes(a.tool) },

  { id: 'egress-no-autorizado', efecto: 'deny',
    razon: 'El destino no está en la allowlist de egress',
    aplica: (a) => {
      const d = a.args['destino'];
      return typeof d === 'string' && d !== 'local' && !EGRESS_PERMITIDO.includes(d);
    } },

  { id: 'intencion-originada-en-modelo', efecto: 'deny',
    razon: 'Una acción de riesgo alto no puede originarse en la salida del modelo',
    aplica: (a) => a.origenArgumentos === 'modelo' && ['high', 'critical'].includes(a.riskLevel) },

  { id: 'critico-requiere-aprobacion', efecto: 'require-approval',
    razon: 'Acción crítica: requiere aprobación humana fuera de banda',
    // Excepción quirúrgica: la exportación local iniciada por humano (ver regla
    // 'export-local-por-humano') YA ES la aprobación humana fuera de banda —
    // no debe volver a pedirse. No se relaja para ningún otro caso 'critical'.
    aplica: (a, c) => a.riskLevel === 'critical' &&
      !(a.tool === 'exportar_dataset' && a.origenArgumentos === 'usuario' &&
        a.args['destino'] === 'local' &&
        (TOOLS_POR_AGENTE[c.agenteId] ?? []).includes(a.tool)) },

  { id: 'lectura-permitida', efecto: 'allow',
    razon: 'Operación de solo lectura en la allowlist del agente',
    aplica: (a, c) => a.riskLevel === 'low' && (TOOLS_POR_AGENTE[c.agenteId] ?? []).includes(a.tool) },

  { id: 'export-local-por-humano', efecto: 'allow',
    razon: 'Exportación local iniciada por un humano',
    aplica: (a, c) => a.tool === 'exportar_dataset' && a.origenArgumentos === 'usuario' &&
                      a.args['destino'] === 'local' &&
                      (TOOLS_POR_AGENTE[c.agenteId] ?? []).includes(a.tool) },
];

export function evaluar(a: ActionRequest, c: SecurityContext): PolicyDecision {
  const v = VERSION_POLITICA;
  for (const efecto of ['deny', 'require-approval', 'allow'] as const) {
    for (const r of REGLAS.filter((x) => x.efecto === efecto)) {
      if (r.aplica(a, c)) return { decision: efecto, reason: r.razon, policyId: r.id, version: v };
    }
  }
  // Deny-by-default: si ninguna regla autoriza explícitamente, se deniega.
  return { decision: 'deny', version: v, policyId: 'deny-by-default',
           reason: 'Ninguna política autoriza explícitamente esta acción (deny-by-default)' };
}
