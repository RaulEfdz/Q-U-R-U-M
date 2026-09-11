# QUÓRUM · mobile (app celular · Android)

> **v0.5.0 · 2026-09-11** — las dos apps corren, el extractor extrae y hay dictado por voz. Ver `README.md` de esta carpeta para el historial de cambios y `../../docs/AUDITORIA.md` para los hallazgos completos.

Fuente: `../../docs/QUORUM_pipeline_android.md` (Anexo D del doc maestro). Diseño y diagrama: `ARCHITECTURE.md`. Auditoría por nota: `TRAZABILIDAD.md`.

**La fuente tiene bugs conocidos.** Están listados abajo en §Correcciones obligatorias. No implementes el código de la fuente tal cual: aplicá esas correcciones.

## Stack

Expo ≥54, React Native, TypeScript estricto. Android 12+, arm64. **Solo dispositivo físico** — los emuladores no corren llama.cpp. Node ≥22.17 para dev.

**Solo teléfono, solo vertical.** `orientation: "portrait"` y `ios.supportsTablet: false` son deliberados: la captura se hace de pie, con una mano, entre consultas — apaisado y tablet no son el escenario. No hay layouts por size class y construirlos está fuera de alcance. La UI sí tolera la fuente del sistema en grande (los controles crecen, no recortan); probar con `adb shell settings put system font_scale 1.5` y restaurar a `1.0`.

**GPU:** el doc pide Adreno 800+ (Vulkan) u OpenCL, pero verificado 2026-09-10: el **Immortalis-G715 del Pixel 8 Pro (familia Mali)** corre Vulkan bien — 11-17 tok/s. Requiere `device: 'gpu'` + `gpu_layers: 99` explícitos en el `modelConfig` (ver `qvac/pool.ts`); sin eso cae a CPU (0.5-1.4 tok/s, ~4 min/nota). Los Pixel/Tensor **no tienen OpenCL** (sin driver del fabricante) — sale por Vulkan. Confirmá siempre con `diagModelo` (`dev=gpu`).

## Paso 0 — antes de escribir código

```bash
npx --package "@qvac/cli" qvac doctor
```
Si no detecta Vulkan ni OpenCL: **parar y avisar**.

Para listar modelos, **no** uses `modelRegistrySearch({query:'qwen'})`: el parámetro `query` no filtra, devuelve los 775 modelos del registro. Filtrá en local:
```js
const r = await modelRegistrySearch({ query: '' });
const list = Array.isArray(r) ? r : r.models;
list.filter(x => /qwen|whisper/i.test(x.name));
```

## Modelos — identificadores reales (verificados contra `@qvac/sdk@0.18.2`)

| Rol | Constante a importar del SDK | Tamaño |
|---|---|---|
| ASR | `WHISPER_BASE_Q8_0` | 78 MB |
| Portero | `QWEN3_5_0_8B_MULTIMODAL_Q4_K_M` | 533 MB |
| Extractor | `QWEN3_1_7B_INST_Q4` | 1057 MB |

`QWEN3_5_0_8B_INST_Q4`, que usa la fuente, **no existe** — `loadModel` falla en runtime.

Las constantes son **objetos** (con `src`, `sha256Checksum`, `expectedSize`), no strings. Importalas del SDK; no escribas `'WHISPER_TINY'` como literal de texto.

Los tres ya están descargados en `~/.qvac/models` (2026-09-10).

⚠️ **El ASR cambió de `WHISPER_TINY` a `WHISPER_BASE_Q8_0`** — el base todavía **no** está en `~/.qvac/models` ni en el teléfono. `loadModel` lo baja solo la primera vez (78 MB), pero eso significa que el primer arranque después de este cambio **necesita red**. Antes de una demo: abrir la app una vez con conectividad y esperar a que `[QUÓRUM·precarga] asr listo` aparezca en el log. Vale para cualquier cambio de la escalera de modelos de `qvac/pool.ts`.

## Precisión del ASR — qué se tocó y dónde

Cuatro palancas, en orden de cuánto mueven la aguja. Todas viven en dos archivos: `qvac/pool.ts` (`CONFIG_ASR`) y `pipeline/lexico.ts`.

