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
| Monorepo | **v0.4.0** | 2026-09-10 |
| `apps/server` | v0.4.0 | 2026-09-10 |
| `apps/mobile` | v0.4.0 | 2026-09-10 |

Estado: **las dos apps corren en su plataforma real**. `apps/server` sirve las nueve rutas de la API y las cuatro pantallas de escritorio en 127.0.0.1; `apps/mobile` arranca en un Pixel 7 con las tres pantallas y el pipeline de tres modelos corriendo on-device. Bitácora de avance en `BITACORA.md`, punto de retome en `CONTINUAR.md`, validación de reglas duras en `VALIDACION.md`.

**Lo que todavía no funciona:** el extractor entiende la nota pero no emite el tool call — Qwen3 arranca en modo *thinking* y gasta el presupuesto de tokens razonando en prosa. Está diagnosticado y en curso; ver `CONTINUAR.md`.

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

## Cómo ejecutar

Todo corre local. No hay servicio en la nube que levantar ni ninguna variable de entorno obligatoria.

### Requisitos

| Qué | Versión | Para qué |
|---|---|---|
| Node | **≥ 22.17** (`engines` de `apps/server/package.json`; probado con 25.2.1) | las dos apps |
| JDK | **17** — `brew install openjdk@17` | build nativo de Android |
| Android SDK + platform-tools | con `adb` en el `PATH` | `expo run:android`, sembrar datos en el teléfono |
| Teléfono Android **físico** | Android 12+ (`minSdkVersion: 31`), arm64 | `apps/mobile` |

**El móvil necesita un dispositivo real: los emuladores no corren llama.cpp** (`apps/mobile/CLAUDE.md`). El desarrollo se hizo sobre un Pixel 7; el paquete de la app es `io.qurum.mobile`.

`apps/mobile/package.json` no declara `engines`; su requisito de Node ≥22.17 sale de `apps/mobile/CLAUDE.md`.

```bash
git clone <url-del-repo> && cd QURUM
cd apps/server && npm ci
cd ../mobile  && npm ci
```

Los dos `.npmrc` tienen `ignore-scripts=true` — no lo saques. Si algún día un addon nativo necesita rebuild, hacelo selectivo (`npm rebuild <pkg> --ignore-scripts=false`), nunca global.

### Los modelos: se bajan solos, pero ocupan el doble de lo que dicen

Nadie descarga GGUF a mano. Las constantes se resuelven contra el SDK **al arrancar** (así un nombre mal escrito falla en el `listen`, no en la primera nota) y el peso se baja la **primera vez que se pide inferencia** — `loadModel()` en `apps/server/src/qvac/gateway.ts` y `apps/mobile/src/qvac/pool.ts`. O sea: `npm start` arranca sin modelos y sin red; la primera nota que interpretes sí necesita red, una única vez.

| Rol | Constante del SDK | Archivo en disco | Tamaño |
|---|---|---|---|
| ASR (voz → texto) | `WHISPER_TINY` | `ggml-tiny.bin` | 78 MB |
| Portero | `QWEN3_5_0_8B_MULTIMODAL_Q4_K_M` | `Qwen3.5-0.8B-Q4_K_M.gguf` | 533 MB |
| Extractor | `QWEN3_1_7B_INST_Q4` | `Qwen3-1.7B-Q4_0.gguf` | 1057 MB |

Dónde caen: `~/.qvac/models` en la máquina de escritorio, `files/.qvac/models` dentro del sandbox de la app en el teléfono.

★ **Presupuestá el doble de esa tabla en el teléfono.** Al lado de `models` hay un `registry-corestore`, y el peso pasa por ahí antes de materializarse en `models`: un modelo de 533 MB pide del orden de **1 GB** durante la descarga. Quedarse sin espacio a mitad de bajada ya nos pasó una vez. La tabla de `apps/mobile/CLAUDE.md` (~2.1 GB) es de **RAM**, no de disco, y como presupuesto de disco subestima a la mitad. Tené **varios GB libres** antes de la primera corrida.

Para mirar cuánto ocupa hoy en el teléfono:

```bash
adb shell 'run-as io.qurum.mobile sh -c "du -sh files/.qvac/*"'
adb shell df -h /data
```

### Arrancar el server (escritorio)

```bash
cd apps/server
npm start          # node --experimental-strip-types src/index.ts
```

Queda en **http://127.0.0.1:3000**. El host está hardcodeado y deliberadamente **no** se lee de env: un env var es exactamente la forma en que ese invariante se pierde sin que nadie lo note. El puerto sí se puede cambiar.

En consola vas a ver dos líneas:

