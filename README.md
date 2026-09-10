# Q-U-R-U-M

> **La verdad tiene quórum.**

Un testigo no es la verdad. La verdad es lo que varios testigos independientes sostienen.
**El modelo entiende lo que vio cada persona. El sistema decide qué podemos creer.**

Reto corporativo *Customer Installed Base Intelligence* (Philips) · Decentralized AI Hackathon · ISD Summit, Ciudad de Panamá.
Requisito duro: inferencia on-device o delegada P2P con QVAC. **Nube prohibida en inferencia.**

---

## Versión

| Componente | Versión | Fecha |
|---|---|---|
| Monorepo | **v0.3.0** | 2026-09-10 |
| `apps/server` | v0.3.0 | 2026-09-10 |
| `apps/mobile` | v0.3.0 | 2026-09-10 |

Estado: **primer código**. Núcleo compartido escrito y congelado (contratos + motor de quórum), `apps/mobile` con proyecto Expo inicializado y pool de modelos QVAC. Bitácora de avance en `BITACORA.md`, validación de reglas duras en `VALIDACION.md`.

Esquema de versionado: `MAJOR.MINOR.PATCH`. Mientras no exista código, `MINOR` sube con cada revisión de diseño que cambia decisiones; `PATCH` con correcciones puntuales de documentación. La versión de cada app vive en la cabecera de su `CLAUDE.md`.

---

## Estructura

```
apps/
├── server/   # app central — motor de reconciliación, store, QVAC, UI en 127.0.0.1
└── mobile/   # app celular Android/Expo — pipeline de 3 modelos on-device
docs/
├── QUORUM_documento_unico.md      # documento maestro (fuente de verdad)
├── QUORUM_documento_maestro.pdf
├── QUORUM_pipeline_android.md     # Anexo D — pipeline mobile
├── QUORUM_pipeline_android.pdf
└── AUDITORIA.md                   # hallazgos de la revisión del 2026-09-10
```

Cada carpeta tiene `CLAUDE.md` (reglas), `ARCHITECTURE.md` (diseño y diagrama), `TRAZABILIDAD.md` (auditoría) y `ORQUESTACION.md` (reparto de tareas entre agentes Haiku/Sonnet).

---

## Historial de cambios

### v0.3.0 — 2026-09-10

Primer código del proyecto. Núcleo compartido escrito y congelado, `apps/mobile` inicializada como app Expo con el SDK de QVAC. Desarrollo repartido entre agentes Haiku/Sonnet según `ORQUESTACION.md`.

