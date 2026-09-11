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

/**
 * ★ El predicado del export humano, en UN solo lugar.
 *
 * Lo usan dos reglas: `export-local-por-humano` (que permite) y la excepción
 * de `critico-requiere-aprobacion` (que evita volver a pedir una aprobación
 * que ya se dio). Estaban escritos dos veces, y si alguien endurece uno y se
 * olvida del otro, el resultado no es un error visible: es un hueco hacia
 * `deny-by-default` o una aprobación que se pide dos veces. Con un predicado
 * compartido eso no puede pasar.
 *
 * Incluye `principal.tipo === 'humano'`, que ANTES no se verificaba en ninguna
 * regla: la única capa que separaba el export legítimo del inyectado era el
 * string `agenteId === 'ui-humano'`, y un string lo fija quien construye el
 * contexto. El campo ya existe en `SecurityContext` y ahora se usa — defensa
 * en profundidad sobre la operación más sensible del sistema, que es la única
 * que puede sacar el dataset completo.
 */
function esExportHumanoLocal(a: ActionRequest, c: SecurityContext): boolean {
  return a.tool === 'exportar_dataset' &&
    a.origenArgumentos === 'usuario' &&
    c.principal.tipo === 'humano' &&
    a.args['destino'] === 'local' &&
    (TOOLS_POR_AGENTE[c.agenteId] ?? []).includes(a.tool);
}

const REGLAS: Regla[] = [
  // ★ El orden DENTRO de un mismo efecto es ATRIBUCIÓN, no permisividad.
  //
  // `evaluar()` recorre los efectos `deny → require-approval → allow`, así que
  // ninguna reordenación acá puede convertir un deny en un allow: mover reglas
  // dentro del bloque `deny` solo cambia CUÁL de las que aplican queda
  // registrada como la razón. Y esa razón no es cosmética: es lo que se
  // escribe en la auditoría (`policy:deny`) y lo que la UI muestra en la banda
  // roja.
  //
  // Antes, `tool-fuera-de-allowlist` iba primera y se quedaba con la
  // atribución del caso que más importa: el modelo intentando llamar
  // `exportar_dataset` desde `/api/consultar`, donde el agente es
  // `agente-consulta` y esa tool no está en su allowlist. Bloqueaba igual,
  // pero el registro decía "la herramienta no está en la allowlist" — un
  // detalle de configuración — y la regla que de verdad detiene la inyección
  // indirecta, `intencion-originada-en-modelo`, no aparecía nunca. La tesis
  // del proyecto (el ORIGEN del argumento es lo que corta el ataque, no que la
  // allowlist esté bien puesta) quedaba invisible en la evidencia.
  //
  // Por eso la regla más específica va primero: `intencion-originada-en-modelo`
  // solo aplica con `origenArgumentos === 'modelo'` y riesgo `high`/`critical`,
  // y en TODOS esos casos el resultado ya era `deny` (por esta misma regla o
  // por otra del mismo bloque). Ninguna decisión cambia; cambia a quién se le
  // atribuye. Las dos que quedan detrás son más genéricas y siguen cubriendo
  // todo lo que la primera no alcanza.
  { id: 'intencion-originada-en-modelo', efecto: 'deny',
    razon: 'Una acción de riesgo alto no puede originarse en la salida del modelo',
    aplica: (a) => a.origenArgumentos === 'modelo' && ['high', 'critical'].includes(a.riskLevel) },

  { id: 'tool-fuera-de-allowlist', efecto: 'deny',
    razon: 'La herramienta no está en la allowlist del agente',
    aplica: (a, c) => !(TOOLS_POR_AGENTE[c.agenteId] ?? []).includes(a.tool) },

  { id: 'egress-no-autorizado', efecto: 'deny',
    razon: 'El destino no está en la allowlist de egress',
    aplica: (a) => {
      const d = a.args['destino'];
      return typeof d === 'string' && d !== 'local' && !EGRESS_PERMITIDO.includes(d);
    } },

  { id: 'critico-requiere-aprobacion', efecto: 'require-approval',
    razon: 'Acción crítica: requiere aprobación humana fuera de banda',
    // Excepción quirúrgica: la exportación local iniciada por humano (ver regla
    // 'export-local-por-humano') YA ES la aprobación humana fuera de banda —
    // no debe volver a pedirse. No se relaja para ningún otro caso 'critical'.
    aplica: (a, c) => a.riskLevel === 'critical' && !esExportHumanoLocal(a, c) },

  { id: 'lectura-permitida', efecto: 'allow',
    razon: 'Operación de solo lectura en la allowlist del agente',
    aplica: (a, c) => a.riskLevel === 'low' && (TOOLS_POR_AGENTE[c.agenteId] ?? []).includes(a.tool) },

  { id: 'export-local-por-humano', efecto: 'allow',
    razon: 'Exportación local iniciada por un humano',
    aplica: esExportHumanoLocal },
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
