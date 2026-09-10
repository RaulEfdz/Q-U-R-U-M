# QUÓRUM mobile — Arquitectura y diseño

Fuente completa: `../../docs/QUORUM_pipeline_android.md`. Este archivo es el diseño operativo para construir; el `CLAUDE.md` de esta carpeta es el resumen de reglas para el agente.

## 1. Diagrama del pipeline

```
   AUDIO (expo-av)
        │
        ▼
┌──────────────────────────────┐
│ WHISPER · whisper.cpp (QVAC) │  ~75 MB · on-device
│ transcripción                │
└──────────────┬───────────────┘
               │ texto
               ▼
┌──────────────────────────────┐
│ PRECHECK DETERMINISTA        │  0 MB · 0 ms
│ ¿hay token modalidad/número/marca? │
└──────────────┬───────────────┘
               │ hayIndicios: sí/no
               ▼
┌──────────────────────────────┐
│ PORTERO · Qwen3.5 0.8B Q4    │  ~600 MB
│ ¿la nota describe equipo?    │
└──────────────┬───────────────┘
       ┌───────┴────────┐
       │ no + sin indicios │  cualquier otro caso
       ▼                  ▼
 ┌───────────┐   ┌──────────────────────────────┐
 │ ATAJO     │   │ EXTRACTOR · Qwen3 1.7B Q4     │  ~1.1 GB
 │ nota SIN  │   │ lotes + evidencia citada obligatoria │
 │ equipo,   │   └──────────────┬────────────────┘
 │ se GUARDA │                  ▼
 └───────────┘   ┌──────────────────────────────┐
                  │ VERIFICADOR DE EVIDENCIA     │  0 MB · determinista
                  │ ¿la cita existe literal?     │
                  └──────────────┬────────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ cruzar() — enrutador de interrupciones │
                  │ nadie borra · máx 1 pregunta/nota │
                  └──────────────┬────────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ BORRADOR → confirmación humana │
                  └──────────────┬────────────────┘
                                 ▼
                       MOTOR DE QUÓRUM (RD-0..RD-7)
```

## 2. Decisiones de diseño y por qué

| Decisión | Por qué |
|---|---|
| 3 modelos, no 2 (whisper + portero + extractor) | Qwen no transcribe audio; whisper.cpp es el addon `stable` para eso |
| Verificador de evidencia determinista, no solo cruce de 2 LLM | Portero y extractor comparten familia/tokenizador/input → errores correlacionados, no independientes. Cita literal + comparación de strings sí es independiente por construcción |
| Portero se conserva | Sirve para detectar *omisiones* (nota menciona equipo, extractor no sacó nada) — algo que el verificador de evidencia no puede hacer |
| Atajo (saltar extractor) solo si portero=no Y precheck=no | Dos señales independientes coincidiendo; ahorra 1.1GB de modelo y segundos de latencia en el caso común de "nota sin equipo" |
| Nunca se borra, se marca | Un descarte silencioso es peor que no filtrar — el usuario nunca se entera de lo que perdió |
| Máximo 1 pregunta por nota | Sin tope: DoS por fricción (peer malicioso maximiza preguntas) o simplemente el usuario deja de usar la app |
| Cruce no decide verdad | Reencuadre obligatorio: es enrutador de interrupciones. El árbitro es el humano, después el quórum. Contradecir esto rompe la tesis del proyecto ante el jurado |
| Fail-open en el portero | Si el portero falla, el sistema captura de más, nunca pierde información. Fail-closed sería correcto para acción peligrosa; acá la acción peligrosa es descartar |
| `core/*` y `trust/*` reutilizados sin tocar desde `apps/server` | El motor de reconciliación es función pura sin I/O — se copia igual, solo cambia el store (`expo-file-system` en vez de `node:fs`) y la UI |

## 3. Tabla de decisión (contrato de `cruzar()`)

| Portero | Lotes | Evidencia | Resultado | Acción |
|---|---|---|---|---|
| sí | N>0 | toda válida | `ACUERDO` | borrador limpio |
| no | 0 | — | `ACUERDO_VACIO` | guarda nota vacía |
| no | N>0 | toda válida | `POSIBLE_OMISION_PORTERO` | 1 pregunta |
| sí | 0 | — | `POSIBLE_OMISION_EXTRACTOR` | 1 pregunta |
| — | N>0 | alguna inválida | `EVIDENCIA_FABRICADA` | marca + 1 pregunta |

## 4. Estructura de carpetas (a construir)

