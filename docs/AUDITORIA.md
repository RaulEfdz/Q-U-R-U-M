# Auditoría QUÓRUM — 2026-09-10

Revisión completa de `QUORUM_documento_unico.md` (3630 líneas) y `QUORUM_pipeline_android.md`, más verificación en vivo contra el `@qvac/sdk` instalado. Todavía no hay código: todos los hallazgos son sobre el diseño y el código publicado en los documentos.

Referencias `doc:N` = `QUORUM_documento_unico.md` línea N. `and:N` = `QUORUM_pipeline_android.md` línea N.

---

## A · BLOQUEANTES DE DEMO — arreglar primero

| # | Hallazgo | Dónde |
|---|---|---|
| A1 | **El export humano está permanentemente denegado.** `evaluar()` corre `deny → require-approval → allow`; `critico-requiere-aprobacion` dispara con `riskLevel==='critical'`, que `exportarDataset` fija siempre. La regla `export-local-por-humano` es inalcanzable → `POST /api/exportar` y el botón "Exportar CSV" devuelven 403. El test `doc:2517` lo prueba en rojo. Se cae H-11. | doc:1376-1424, 1711 |
| A2 | **`verify-no-cloud.sh` falla siempre.** El control 4 hace `grep -rniE 'philips\|…' src` y matchea `A_STATUS_PHILIPS` en `contracts.ts`. Con `set -euo pipefail` → `exit 1`. Es el script que se corre en vivo en el video. | doc:2549, 410 |
| A3 | **El dictado se autodestruye.** `rec.stop(); …; location.reload()` — el reload corre antes de que el `rec.onstop` asíncrono complete el POST a `/api/transcribir`. La ruta de voz on-device no se puede filmar tal cual. | doc:2194, 2187 |
| A4 | **Las tools se declaran con Zod crudo, no JSON Schema.** `parameters: zExtraccion` / `zFiltro` / `zExportar`, sin conversión en ningún lado (zod 3.25 no trae `z.toJSONSchema`). Si el SDK espera JSON Schema, el tool calling no arranca — y es la base de captura y consulta. | doc:1174, 1467, 1700 |
| A5 | **El ataque del video es inalcanzable.** `/api/consultar` solo pasa `tools:[TOOL_FILTRAR]`, y la rama del ataque hace `zExportar.parse()` **antes** del PEP → `ZodError` → 500, sin evento SSE `policy-denied` ni banner. El escenario ③ del seed depende de ese camino. | doc:1998, 2010, 2586 |
| A6 | **El diagrama D5 del ataque no tiene camino.** El testimonio envenenado entra al Store y muere ahí: no existe la flecha `ST → CE`. La secuencia que va al video no se puede seguir. | doc:3067 |
| A7 | **Faltan 2 de los 3 modelos en disco.** En `~/.qvac/models` están Qwen3-1.7B (extractor ✅), Qwen3-4B, Llama-3.2-1B, gte-large. **No están** `WHISPER_TINY` (78 MB) ni `Qwen3.5-0.8B` (533 MB). Hoy no corre ni la voz del server ni el pipeline mobile. | verificado en vivo |

---

## B · CUMPLIMIENTO DEL RETO — riesgo de descalificación o de perder credibilidad

