// policy.test.ts — la defensa está EN CAPAS y cada capa se verifica sola.
// Se prueba `evaluar()` (el PDP) directo, sin pasar por `pep.ts`: el PEP
// escribe auditoría en `data/`, y estos tests no tocan disco.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluar, VERSION_POLITICA } from '../src/policy/engine.ts';
import type { ActionRequest, SecurityContext } from '../src/core/contracts.ts';

function ctx(agenteId: string, tipo: 'humano' | 'agente' = 'agente'): SecurityContext {
  return {
    principal: { id: 'p-1', tipo, roles: [] },
    agenteId,
    traceId: 'trace-policy-test',
  };
}

function req(o: Partial<ActionRequest> & { tool: string }): ActionRequest {
  return {
    tool: o.tool,
    args: o.args ?? {},
    riskLevel: o.riskLevel ?? 'low',
    origenArgumentos: o.origenArgumentos ?? 'usuario',
  };
}

// ── Capa 1: allowlist por agente ──────────────────────────────────────────

test('policy.test: capa 1 — exportar_dataset pedido por el modelo desde agente-consulta cae en la allowlist', () => {
  // `agente-consulta` es de SOLO LECTURA: su allowlist es la primera capa
  // que ataja el pedido, antes incluso de mirar el origen de los argumentos.
  const d = evaluar(
    req({
      tool: 'exportar_dataset',
      args: { filtro: { pais: '*' }, destino: 'peer-atacante' },
      riskLevel: 'critical',
      origenArgumentos: 'modelo',
    }),
    ctx('agente-consulta'),
  );

  assert.strictEqual(d.decision, 'deny');
  assert.strictEqual(d.policyId, 'tool-fuera-de-allowlist');
  assert.strictEqual(d.version, VERSION_POLITICA);
});

// ── Capa 2: el origen de la intención (la tesis del proyecto) ─────────────

test('policy.test: capa 2 — con la tool SÍ en la allowlist, el origen "modelo" la deniega igual', () => {
  // `ui-humano` TIENE `exportar_dataset` en su allowlist (ver TOOLS_POR_AGENTE),
  // así que la capa 1 no ataja nada acá. La defensa no depende de que la
  // allowlist esté bien configurada: una intención originada en la salida del
  // modelo no puede disparar una acción de riesgo alto/crítico.
  const critico = evaluar(
    req({
      tool: 'exportar_dataset',
      args: { filtro: { pais: '*' }, destino: 'local' },   // destino permitido a propósito
      riskLevel: 'critical',
      origenArgumentos: 'modelo',
    }),
    ctx('ui-humano'),
  );

  assert.strictEqual(critico.decision, 'deny');
  assert.strictEqual(critico.policyId, 'intencion-originada-en-modelo');

  // Mismo razonamiento con riesgo 'high'.
  const alto = evaluar(
    req({
      tool: 'exportar_dataset',
      args: { destino: 'local' },
      riskLevel: 'high',
      origenArgumentos: 'modelo',
    }),
    ctx('ui-humano'),
  );

  assert.strictEqual(alto.decision, 'deny');
  assert.strictEqual(alto.policyId, 'intencion-originada-en-modelo');
});

// ── Corrección #1: el export humano local es alcanzable ───────────────────

const EXPORT_HUMANO = {
  agenteId: 'ui-humano',
  origenArgumentos: 'usuario' as const,
  destino: 'local',
};

test('policy.test: corrección #1 — el export local iniciado por un humano SÍ pasa', () => {
  const d = evaluar(
    req({
      tool: 'exportar_dataset',
      args: { filtro: {}, destino: EXPORT_HUMANO.destino },
      riskLevel: 'critical',                       // exportarDataset lo fija SIEMPRE
      origenArgumentos: EXPORT_HUMANO.origenArgumentos,
    }),
    ctx(EXPORT_HUMANO.agenteId, 'humano'),
  );

  assert.strictEqual(d.decision, 'allow', 'no devuelve 403: el bug #1 está corregido');
  assert.strictEqual(d.policyId, 'export-local-por-humano');
  assert.notStrictEqual(d.policyId, 'critico-requiere-aprobacion',
    'no queda atrapado en la regla crítica');
});

