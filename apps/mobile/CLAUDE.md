# QUÓRUM · mobile (app celular · Android)

> **v0.2.0 · 2026-09-10** — corregido tras la auditoría. Ver `README.md` de esta carpeta para el historial de cambios y `../../docs/AUDITORIA.md` para los hallazgos completos.

Fuente: `../../docs/QUORUM_pipeline_android.md` (Anexo D del doc maestro). Diseño y diagrama: `ARCHITECTURE.md`. Auditoría por nota: `TRAZABILIDAD.md`.

**La fuente tiene bugs conocidos.** Están listados abajo en §Correcciones obligatorias. No implementes el código de la fuente tal cual: aplicá esas correcciones.

## Stack

Expo ≥54, React Native, TypeScript estricto. Android 12+, arm64, GPU Adreno 700+ (Vulkan) u OpenCL. **Solo dispositivo físico** — los emuladores no corren llama.cpp. Node ≥22.17 para dev.

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
| ASR | `WHISPER_TINY` | 78 MB |
| Portero | `QWEN3_5_0_8B_MULTIMODAL_Q4_K_M` | 533 MB |
| Extractor | `QWEN3_1_7B_INST_Q4` | 1057 MB |

`QWEN3_5_0_8B_INST_Q4`, que usa la fuente, **no existe** — `loadModel` falla en runtime.

Las constantes son **objetos** (con `src`, `sha256Checksum`, `expectedSize`), no strings. Importalas del SDK; no escribas `'WHISPER_TINY'` como literal de texto.

Los tres ya están descargados en `~/.qvac/models` (2026-09-10).

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

**Determinismo:** `generationParams: { temp: 0, seed: 42, predict: 80 }`. Sin `temp: 0` las cinco métricas no son comparables entre corridas. `ctx_size`: 1024 el portero, 2048 el extractor (`tools: true`).

## Presupuesto de memoria

| Componente | RAM |
|---|---|
| Whisper tiny | ~78 MB |
| Portero Qwen3.5 0.8B Q4_K_M | ~533 MB |
| Extractor Qwen3 1.7B Q4_0 | ~1057 MB |
| KV cache (portero 1024 + extractor 2048) | ~150 MB |
| Runtime Expo + JS + UI | ~300 MB |
| **Total** | **~2.1 GB** |

8 GB: los tres cargados. 6 GB: liberar whisper tras transcribir.

## Qué se reutiliza y qué es nuevo

**Copiado de `apps/server` sin tocar** (10 archivos): `core/contracts.ts`, `core/ids.ts`, `trust/{normalize,similarity,entity,reconcile,score}.ts`, `policy/engine.ts`, `context/spotlight.ts`, `export/philips.ts`.

**Nuevo** (8 módulos): `qvac/pool.ts`, `pipeline/{precheck,portero,extractor,verificar,cruzar}.ts`, `store/expo-store.ts`, `app/*`. La fuente olvida `precheck.ts` en su lista aunque lo define.

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

## Prioridad

La fuente lo plantea **condicional, no cerrado**: si el objetivo es ganar el hackathon, escritorio primero y teléfono como tercer peer después del freeze (Android cuesta 13-19 h de 48). Si el objetivo es que esto viva en el bolsillo de un ingeniero de campo, Android es el camino correcto. Esa decisión todavía no la tomó el equipo.