```
QUÓRUM en http://127.0.0.1:3000
sync P2P apagado: QUORUM_PEERS vacío (deny-by-default en el transporte).
```

La segunda es lo esperado, no un error: el sync P2P es opt-in por allowlist.

Variables de entorno, **todas opcionales** (`apps/server/src/index.ts`):

| Variable | Default | Qué hace |
|---|---|---|
| `QUORUM_PUERTO` | `3000` | puerto de escucha |
| `QUORUM_MODELO` | `QWEN3_1_7B_INST_Q4` | extractor |
| `QUORUM_ASR` | `WHISPER_TINY` | transcripción |
| `QUORUM_OBSERVADOR` | `Field User 01` | quién firma las observaciones que se capturen |
| `QUORUM_DISPOSITIVO` | `dispositivo-a` | id de dispositivo |
| `QUORUM_PEERS` | vacío | allowlist de claves públicas hex de peers. **Vacía = ningún peer entra** |
| `QUORUM_PEER_PUBKEY` | — | peer al que delegar inferencia |
| `BOOTSTRAP` | — | nodos DHT `host:puerto`, separados por coma |

Las cuatro pantallas, en la barra de navegación:

| Pantalla | Qué se ve |
|---|---|
| **Capturar** | un campo de texto grande, `Dictar` (el navegador solo **graba** con `MediaRecorder`; transcribe whisper local vía `/api/transcribir`) e `Interpretar`. Lo extraído aparece abajo como «Revisá antes de guardar», **editable**, con `Sí, es correcto — guardar` y `Descartar`. Nada toca el disco hasta ese botón. |
| **Cliente 360** | la reconciliación agrupada por cliente: confianza **por campo**, `Sin quórum` mostrando todas las versiones en conflicto y quién sostiene cada una (nunca un promedio), cohortes de edad como composición y frescura como eje aparte. |
| **Panorama** | KPIs, distribución por país y modalidad en barras, candidatos a duplicado con su nota de revisión humana, la consulta en lenguaje natural (`/api/consultar` — el modelo solo traduce la pregunta a un filtro; el filtro lo corre código determinista) y `Exportar CSV (esquema del workbook, 19 columnas)`. |
| **Auditoría** | la cadena de hashes con su botón `Verificar integridad`, y cada llamada de inferencia con su `delegado` a la vista. |

### Sembrar los datos de demo (server)

`apps/server/data/seed.json` tiene las **23 observaciones** que producen los cuatro estados de quórum, y es el único archivo de `data/` que se versiona.

**No hay script que lo cargue.** `apps/server/CLAUDE.md` lista un `scripts/seed.ts` en la estructura *prevista*, pero no existe: en `scripts/` solo está `verify-no-cloud.sh`. Y el store no lee el seed: lee **`data/observaciones.jsonl`**, un JSON por línea, no un array (`apps/server/src/store/observations.ts`, `RUTA = 'data/observaciones.jsonl'`). Hay que convertirlo una vez, desde `apps/server`:

```bash
cd apps/server
node -e "const s=require('./data/seed.json');require('node:fs').writeFileSync('data/observaciones.jsonl',s.map(o=>JSON.stringify(o)).join('\n')+'\n')"
```

Con `jq`, lo mismo en una línea: `jq -c '.[]' data/seed.json > data/observaciones.jsonl`.

Dos cosas a tener en cuenta:

- El store es **append-only con dedup por `id`**, pero el comando de arriba **sobrescribe** el archivo. Si ya tenés observaciones capturadas y querés sumar el seed en vez de reemplazarlo, usá `>>`.
- `data/` es ruta **relativa al cwd**: tanto el comando como `npm start` tienen que correrse desde `apps/server`.

Con el server arriba, para comprobar que el motor las está leyendo:

```bash
curl -s http://127.0.0.1:3000/api/base-instalada | head -c 200
```

### Arrancar la app móvil (Android)

Teléfono conectado por USB con depuración activada — `adb devices` lo tiene que listar. Después:

```bash
cd apps/mobile
JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
ANDROID_HOME=$HOME/Library/Android/sdk \
npx expo run:android
```

**`JAVA_HOME` hay que pasarlo siempre**: el JDK quedó keg-only, sin symlink al sistema. `android/` no se versiona, así que la primera corrida hace el prebuild sola y se toma su tiempo (Gradle, NDK, CMake). Dejá el proceso abierto: sirve el bundle de Metro.

Dos pestañas: **Capturar** y **Clientes** (Cliente 360).

Para sembrar la demo en el teléfono está `dev/sembrar-demo.ts`, que genera 9 observaciones cubriendo `Quórum`, `Sin quórum`, cohortes y `Estimado`. No es una vía para saltarse la confirmación humana: escribe el archivo del store **por fuera** de la app, y el código de la app sigue teniendo un único punto de escritura.

