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

---

> Las entradas de abajo son de la sesión de la mañana del 2026-09-10 (Fase 10
> de mobile: Cliente 360). El tramo entre las 01:45 y las 09:00 no quedó
> registrado acá; lo que se hizo ahí está en los commits `0ff9c57`,
> `932d7c6` y `8ba499d`.

- [x] **09:15** — Escrita la pantalla **Cliente 360** (`apps/mobile/src/app/Cliente360Screen.tsx`) con tres componentes nuevos: `components/InsigniaQuorum.tsx` (eje 2, glifos y colores literales de §II.20), `components/FilaCampo.tsx` (fila de confianza por campo + `FilaCohorte`) y `app/testigos.ts`. No consulta ninguna API: lee el store local y corre el mismo `trust/reconcile.ts` que el server. Decisiones tomadas: (1) `Sin quórum` muestra SIEMPRE todas las versiones con quién dijo cada una, sin colapsar detrás de un tap — esconderlo lo degradaba a detalle y es la tesis del proyecto; (2) los `observadorId` opacos de 20 caracteres se etiquetan como `Vos` / `Testigo A` por primera aparición cronológica, porque crudos hacían ilegible justo lo que la pantalla tiene que responder; (3) la frescura va como texto propio y nunca con el color del estado — el doc maestro §B.2 marca confundir esos dos ejes como el error de diseño más fácil acá.

