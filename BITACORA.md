# Bitácora QUÓRUM

**Fecha:** 2026-09-10

## Hechos completados

- [x] **00:20** — Configurados 2 hooks en `.claude/settings.json` de QURUM: PreToolUse bloqueando Edit/Write sobre `core/contracts.ts` sin aprobación, y PreToolUse bloqueando `npm install`/`npm ci` sin `--ignore-scripts`. (Nota: el primer intento del hook de npm tenía un campo `"if"` inválido que lo invalidaba silenciosamente; se corrigió sacándolo, pero requiere reinicio de sesión para tomar efecto — no confirmado aún que esté activo).

- [x] **00:25** — Gate previo de mobile completado: `qvac doctor` OK (Metal en Mac, no aplica a Android pero confirma CLI funcional), modelos WHISPER_TINY y QWEN3.5-0.8B-Q4_K_M ya en `~/.qvac/models`, Pixel 7 conectado por USB con soporte Vulkan (Mali, compute level 1) confirmado por adb.

- [x] **00:29** — `core/contracts.ts` escrito y congelado en `apps/server/src/core/` con 2 correcciones agregadas sobre la fuente original: campo `estadoRevision` en `Borrador` (no en `Observacion`, tras corrección pedida) para notas con pregunta sin responder, y campo `edad: CampoResuelto<RangoEdad>` agregado a `GrupoEquipo.campos` (bug #12 de server/CLAUDE.md: la edad no resolvía como campo, solo como cohortes).

- [x] **00:34** — Escritos y copiados sin diferencias a `apps/mobile/src/`: `core/ids.ts`, `trust/{normalize,similarity,entity,reconcile,score}.ts`, `policy/engine.ts`, `context/spotlight.ts`, `export/philips.ts`. `score.ts` con corrección #11 aplicada (corroboración solo cuenta el clúster mayoritario de modalidad, no todos los testigos a ciegas). `reconcile.ts` con corrección #12 aplicada (nuevo campo edad resuelto vía `resolverCampo`, sumado a `MIN_ESTADO` de `estadoGeneral`).

- [x] **00:39** — Bug encontrado y corregido en ambas copias de `reconcile.ts` (server y mobile): predicado de tipo `(x): x is number` sobre un genérico `T` no compilaba bajo TypeScript strict; se cambió a `(x): x is T & number`.

- [x] **00:43** — PENDIENTE DELEGADO: bug #1 de `apps/server/CLAUDE.md` — el `policy/engine.ts` compartido (copiado igual a mobile) tiene un bug real: el orden de evaluación `deny → require-approval → allow` hace que la regla `critico-requiere-aprobacion` dispare siempre sobre `riskLevel:'critical'`, y como `exportar_dataset` siempre fija ese nivel, la regla `export-local-por-humano` (que sí permitiría el export) nunca se alcanza → el export queda bloqueado siempre. Delegado a teammate "server-lead"; una vez aprobado hay que volver a copiar `policy/engine.ts` a mobile.

- [x] **00:48** — Proyecto Expo inicializado en `apps/mobile` (blank-typescript, Expo ~57.0.21, React 19.2.3, React Native 0.86.3), mergeado sin pisar los docs existentes (`ARCHITECTURE.md`, `CLAUDE.md`, `ORQUESTACION.md`, `TRAZABILIDAD.md`, `src/`). `.npmrc` con `ignore-scripts=true` creado ANTES de cualquier instalación. `package.json` renombrado de `qurum-mobile-init` a `qurum-mobile`, agregado script `typecheck: tsc --noEmit`.

- [x] **00:52** — Instaladas dependencias: `@qvac/sdk@0.18.2` (versión exacta pedida por CLAUDE.md, no la 0.17.1 del doc maestro), `zod@3.25.76` (fijado explícito porque los contratos lo importan y no estaba como dependencia directa), `@types/node`, `expo-build-properties`. Todas con `--ignore-scripts`. Verificado: ningún paquete de `@qvac/*` tiene scripts `preinstall`/`postinstall` ni `binding.gyp` propios (traen binarios prebuildeados).

- [x] **00:57** — 10 vulnerabilidades npm moderadas detectadas (root: `uuid` con bug de buffer bounds check, arrastrado por `xcode` → `@expo/config-plugins` → el resto de paquetes `@expo/*`). Decisión tomada: no forzar el fix (rompería el pin de Expo SDK 57), riesgo aceptado porque es tooling de build iOS y el proyecto es Android-only.

- [x] **01:02** — `tsconfig.json` de mobile ajustado: agregado `types: ["node"]`, `allowImportingTsExtensions: true`, `noEmit: true` (los imports usan extensión `.ts` explícita, estilo del server con `--experimental-strip-types`).

- [x] **01:06** — Escrito `apps/mobile/src/qvac/pool.ts` desde cero (no existe en el doc maestro, es módulo nuevo de mobile): corrige bug #5 (aserción `isDelegated !== false` en vez de `if (info.isDelegated)` que era fail-open) y bug #7 (agrega presupuesto de RAM con eviction bajo presión y un mapa de promesas en vuelo para deduplicar cargas concurrentes del mismo rol — el bug original cargaría el mismo modelo de 1.1GB dos veces si dos `obtener()` corrían a la vez). Usa las constantes reales del SDK como objetos importados (`WHISPER_TINY`, `QWEN3_5_0_8B_MULTIMODAL_Q4_K_M`, `QWEN3_1_7B_INST_Q4`), no strings inventados como la fuente original (`QWEN3_5_0_8B_INST_Q4` no existe).

- [x] **01:11** — `App.tsx` reescrito como "hola mundo": al montar, llama `obtener('portero')` del pool y muestra en pantalla si cargó OK o el error.

- [x] **01:16** — `app.json`: agregado `"android": {"package": "io.qurum.mobile"}`, plugin `"@qvac/sdk/expo-plugin"` (el nombre corto `"@qvac/sdk"` no resuelve, hay que usar el subpath exacto del `exports` map del package.json del SDK). Slug cambiado a `qurum-mobile`, nombre mostrado a "QUÓRUM".

- [x] **01:20** — PENDIENTE EN CURSO: corriendo `npx expo prebuild --platform android` para generar la carpeta nativa `android/` y poder instalar en el Pixel 7 conectado. Encontrado y resuelto sobre la marcha: faltaba `expo-build-properties` como dependencia (peer que pide el plugin de qvac), se instaló. El prebuild todavía no terminó de correr exitosamente al momento de escribir esta bitácora.

- [x] **01:25** — Creado teammate "server-lead" (Sonnet) trabajando en paralelo en `apps/server`: primero arreglando el bug #1 de policy/engine.ts (pendiente de aprobación), después Fase 3 (qvac/gateway.ts, qvac/extract.ts, qvac/delegation.ts).

- [x] **01:30** — Actualizado `apps/server/ORQUESTACION.md` con sección de estado agregada al principio, documentando qué fases están hechas y el bug #1 pendiente.

- [x] **01:35** — `expo prebuild --platform android` corrió OK tras dos fallos previos: primero el plugin no resolvía con el nombre corto `"@qvac/sdk"` (hay que usar el subpath `"@qvac/sdk/expo-plugin"`), después faltaba `expo-build-properties` como dependencia. El prebuild generó la carpeta nativa `android/`, fijó arquitectura arm64-v8a, NDK 29.0.14206865, y agregó exclusión de OpenCL en packagingOptions. Warnings a tener en cuenta: `react-native-bare-kit` no encontrado en node_modules ancestros (el bundle linkea todos los addons nativos en vez de solo los necesarios), y no hay `qvac.config.json` para pinear `bareRuntimeVersion` (el runtime Bare se auto-detecta, sin chequeo determinista de ABI).

- [x] **01:45** — Primer intento de `expo run:android` falló: no había ningún JDK utilizable en la máquina (`/usr/libexec/java_home -V` decía "Unable to locate a Java Runtime" aunque brew tenía openjdk, openjdk@11 y openjdk@21 instalados pero keg-only, sin symlink a /Library/Java/JavaVirtualMachines). Se instaló `openjdk@17` vía brew y se relanzó el build seteando `JAVA_HOME=/opt/homebrew/opt/openjdk@17` en el comando, sin usar sudo ni symlinks al sistema. Build en curso al momento de escribir esto.

## Pendientes

- [ ] Confirmar que el hook de `--ignore-scripts` en npm install realmente funciona (necesita reinicio de sesión de Claude Code, no confirmado en vivo todavía).

- [ ] `policy/engine.ts` tiene el bug #1 sin arreglar — no copiar la versión arreglada de vuelta a mobile hasta que se apruebe el fix de "server-lead".

- [ ] Expo prebuild de mobile en curso, no confirmado que termine bien ni que corra en el Pixel 7 todavía (Fase 3 "hola mundo" del orden de construcción, no completada).

- [ ] 10 vulnerabilidades npm moderadas aceptadas sin forzar fix (uuid vía xcode, tooling iOS no usado en este proyecto Android-only) — revisar si esto cambia si en algún momento se agrega soporte iOS.

- [ ] Decisión de prioridad escritorio-vs-móvil para el hackathon sigue sin tomar (mencionada en ambos ARCHITECTURE.md, no es tema de esta bitácora resolverla, solo señalar que sigue abierta).

- [ ] `JAVA_HOME` hay que pasarlo en cada build (`JAVA_HOME=/opt/homebrew/opt/openjdk@17 npx expo run:android`) porque el JDK quedó keg-only sin symlink al sistema — decidir si conviene agregarlo al `.zshrc` o dejarlo explícito por comando.

- [ ] Falta `qvac.config.json` con `bareRuntimeVersion` para que el chequeo de ABI del runtime Bare sea determinista, y `react-native-bare-kit` no se está resolviendo (el bundle linkea todos los addons nativos en vez de solo los que usamos: whisper + llamacpp). Revisar si esto infla el APK o rompe algo en el dispositivo.