| # | Hallazgo | Dónde |
|---|---|---|
| B1 | **El pitch de 30s vende un producto que no existe:** *"con la IA corriendo dentro del teléfono"*, cuando la decisión cerrada I.5 es dos laptops y el móvil está cortado. | doc:3243 vs 279 |
| B2 | **"Sin que el dato del cliente salga del dispositivo" es falso.** El sync transmite `cliente.nombre` a otros peers y III.5 ya admite que el peer delegado ve el prompt en claro. | doc:3243 vs 2652 |
| B3 | **La aserción `isDelegated` es fail-open.** `if (info.isDelegated) throw` — si el SDK no devuelve el campo, `undefined` es falsy y pasa silenciosamente. Es la restricción cuya violación descalifica. Debe ser `!== false`. | and:326 |
| B4 | **La clasificación de sensibilidad llega tarde.** `transcribe()` corre antes de clasificar → el audio que identifica al cliente pasa por inferencia sin pasar por la política de ruta. | doc:3101 |
| B5 | **El clasificador de sensibilidad es evadible.** `PATRONES_CLIENTE` busca "hospital/clínica/instituto"; un nombre propio sin esas palabras se marca `no-sensible` y viaja en claro al peer. | doc:1305 |
| B6 | **El sync arranca sin allowlist.** `iniciarSync()` nunca pasa `allowlist` y la guarda es `if (opts.allowlist?.length && …)` → acepta cualquier peer. Contradice el "deny-by-default en el transporte" declarado dos líneas antes. | doc:2060, 1747 |
| B7 | **`startQVACProvider({firewall})` no existe.** Se vende en III.3 como una de las tres capacidades QVAC usadas; `scripts/provider.ts` está en la estructura y en `package.json` pero **ningún bloque del runbook lo construye**. | doc:2749, 325 |
| B8 | **"7 controles automatizados" son 5.** El control 5 nunca hace `exit 1`; el 7 es un `echo` con instrucciones manuales. Repetido en 4 lugares del doc. | doc:2554, 2560 |
| B9 | **XSS con datos de peers.** Todo se inyecta por `innerHTML` sin escapar (`cliente.nombre`, `marca`, `JSON.stringify(r.detalle)`). Un `notas` malicioso de un peer ejecuta script que puede llamar `/api/confirmar` o `/api/exportar`. | doc:2160, 2202, 2298 |
| B10 | **El spotlighting no sanea el atributo `fuente`.** Viene de `observadores.join(',')` (dato de peer) y se interpola crudo en `<dato fuente="…">`. Un `observadorId` con `"` o `</dato>` neutraliza el delimitador. | doc:1661 |
| B11 | **Falta la prohibición de `@qvac/ai-sdk-provider` / Vercel AI SDK** en los tres `CLAUDE.md` que escribimos. Está en la lista cuya violación descalifica. | and:703 |

---

## C · BUGS DEL MOTOR Y DEL PIPELINE

### Server (`doc`)

| # | Hallazgo | Dónde |
|---|---|---|
| C1 | **Un registro corrupto borra todo el store.** `cargar()` hace `catch { memoria = [] }`; `agregar()` no valida y `/api/confirmar` persiste sin `zObservacion` → en el siguiente arranque la base instalada aparece vacía. | doc:1567, 1951 |
| C2 | **El filtro del modelo nunca pasa por el PEP.** El comentario dice que sí; la línea siguiente llama `ejecutarFiltro()` directo. `filtrar()` (la que aplica política) es código muerto y no hay auditoría del filtro. | doc:2001, 1493 |
| C3 | **La corroboración del puntaje ignora la discrepancia.** Cuenta observadores `Directo` sin mirar si convergen: un grupo en `Sin quórum` con 3 testigos que se contradicen saca corroboración 1.0 (30/30). Premia el estado menos confiable, contra RD-2. | doc:1009 |
| C4 | **`Sin quórum` por edad no existe en el código.** La edad solo genera cohortes, nunca pasa por `resolverCampo` → el badge ▲ nunca aparece. El escenario ② del seed se titula "② SIN QUÓRUM". | doc:878, 2576 |
| C5 | **Edades fuera de contrato tumban la captura entera.** `zExtraccion` acepta `z.number()` sin `int` ni tope; `zRangoEdad` exige entero 0-60. Un "7.5 años" lanza `ZodError` no capturado y se pierde toda la observación. | doc:1162 vs 424 |
| C6 | **La UI no permite corregir, solo confirmar o descartar.** `#campos` es HTML de solo lectura y `/api/confirmar` se llama solo con `borradorId`; `correcciones` no tiene emisor. H-03 y III.6 afirman "confirma, **corrige** o descarta". | doc:2160, 2172 |
| C7 | **La ruta delegada recarga el modelo en cada request** (`cargarLLMDelegado` sin caché, sin `unloadModel`) → fuga de instancias durante la demo. | doc:1067, 1919 |
| C8 | **`npm run typecheck` no puede pasar:** `hyperswarm` sin tipos ni `@types` bajo `strict` → TS7016, más `any` implícitos en `swarm.on('connection', …)`. | doc:1725 |
| C9 | Dos definiciones de frescura: `DIAS_FRESCURA = 180` vs decaimiento a 365 días en el puntaje. | doc:757 vs 1007 |
| C10 | `eq()` usa `includes`: filtrar por `pais:"US"` matchea "Australia". | doc:1472 |
| C11 | La columna `Observation ID` del CSV exporta `i+1` en vez de `o.id` → rompe la trazabilidad entre el CSV y la cadena de auditoría. | doc:1538 |
| C12 | `/api/transcribir` guarda `data/tmp/*.webm` y nunca lo borra; envía `Blob` sin mimetype y asume que whisper acepta webm, sin decodificación. | doc:1906, 2189 |
| C13 | `verificarCadena()` sin `catch` y `audit.ts` sin `mkdir('data')` → abrir la pestaña Auditoría antes del primer registro devuelve 500. | doc:1636, 1603 |

