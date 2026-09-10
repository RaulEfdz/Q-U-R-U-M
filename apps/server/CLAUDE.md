# QUÓRUM · server (app central)

> **v0.2.0 · 2026-09-10** — corregido tras la auditoría. Ver `../../docs/AUDITORIA.md` para los hallazgos y `../../README.md` para el historial de versiones.

Node ≥22.17, TypeScript sin build step (`--experimental-strip-types`), 3 dependencias totales: `@qvac/sdk` (usar **0.18.2**, no la 0.17.1 del doc), `hyperswarm`, `zod`. Ver monorepo raíz `../../CLAUDE.md` para restricciones duras (sin nube, sin Vercel). Diagrama y decisiones: `ARCHITECTURE.md`. Trazabilidad y auditoría: `TRAZABILIDAD.md`. Reparto de trabajo entre agentes: `ORQUESTACION.md`.

**El código del doc maestro tiene bugs bloqueantes.** Ver §Correcciones obligatorias abajo. No copiarlo tal cual.

## Dónde corre la inferencia (regla de oro)

| Tarea | Motor | Dónde |
|---|---|---|
| Voz → texto | QVAC `transcribe` (whisper.cpp) | on-device |
| Texto → estructura | QVAC `completion()` + tool + Zod | on-device o delegado P2P |
| Todo lo demás (normalización, cohortes, quórum, puntaje, query) | código determinista | nunca inferencia |

Dictado: `MediaRecorder` → POST server local → whisper QVAC on-device. Nunca Web Speech API.

## Estructura prevista (del doc maestro §II.1)

```
src/
├── core/{ids,errors,contracts}.ts     # contratos Zod — congelados tras diseño
├── qvac/{gateway,extract,delegation}.ts
├── trust/{normalize,similarity,entity,reconcile,score}.ts   # ★ motor, puro, sin I/O
├── store/{observations,drafts,audit}.ts
├── policy/{engine,pep}.ts             # policy enforcement point
├── tools/{filtrar,exportar}.ts
├── context/spotlight.ts               # marca contenido peer como untrusted
├── export/philips.ts                  # CSV esquema exacto de 19 columnas
├── sync/peer.ts                       # Hyperswarm, Noise E2E
└── server/index.ts
ui/{index.html,app.js,style.css}       # sin framework, servido en 127.0.0.1
data/seed.json
test/{reconcile,cohortes,policy,injection,score}.test.ts
scripts/{seed,provider,probar-dht,verify-no-cloud.sh}.ts
```

## Reglas duras del motor (`trust/reconcile.ts`)

RD-0 sin datos nunca se rellena · RD-1 un observador no da quórum · RD-2 discrepancia = `Sin quórum`, nunca promedio · RD-3 un observador cuenta una vez (su testimonio más reciente) · RD-4 confianza por campo · RD-5 todos hedgeados → techo `Reportado` · RD-6 frescura desde `visitadoEn`, no `capturadaEn` · RD-7 solo testimonio `Directo` y asertivo da quórum.

Texto completo y código de referencia: `../../docs/QUORUM_documento_unico.md` §I.2, §II.8.

## Correcciones obligatorias al código del doc maestro

Bloqueantes de demo:

| # | Bug | Corrección |
|---|---|---|
| 1 | `evaluar()` corre `deny → require-approval → allow` y `critico-requiere-aprobacion` dispara con todo `riskLevel:'critical'`, que `exportarDataset` fija siempre → `export-local-por-humano` es inalcanzable y el export devuelve **403 siempre**. El test `doc:2517` lo prueba en rojo | Excluir el export humano de la regla crítica, o reordenar los efectos |
| 2 | `verify-no-cloud.sh` control 4: `grep -rniE 'philips\|…' src` matchea `A_STATUS_PHILIPS` en `contracts.ts` → con `set -euo pipefail` el script **siempre sale 1**. Se corre en vivo en el video | Excluir el identificador del patrón |
| 3 | El botón de dictar hace `rec.stop()` y `location.reload()` inmediato: el `onstop` asíncrono que hace el POST a `/api/transcribir` no alcanza a completar | Recargar dentro del `onstop`, después del POST |
| 4 | Las tools se declaran con Zod crudo (`parameters: zExtraccion`) sin convertir a JSON Schema, y zod 3.25 no trae `z.toJSONSchema` | Verificar qué espera el SDK y convertir. Si no arranca el tool calling, no hay captura ni consulta |
| 5 | El ataque del video: `/api/consultar` solo pasa `tools:[TOOL_FILTRAR]`, y la rama hace `zExportar.parse()` **antes** del PEP → `ZodError` → 500 sin evento `policy-denied` ni banner | Parsear después del PEP y capturar el `ZodError` |
| 6 | `iniciarSync()` nunca pasa `allowlist`, y la guarda es `if (opts.allowlist?.length && …)` → acepta cualquier peer, contra el "deny-by-default en el transporte" | Pasar la allowlist y rechazar si está vacía |
| 7 | `innerHTML` sin escapar en toda la UI con datos de peer (`cliente.nombre`, `marca`, `r.detalle`) → XSS que puede llamar `/api/confirmar` o `/api/exportar` | Escapar, o usar `textContent` |
| 8 | El spotlighting sanea el texto pero no el atributo `fuente`, que viene de `observadores.join(',')` — dato de peer. Un `"` o `</dato>` neutraliza el delimitador | Sanear también los atributos |
| 9 | `cargar()` hace `catch { memoria = [] }` y `/api/confirmar` persiste sin validar con `zObservacion` → una línea corrupta vacía la base instalada en el siguiente arranque | Validar al escribir; filtrar la línea mala al leer |
| 10 | El filtro del modelo nunca pasa por el PEP: el comentario dice que sí, la línea siguiente llama `ejecutarFiltro()` directo. `filtrar()` es código muerto y no hay auditoría del filtro | Enrutar por el PEP |
| 11 | La corroboración del puntaje cuenta testigos `Directo` sin mirar si convergen → un grupo en `Sin quórum` con 3 testigos contradictorios saca 30/30. Premia el estado menos confiable, contra RD-2 | Contar solo el clúster mayoritario |
| 12 | La edad nunca pasa por `resolverCampo`, solo genera cohortes → `Sin quórum` por edad **no existe** y el badge ▲ nunca aparece, aunque el escenario ② del seed se titula "② SIN QUÓRUM" | Resolver la edad como campo además de cohortes, o renombrar el escenario |
| 13 | `zExtraccion` acepta `edadAnios: z.number()` sin `int` ni tope; `zRangoEdad` exige entero 0-60 → un "7.5 años" lanza `ZodError` no capturado y se pierde la observación entera | Alinear los dos esquemas y degradar el lote, no la observación |
| 14 | La UI no permite corregir: `#campos` es solo lectura y `/api/confirmar` se llama solo con `borradorId`. H-03 promete "confirma, **corrige** o descarta" | Hacer editables los campos y emitir `correcciones` |
| 15 | `cargarLLMDelegado` no cachea y `/api/observar` la llama por request, sin `unloadModel` → fuga de instancias en la demo | Cachear |
| 16 | `hyperswarm` sin tipos bajo `strict` → `npm run typecheck` no puede pasar (TS7016 + `any` implícitos) | Declaración de módulo propia |