1. **Modelo.** `WHISPER_BASE_Q8_0` en vez de `WHISPER_TINY`: cuesta 4 MB (78 vs 74 — el base viene cuantizado q8_0, el tiny que traíamos era f16) y es un escalón entero de whisper. La escalera completa, con `WHISPER_SMALL_Q8_0` (+174 MB) como próximo paso, está tabulada en el comentario de `MODELOS`. **Small no está medido**: el dictado es en vivo y hay que mirar el `ms` del paso «dictando» antes de dejarlo.
2. **Decodificación.** `strategy: 'beam_search'` + `beam_search_beam_size: 5` en vez del `greedy` por default — greedy no reconsidera, y una sílaba mal resuelta arrastra la palabra entera («Blue Pick» por «BluePeak»). Más `no_context: true` (corta el bucle de repetición de raíz) y el fallback por temperatura de whisper (`temperature_inc` + `entropy_thold` + `logprob_thold`). **Si el dictado en vivo llega tarde a la pantalla, bajar el beam a 3 es lo primero que hay que probar, antes de tocar el modelo.**
3. **VAD.** `threshold` 0.6 → 0.5 y `speech_pad_ms` 200 → 300: a 0.6 el VAD se comía el arranque de la frase, y «dos MR» llegaba como «MR» — perder la cantidad es perder justo uno de los campos que reconcilia el quórum.
4. **Corrector léxico** (`pipeline/lexico.ts`, nuevo). Ningún whisper vio nunca «BluePeak Medical»: subir el modelo mejora el promedio y no cierra el vocabulario cerrado. La corrección va en CÓDIGO —alias exactos para las siglas, similitud difusa acotada para las 6 marcas— y **devuelve qué cambió**, que la pantalla de captura muestra: la nota la confirma la persona como propia y una palabra que reescribió el código sin avisar sería inaceptable. Umbral 0.88, **medido** (ver el comentario de `UMBRAL_MARCA`), no elegido a ojo. Tests en `test/lexico.test.ts`.

El `initial_prompt` está escrito **con forma de nota dictada**, no de descripción del dominio: el prompt de whisper no es una instrucción, son tokens que el modelo imita. Vive en `pipeline/lexico.ts` como `PROMPT_ASR` y es fuente única — el SDK, al recibir `prompt` en `transcribe()`, recarga el modelo y al terminar deja el `initial_prompt` en cadena vacía, así que el de la carga no sobrevive a la primera nota y los dos tienen que decir lo mismo.

**Oportunidad:** el modelo del portero es multimodal. La captura por foto que el doc maestro corta en H-14 usa **el mismo modelo** que ya cargás para el portero — sale sin RAM adicional.

## Pipeline: tres modelos, no dos

```
audio → whisper.cpp ASR (on-device) → texto
      → precheck determinista (¿token de modalidad, dígito o marca?)
      → PORTERO Qwen3.5 0.8B (¿la nota describe equipo?)
      → [atajo si portero=no Y precheck=no → ACUERDO_VACIO, sigue al borrador igual]
      → EXTRACTOR Qwen3 1.7B, cada lote con `evidencia` (cita literal obligatoria)
      → VERIFICADOR DE EVIDENCIA — determinista, sin modelo
      → procesarNota() — enrutador de interrupciones, máx. 1 pregunta por nota
      → BORRADOR → confirmación humana → store → motor de quórum (RD-0..RD-7)
```

**El atajo no persiste nada.** Devuelve `ACUERDO_VACIO` por el mismo canal que todo lo demás; el único punto que escribe al store es la pantalla de confirmación. La fuente dibuja el atajo como rama terminal que "GUARDA" — eso contradice "nada se persiste sin confirmación humana". El dato *"visité y no observé equipo"* es válido y se conserva, pero lo confirma el humano.

**Por qué el verificador de evidencia y no solo el cruce de dos LLM:** portero y extractor comparten familia, tokenizador, cuantización e input → sus errores pueden estar correlacionados. La cita literal + comparación de strings sí es independiente por construcción. El portero se queda para detectar *omisiones*, no alucinaciones.

**Reencuadre obligatorio en pitch y README:** el cruce **no decide qué es verdad**, decide si el usuario ve un borrador limpio o una pregunta. El árbitro es el humano, y después el quórum.

## Tabla de decisión (5 resultados)

| Portero | Lotes | Evidencia | Resultado | Acción |
|---|---|---|---|---|
| sí | N>0 | toda válida | `ACUERDO` | borrador limpio |
| no | 0 | — | `ACUERDO_VACIO` | nota sin equipo, va al borrador |
| no | N>0 | toda válida | `POSIBLE_OMISION_PORTERO` | 1 pregunta |
| sí | 0 | — | `POSIBLE_OMISION_EXTRACTOR` | 1 pregunta |
| — | N>0 | alguna inválida | `EVIDENCIA_FABRICADA` | marca (no borra) + 1 pregunta |