```bash
cd apps/mobile
# 1. el observadorId de ESTE teléfono, para que la UI te etiquete como "Vos"
adb shell run-as io.qurum.mobile cat files/identidad.json
# 2. pegalo en la constante VOS de dev/sembrar-demo.ts
# 3. generar y empujar
node --experimental-strip-types dev/sembrar-demo.ts /tmp/obs.jsonl
adb push /tmp/obs.jsonl /data/local/tmp/obs.jsonl
adb shell "run-as io.qurum.mobile sh -c 'cat /data/local/tmp/obs.jsonl > files/observaciones.jsonl'"
adb shell am force-stop io.qurum.mobile && adb shell am start -n io.qurum.mobile/.MainActivity
```

Para capturar la pantalla — sin colapsar la barra de estado, la captura sale negra:

```bash
adb shell cmd statusbar collapse
adb exec-out screencap -p > /tmp/x.png
```

### Verificar cumplimiento

```bash
cd apps/server
npm run verify:no-cloud     # bash scripts/verify-no-cloud.sh
```

Siete controles, cada uno con su `OK` o `FALLO` en pantalla:

1. **Proveedores de inferencia cloud** en el código (OpenAI, Anthropic, Gemini, Groq, Together, Replicate, HF Inference, Bedrock…).
2. **Vercel** y el Vercel AI SDK, incluido `@qvac/ai-sdk-provider` y el paquete `ai`.
3. **Web Speech API** — busca el *uso* (constructor, acceso por `window`), no la mención.
4. **Marcas reales**: (4a) competencia y modelos reales; (4b) `philips` en `data/`, sin excepciones; (4c) `philips` en el código solo como identificador, ruta de módulo o esquema de export; (4d) verificación **positiva** con Node — toda `marca` de `data/` tiene que estar en `MARCAS_DUMMY`.
5. **Dependencias con script de instalación** (`hasInstallScript`) y `ignore-scripts=true` en `.npmrc`.
6. **`npm audit --audit-level=high`**.
7. **Egress**: ninguna URL absoluta fuera de localhost.

Esperado: `RESULTADO: 7/7 controles en verde` y exit 0. Sin red, el control 6 no puede consultar el registro y sale como **AVISO**, no como fallo: el script termina en 0 igual. Correrlo con red antes de entregar.

### Correr los tests y el typecheck

```bash
cd apps/server && npx tsc --noEmit && npm test     # esperado: 31/31, exit 0
cd ../mobile   && npx tsc --noEmit                 # esperado: exit 0
```

★ **Nunca leas un exit code a través de un pipe.** `npx tsc --noEmit | head` devuelve el exit de `head`, que es **siempre 0**: el build se rompió una vez justo así, sin que nadie se enterara. Corré el comando solo y después `echo $?`.

El typecheck verde tampoco es evidencia de que la app funcione: no ve un `import` de `node:crypto` que Metro sí rechaza, ni un render roto. Después de tocar UI, mirá la pantalla.

Para chequear que los diez archivos del núcleo compartido siguen idénticos entre las dos apps, el bucle de `CONTINUAR.md` §Arrancá por acá.

### Problemas conocidos al arrancar

- **Cambiaste una dependencia nativa → hay que volver a correr el prebuild.** `expo run:android` **no** lo vuelve a correr si `android/` ya existe, y el worker bundle de QVAC queda atado a la versión anterior: «Could not load bundle». `npx expo prebuild` ya recrea las carpetas nativas por defecto en esta versión del CLI (`--clean` se acepta pero es un no-op; lo que cambia el comportamiento es `--no-clean`).
- **`react-native-bare-kit` está pineado en `0.14.5` y no se puede subir.** La 0.15.0 linkea `libbare-kit.so` contra `libnativehelper.so`, interno de la ART APEX y bloqueado para apps desde Android 10: tumba el registro entero de TurboModules y RN muere con `PlatformConstants could not be found`, que es colateral y no la causa. Issue upstream `holepunchto/react-native-bare-kit#48`, cerrado *not planned*. Un `npm update` sin `--save-exact` reintroduce el crash.
- **La app corre hoy en *debug*, con el JS servido por Metro.** Si apagás el WiFi y la app se reinicia, **no arranca** — y eso **no** es porque dependa de la nube, sino porque no encuentra el bundle en la máquina de desarrollo. Para una demo sin red hace falta un build de release (`npx expo run:android --variant release`), que todavía **no se probó**.
- **El extractor entiende la nota pero no emite el tool call** (ver §Versión arriba). El server responde «El modelo no produjo una extracción utilizable» y el teléfono muestra «Sin equipo estructurado». Las pantallas de consulta sí se pueden recorrer completas con los datos del seed.
- **Sin `QUORUM_PEERS`, el sync P2P no arranca.** Es deny-by-default en el transporte, no una falla.