test('policy.test: corrección #1 — la excepción es quirúrgica: cambiar cualquiera de los tres campos la cierra', () => {
  // (a) otro agenteId → la tool no está en su allowlist
  const otroAgente = evaluar(
    req({
      tool: 'exportar_dataset',
      args: { destino: EXPORT_HUMANO.destino },
      riskLevel: 'critical',
      origenArgumentos: EXPORT_HUMANO.origenArgumentos,
    }),
    ctx('agente-consulta'),
  );
  assert.strictEqual(otroAgente.decision, 'deny');
  assert.strictEqual(otroAgente.policyId, 'tool-fuera-de-allowlist');

  // (b) origenArgumentos: 'modelo' → intención originada en el modelo
  const otroOrigen = evaluar(
    req({
      tool: 'exportar_dataset',
      args: { destino: EXPORT_HUMANO.destino },
      riskLevel: 'critical',
      origenArgumentos: 'modelo',
    }),
    ctx(EXPORT_HUMANO.agenteId),
  );
  assert.strictEqual(otroOrigen.decision, 'deny');
  assert.strictEqual(otroOrigen.policyId, 'intencion-originada-en-modelo');

  // (c) destino distinto de 'local' → egress no autorizado
  const otroDestino = evaluar(
    req({
      tool: 'exportar_dataset',
      args: { destino: 'peer-atacante' },
      riskLevel: 'critical',
      origenArgumentos: EXPORT_HUMANO.origenArgumentos,
    }),
    ctx(EXPORT_HUMANO.agenteId, 'humano'),
  );
  assert.strictEqual(otroDestino.decision, 'deny');
  assert.strictEqual(otroDestino.policyId, 'egress-no-autorizado');

  // (d) sin `destino` no hay excepción tampoco: cae en la regla crítica
  const sinDestino = evaluar(
    req({
      tool: 'exportar_dataset',
      args: {},
      riskLevel: 'critical',
      origenArgumentos: EXPORT_HUMANO.origenArgumentos,
    }),
    ctx(EXPORT_HUMANO.agenteId, 'humano'),
  );
  assert.notStrictEqual(sinDestino.decision, 'allow');
  assert.strictEqual(sinDestino.policyId, 'critico-requiere-aprobacion');
});

// ── Egress ────────────────────────────────────────────────────────────────

test('policy.test: egress — cualquier destino que no sea "local" se deniega (EGRESS_PERMITIDO está vacío)', () => {
  for (const destino of ['peer-atacante', 'https://evil.example', 's3://bucket', 'LOCAL']) {
    const d = evaluar(
      req({
        tool: 'exportar_dataset',
        args: { destino },
        riskLevel: 'critical',
        origenArgumentos: 'usuario',
      }),
      ctx('ui-humano', 'humano'),
    );
    assert.strictEqual(d.decision, 'deny', `destino ${destino} denegado`);
    assert.strictEqual(d.policyId, 'egress-no-autorizado', `destino ${destino} por egress`);
  }
});

// ── Deny-by-default ───────────────────────────────────────────────────────

test('policy.test: deny-by-default — una tool desconocida se deniega', () => {
  const d = evaluar(
    req({ tool: 'borrar_todo', riskLevel: 'low', origenArgumentos: 'usuario' }),
    ctx('ui-humano', 'humano'),
  );
  assert.strictEqual(d.decision, 'deny');
  // La ataja la allowlist antes del default: ninguna allowlist la contiene.
  assert.strictEqual(d.policyId, 'tool-fuera-de-allowlist');

  // Y una tool desconocida con un agente desconocido, idem.
  const sinAgente = evaluar(
    req({ tool: 'borrar_todo' }),
    ctx('agente-que-no-existe'),
  );
  assert.strictEqual(sinAgente.decision, 'deny');
});

test('policy.test: deny-by-default — nada autoriza explícitamente ⇒ deny', () => {
  // Tool en la allowlist, origen humano, sin destino, riesgo 'medium':
  // ninguna regla deny aplica, ninguna allow aplica tampoco.
  const d = evaluar(
    req({ tool: 'registrar_observacion', riskLevel: 'medium', origenArgumentos: 'usuario' }),
    ctx('agente-captura'),
  );
  assert.strictEqual(d.decision, 'deny');
  assert.strictEqual(d.policyId, 'deny-by-default');
});

// ── Orden de evaluación ───────────────────────────────────────────────────

