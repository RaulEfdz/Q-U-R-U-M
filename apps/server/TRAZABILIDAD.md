# QUÓRUM server — Trazabilidad y auditoría

> **v0.2.0 · 2026-09-10**. Extiende el Anexo C del doc maestro (`../../docs/QUORUM_documento_unico.md:3568`) — esa tabla va al README para que el jurado verifique que no se saltó nada. Acá se agrega lo que el Anexo C no cubre: auditoría de ejecución y los huecos que encontró `../../docs/AUDITORIA.md`.

## 1. Trazabilidad de requisitos (Anexo C, resumida)

### Prototipo mínimo

| Requisito del brief | Dónde se cumple |
|---|---|
| Captura en lenguaje natural, texto o voz | `qvac/gateway.ts` (`transcribe`) + `ui/app.js` (MediaRecorder → whisper local) |
| Extracción con IA, tolerando datos incompletos | `qvac/extract.ts` — todos los campos salvo modalidad son opcionales |
| Estado por observación (`Confirmado`/`Reportado`/`Estimado`/`Desconocido`) | `contracts.ts` → `naturaleza` + `A_STATUS_PHILIPS`; `store/observations.ts` |
| Vista de base instalada a nivel de cliente | pantalla Cliente 360 |
| Agregación entre varios clientes | pantalla Panorama: país, modalidad, KPIs |

### Metas adicionales

| Meta | Estado |
|---|---|
| Dictado por voz | whisper.cpp on-device |
| Detección de duplicados | agrupación por clave canónica + candidatos de fusión con revisión humana (nunca fusión automática) |
| Puntaje de confianza | `trust/score.ts`, desglose visible |
| Alertas de información no verificada | `fresco` por campo, medido desde `visitadoEn` |
| Preguntas de seguimiento | `siguientePregunta()`, prioridad determinista |
| Consultas en lenguaje natural | `tools/filtrar.ts` — el modelo emite filtro, el sistema ejecuta |
| Oportunidades de renovación | edad ≥10 años + quórum ≥`Reportado` |
| Captura por foto | **No construida.** Ruta declarada: `QWEN3_5_*_MULTIMODAL_Q4_K_M` vía `completion()`, u `ocr-ggml`, ambos on-device — verificado que el modelo real (`QWEN3_5_0_8B_MULTIMODAL_Q4_K_M`) ya es multimodal, así que la ruta no pide RAM adicional sobre lo que el pipeline mobile ya usa |

### Su lógica de preguntas (hoja *Agent Question Logic*)

| Paso | Cómo se cumple |
|---|---|
| 9 · Confianza por campo | RD-4 — es literalmente su paso 9 |
| 10 · Status | `naturaleza`, vocabulario exacto en el export |
| 12 · Review antes de guardar | Borrador + confirmación humana. Nada se persiste sin ella |

Tabla completa de los 12 pasos: `../../docs/QUORUM_documento_unico.md:3597`.

### HIGH VALUE sin fila en el Anexo C original (hueco encontrado en la auditoría)

El Anexo C de la fuente no mapea estos a un archivo — se agrega acá:

| Requisito | Dónde se cumple |
|---|---|
| Sync P2P y ascenso a quórum por corroboración | `sync/peer.ts` |
| Delegación gobernada por política, verificación `isDelegated` | `qvac/delegation.ts` + `policy/pep.ts` |
| Inyección indirecta bloqueada, auditoría encadenada | `context/spotlight.ts` (sanitiza texto **y atributos** — corrección de bug de XSS) + `store/audit.ts` |

## 2. Auditoría de ejecución

A diferencia de `apps/mobile` (que registra por nota antes de tocar el store), acá la auditoría es **posterior al store**: cada acción con efecto lateral pasa por el PEP, y el PEP escribe un `AuditRecord` hash-encadenado.

```typescript
export interface AuditRecord {
  id: string; at: string; traceId: string;
  accion: string; detalle: Record<string, unknown>;
  hashPrev: string; hash: string;
}
```

Reglas:
- Se escribe en **toda** decisión del PEP (`allow`, `deny`, `require-approval`), no solo en las permitidas — o la auditoría no puede mostrar qué se bloqueó.
- `hashPrev`/`hash` encadenan igual que en `apps/mobile/TRAZABILIDAD.md` — cualquier alteración retroactiva rompe la cadena.
- `store/audit.ts` debe crear el directorio `data/` si no existe (bug de la fuente: hoy no lo hace y romper la pestaña Auditoría antes del primer registro es un 500, corrección pendiente en `CLAUDE.md`).

### Qué responde ante un auditor

| Pregunta | Cómo se responde |
|---|---|
| ¿Qué tool calls se bloquearon y por qué? | `AuditRecord` con `accion` + `detalle.policyId` para cada `deny`/`require-approval` |
| ¿Alguna vez se delegó inferencia sensible? | Cruzar `AuditRecord` de `qvac/delegation.ts` contra la clasificación de `context/spotlight.ts` — debe ser siempre `false` |
| ¿Se puede reconstruir la cadena sin huecos? | `verificarCadena()` recorre `hashPrev`→`hash`; debe tener manejo de error explícito, no un `readFile` sin `catch` (bug conocido) |
| ¿El export a Philips coincide con lo que el motor calculó? | Comparar `Observation ID` del CSV contra `observacionesIds` del `GrupoEquipo` — bug conocido: la fuente exporta `i+1` en vez de `o.id`, rompiendo este cruce |

## 3. Conexión con el motor de quórum

Un `AuditRecord` de tipo `captura:borrador` referencia el `traceId` de la sesión; la `Observacion` resultante lleva `provenance.hash`. Ambos deben poder cruzarse: dado un testimonio en el motor de quórum, tiene que poder reconstruirse qué decisión del PEP lo dejó pasar y con qué política vigente (`policyId`, `version`).

## 4. Pendiente

- El Anexo C original no cubre HIGH VALUE 9-11 — completado en §1 de este archivo, pero falta que el README final del proyecto lo incluya.
- Ningún `AuditRecord` se emite hoy para `/api/consultar` (la ruta de inferencia de consulta no audita `isDelegated`) — hallazgo F9 de `docs/AUDITORIA.md`.
