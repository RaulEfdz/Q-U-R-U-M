# QUÓRUM mobile — Arquitectura y diseño

> **v0.2.0 · 2026-09-10** — corregido tras la auditoría (`../../docs/AUDITORIA.md`). Cambios: identificadores reales de modelo, atajo que no persiste, 8 módulos nuevos en vez de 2, presupuesto de RAM recalculado, `procesarNota` en vez de `cruzar()`.

Fuente: `../../docs/QUORUM_pipeline_android.md`. Reglas de trabajo: `CLAUDE.md`. Auditoría por nota: `TRAZABILIDAD.md`.

## 1. Diagrama del pipeline

```
   AUDIO (expo-audio)
        │
        ▼
┌────────────────────────────────────┐
│ WHISPER · whisper.cpp (QVAC)       │  78 MB · on-device
└──────────────┬─────────────────────┘
               │ texto
               ▼
┌────────────────────────────────────┐
│ PRECHECK DETERMINISTA              │  0 MB · 0 ms
│ ¿modalidad, dígito o marca?        │
└──────────────┬─────────────────────┘
               │ hayIndicios
               ▼
┌────────────────────────────────────┐
│ PORTERO · Qwen3.5 0.8B Q4_K_M      │  533 MB
└──────────────┬─────────────────────┘
       ┌───────┴────────┐
       │ no + sin        │ cualquier
       │ indicios        │ otro caso
       ▼                 ▼
┌──────────────┐  ┌────────────────────────────────┐
│ ATAJO        │  │ EXTRACTOR · Qwen3 1.7B Q4_0    │  1057 MB
│ ACUERDO_     │  │ lotes + evidencia citada       │
│ VACIO        │  └──────────────┬─────────────────┘
└──────┬───────┘                 ▼
       │          ┌────────────────────────────────┐
       │          │ VERIFICADOR DE EVIDENCIA       │  0 MB · determinista
       │          │ ¿la cita existe en la nota?    │
       │          └──────────────┬─────────────────┘
       │                         ▼
       │          ┌────────────────────────────────┐
       └─────────▶│ procesarNota() — enrutador     │
                  │ nadie borra · máx 1 pregunta   │
                  └──────────────┬─────────────────┘
                                 ▼
                  ┌────────────────────────────────┐
                  │ audit/trace.ts — RegistroPipeline │
                  └──────────────┬─────────────────┘
                                 ▼
                  ┌────────────────────────────────┐
                  │ BORRADOR → confirmación humana │  ← único punto que persiste
                  └──────────────┬─────────────────┘
                                 ▼
                       MOTOR DE QUÓRUM (RD-0..RD-7)
```

**El atajo no es rama terminal.** Vuelve al mismo enrutador y termina en el borrador como todo lo demás. La fuente lo dibuja saliendo directo a "se GUARDA", lo que contradice "nada se persiste sin confirmación humana".

## 2. Decisiones de diseño y por qué

| Decisión | Por qué |
|---|---|
| 3 modelos (whisper + portero + extractor) | Qwen no transcribe audio; whisper.cpp es el addon `stable` |
| Verificador determinista, no solo cruce de 2 LLM | Portero y extractor comparten familia, tokenizador e input → errores correlacionados. La comparación de strings sí es independiente |
| El portero se conserva | Detecta *omisiones*, que el verificador de evidencia no puede |
| Atajo solo si portero=no **Y** precheck=no | Dos señales independientes; ahorra cargar 1 GB en el caso común |
| Nunca se borra, se marca | Un descarte silencioso es peor que no filtrar: el usuario no se entera de lo que perdió |
| Máximo 1 pregunta por nota | Sin tope hay DoS por fricción, y el usuario abandona la app |
| El cruce no decide verdad | Es enrutador de interrupciones. El árbitro es el humano, después el quórum |
| Fail-open en el portero | Si se rompe, el sistema captura de más, nunca pierde información. Acá la acción peligrosa es descartar |
| `core/*` y `trust/*` copiados de `apps/server` | El motor de reconciliación es función pura sin I/O |

## 3. Tabla de decisión

| Portero | Lotes | Evidencia | Resultado | Acción |
|---|---|---|---|---|
| sí | N>0 | toda válida | `ACUERDO` | borrador limpio |
| no | 0 | — | `ACUERDO_VACIO` | nota sin equipo, al borrador |
| no | N>0 | toda válida | `POSIBLE_OMISION_PORTERO` | 1 pregunta |
| sí | 0 | — | `POSIBLE_OMISION_EXTRACTOR` | 1 pregunta |
| — | N>0 | alguna inválida | `EVIDENCIA_FABRICADA` | marca + 1 pregunta |