---

## Historial de cambios

### v0.4.0 — 2026-09-10

Las dos apps pasan de "compila" a "corre en su plataforma real". Fases 8 y 9 del server, Cliente 360 en mobile, cumplimiento automatizado, y una pasada de diseño sobre las dos superficies. Cinco bugs bloqueantes encontrados por ejecutar, no por leer.

**Añadido — `apps/server`**
- `src/index.ts` (Fase 8) — servidor HTTP local con las nueve rutas de la API, cero dependencias nuevas. Escucha en `127.0.0.1` hardcodeado y deliberadamente no leído de env. `/api/observar` produce solo un borrador; `/api/confirmar` es el único punto que escribe.
- `ui/` (Fase 9) — las cuatro pantallas de escritorio: Capturar, Cliente 360, Panorama y Auditoría. `index.html` + `style.css` + seis módulos ES nativos. Sin framework, sin build, cero dependencias y ningún recurso externo.
- `scripts/verify-no-cloud.sh` — los siete controles de cumplimiento, **7/7 en verde**. Se corre en vivo durante el video.
- `data/seed.json` — 23 observaciones (las 20 del workbook más los tres testimonios diseñados), que producen los cuatro estados de quórum.

**Añadido — `apps/mobile`**
- Pantalla **Cliente 360** con la vista de reconciliación, verificada en un Pixel 7: confianza por campo, `Sin quórum` con todas las versiones y quién sostiene cada una, cohortes de edad, y frescura como eje separado.
- Navegación de dos pestañas y barra de marca con los insets reales del dispositivo.
- `dev/sembrar-demo.ts` — escenario de demo para ver la pantalla con datos sin depender del pipeline.

**Corregido — bloqueantes que el typecheck no podía ver**
- **La app móvil no arrancaba.** Cuatro archivos importaban `node:crypto`, que no existe en React Native. La aleatoriedad pasa a Web Crypto resuelto en runtime (con polyfill de `expo-crypto` en el entrypoint) y los hashes a `@noble/hashes`, verificado idéntico al SHA-256 de `node:crypto`.
- **El server no arrancaba.** `core/errors.ts` usaba *parameter properties*, sintaxis que `--experimental-strip-types` rechaza.
- **Los modelos se pasaban como string** en vez de los objetos descriptores del SDK, así que `loadModel` buscaba un `modelId` inexistente. Afectaba al extractor y a whisper.
- **Path traversal en el server de estáticos**: `GET /../../../etc/passwd` servía cualquier archivo del disco. No estaba en la lista de bugs conocidos del doc.
- **`seed.json` no se versionaba** (`data/` entero estaba en `.gitignore`), así que un `git clone` en máquina virgen arrancaba sin los escenarios de demo.
- **`verify-no-cloud.sh` no verificaba nada.** Además del bug #2 documentado, los controles 2 y 3 tenían el mismo defecto de automatcheo, y una carpeta ausente hacía pasar un control sin mirar: `grep -r` sobre un directorio inexistente devuelve 2, y bajo `if grep` eso se lee igual que "no hubo match".

**Corregido — diseño y accesibilidad**
- **La rampa de confianza de §II.20 fallaba WCAG AA usada como texto**: `reportado` daba 2.76:1 y es el estado más frecuente; `sinDatos` 2.85:1. Se derivó una tinta por estado — mismo hue y croma en OKLCH, solo menos luminosidad — dejando el color original para glifo y borde. La rampa no cambió.
- La **frescura** se pintaba con el color de `Reportado` en mobile: cruzaba los dos ejes de confianza, que es el error de diseño que el propio proyecto marca como el más fácil de cometer.
- **Iconografía propia**: 15 iconos dibujados a medida como sprite SVG inline. Cero peticiones y ninguna librería. Los cinco glifos de estado siguen tipográficos a propósito.
- Cliente 360 de escritorio **agrupa por cliente** en vez de repetir su nombre en cada tarjeta.
- **Auditoría se rompía con un solo registro**: un error del SDK con 17.603 caracteres empujaba los otros 49 fuera de la vista.

**Añadido — documentación**
- `PRODUCT.md` — registro de producto: usuarios, posicionamiento, restricciones duras, y qué evidencia existe y cuál no (las métricas del pitch son hipótesis; no hay corrida sobre las 300 notas ciegas).

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