`EVIDENCIA_FABRICADA` **tiene precedencia sobre todas las demás filas** — se evalúa primero. La fuente no lo dice y su tabla asigna dos resultados al caso `validos=0` + portero `sí`; el orden de los `if` lo resuelve de facto. Documentarlo, no dejarlo implícito.

**Máximo 1 pregunta por nota.** Si el usuario no responde, la nota se guarda con estado `pendiente-de-revision` — nunca se descarta (evita DoS por fricción). Ese estado **necesita un campo propio** en `SalidaPipeline` y en el contrato de observación: la fuente lo declara regla dura y no lo modela en ningún lado.

## Correcciones obligatorias al código de la fuente

No copiar y pegar. Aplicar esto:

| # | Bug en la fuente | Corrección |
|---|---|---|
| 1 | `precheck()` calcula `hayNumeros` y nunca lo usa (`:379`) | `hayIndicios = modalidades.length > 0 \|\| hayMarca \|\| hayNumeros`. Sin esto *"compramos tres el año pasado"* toma el atajo |
| 2 | `zExtraccion.lotes` tiene `.min(1)` (`:468`) | Quitarlo. Con `.min(1)` son inalcanzables `ACUERDO_VACIO` por la rama no-atajo y `POSIBLE_OMISION_EXTRACTOR` — 2 de los 5 resultados |
| 3 | `extraer()` se importa y nunca se define (`:527`) | Escribir la conversión: `zExtraccion` devuelve **un objeto** con `cliente` + `lotes[]`; `procesarNota` espera `Observacion[]` con `evidencia` en la raíz |
| 4 | `expo-av` (`:651`) fue removido en Expo SDK 54 | Usar `expo-audio`. Y para el store, `expo-file-system/legacy` o la API nueva `File`/`Paths` |
| 5 | `if (info.isDelegated) throw` es fail-open (`:326`) | `if (info.isDelegated !== false) throw`. Si el SDK no devuelve el campo, `undefined` es falsy y pasa — y es la restricción que descalifica |
| 6 | `const run = completion({...}); await run.final` (`:418`) | `await` la llamada. Si devuelve Promise, `run.final` es `undefined` → `TypeError` que el fail-open no cubre porque no hay `try` |
| 7 | El pool es un `Map` sin política ni eviction (`:287`) | Implementar el presupuesto de RAM y la descarga bajo presión que la fuente promete. Y un mapa de promesas en vuelo: dos `obtener()` concurrentes cargan 1.1 GB dos veces → OOM |
| 8 | `motivo: z.string().max(120)` (`:395`) | Subir el tope o truncar antes de parsear. Un motivo de 130 chars tira el `safeParse` completo y fuerza fail-open → una pregunta por nota |
| 9 | `cargar()` hace `catch { memoria = [] }` (`:627`) | Filtrar la línea corrupta, no descartar el archivo. Además `agregar()` reconstruye `vistos` desde el array vacío y reinserta duplicados |
| 10 | `agregar()` reescribe el archivo entero por llamada (`:640`) | Append real. Un corte a mitad de escritura pierde **todas** las observaciones, no solo las nuevas |
| 11 | Verificador: sin tolerancia para citas de 1-2 palabras, y `n.includes(p)` compara subcadenas (`:509`) | Manejar citas cortas explícitamente y comparar por palabra: hoy "dos" valida contra "todos" |
| 12 | `MODALIDADES` se importa y no se usa (`:352`) | Quitarlo, o unificar `PALABRAS_MODALIDAD` con el vocabulario de contratos. Con `noUnusedLocals` no compila |
| 13 | Regex sin `\b` de cierre (`:373`) | `eco` matchea "economía", `monitor` matchea "monitorear" |
| 14 | `ctx.visitadoEn` es opcional (`:548`) | Hacerlo requerido: RD-6 mide frescura desde ahí, un `undefined` la rompe en silencio |

## Reglas de dominio que NO pueden perderse

**Definición de LOTE.** Un lote = N unidades que **comparten edad**. *"Tres MR, dos viejos y uno nuevo"* produce **dos lotes** de la misma modalidad (2 y 1), no uno de 3. El total del grupo es la suma de los lotes de una sesión. Sin esto se genera un conflicto falso 2-vs-1 — es el bug H-02 del doc maestro, ya encontrado y cerrado una vez.

**`hedging` lo detecta el CÓDIGO**, no el modelo, sobre el texto original (tabla de marcadores: "creo", "unos", "aproximadamente"…). Lo mismo `naturaleza`. Preguntarle al modelo "¿estabas seguro?" mete una decisión de confianza dentro del LLM y rompe el principio rector.