`EVIDENCIA_FABRICADA` se evalúa **primero** y gana sobre las demás.

## 4. Estructura de carpetas

```
apps/mobile/
├── .npmrc                          # ignore-scripts=true (obligatorio, no basta el package.json)
├── app.json                        # incluye permiso RECORD_AUDIO de Android
├── package.json
├── tsconfig.json                   # strict
├── src/
│   ├── core/                       # ── copiado de apps/server, sin tocar
│   │   ├── contracts.ts
│   │   └── ids.ts
│   ├── trust/                      # ── copiado
│   │   ├── normalize.ts
│   │   ├── similarity.ts
│   │   ├── entity.ts
│   │   ├── reconcile.ts            # ★ el motor
│   │   └── score.ts
│   ├── policy/engine.ts            # ── copiado
│   ├── context/spotlight.ts        # ── copiado
│   ├── export/philips.ts           # ── copiado
│   ├── qvac/pool.ts                # ── NUEVO · presupuesto de RAM + eviction + lock
│   ├── pipeline/                   # ── NUEVO
│   │   ├── precheck.ts
│   │   ├── portero.ts
│   │   ├── extractor.ts
│   │   ├── verificar.ts
│   │   └── cruzar.ts               # exporta procesarNota()
│   ├── audit/trace.ts              # ── NUEVO · extensión nuestra, no está en la fuente
│   ├── store/expo-store.ts         # ── NUEVO
│   ├── audio/grabacion.ts          # ── NUEVO · expo-audio
│   └── app/                        # ── NUEVO
│       ├── Capturar.tsx
│       └── Cliente360.tsx
└── test/
    ├── pipeline.test.ts            # los 5 resultados
    ├── verificar.test.ts
    └── reconcile.test.ts           # las 7 reglas
```

Diez archivos copiados, ocho módulos nuevos. La fuente dice "solo cambia el store y la UI" — no es cierto.

## 5. Presupuesto de memoria

| Componente | RAM |
|---|---|
| Whisper tiny | ~78 MB |
| Portero Qwen3.5 0.8B Q4_K_M | ~533 MB |
| Extractor Qwen3 1.7B Q4_0 | ~1057 MB |
| KV cache (1024 + 2048) | ~150 MB |
| Runtime Expo + JS + UI | ~300 MB |
| **Total** | **~2.1 GB** |

Requisitos duros: Android 12+, arm64, Adreno 700+ (Vulkan) u OpenCL, Expo ≥54, dispositivo físico.

## 6. Orden de construcción

1. Contratos Zod (copiados, congelar).
2. Pool: presupuesto de RAM, eviction, lock de cargas concurrentes, assert `isDelegated !== false`.
3. Hola mundo: portero en el teléfono real. Si falla, parar.
4. `precheck` + `portero` + tests.
5. `extractor` + `verificar` + tests.
6. `procesarNota()` + test de los 5 resultados.
7. Motor de quórum: RD-0..RD-7, un test por regla.
8. `store/expo-store.ts`.
9. `audit/trace.ts`.
10. UI: Capturar (con revisión antes de guardar) + Cliente 360 con estado por campo.
11. Audio con `expo-audio`.

## 7. Gate antes de escribir código

```bash
npx --package "@qvac/cli" qvac doctor
```
Si no hay Vulkan ni OpenCL: parar. Los identificadores de modelo están en `CLAUDE.md` §Modelos, ya verificados contra el SDK — no volver a inventarlos ni confiar en el `query` de `modelRegistrySearch`, que no filtra.

## 8. Trazabilidad

Ver `TRAZABILIDAD.md`: tabla requisito→código y `RegistroPipeline` hash-encadenado (paso 9 del orden de construcción). Es una **extensión nuestra**: la fuente no la contempla.

## 9. Pendiente

- Confirmar teléfono físico que cumpla Android 12+/arm64/Adreno 700+. Bloqueante.
- Descargar `WHISPER_TINY` y `QWEN3_5_0_8B_MULTIMODAL_Q4_K_M` — hoy no están en `~/.qvac/models`.
- Las cifras 93%/95% son hipótesis sin medir.
- Prioridad escritorio vs móvil: la fuente la deja condicional al objetivo. Sin decidir.