test('policy.test: orden — deny gana sobre require-approval', () => {
  // Este pedido matchea las DOS: 'intencion-originada-en-modelo' (deny) y
  // 'critico-requiere-aprobacion' (require-approval). Gana el deny.
  const d = evaluar(
    req({
      tool: 'exportar_dataset',
      args: { destino: 'local' },
      riskLevel: 'critical',
      origenArgumentos: 'modelo',
    }),
    ctx('ui-humano'),
  );
  assert.strictEqual(d.decision, 'deny');
  assert.strictEqual(d.policyId, 'intencion-originada-en-modelo');
});

test('policy.test: orden — deny gana sobre allow', () => {
  // Lectura de bajo riesgo en la allowlist (matchea 'lectura-permitida'),
  // pero con un destino externo colado en los args: gana 'egress-no-autorizado'.
  const d = evaluar(
    req({
      tool: 'filtrar_base_instalada',
      args: { pais: 'Panama', destino: 'peer-atacante' },
      riskLevel: 'low',
      origenArgumentos: 'usuario',
    }),
    ctx('agente-consulta'),
  );
  assert.strictEqual(d.decision, 'deny');
  assert.strictEqual(d.policyId, 'egress-no-autorizado');
});

test('policy.test: orden — require-approval gana sobre el deny-by-default final', () => {
  // Sin la regla crítica, este pedido caería en 'deny-by-default'. La regla
  // require-approval se evalúa antes, así que el motivo real es visible para
  // la UI (`critico-requiere-aprobacion`) en vez de un deny genérico.
  const d = evaluar(
    req({ tool: 'registrar_observacion', riskLevel: 'critical', origenArgumentos: 'usuario' }),
    ctx('agente-captura'),
  );
  assert.strictEqual(d.decision, 'require-approval');
  assert.strictEqual(d.policyId, 'critico-requiere-aprobacion');
});

// ── Lectura permitida ─────────────────────────────────────────────────────

test('policy.test: lectura-permitida — filtrar_base_instalada de bajo riesgo se permite', () => {
  const porHumano = evaluar(
    req({ tool: 'filtrar_base_instalada', args: { pais: 'Panama' }, riskLevel: 'low' }),
    ctx('agente-consulta'),
  );
  assert.strictEqual(porHumano.decision, 'allow');
  assert.strictEqual(porHumano.policyId, 'lectura-permitida');

  // También cuando el filtro lo armó el MODELO: es lectura, riesgo 'low', y
  // la regla de origen solo corta 'high'/'critical'. El modelo traduce la
  // pregunta a un filtro; la búsqueda la ejecuta código determinista.
  const porModelo = evaluar(
    req({
      tool: 'filtrar_base_instalada',
      args: { pais: 'Panama' },
      riskLevel: 'low',
      origenArgumentos: 'modelo',
    }),
    ctx('agente-consulta'),
  );
  assert.strictEqual(porModelo.decision, 'allow');
  assert.strictEqual(porModelo.policyId, 'lectura-permitida');
});

/*
 * Cuarta capa, agregada después de que estos tests destaparan el hueco:
 * `SecurityContext.principal` no se consultaba en NINGUNA regla. La única cosa
 * que separaba el export legítimo del inyectado era el string
 * `agenteId === 'ui-humano'`, y un string lo fija quien construye el contexto.
 *
 * El campo ya existía en el contrato sin usarse. Ahora el export exige además
 * que el principal SEA humano, así que un agente que se presente con el
 * `agenteId` de la UI no exporta.
 */
test('policy: el export exige un principal humano, no solo el agenteId de la UI', () => {
  const pedido = {
    tool: 'exportar_dataset',
    args: { filtro: {}, destino: EXPORT_HUMANO.destino },
    riskLevel: 'critical' as const,
    origenArgumentos: EXPORT_HUMANO.origenArgumentos,
  };

  const humano = evaluar(req(pedido), ctx(EXPORT_HUMANO.agenteId, 'humano'));
  assert.strictEqual(humano.decision, 'allow');
  assert.strictEqual(humano.policyId, 'export-local-por-humano');

  // Mismo pedido, mismo agenteId, mismos args: solo cambia QUIÉN es el
  // principal. Deja de estar permitido.
  const agente = evaluar(req(pedido), ctx(EXPORT_HUMANO.agenteId, 'agente'));
  assert.notStrictEqual(agente.decision, 'allow',
    'un principal no-humano no puede exportar aunque use el agenteId de la UI');
  assert.strictEqual(agente.policyId, 'critico-requiere-aprobacion',
    'cae en la aprobación fuera de banda, que es el comportamiento fail-closed');
});