- [x] **09:30** — Navegación de dos pestañas escrita a mano en `App.tsx`, sin `react-navigation`: la librería trae dependencias nativas nuevas y con ellas `expo prebuild --clean` obligatorio, con riesgo de tocar el linkeo de `react-native-bare-kit@0.14.5` (trampa #1). Las dos pantallas quedan MONTADAS y se alternan con `display`, porque desmontar Capturar al cambiar de pestaña perdería un borrador a medio confirmar sin haberlo persistido.

- [x] **09:45** — Verificada la lógica pura de la pantalla con un script temporal en Node (`--experimental-strip-types`): un observador cuenta como un solo testigo, etiquetas únicas pasando los 26 testigos y estables al reordenar la entrada, `Sin quórum` con dos clusters y `valor === undefined` (confirma que el motor NO promedia), quórum con dos directos, y dos cohortes de edad disparando `oportunidadRenovacion`. Todo pasó. `Cliente360Screen` y `FilaCampo` importan React Native y no corren en Node: quedaron para el smoke test en el teléfono.

- [x] **10:03** — **Primer smoke test real en el Pixel 7, y la app no arrancaba.** Metro fallaba con `UnableToResolveError: Unable to resolve module node:crypto`. Causa: `src/core/ids.ts` importaba `randomBytes` de `node:crypto`, que no existe en React Native. Es un bug PREEXISTENTE, no de Cliente 360: `CapturarScreen` ya dependía de ese archivo vía `identidad.ts`, así que la UI entregada la noche anterior tampoco habría arrancado. Salió ahora porque este fue el primer arranque real en el dispositivo — el `tsc --noEmit` verde nunca lo iba a detectar.

- [x] **10:10** — Barrido completo en vez de ir de uno en uno (`grep -rn "from 'node:"`): son CUATRO sitios, no uno. `core/ids.ts` (`randomBytes`), `context/spotlight.ts` (`randomBytes`), `pipeline/extractor.ts` (`createHash`) y `audit/trace.ts` (`createHash`).

- [x] **10:20** — Resuelto `core/ids.ts` sin dependencias: la fuente de aleatoriedad se decide en RUNTIME vía `globalThis.crypto.getRandomValues`, la única API presente en las dos plataformas (Node la trae como global desde la 18). La detección quedó DIFERIDA a propósito y no capturada en tiempo de import: leer el global al importar el módulo podía dejarlo cacheado antes de que el polyfill corriera. Se exporta `aleatoriedadDebil()` en vez de tapar el estado degradado con un `console.warn` — mismo criterio que la corrección #9.

- [x] **10:25** — Decisión de dependencias, con el trade-off puesto sobre la mesa antes de instalar. Los dos `createHash` necesitan SHA-256 **sincrónico**, y Hermes no trae Web Crypto ni `crypto.subtle` (que además es async). El delimitador de `context/spotlight.ts` es una defensa anti-inyección: su comentario dice *"el atacante no puede cerrar un delimitador cuyo valor no conoce"*, así que degradarlo a `Math.random()` no era aceptable. Instalados, con las versiones ancladas exactas y verificados antes: **`@noble/hashes@2.4.0`** (JS puro, cero dependencias, sin `preinstall`/`postinstall`/`install`, sin `binding.gyp`) y **`expo-crypto@57.0.2`** (cero dependencias, sin scripts de instalación, línea 57.x alineada con `expo@57.0.21`). `ignore-scripts=true` ya estaba activo. `npm audit` sigue dando las mismas 10 moderadas preexistentes de la cadena de Expo (raíz `uuid <11.1.1`, GHSA-w5hq-g745-h8pq, vía `xcode`), ninguna de los paquetes nuevos.

- [x] **10:28** — Verificado lo único que no podía fallar en silencio: que `@noble/hashes` produzca **el mismo** SHA-256 que `node:crypto`. Seis casos (vacío, acentos, emoji, JSON, 5000 chars) más el vector conocido de `'abc'`, todos idénticos. Si hubieran divergido, los hashes ya persistidos habrían dejado de validar y la cadena de auditoría del botón "Verificar integridad" mentiría. `ids.ts` y `spotlight.ts` se replicaron byte a byte a `apps/server`; sus 31 tests siguen verdes.

- [x] **10:30** — **Bug propio, encontrado y corregido antes de que llegara al dispositivo:** el polyfill de Web Crypto lo había escrito como un bloque de código dentro de `index.ts`, arriba de `import App from './App'`. Los `import` de ES modules se hoistean, así que App y todo su árbol de módulos se habrían evaluado ANTES del polyfill — exactamente lo contrario de lo que hacía falta. Movido a `src/platform/webcrypto.ts` con el efecto en el nivel superior, importado en primer lugar: los módulos sí se evalúan en el orden en que se importan.

- [x] **10:32** — App corriendo en el Pixel 7: `Android Bundled 1084 modules`, sin `UnableToResolveError`. Fase 10 arrancando de verdad en el dispositivo por primera vez.

- [x] **10:35** — Corregida la zona superior de la UI, que quedaba debajo de la barra de estado del sistema (hora, señal y batería encima del título), y la barra de pestañas pegada a la barra de gestos. Causa: la app corre **edge-to-edge** (obligatorio desde Android 15, por defecto en SDK 54+) y `SafeAreaView` de React Native está deprecado y no aplica insets en Android — el propio log lo avisaba. Instalado **`react-native-safe-area-context@5.7.0`**, la versión que pide el SDK 57 (no la 5.9.1 más nueva), verificada igual que las anteriores. Los insets se aplican a mano en cada barra en vez de envolver todo en un `SafeAreaView`, así el fondo de las barras llega al borde de la pantalla y solo el contenido se corre. Agregada `components/BarraSuperior.tsx` con la marca `● QUÓRUM` fija arriba de las dos pantallas — el glifo es el mismo que marca `Quórum` en el eje 2, no hay archivo de logo en `assets/` fuera del icono de launcher. Quitados los títulos duplicados que además se iban con el scroll.

- [x] **10:36** — **Dos bugs encontrados por mirar la pantalla, no por los tests.** (1) `app/testigos.ts` mostraba un "Testigo B" sin que existiera ningún "Testigo A": el índice 0 lo consumía "Vos" y la numeración de los demás arrancaba en B, y se leía como si faltara un testimonio. Corregido con un contador propio para los que llevan letra. (2) La fila `Edad` mostraba "13 · Quórum" en un grupo con 4 equipos de 3 años y 2 de 13: `resolverEdad` aplica RD-3 y ambos observadores terminaron declarando 13, así que el motor está bien, pero mostrado así se lee como si TODO el parque tuviera 13 años. La fila la había agregado yo; el mockup del doc maestro §B.2 no la lleva, justamente porque las cohortes cuentan esa historia mejor. Ahora solo se muestra cuando no hay cohortes. El estado del campo sigue pesando en `estadoGeneral` — eso lo decide `MIN_ESTADO` en el motor, no la pantalla.

- [x] **10:40** — **Cliente 360 verificada en el Pixel 7 con datos reales de un escenario de demo**, sembrado con `apps/mobile/dev/sembrar-demo.ts` (nuevo, herramienta de desarrollo: las 9 observaciones pasan `zObservacion.parse` antes de escribirse, y NO es una vía para saltear la confirmación humana — el código de la app sigue teniendo un único punto de escritura). Verificado en pantalla: `Quórum` en modalidad, marca y total; `Sin quórum` mostrando **3 (Vos)** vs **6 (Testigo A)** con el texto *"No se promedia"*, sin elegir ni promediar; dos cohortes con año de instalación derivado (≈2023 y ≈2013) y la nota de que son tandas, no una contradicción; los dos ejes juntos (`● Directo` por testigo y `● Quórum` por campo); frescura como tercer eje (*"sin verificar desde hace 7 meses"* sobre un grupo en `Estimado`); y puntajes 88/100, 84/100 y 50/100 con su desglose.

## Pendientes

- [ ] **`Cliente360Screen` y `FilaCampo` no tienen tests automáticos** — importan React Native y no corren bajo el runner de Node del server. Hoy están verificadas a mano en el dispositivo, con evidencia en las entradas de las 10:40. Si se toca la lógica de render, hay que volver a mirar la pantalla: el typecheck no alcanza (esta sesión lo demostró dos veces).

- [ ] **`aleatoriedadDebil()` no se muestra en ninguna parte de la UI.** Está exportada y hoy devuelve `false` en el teléfono porque `index.ts` instala el polyfill, pero si esa importación se rompiera o se reordenara, la app seguiría corriendo con `Math.random()` sin avisarle a nadie. Falta un indicador visible, del mismo tipo que el aviso de líneas corruptas que ya tiene Cliente 360.

- [ ] **`dispositivoId` se documenta en `core/contracts.ts` como "clave pública del peer" y todavía es solo un identificador**, no una clave. Cuando el sync entre peers pase a firmar de verdad, hay que revisar de dónde sale ese valor — con el polyfill instalado el random ya es criptográfico, pero el campo no es material de clave.

- [ ] Confirmar que el hook de `--ignore-scripts` en npm install realmente funciona (necesita reinicio de sesión de Claude Code, no confirmado en vivo todavía). Las tres instalaciones de esta sesión se hicieron pasando `--ignore-scripts` explícito, además del `ignore-scripts=true` del `.npmrc`.

- [ ] `policy/engine.ts` tiene el bug #1 sin arreglar — no copiar la versión arreglada de vuelta a mobile hasta que se apruebe el fix de "server-lead".

- [ ] 10 vulnerabilidades npm moderadas aceptadas sin forzar fix (uuid vía xcode, tooling iOS no usado en este proyecto Android-only) — revisar si esto cambia si en algún momento se agrega soporte iOS.

- [ ] Decisión de prioridad escritorio-vs-móvil para el hackathon sigue sin tomar (mencionada en ambos ARCHITECTURE.md, no es tema de esta bitácora resolverla, solo señalar que sigue abierta).

- [ ] `JAVA_HOME` hay que pasarlo en cada build (`JAVA_HOME=/opt/homebrew/opt/openjdk@17 npx expo run:android`) porque el JDK quedó keg-only sin symlink al sistema — decidir si conviene agregarlo al `.zshrc` o dejarlo explícito por comando.

- [ ] Falta `qvac.config.json` con `bareRuntimeVersion` para que el chequeo de ABI del runtime Bare sea determinista, y `react-native-bare-kit` no se está resolviendo (el bundle linkea todos los addons nativos en vez de solo los que usamos: whisper + llamacpp). Revisar si esto infla el APK o rompe algo en el dispositivo.

- [ ] **El pipeline de modelos no se probó en esta sesión.** Cliente 360 se verificó con datos sembrados; capturar una nota de punta a punta en el teléfono (portero + extractor + verificador corriendo on-device) sigue sin evidencia en el dispositivo.