### Mobile (`and`)

| # | Hallazgo | Dónde |
|---|---|---|
| C14 | **`precheck()` ignora `hayNumeros`** — lo calcula y nunca lo usa. *"compramos tres el año pasado"* toma el atajo y se guarda como "sin equipo". | and:379 vs 123 |
| C15 | **`.min(1)` en `zExtraccion.lotes` hace inalcanzables 2 de los 5 resultados** de la tabla de decisión: `ACUERDO_VACIO` por la rama no-atajo y `POSIBLE_OMISION_EXTRACTOR`. | and:468 vs 194 |
| C16 | **`extraer()` nunca se define.** `cruzar.ts` la importa; el schema devuelve *un objeto* con `lotes[]` pero el código lo trata como `Observacion[]`. Falta toda la conversión, la firma y el manejo de `cliente/ciudad/pais`. | and:527, 579 |
| C17 | **`expo-av` fue removido en Expo SDK 54** y el doc exige Expo ≥54. El paso 10 del orden de construcción no compila. Reemplazo: `expo-audio`. Mismo problema con `expo-file-system`: la API usada (`documentDirectory`, `readAsStringAsync`) es la legacy. | and:651 vs 220 |
| C18 | **`completion()` se llama sin `await`** y luego se lee `.final` → `undefined.toolCalls` lanza `TypeError`, que el fail-open no cubre porque no hay `try`. | and:418 |
| C19 | **`PoolDeModelos` no existe.** El doc lo promete con presupuesto de RAM y descarga bajo presión; el código es un `Map` sin política ni eviction. Y `obtener()` no protege contra cargas concurrentes → dos `loadModel` de 1.1 GB simultáneos = OOM en un presupuesto de 2.3 GB. | and:287, 315 |
| C20 | **`motivo: max(120)`**: un motivo de 130 chars tira el `safeParse` completo y fuerza fail-open → una pregunta por nota, destruye la métrica de interrupción que el propio doc declara decisiva. | and:395, 439 |
| C21 | **`cargar()` vacía la tienda si una línea del `.jsonl` está corrupta**, y `agregar()` reconstruye `vistos` desde ese array vacío → reinserta duplicados. Mismo bug que C1. | and:627 |
| C22 | **`pendiente-de-revision` es regla dura sin campo en ningún contrato.** `SalidaPipeline` no tiene estado y `RegistroPipeline` solo guarda `respuestaUsuario:'ignoro'`. Nadie es dueño de ese estado. | and:117, 749 |
| C23 | La función se llama `procesarNota`, no `cruzar()`. Nuestros tres docs la referencian mal. Y `procesarNota` no cruza: orquesta todo el pipeline desde `precheck`. | and:547 |
| C24 | `EVIDENCIA_FABRICADA` tiene precedencia de facto sobre todo lo demás (orden de los `if`), pero ni la tabla ni los docs lo dicen. Con `validos=0` y portero `sí`, la tabla asigna dos resultados distintos al mismo caso. | and:589 vs 196 |
| C25 | La tolerancia del verificador es nula para citas de 1-2 palabras (el bucle `i+3 <= length` no corre) y `n.includes(p)` compara subcadenas: "dos" valida contra "todos". | and:509, 512 |

---

## D · MODELOS Y SDK — verificado en vivo contra `@qvac/sdk@0.18.2`