```
apps/mobile/
├── app.json / app.config.ts        # config Expo
├── package.json                    # engines node>=22.17, --ignore-scripts
├── tsconfig.json                   # strict
├── src/
│   ├── core/                       # copiado de apps/server, sin tocar
│   │   ├── contracts.ts
│   │   └── ids.ts
│   ├── trust/                      # copiado de apps/server, sin tocar
│   │   ├── normalize.ts
│   │   ├── similarity.ts
│   │   ├── entity.ts
│   │   ├── reconcile.ts            # ★ el motor
│   │   └── score.ts
│   ├── policy/
│   │   └── engine.ts               # copiado de apps/server
│   ├── context/
│   │   └── spotlight.ts            # copiado de apps/server
│   ├── export/
│   │   └── philips.ts              # copiado de apps/server
│   ├── qvac/
│   │   └── pool.ts                 # NUEVO — gestión de RAM de 3 modelos
│   ├── pipeline/                   # NUEVO — específico de mobile
│   │   ├── precheck.ts
│   │   ├── portero.ts
│   │   ├── extractor.ts
│   │   ├── verificar.ts
│   │   └── cruzar.ts
│   ├── audit/
│   │   └── trace.ts                # NUEVO — RegistroPipeline hash-encadenado, ver TRAZABILIDAD.md
│   ├── store/
│   │   └── expo-store.ts           # NUEVO — expo-file-system
│   ├── audio/
│   │   └── grabacion.ts            # NUEVO — expo-av
│   └── app/                        # NUEVO — pantallas React Native
│       ├── Capturar.tsx
│       └── Cliente360.tsx
└── test/
    ├── pipeline.test.ts            # 5 resultados de cruzar()
    ├── verificar.test.ts
    └── reconcile.test.ts           # 7 reglas, heredado de server
```

## 5. Presupuesto de memoria (gate de viabilidad)

| Componente | RAM |
|---|---|
| Whisper tiny Q4 | ~75 MB |
| Portero Qwen3.5 0.8B Q4 | ~600 MB |
| Extractor Qwen3 1.7B Q4 | ~1.1 GB |
| KV cache (ctx 2048 × 2) | ~200 MB |
| Runtime Expo + JS + UI | ~300 MB |
| **Total** | **~2.3 GB** |

Requisitos duros: Android 12+, arm64, GPU Adreno 700+ (Vulkan) u OpenCL, Expo ≥54, **dispositivo físico** (emuladores no corren llama.cpp).

## 6. Orden de construcción

1. Contratos Zod — congelar (copiados de server, no reinventar).
2. Pool de modelos + assert `isDelegated === false` tras cada `loadModel`.
3. Hola mundo: cargar portero, obtener booleano, en el teléfono real. Si falla, parar y revisar antes de seguir.
4. `precheck` + `portero` + tests.
5. `extractor` con `evidencia` obligatoria + `verificar` determinista + tests.
6. `cruzar()` + test de los 5 resultados de la tabla.
7. Motor de quórum: RD-0 a RD-7, un test por regla (reutilizado, no reescribir).
8. `store/expo-store.ts`.
9. UI: pantalla Capturar (con revisión antes de guardar) + Cliente 360 con estado por campo.
10. Audio con `expo-av`.

## 7. Gate antes de escribir código

```bash
npx --package "@qvac/cli" qvac doctor
node -e "import('@qvac/sdk').then(m=>m.modelRegistrySearch({query:'qwen'}).then(console.log))"
node -e "import('@qvac/sdk').then(m=>m.modelRegistrySearch({query:'whisper'}).then(console.log))"
```
Si `qvac doctor` no detecta Vulkan ni OpenCL: **parar**, no seguir armando código sobre un teléfono que no va a correr los modelos. IDs de modelo salen de `modelRegistrySearch` — nunca inventar constantes.

## 8. Trazabilidad y auditoría

Ver `TRAZABILIDAD.md` — tabla requisito→código y diseño del `RegistroPipeline` (registro hash-encadenado por nota, para reconstruir qué dijo cada modelo y por qué sin re-ejecutar nada). Módulo nuevo: `src/audit/trace.ts` (paso 6.5 entre `cruzar()` y el store).

## 9. Pendiente / no cerrado

- Confirmar teléfono físico disponible que cumpla Android 12+/arm64/Adreno 700+ — bloqueante antes de escribir una línea.
- Las cifras 93%/95% de detección son hipótesis sin medir — no reportar como resultado hasta correr las 300 notas etiquetadas (ver `CLAUDE.md` §métricas).
- Decisión de prioridad: `apps/server` (escritorio) es la apuesta principal del hackathon; esta app es plan B si sobra tiempo tras el freeze del escritorio.