Menores: `eq()` usa `includes` (filtrar `pais:"US"` matchea "Australia"); el CSV exporta `i+1` como `Observation ID` en vez de `o.id`, rompiendo la trazabilidad con la auditoría; dos definiciones de frescura (180 vs 365 días); `/api/transcribir` deja `data/tmp/*.webm` sin borrar; `verificarCadena()` sin `catch` y `audit.ts` sin `mkdir('data')` → 500 al abrir Auditoría antes del primer registro.

## Skills, hooks y técnicas a usar en esta app

**Skills:**
- `security-audit` — corrida completa una vez que `policy/*` y `ui/app.js` tengan código. Los bugs A1/A2/B6/B9/B10 de `../../docs/AUDITORIA.md` son su dominio: OWASP, XSS, allowlist, spotlighting.
- `code-review` — en cada punto de aprobación entre fases de `ORQUESTACION.md`, antes de dejar avanzar al equipo a la fase siguiente.
- `run` — para levantar el server real (`node --experimental-strip-types src/server/index.ts`) y probar que algo funciona, no solo que compila.
- `fewer-permission-prompts` — cuando arranquen los teammates de `ORQUESTACION.md`, todos sus permission prompts caen en tu sesión lead; corrida temprana para preautorizar lo repetitivo.
- `simplify` — cleanup de reuse/eficiencia, después de `code-review`, no antes.

**Hooks a configurar (vía skill `update-config`):**
1. `PreToolUse` en `Edit`/`Write` sobre `core/contracts.ts` — bloquea toques sin tu aprobación explícita. Hoy la regla de "congelado" solo está en texto, no se hace cumplir.
2. `TaskCompleted` — corre `npm run typecheck` antes de que un teammate marque su tarea como terminada. Atrapa temprano el bug C8 (`hyperswarm` sin tipos bajo `strict`).
3. `TeammateIdle` — verifica que no haya corrido `npm install` sin `--ignore-scripts` en la sesión.

Opcional: `PreToolUse` sobre `Bash` bloqueando `curl`/`fetch` a dominios de inferencia en nube — refuerzo determinista de "cero nube", porque `verify-no-cloud.sh` hoy está roto (bug A2).

**Técnica:** `apps/server` usa Agent Teams (ver `ORQUESTACION.md`) — no `Workflow`/`ultracode`, no aplica acá.

## Antes de tocar código

1. `core/contracts.ts` es el contrato — no romper sin actualizar el doc maestro.
2. `.npmrc` tiene `ignore-scripts=true` — no lo saques. Si un addon nativo necesita rebuild, hacelo selectivo (`npm rebuild <pkg> --ignore-scripts=false`), nunca global, nunca en máquina con tokens de CI/prod.
3. `verify-no-cloud.sh` es el control que corre antes de cualquier demo. Son **5 controles automatizados, no 7**: el 5 nunca hace `exit 1` y el 7 es un `echo` manual. Arreglar eso o corregir el número en el README y el video.
4. **Prohibido `@qvac/ai-sdk-provider` y el Vercel AI SDK** (política de la organización). Usar `@qvac/sdk` puro.
5. `WHISPER_TINY` ya está en `~/.qvac/models` (2026-09-10). El README todavía no tiene paso de descarga del GGUF documentado, y el checklist exige arrancar en máquina virgen siguiendo solo el README — falta escribir ese paso, aunque el modelo ya esté en caché local.