**Verificador de evidencia — regla exacta.** Normalizar ambos lados (minúsculas, sin acentos, espacios colapsados). Válida si la cita aparece como subcadena; si no, exigir que **todas** las palabras estén presentes **y** que al menos una secuencia de **3 palabras consecutivas** coincida. Ni coincidencia exacta (falsos rechazos por una tilde) ni parecido difuso (deja pasar fabricaciones).

**Cláusula del prompt del extractor, textual:** *"Si no podés copiar un fragmento literal que lo justifique, NO generes ese lote."* Es la que le da al modelo una salida honesta en vez de inventar la cita.

**Determinismo:** `temp: 0` + `seed: 42` — sin eso las cinco métricas no son comparables entre corridas.

**Qwen3 sin razonamiento — TRES capas (`Qwen3-1.7B` y `Qwen3.5-0.8B` son híbridos, razonan por defecto):**
1. `reasoning_budget: 0` en `generationParams` de cada `completion()` (`portero.ts`, `extractor.ts`) — por request; doc del schema: `0` desactiva el canal de razonamiento.
2. `reasoning_budget: 0` en `modelConfig` al `loadModel` (`qvac/pool.ts` `CONFIG`) — default del modelo.
3. `/no_think` (tag exacto, no `/nothink`) al final del `content` del system — switch suave entrenado de Qwen3, actúa a nivel plantilla, independiente de si el addon Bare cablea bien `reasoning_budget`.

El SDK **no** expone `enable_thinking` ni `chat_template_kwargs` (solo `chatTemplatePath`, y solo en finetune) — `/no_think` + `reasoning_budget` es todo lo que hay. `remove_thinking_from_context` NO sirve para esto (solo limpia el KV cache post-generación; ya default `true` para la familia Qwen3).

Sin esto, Qwen3 quema `predict` razonando en prosa y nunca emite el tool call — era el bloqueante "el extractor no extrae". Para confirmar en runtime: `diagModelo()` (`pipeline/_diag.ts`) loguea `think=N` (largo de `thinkingText`; `>0` = razonó), `stop=length` (truncado), `dev=cpu|gpu` y `tok/s` al canal `[QUÓRUM·modelo]`.

**`predict`:** `80` el portero (devuelve `{hayEquipo, motivo}`, le sobra), **`512` el extractor** — un tool call con cliente + N lotes + citas `evidencia` no entra en 80 y el JSON truncado tira el `safeParse` entero. `ctx_size`: 1024 el portero, 2048 el extractor (`tools: true`).

El schema de `generationParams` es `$strict` (`node_modules/@qvac/sdk/dist/schemas/completion-stream.d.ts`): solo `temp`, `top_p`, `top_k`, `predict`, `seed`, las penalties, `reasoning_budget` y `remove_thinking_from_context`.

## Presupuesto de memoria

| Componente | RAM |
|---|---|
| Whisper base q8_0 | ~78 MB |
| Portero Qwen3.5 0.8B Q4_K_M | ~533 MB |
| Extractor Qwen3 1.7B Q4_0 | ~1057 MB |
| KV cache (portero 1024 + extractor 2048) | ~150 MB |
| Runtime Expo + JS + UI | ~300 MB |
| **Total** | **~2.1 GB** |

8 GB: los tres cargados. 6 GB: liberar whisper tras transcribir.

## Qué se reutiliza y qué es nuevo

**Copiado de `apps/server` sin tocar** (10 archivos): `core/contracts.ts`, `core/ids.ts`, `trust/{normalize,similarity,entity,reconcile,score}.ts`, `policy/engine.ts`, `context/spotlight.ts`, `export/philips.ts`.

**Nuevo** (8 módulos): `qvac/pool.ts`, `pipeline/{precheck,portero,extractor,verificar,cruzar}.ts`, `store/expo-store.ts`, `app/*`. La fuente olvida `precheck.ts` en su lista aunque lo define.

## UI · tipografía e iconos

Tokens en `app/theme.ts`: `color`, `espacio`, `radio`, `tipografia` (8 roles con un trabajo cada uno), `tap`. Los componentes se enganchan a un rol, no eligen `fontSize` suelto.

