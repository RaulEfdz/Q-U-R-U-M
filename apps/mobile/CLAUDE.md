# QUÓRUM · mobile (app celular · Android)

Fuente completa: `../../docs/QUORUM_pipeline_android.md` (Anexo D del doc maestro). Leer ahí antes de tocar el pipeline — este archivo es resumen operativo. Diagrama y decisiones de diseño: `ARCHITECTURE.md`. Auditoría/trazabilidad por nota: `TRAZABILIDAD.md`.

## Stack

Expo ≥54, React Native, TypeScript estricto. Android 12+, arm64, GPU Adreno 700+ (Vulkan) u OpenCL. **Solo dispositivo físico** — los emuladores no corren llama.cpp. Node ≥22.17 para dev.

## Paso 0 — antes de escribir código

Verificar que el teléfono cumple y sacar los IDs reales del registro QVAC (no inventar constantes):
```bash
npx --package "@qvac/cli" qvac doctor
node -e "import('@qvac/sdk').then(m=>m.modelRegistrySearch({query:'qwen'}).then(console.log))"
node -e "import('@qvac/sdk').then(m=>m.modelRegistrySearch({query:'whisper'}).then(console.log))"
```
Si `qvac doctor` no detecta Vulkan ni OpenCL: parar y avisar. Si un `modelId` no existe, `loadModel` falla en runtime — no asumir.

## Pipeline: tres modelos, no dos

```
audio → whisper.cpp ASR (on-device) → texto
      → precheck determinista (¿hay token de modalidad/dígito/marca?)
      → PORTERO Qwen3.5 0.8B Q4 (¿la nota describe equipo?)
      → [atajo si portero=no Y precheck=no → nota se GUARDA como "sin equipo", nunca se descarta]
      → EXTRACTOR Qwen3 1.7B Q4, cada lote con `evidencia` (cita literal obligatoria)
      → VERIFICADOR DE EVIDENCIA — determinista, sin modelo: ¿la cita existe literal en la nota?
      → cruzar() — enrutador de interrupciones, máx. 1 pregunta por nota
      → BORRADOR → confirmación humana → store → motor de quórum (RD-0..RD-7, sin cambios)
```

**Por qué el verificador de evidencia y no solo un segundo modelo "portero":** portero y extractor son misma familia/tokenizador/cuantización/mismo input → sus errores pueden estar correlacionados, no son independientes. La cita literal + comparación de strings sí es independiente por construcción (código, no modelo). El portero se queda, pero para detectar *omisiones*, no alucinaciones — para eso el verificador es superior.

**Reencuadre obligatorio para pitch/README:** el cruce Portero×Extractor **no decide qué es verdad**, decide si el usuario ve borrador limpio o pregunta. Es enrutador de interrupciones. El árbitro sigue siendo el humano, y después el quórum. No decir "dos modelos deciden la verdad" — contradice la tesis del proyecto.

## Tabla de decisión (5 resultados, implementar exacto)

| Portero | Lotes | Evidencia | Resultado | Acción |
|---|---|---|---|---|
| sí | N>0 | toda válida | `ACUERDO` | borrador limpio |
| no | 0 | — | `ACUERDO_VACIO` | guarda nota vacía |
| no | N>0 | toda válida | `POSIBLE_OMISION_PORTERO` | 1 pregunta |
| sí | 0 | — | `POSIBLE_OMISION_EXTRACTOR` | 1 pregunta |
| — | N>0 | alguna inválida | `EVIDENCIA_FABRICADA` | marca (no borra) + 1 pregunta |

Reglas de interrupción: **máximo 1 pregunta por nota**. Si el usuario no responde, la nota se guarda como `pendiente-de-revision` — nunca se descarta (evita DoS por fricción de un peer malicioso).

## Presupuesto de memoria (decide si corre en el teléfono)

| Componente | RAM |
|---|---|
| Whisper tiny Q4 | ~75 MB |
| Portero Qwen3.5 0.8B Q4 | ~600 MB |
| Extractor Qwen3 1.7B Q4 | ~1,1 GB |
| KV cache (ctx 2048 × 2) | ~200 MB |
| Runtime Expo + JS + UI | ~300 MB |
| **Total** | **~2,3 GB** |

8 GB de RAM: los tres modelos cargados a la vez. 6 GB: descargar Whisper después de transcribir (`liberar('asr')`). Usar `PoolDeModelos`, nunca `loadModel` sueltos — y siempre asertar `isDelegated === false` tras cargar (nada se delega en el teléfono).

## Qué se reutiliza de `apps/server` sin tocar

```
core/contracts.ts  core/ids.ts        trust/normalize.ts
trust/similarity.ts trust/entity.ts   trust/reconcile.ts   ← el motor
trust/score.ts      policy/engine.ts  context/spotlight.ts
export/philips.ts
```
Posible porque el motor de reconciliación es función pura sin I/O. Solo cambia el store (`node:fs` → `expo-file-system`) y la UI (React Native en vez de HTML plano).

## Restricciones duras (heredadas + específicas de mobile)

Ver `../../CLAUDE.md`. Además:
- Nunca `SpeechRecognition` / Web Speech API del sistema operativo — transcripción siempre `whisper.cpp` vía QVAC, on-device.
- No instalar dependencia nueva sin justificar riesgo de cadena de suministro (`--ignore-scripts`).
- Marcas: solo el vocabulario ficticio del doc maestro (NovaMed, Aurelia Health, BluePeak Medical, Orion Imaging, HelixCare, Zenith MedTech). Nunca marcas reales.

## Antes de reportar métricas (93%/95% de detección, etc.)

No hay corrida real todavía sobre las 300 notas ciegas — esas cifras son **hipótesis**, no resultados. En README/video: "esperamos", nunca "logramos", hasta tener el conjunto etiquetado y medir. Las 5 métricas reales a reportar: falsos positivos del extractor, aciertos del portero, **tasa de fallo conjunto** (valida o refuta si el portero aporta), cobertura del verificador de evidencia, **tasa de interrupción** (decide si se adopta).

## Orden de construcción

1. Contratos Zod (congelar) → 2. Pool de modelos + assert `isDelegated=false` → 3. Hola mundo: portero en el teléfono real, si falla parar → 4. Precheck+portero+tests → 5. Extractor+evidencia+verificador+tests → 6. `cruzar()` + tests de los 5 resultados → 7. Motor de quórum (7 reglas, 1 test c/u) → 8. Store expo-file-system → 9. UI Capturar + Cliente 360 → 10. Audio con `expo-av`.

Decisión pendiente del equipo: escritorio (`apps/server`) es la apuesta principal del hackathon; Android es plan si sobra tiempo tras el freeze del escritorio (costo estimado 13-19h de 48h totales) — ver §Parte 5 del doc fuente antes de priorizar trabajo acá.