**Añadido — núcleo compartido** (idéntico byte a byte en `apps/server/src/` y `apps/mobile/src/`)
- `core/contracts.ts` — contratos Zod, **congelado**. Dos campos agregados sobre el doc maestro: `estadoRevision` en `Borrador` (la regla "máximo 1 pregunta por nota, nunca se descarta" estaba declarada pero no modelada) y `campos.edad` en `GrupoEquipo` (bug #12).
- `core/ids.ts`, `core/errors.ts` — ULID ordenable por tiempo y jerarquía de errores fail-closed.
- `trust/{normalize,similarity,entity}.ts` — normalización con tabla de sinónimos, Jaro-Winkler, clave de grupo y detección de candidatos a fusión.
- `trust/reconcile.ts` — el motor de quórum, RD-0 a RD-7. Con corrección **#12**: la edad ahora se resuelve como campo (`resolverEdad`) además de generar cohortes, y entra en el cálculo de `estadoGeneral` — antes `Sin quórum` por discrepancia de edad era inalcanzable.
- `trust/score.ts` — puntaje de tres factores. Con corrección **#11**: la corroboración solo cuenta el clúster mayoritario, no todos los testigos a ciegas (antes un grupo en `Sin quórum` con 3 testigos contradictorios sacaba 30/30, premiando el estado menos confiable).
- `policy/engine.ts` — PDP determinista, deny-overrides, deny-by-default. Con corrección **#1**: excepción quirúrgica en `critico-requiere-aprobacion` para el export local iniciado por humano, que antes quedaba bloqueado siempre (la regla `allow` era inalcanzable). El predicado de la excepción es idéntico al de la regla `allow` para no dejar huecos hacia `deny-by-default`.
- `context/spotlight.ts` — empaquetado de contenido untrusted con delimitador aleatorio por sesión.
- `export/philips.ts` — CSV en el esquema exacto de 19 columnas del workbook.

**Añadido — `apps/mobile`**
- Proyecto Expo inicializado (SDK ~57, React Native 0.86.3, TypeScript estricto), `.npmrc` con `ignore-scripts=true` **antes** de la primera instalación.
- `src/qvac/pool.ts` — pool de los tres modelos on-device. Módulo nuevo, no existe en el doc maestro. Con correcciones **#5** (aserción `isDelegated !== false`, fail-closed: la versión original era fail-open y dejaba pasar la delegación si el SDK omitía el campo) y **#7** (presupuesto de RAM con eviction bajo presión, y mapa de promesas en vuelo para que dos `obtener()` concurrentes no carguen 1.1 GB dos veces).
- Identificadores de modelo corregidos: son objetos descriptores importados del SDK (`WHISPER_TINY`, `QWEN3_5_0_8B_MULTIMODAL_Q4_K_M`, `QWEN3_1_7B_INST_Q4`), no strings. El `QWEN3_5_0_8B_INST_Q4` que usaba la fuente no existe en el registro.
- `App.tsx` — "hola mundo" del paso 3 del orden de construcción: carga el portero real y reporta resultado.
- Dependencias ancladas: `@qvac/sdk@0.18.2` exacto, `zod@3.25.76` exacto.

**Corregido (encontrado durante la escritura)**
- `trust/reconcile.ts`: predicado de tipo `(x): x is number` sobre un genérico `T` no compila bajo `strict`; cambiado a `(x): x is T & number`.
- Config plugin de QVAC: se declara como `@qvac/sdk/expo-plugin` (el nombre corto `@qvac/sdk` no resuelve), y requiere `expo-build-properties` como dependencia.

**Añadido — documentación**
- `BITACORA.md` — bitácora cronológica de avance, decisiones y pendientes.
- `VALIDACION.md` — verificación automatizada de las reglas duras (sin nube, sin Vercel, sin Web Speech API, `ignore-scripts`, marcas ficticias, contratos congelados, paridad server↔mobile).
- Sección de estado en `apps/server/ORQUESTACION.md` con las fases completadas.

**Pendiente conocido**
- El "hola mundo" en el Pixel 7 todavía no se completó: el build nativo requirió instalar JDK 17 y declarar `sdk.dir`, y está descargando NDK 29 + CMake.
- 10 vulnerabilidades npm moderadas aceptadas sin forzar fix (`uuid` vía `xcode` → `@expo/config-plugins`): es tooling de build iOS y el proyecto es Android-only. Revisar si se agrega iOS.
- Falta `qvac.config.json` con `bareRuntimeVersion` para que el chequeo de ABI del runtime Bare sea determinista.

### v0.2.1 — 2026-09-10

**Añadido**
- `apps/server/ARCHITECTURE.md` — diagrama de flujo, tabla de dónde ocurre la inferencia, modelo de confianza, decisiones cerradas y estructura de carpetas (paridad con `apps/mobile/ARCHITECTURE.md`, que ya existía).
- `apps/server/TRAZABILIDAD.md` — extiende el Anexo C del doc maestro con los HIGH VALUE 9-11 (sync, delegación, PEP) que no tenían fila, más diseño de `AuditRecord` hash-encadenado y qué responde ante un auditor.
- `apps/server/ORQUESTACION.md` y `apps/mobile/ORQUESTACION.md` — reparto del trabajo de desarrollo entre agentes **Haiku** (tareas mecánicas) y **Sonnet** (motor, políticas, seguridad), por fases con dependencias explícitas y gate previo.

### v0.2.0 — 2026-09-10

Auditoría completa de los dos documentos fuente (3630 + 843 líneas) y verificación en vivo contra el `@qvac/sdk` instalado. **56 hallazgos**, de los cuales 7 bloquean la demo y 11 tocan el cumplimiento del reto. Reporte completo en `docs/AUDITORIA.md`.

**Añadido**
- `docs/AUDITORIA.md` — hallazgos agrupados en 8 secciones (bloqueantes, cumplimiento, bugs del motor, modelos y SDK, diagramas, runbook, huecos de estructura, errores propios).
- `README.md` — este archivo, con versionado e historial.
- Sección de correcciones obligatorias en `apps/server/CLAUDE.md` (16 bugs) y `apps/mobile/CLAUDE.md` (14 bugs).
- Identificadores reales de modelo, verificados contra el SDK, en `apps/mobile/CLAUDE.md`.

**Corregido**
- **Modelos.** `QWEN3_5_0_8B_INST_Q4` no existe: la constante real del portero es `QWEN3_5_0_8B_MULTIMODAL_Q4_K_M` (533 MB). Las constantes del SDK son objetos, no strings. El `query` de `modelRegistrySearch` no filtra.
- **Presupuesto de RAM** recalculado con los tamaños reales: 2.1 GB, no 2.3 GB.
- **El atajo del pipeline ya no es rama terminal** — vuelve al enrutador y termina en el borrador. Dibujarlo como "se GUARDA" contradecía "nada se persiste sin confirmación humana".
- **`procesarNota()`**, no `cruzar()`: la función tenía otro nombre en los tres documentos derivados.
- **Ocho módulos nuevos en mobile**, no dos. Se decía "solo cambia el store y la UI".
- **`isDelegated !== false`** en vez de la comparación truthy: la original es fail-open sobre la restricción que descalifica.
- **`expo-audio`** en vez de `expo-av`, removido en Expo SDK 54.
- Recuperadas tres reglas de dominio que se habían perdido al resumir: la definición de **lote** (evita el conflicto falso 2-vs-1 del bug H-02), que **`hedging` lo detecta el código** y no el modelo, y la **regla exacta de tolerancia del verificador** de evidencia.
- Añadida la prohibición de `@qvac/ai-sdk-provider` y el Vercel AI SDK, que faltaba en los tres `CLAUDE.md`.
- `TRAZABILIDAD.md` marcado como extensión propia: no está en la fuente.

**Verificado y descartado**
- La sospecha de que zod 4.3.6 rompería los contratos escritos para zod 3: se corrieron los esquemas y todos pasan. No hay que tocar nada.

**Encontrado, sin resolver**
- Faltan `WHISPER_TINY` y `Qwen3.5-0.8B` en `~/.qvac/models`: hoy no corre ni la voz del server ni el pipeline mobile.
- El export humano queda denegado siempre por el orden de efectos del policy engine.
- `verify-no-cloud.sh` sale `exit 1` siempre por su propio control nº4.
- El pitch afirma cosas que el sistema no hace ("la IA corriendo dentro del teléfono", "sin que el dato salga del dispositivo").

### v0.1.0 — 2026-09-10

- Monorepo inicial: `apps/server`, `apps/mobile`, `docs/`.
- `CLAUDE.md` en la raíz y por app con las restricciones duras del reto.
- `apps/mobile/ARCHITECTURE.md` y `apps/mobile/TRAZABILIDAD.md`.
- Documentos fuente incorporados a `docs/`.

---

## Restricciones duras

- **Cero inferencia en la nube.** Ninguna API de OpenAI, Anthropic, Gemini, Groq, Together, Replicate ni HuggingFace Inference. ISD lo verifica antes de pasar las entregas a Philips.
- **Nada de Vercel** — deploy, previews, CI/CD, ni el Vercel AI SDK. Política de la organización.
- **Web Speech API prohibida**: envía el audio a servidores del proveedor. Es inferencia en la nube.
- **Nada se persiste sin confirmación humana.**
- Dependencias npm: verificar antes de instalar, ojo con `postinstall`/`preinstall`/`binding.gyp`, versiones ancladas, `ignore-scripts=true`.
- Solo marcas ficticias: NovaMed, Aurelia Health, BluePeak Medical, Orion Imaging, HelixCare, Zenith MedTech.

## Principio rector

> **El LLM entiende. El código decide. El humano confirma.**