**Deuda cerrada:** los glifos que NO son de estado (`✓ ✕` del panel de progreso, `⚠`, `🎙`) eran caracteres Unicode del font del sistema — en Android salían con la fuente de emoji, en color, saltándose la paleta. Ya son trazos de `app/components/Icono.tsx` (`chequeo`, `falla`, `alerta`, `microfono`), mismo viewBox 24×24 y trazo 1.6 que el resto. Los 5 glifos de estado (`● ◐ ○ · ▲`) sí se quedan tipográficos: los fija §II.20 del doc maestro y escalan con la fuente del sistema. Todos llevan `accessibilityLabel` y los decorativos `importantForAccessibility="no"`.

## Restricciones duras

Ver `../../CLAUDE.md`. Específicas de mobile:
- Nunca `SpeechRecognition` / Web Speech API — transcripción siempre whisper.cpp vía QVAC.
- **Prohibido `@qvac/ai-sdk-provider` y el Vercel AI SDK** (política de la organización). Usar `@qvac/sdk` puro.
- `.npmrc` con `ignore-scripts=true` en esta carpeta — un comentario en `package.json` no lo aplica. No agregar dependencia sin justificar el riesgo de cadena de suministro.
- Marcas solo del vocabulario ficticio: NovaMed, Aurelia Health, BluePeak Medical, Orion Imaging, HelixCare, Zenith MedTech.

## Métricas — decir "esperamos", no "logramos"

No hay corrida sobre las 300 notas ciegas. Las cifras 93%/95% son **hipótesis**. Las cinco métricas reales: falsos positivos del extractor, aciertos del portero, **tasa de fallo conjunto** (valida o refuta que el portero aporte), cobertura del verificador, **tasa de interrupción** (decide la adopción).

## Orden de construcción

1. Contratos Zod (copiados, congelar) → 2. Pool + assert `isDelegated !== false` → 3. Hola mundo: portero en teléfono real; si falla, parar → 4. `precheck` + `portero` + tests → 5. `extractor` + `verificar` + tests → 6. `procesarNota()` + test de los 5 resultados → 7. Motor de quórum (RD-0..RD-7, 1 test por regla) → 8. Store → 9. `audit/trace.ts` (extensión nuestra, ver `TRAZABILIDAD.md`) → 10. UI Capturar + Cliente 360 → 11. Audio con `expo-audio`.

**Cliente 360 salió del móvil.** La Fase 10 la construyó en el teléfono (`Cliente360Screen.tsx`, pestaña `Clientes`); se eliminó después: la reconciliación se visualiza del lado del server (`apps/server`, misma `trust/reconcile.ts`), no duplicada acá. El móvil quedó de una sola pantalla — Capturar — sin barra de pestañas. Lo que era exclusivo de esa pantalla se borró con ella: `app/Cliente360Screen.tsx`, `app/testigos.ts`, `app/components/FilaCampo.tsx`, `app/components/InsigniaQuorum.tsx`, y el icono `cliente` + `IconoModalidad` de `app/components/Icono.tsx`.

## Skills, hooks y técnicas a usar en esta app

**Skills:**
- `adb-test` — smoke test en el teléfono físico. Es exactamente el paso 3 del orden de construcción abajo ("hola mundo en el teléfono real, si falla parar").
- `code-review` — en cada punto de aprobación entre fases de `ORQUESTACION.md`.
- `security-audit` — una vez que `pipeline/*` tenga código, para verificar de nuevo la aserción `isDelegated` y que ninguna ruta de audio/texto salga del dispositivo.
- `fewer-permission-prompts` — igual que en server, apenas arranquen los teammates.
- `simplify` — después de `code-review`, no antes.

**Hooks a configurar (vía skill `update-config`):**
1. `PreToolUse` en `Edit`/`Write` sobre `core/contracts.ts` — mismo archivo congelado que en server, se copia sin tocar (ver §Qué se reutiliza).
2. `TaskCompleted` — corre `npm run typecheck` (o el chequeo de Expo equivalente) antes de marcar tarea terminada.
3. `TeammateIdle` — verifica `--ignore-scripts` en cualquier instalación de dependencia nueva.

Opcional: hook que bloquee cualquier import de `expo-av` (removido en SDK 54, corrección #4) o de `SpeechRecognition`/Web Speech API — refuerzo determinista de dos restricciones que ya rompieron una vez en la fuente.

**Técnica:** Agent Teams (ver `ORQUESTACION.md`), no `Workflow`/`ultracode`.

## Prioridad

La fuente lo plantea **condicional, no cerrado**: si el objetivo es ganar el hackathon, escritorio primero y teléfono como tercer peer después del freeze (Android cuesta 13-19 h de 48). Si el objetivo es que esto viva en el bolsillo de un ingeniero de campo, Android es el camino correcto. Esa decisión todavía no la tomó el equipo.
