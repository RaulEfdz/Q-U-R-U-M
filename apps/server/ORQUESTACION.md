# QUÓRUM server — Orquestación con Agent Teams (Haiku + Sonnet)

> Solo dos modelos: **Haiku** (mecánico, sin ambigüedad) y **Sonnet** (lógica, seguridad, políticas). Nunca Opus.

Usar [Agent Teams](https://code.claude.com/docs/en/agent-teams): los teammates comparten task list y se mensajean directo, sin pasar por vos para cada resultado.

## Activar

```json
// .claude/settings.json del repo
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

## Reglas de equipo

- 3-5 teammates por fase, no más.
- Modelo explícito en el prompt de spawn ("en Haiku" / "en Sonnet" por cada teammate) — si no se nombra, hereda el del lead.
- Un archivo, un dueño: las fases de abajo ya particionan por archivo para evitar overwrites.
- El contrato de la tarea va completo en el prompt de spawn — el teammate no hereda esta conversación.
- No dejar que el lead implemente en lugar de esperar al equipo; decile explícito que espere si eso pasa.

Base: estructura de `CLAUDE.md` §Estructura prevista + tabla de correcciones obligatorias (16 bugs). Cada agente recibe el contrato de su archivo y, si aplica, la corrección puntual — no el doc maestro completo.

## Regla de asignación

| Modelo | Cuándo |
|---|---|
| **Haiku** | `core/ids.ts`, `core/errors.ts`, tests cuyo caso ya está enumerado, CSV/export mecánico una vez que el mapeo de columnas está definido, UI de solo lectura |
| **Sonnet** | `trust/reconcile.ts`, `policy/engine.ts` + `pep.ts`, `sync/peer.ts`, `context/spotlight.ts`, cualquier endpoint de `server/index.ts`, y cualquiera de las 16 correcciones de `CLAUDE.md` |

## Gate previo

1. `core/contracts.ts` se escribe una vez, con un solo agente Sonnet, y se congela. Nadie más lo toca sin tu aprobación.
2. Confirmar `@qvac/sdk@0.18.2` instalado (no 0.17.1 del doc) y modelos en `~/.qvac/models` — falta `WHISPER_TINY`.
3. Las 16 correcciones de `CLAUDE.md` §Correcciones obligatorias se aplican **durante** la escritura de cada archivo, no como parche después. Cada agente que escribe un archivo con una corrección asociada la recibe en el prompt.

## Fases y asignación

### Fase 1 — Núcleo (Sonnet → Haiku)
1. `core/contracts.ts` — **Sonnet**, único agente, después congelado.
2. `core/ids.ts`, `core/errors.ts` — **Haiku**, en paralelo entre sí, dependen solo de que `contracts.ts` exista.

### Fase 2 — Trust (Sonnet, mayormente secuencial)
`trust/normalize.ts` → **Haiku** (tablas de sinónimos y hedges ya están completas en el doc, es transcripción).
`trust/similarity.ts` → **Haiku** (Jaro-Winkler es un algoritmo cerrado, sin decisiones de negocio).
`trust/entity.ts` → **Sonnet** (política de fusión de duplicados: "duplicado visible mejor que fusión silenciosa" es una decisión, no mecánica).
`trust/reconcile.ts` → **Sonnet**, único agente, con las 7 reglas RD-0..RD-7 explícitas en el prompt línea por línea. **No dividir entre agentes** — es el motor, y dividirlo garantiza que una regla quede mal cableada con otra.
`trust/score.ts` → **Sonnet**, depende de `reconcile.ts` aprobado (corrección #11: corroboración debe mirar convergencia, no solo conteo).

### Fase 3 — QVAC (Sonnet)
`qvac/gateway.ts`, `qvac/extract.ts`, `qvac/delegation.ts` — todos Sonnet, secuenciales. Tocan la superficie de tool calling (corrección #4: Zod crudo vs JSON Schema) y la aserción `isDelegated`, que no admite error.

### Fase 4 — Policy (Sonnet, secuencial y crítico)
`policy/engine.ts` primero, `policy/pep.ts` después, mismo agente o con el diff del primero en el prompt del segundo. Corrección #1 (`export-local-por-humano` inalcanzable) se resuelve acá — es el bug que bloquea toda la demo de export. Un Haiku no debería tocar el orden de evaluación de efectos.

### Fase 5 — Tools y export (mixto)
`tools/filtrar.ts` → **Sonnet** (corrección #10: debe pasar por el PEP, ahí está el bug).
`export/philips.ts` → **Haiku** una vez que el mapeo de las 19 columnas está fijado por vos — es transcripción mecánica, pero verificar la corrección menor del `Observation ID` (`o.id`, no `i+1`).
`tools/exportar.ts` → **Sonnet** ("la tool peligrosa" — riskLevel crítico, no delegar el criterio).

### Fase 6 — Store (Haiku con revisión Sonnet)
`store/observations.ts`, `store/drafts.ts`, `store/audit.ts` → **Haiku** en paralelo, cada uno con su contrato. Corrección #9 (no vaciar el store ante línea corrupta) y la de `audit.ts` sin `mkdir('data')` van explícitas en el prompt. Un agente Sonnet revisa los tres al final antes de aceptarlos — persistencia rota es silenciosa y cara.

### Fase 7 — Sync (Sonnet)
`sync/peer.ts` — único agente. Corrección #6: la allowlist debe aplicarse de verdad, no quedar en `opts.allowlist?.length &&`.

### Fase 8 — Server HTTP (Sonnet)
`server/index.ts` — único agente, no paralelizar endpoints: comparten el mismo estado de policy/store y dividirlo entre agentes duplica lógica de validación. Corrección #3 (orden `stop`/reload en el dictado) y #5 (parsear `zExportar` después del PEP, no antes) van en el prompt.

### Fase 9 — UI (Haiku con excepción Sonnet)
`ui/{index.html,style.css}` → **Haiku**.
`ui/app.js` → **Sonnet** para las partes que tocan `innerHTML` con datos de peer (corrección #7: XSS) y el flujo de confirmar/corregir/descartar (corrección #14). El resto (fetch, render de listas propias) puede ir a Haiku si se separa el archivo en dos módulos.

### Fase 10 — Scripts y verificación (Haiku + 1 Sonnet)
`scripts/seed.ts`, `scripts/provider.ts` → **Haiku**, con el contrato de datos ya definido.
`scripts/verify-no-cloud.sh` → **Sonnet** — tiene el bug conocido (corrección #2, el grep se automatcha) y hay que decidir qué excluir sin abrir un agujero real.

### Fase 11 — Tests (Haiku, en paralelo, al final de cada módulo)
Un agente Haiku por archivo de test, lanzado apenas su módulo correspondiente está aprobado: `reconcile.test.ts`, `cohortes.test.ts`, `policy.test.ts` (falta en el doc, hay que crearlo), `injection.test.ts`, `score.test.ts` (falta en el doc, hay que crearlo). Los casos ya están descritos en el doc maestro y en `AUDITORIA.md` §G — no requieren diseño, sí requieren que existan (el doc declara 5 y solo escribe 3).

## Cómo invocar

Mensaje en lenguaje natural al lead, por fase:

```text
Spawn 2 teammates en Haiku, "ids" y "errors", para escribir
core/ids.ts y core/errors.ts de apps/server/CLAUDE.md §Estructura, uno
cada uno. Pasales el contrato completo de cada archivo desde el doc maestro.
```

```text
Spawn un teammate en Sonnet llamado "motor" con la Fase 2 de
apps/server/ORQUESTACION.md: trust/reconcile.ts, con las 7 reglas
RD-0..RD-7 pegadas línea por línea. No dividir esto entre teammates.
```

**No lanzar una fase antes de que la anterior esté aprobada por vos.** `reconcile.ts`, `policy/engine.ts` y `server/index.ts` no se paralelizan entre teammates bajo ninguna circunstancia — van solos, un teammate, sin compañía en esa fase.

**Roles reutilizables:** si un rol se repite (ej. "escritor de tests Haiku" en la Fase 11), definilo como [subagent](https://code.claude.com/docs/en/sub-agents) en `.claude/agents/` con `model: haiku` fijo, y nombralo al spawnear en vez de repetir el contrato.

## Qué NO delegar a ningún agente

- Congelar o modificar `core/contracts.ts` sin tu revisión.
- Aceptar un fix de las 16 correcciones de `CLAUDE.md` sin comparar el diff contra la tabla.
- Decidir el orden de evaluación de `policy/engine.ts` — es donde vive el bug que bloquea el export; un cambio mal pensado ahí puede abrir el `allow` a algo que debía ser `deny`.
