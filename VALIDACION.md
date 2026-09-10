# VALIDACIÓN QUÓRUM — cumplimiento de reglas duras

Corrida: 2026-09-10.

## Tabla de resultados

| # | Regla | Estado | Nota |
|---|---|---|---|
| 1 | Cero inferencia en la nube (OpenAI/Anthropic/Gemini/Groq/Together/HF/URLs externas, fetch/axios) | ✅ cumple | `grep -rniE` sin coincidencias en `apps/server/src` y `apps/mobile/src`. Sin `fetch(`/`axios.` a hosts externos. |
| 2 | Prohibido `SpeechRecognition`/Web Speech API | ✅ cumple | `grep -rniE 'SpeechRecognition\|webkitSpeechRecognition'` sin coincidencias. |
| 3 | Prohibido Vercel, `@qvac/ai-sdk-provider`, Vercel AI SDK (`ai`, `@ai-sdk/*`) | ✅ cumple | Sin coincidencias en código ni en `apps/mobile/package.json`. `apps/server` sin `package.json` todavía (nada que auditar ahí). |
| 4 | Cero credenciales/API keys/tokens/secretos hardcodeados | ✅ cumple | `grep` de patrones (`api_key=`, `sk-...`, `password=`, tokens largos) sin coincidencias en `src/` de ambas apps. |
| 5 | Solo marcas ficticias (NovaMed, Aurelia Health, BluePeak Medical, Orion Imaging, HelixCare, Zenith MedTech) | ✅ cumple | `MARCAS_DUMMY` en `core/contracts.ts` (idéntico en ambas apps) solo tiene esas 6. Únicas menciones de "Philips" son el nombre del cliente/reto y el mapeo de vocabulario de export (`A_STATUS_PHILIPS`, `export/philips.ts`), no una marca de equipo. |
| 6 | `.npmrc` con `ignore-scripts=true` en cada app con `package.json` | ⚠️ parcial | `apps/mobile/.npmrc` → `ignore-scripts=true` ✅. `apps/server` **no tiene `package.json` todavía** (confirmado, `ls apps/server/*.json` sin matches) → regla no aplica aún, no verificable como violación ni como cumplimiento pleno. |
| 7 | Ninguna dependencia con `preinstall`/`postinstall`/`install`/`binding.gyp` sin justificar | ✅ cumple (mobile) | Script recorrió `apps/mobile/node_modules` (449 paquetes top-level) buscando `scripts.preinstall/postinstall/install` en cada `package.json`: único hit fue `resolve/test/resolver/multirepo` (fixture de test interno del paquete `resolve`, no un script real de instalación). Sin `binding.gyp` en ningún paquete (`find ... -name binding.gyp` vacío). `apps/server` no tiene dependencias instaladas aún (no hay `package.json`/`node_modules`). |
| 8 | Versión anclada `@qvac/sdk` exactamente `0.18.2` | ✅ cumple | `apps/mobile/package.json:6` → `"@qvac/sdk": "0.18.2"` (sin `^`/`~`). Confirmado también en `package-lock.json:11`. `apps/server` aún sin `package.json`. |
| 9 | `core/contracts.ts` idéntico byte a byte entre server y mobile | ✅ cumple | `diff apps/server/src/core/contracts.ts apps/mobile/src/core/contracts.ts` → sin diferencias (salida vacía). |
| 10 | 10 archivos compartidos idénticos server↔mobile | ✅ cumple | `diff` corrido en los 10: `core/contracts.ts`, `core/ids.ts`, `trust/{normalize,similarity,entity,reconcile,score}.ts`, `policy/engine.ts`, `context/spotlight.ts`, `export/philips.ts` → **todos** sin diferencias. |
| 11 | `trust/score.ts`: corroboración mira `clusters[0].observadores` (clúster mayoritario), no todo `obs` a ciegas | ✅ cumple | `apps/server/src/trust/score.ts:37-41` (idéntico en mobile): calcula `observadoresClusterMayoritario` desde `campos.modalidad.clusters[0].observadores` (con fallback a `campos.modalidad.observadores` solo si no hay clusters), y `habilitados` (línea 43-47) filtra por ese set antes de contar `Directo && !hedging`. Corrección #11 presente. |
| 12 | `trust/reconcile.ts`: `resolverEdad()` + `campos.edad` dentro de `MIN_ESTADO` | ✅ cumple | `resolverEdad()` definida en `reconcile.ts:122-125`; `campos.edad: resolverEdad(...)` en línea 192; `estadoGeneral = MIN_ESTADO([..., campos.edad.estado])` en líneas 197-200. Corrección #12 presente. |
| 13 | `policy/engine.ts`: excepción de `critico-requiere-aprobacion` usa predicado EXACTAMENTE igual al de `export-local-por-humano` | ✅ cumple | Comparación línea a línea de ambos predicados (`engine.ts:40-43` vs `:51-53`): mismas 3 condiciones (`tool === 'exportar_dataset'`, `origenArgumentos === 'usuario'`, `args['destino'] === 'local'`) más el chequeo de allowlist del agente. Sin hueco de deny-by-default. Corrección #1 server presente. |
| 14 | `apps/mobile/src/qvac/pool.ts`: aserción `isDelegated !== false` (fail-closed) | ✅ cumple | `pool.ts:120` → `if (info.isDelegated !== false) { ...throw }`. No es `if (info.isDelegated)`. Corrección #5 mobile presente. |
| 15 | `apps/mobile` typechequea limpio (`npx tsc --noEmit`) | ✅ cumple | Corrido en `apps/mobile`: exit code 0, sin salida. `apps/server`: sin `package.json` ni `tsconfig.json` → no corrido, no creado (según instrucción explícita de no crearlo). |

*(Nota: la checklist original tenía 12 ítems pero listaba varios sub-chequeos dentro del ítem 11 y 12 de la tarea original; acá quedaron desagregados en 15 filas para trazabilidad 1 a 1 con lo pedido — cada fila corresponde a un chequeo concreto de la checklist recibida.)*

## Detalle de lo NO verificable / parcial

- **Regla 6 y 8 para `apps/server`**: no aplica todavía porque `apps/server` no tiene `package.json` (confirmado con `ls`). El repo lo documenta explícitamente (raíz `CLAUDE.md`: "Ambas apps son código todavía por escribir"). No es una violación — es un estado "aún no construido". Volver a correr esta verificación cuando `apps/server` tenga `package.json`.
- **Regla 7 para `apps/server`**: mismo motivo, sin `node_modules` que auditar.

## Resumen

- **Cumplen: 13 / 15** verificaciones concretas.
- **Parcial/no aplica todavía (⚠️): 2** — ambas por ausencia de `package.json` en `apps/server` (regla 6 y regla 8 en esa app), no por código incorrecto.
- **Violan (❌): 0.**

**Más urgente:** ninguna violación activa. Lo único a seguir de cerca: en cuanto `apps/server` tenga `package.json`, repetir de inmediato los chequeos de `.npmrc`/`ignore-scripts`, versión anclada de `@qvac/sdk` y `npm run typecheck` — hoy quedan sin cubrir por simple ausencia de archivo, no por corrección.