| # | Hallazgo |
|---|---|
| D1 | **`QWEN3_5_0_8B_INST_Q4` no existe.** `loadModel` falla en runtime. La constante real del portero es **`QWEN3_5_0_8B_MULTIMODAL_Q4_K_M`** (533 MB). |
| D2 | **Las constantes son objetos, no strings.** El doc escribe `MODELOS` con literales de texto (`'WHISPER_TINY'`) y los pasa a `loadModel({modelSrc})`. En el SDK son objetos con `src`/`sha256Checksum`/`expectedSize`: hay que importarlas. |
| D3 | **El PASO 0 del prompt maestro no funciona.** `modelRegistrySearch({query:'qwen'})` **no filtra**: devuelve los 775 modelos del registro, idénticos para `'qwen'` y `'whisper'`. Hay que filtrar en local sobre `.name`. |
| D4 | Versiones desactualizadas: el doc fija `@qvac/sdk 0.17.1`, instalado hay `0.18.2`. |
| D5 | **Verificado y descartado:** sospecha de que zod 4.3.6 rompería los contratos escritos para zod 3. Corridos `z.string().datetime()`, `.default([])`, uniones y `.describe()` — **todos pasan**. No hay que tocar nada. |
| D6 | **Oportunidad:** el modelo real del portero es multimodal. La captura por foto que H-14 corta usa **el mismo modelo** que ya cargarías — capacidad sin RAM adicional. |

---

## E · DIAGRAMAS

| # | Hallazgo | Dónde |
|---|---|---|
| E1 | **D2 (fronteras de confianza): dos nodos rotos y falta la compuerta principal.** `C1` sin arista de salida, `C4` sin ninguna entrada. Y dibuja `G2 → C1`: salida del modelo directo al motor, saltándose store y revisión humana — que es justo la compuerta que H-03 declara esencial. | doc:2948 |
| E2 | **D7: la rama `DelegationViolation` es inalcanzable.** Lo sensible va local y solo lo no-sensible llega al peer; con ese grafo el rombo nunca dispara. La prosa lo llama "el argumento". | doc:3129 |
| E3 | **D3 contradice el test RD-2+RD-4.** Dibuja `QUÓRUM → SIN QUÓRUM` por tercer testigo discrepante; el test afirma que `marca` y `totalUnidades` siguen en Quórum y solo la edad se parte en cohortes. | doc:2993 vs 2370 |
| E4 | **D1 y D6 no tienen ruta de texto.** `V --> W` obliga a toda captura a pasar por whisper, pero el MUST nº1 y el Anexo C exigen captura por texto **o** voz. | doc:2912, 3101 |
| E5 | **D1 omite el agente de consulta** (tercera ruta de inferencia, la que usa la demo del ataque) y es el único diagrama que va al README. | doc:2930 |
| E6 | **El diagrama del atajo contradice el código.** La fuente y nuestro `ARCHITECTURE.md` dibujan `ATAJO → se GUARDA` como rama terminal; el código devuelve `ACUERDO_VACIO` por el mismo canal y **no guarda nada**. Además "se GUARDA" contradice "nada se persiste sin confirmación humana". | and:161 |
| E7 | **`marca` está en la clave de grupo y a la vez tiene estado de quórum propio.** Si discrimina el grupo, dos observadores que discrepen caen en grupos distintos y `marca` jamás llega a "Sin quórum": su fila en Cliente 360 es tautológica. | doc:3026 vs 3513 |

---

## F · RUNBOOK, PITCH Y NÚMEROS

| # | Hallazgo | Dónde |
|---|---|---|
| F1 | **El puntaje del Anexo B no cuadra.** Con los pesos reales (45/25/30) da **80**, no 72. Y `doc:244` muestra una tercera variante que da 76.5. Es la pantalla que sale en el video. Además "corroboración 0.6" son 2 testigos, y la misma pantalla dice 3. | doc:3507 vs 981 |
| F2 | **"Ninguna otra pieza depende del sync" es falso.** La delegación usa el mismo descubrimiento Hyperswarm; el abandono de H33 corta el sync y deja la delegación rota. | doc:2629 |
| F3 | **El Anexo A y §II.23 se contradicen sobre el seed** (si los tres testimonios del escenario de quórum ya están, o solo el malicioso). De cuál sea cierta depende el plan B de grabación. | doc:3471 vs 2589 |
| F4 | **El README no descarga el modelo.** `descargar()` existe pero nunca se expone, y el checklist exige arrancar en máquina virgen siguiendo solo el README. El clone limpio no puede llegar a inferir. | doc:2809, 2864 |
| F5 | **Runbook: 9 de 11 bloques sin dueño** (incluidos el checkpoint de sync, la grabación/edición del video y la revisión humana de código). Y 4 h para README + grabar + editar 5 min con demos en vivo. Cero descanso en 48 h para 4 personas. | doc:2712 |
| F6 | **Doble calendario para el mismo entregable:** el Anexo B pone la transición de quórum y la alerta de denegación en H26-H30; el runbook en H33-H37. Son los dos momentos del video. | doc:3546 vs 2718 |
| F7 | Métricas sin metodología: III.4 asigna 9/10, 8.5/10 sin rúbrica; "cinco equipos van a entregar eso", "32 segundos cronometrada", "`node_modules` de 3.2 GB", "unas 150 líneas" — presentados como hechos. Y las cifras 93%/95% del pipeline android son hipótesis sin medir. | doc:2631, 3247 |
| F8 | Contradicción directa: `doc:1136` afirma que "un Qwen3 1.7B es fiable" con tool calling; III.7 lista "Qwen3 1.7B falla el tool calling · Prob. **Media**". | doc:1136 |
| F9 | `isDelegated` se vende como "escrito en la auditoría de **cada** llamada"; solo se registra en `captura:borrador`. `/api/consultar` no audita la ruta de inferencia. | doc: III.5 |

---

## G · HUECOS DE ESTRUCTURA

- `§II.1` declara 5 archivos de test; `§II.21` escribe 3. `test/policy.test.ts` y `test/score.test.ts` no existen (doc:324).
- `scripts/{…,verify-no-cloud.sh}.ts` expande a `verify-no-cloud.sh.ts`, mientras `package.json` invoca `scripts/verify-no-cloud.sh` (doc:325 vs 353).
- Nunca se muestran `scripts/seed.ts`, `scripts/provider.ts`, `ui/style.css` completo ni el `data/seed.json` real.
- Anexo C: la agregación reclama país/modalidad/KPIs pero el MUST nº8 pide también **antigüedad** (doc:3580 vs 256).
- Anexo C: sin fila para los HIGH VALUE 9-11 (sync, delegación gobernada, PEP con auditoría). `policy/*`, `sync/peer.ts`, `context/spotlight.ts` y `store/audit.ts` nunca se mapean a un archivo.
- La fuente olvida `pipeline/precheck.ts` en su lista de archivos nuevos aunque lo define en §3.3.

---

## H · ERRORES EN LOS DOCS QUE ESCRIBIMOS NOSOTROS

Todos en `apps/mobile/` y `apps/server/`, a corregir antes de que alguien implemente desde ellos:

1. `apps/mobile/CLAUDE.md:69` — *"solo cambia el store y la UI"*. Son **7 módulos nuevos** (`pool`, `portero`, `extractor`, `verificar`, `cruzar`, `expo-store`, `app/*`).
2. `ARCHITECTURE.md` §4/§8 y `TRAZABILIDAD.md` §2 — inventamos `src/audit/trace.ts`, el `RegistroPipeline` y un "paso 6.5" que la fuente no tiene, y que deja el orden de 10 pasos internamente inconsistente.
3. Los tres docs referencian `cruzar()`; la función se llama `procesarNota`.
4. Falta en los tres la prohibición de `@qvac/ai-sdk-provider` y el Vercel AI SDK (restricción que descalifica).
5. Falta la **definición de LOTE** ("tres MR, dos viejos y uno nuevo" = dos lotes) — es la regla que evita el conflicto falso 2-vs-1 del bug H-02.
6. Redujimos el verificador a *"¿la cita existe literal?"*; la regla real es "todas las palabras presentes **y** una secuencia de 3 consecutivas, normalizado".
7. Falta que `hedging` lo detecta el **código**, no el modelo — es justo el campo que se implementa mal por defecto.
8. `TRAZABILIDAD.md:14` dice "todos los campos opcionales salvo modalidad y evidencia"; en `zExtraccion`, `cliente` es requerido y `lotes` tiene `.min(1)`.
9. `TRAZABILIDAD.md:58` propone la ruta `data/audit-pipeline.jsonl`, que no existe en Expo (solo `FileSystem.documentDirectory + …`).
10. Copiamos "KV cache ctx 2048 × 2 modelos" sin notar que el portero usa `ctx_size: 1024`.
11. Falta `.npmrc` con `ignore-scripts=true` en la estructura de mobile (queda como comentario en `package.json`, que no lo aplica).
12. Presentamos como decisión cerrada ("plan B") lo que la fuente plantea como condicional según el objetivo.
