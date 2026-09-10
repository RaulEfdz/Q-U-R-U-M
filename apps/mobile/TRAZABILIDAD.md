# QUÓRUM mobile — Trazabilidad y auditoría

Dos cosas distintas, no mezclar:
1. **Trazabilidad de requisitos** — qué pide el brief de Philips y dónde vive en el código (extiende el Anexo C del doc maestro, que es server-only, a la parte mobile).
2. **Auditoría de ejecución** — registro encadenado de cada paso del pipeline por nota procesada, para poder reconstruir "qué modelo dijo qué, cuándo, y por qué la nota terminó donde terminó".

Fuente: `../../docs/QUORUM_documento_unico.md` Anexo C (líneas 3568+) + `../../docs/QUORUM_pipeline_android.md` §3.7.

## 1. Trazabilidad de requisitos — parte mobile

| Requisito / meta | Dónde se cumple en `apps/mobile` |
|---|---|
| Captura por voz, on-device | `src/audio/grabacion.ts` (`expo-av`) → `pipeline/precheck.ts` recibe texto ya transcrito por whisper vía QVAC |
| Extracción con IA tolerando datos incompletos | `pipeline/extractor.ts` — todos los campos opcionales salvo `modalidad` y `evidencia` |
| Detección de alucinación de fila completa | `pipeline/verificar.ts` — determinista, no depende de un segundo modelo |
| Detección de omisión (nota tiene equipo, extractor no sacó nada) | `pipeline/portero.ts` cruzado en `cruzar()` → `POSIBLE_OMISION_EXTRACTOR` |
| Nada se persiste sin confirmación humana | `cruzar()` produce `SalidaPipeline`, nunca escribe al store directo — pantalla `Capturar.tsx` es el único punto que llama `store/expo-store.ts::agregar()` |
| Nadie borra, solo se marca | `descartados` en `SalidaPipeline` viaja a UI y a auditoría, nunca se descarta en memoria |
| Máximo 1 pregunta por nota | Tipo `pregunta: string \| null` en `SalidaPipeline` — el tipo mismo impone el límite |
| Motor de quórum (RD-0..RD-7) | Reutilizado sin cambios de `apps/server/src/trust/reconcile.ts` |
| Cero inferencia en nube | Todo `completion()`/`transcribe()` vía `@qvac/sdk`, assert `isDelegated === false` en `qvac/pool.ts::obtener()` |

## 2. Auditoría de ejecución — registro por nota

Cada nota procesada genera un **`RegistroPipeline`** inmutable, encadenado por hash (mismo patrón que `AuditRecord` de `apps/server/src/core/contracts.ts`), para que un auditor pueda reconstruir la decisión sin re-ejecutar nada.

### Contrato (a implementar en `src/audit/trace.ts`)

```typescript
export interface RegistroPipeline {
  id: string;                    // nuevoId()
  at: string;                    // ISO timestamp
  observadorId: string;
  dispositivoId: string;
  notaHash: string;              // sha256 del texto original, NUNCA el texto crudo
  hayIndicios: boolean;          // salida de precheck
  porteroDijo: boolean;
  porteroMotivo: string;
  msPortero: number;
  atajo: boolean;                // true si se saltó el extractor
  lotesPropuestos: number;
  lotesValidos: number;
  descartados: Array<{ razon: string }>;   // razón sí, contenido de la fila no (evita duplicar PII en el log)
  resultado: 'ACUERDO' | 'ACUERDO_VACIO' | 'POSIBLE_OMISION_PORTERO'
           | 'POSIBLE_OMISION_EXTRACTOR' | 'EVIDENCIA_FABRICADA';
  msExtractor: number;
  preguntaMostrada: string | null;
  respuestaUsuario: 'confirmo' | 'corrigio' | 'descarto' | 'ignoro' | null;
  hashPrev: string;              // encadenamiento, igual que audit.ts del server
  hash: string;
}
```

**Reglas:**
- `notaHash`, nunca el texto original — el registro de auditoría no debe volverse una segunda copia de datos sensibles del cliente.
- Se escribe **siempre**, incluso si el usuario ignora la pregunta (`respuestaUsuario: 'ignoro'`) — sin excepción, o la auditoría tiene huecos justo donde más importa.
- `hashPrev`/`hash` siguen el mismo esquema del server: cualquier alteración retroactiva del log rompe la cadena y es detectable.
- Persistencia: `data/audit-pipeline.jsonl` append-only vía `expo-file-system`, igual patrón que `store/expo-store.ts`.

### Qué responde este registro ante un auditor (jurado, o debug real)

| Pregunta | Campo(s) |
|---|---|
| ¿Cuántas notas terminaron en pregunta al usuario? | `resultado != ACUERDO` count / total |
| ¿Tasa de interrupción? (métrica clave, ver `CLAUDE.md`) | preguntas / 100 notas = `preguntaMostrada != null` count |
| ¿El portero está aportando o solo gastando batería? | correlación entre `porteroDijo` y `resultado = EVIDENCIA_FABRICADA` o `POSIBLE_OMISION_*` |
| ¿Cuánto tarda cada modelo? | `msPortero`, `msExtractor` |
| ¿Alguna fila fabricada llegó a guardarse? | debe ser imposible por diseño — `lotesValidos` en `ACUERDO`/`EVIDENCIA_FABRICADA` ya pasó `verificar.ts`; auditar que nunca haya un registro con `resultado=EVIDENCIA_FABRICADA` y `descartados=[]` |
| ¿Qué pasó con las notas que el usuario ignoró? | `respuestaUsuario='ignoro'` → deben aparecer también en la cola `pendiente-de-revision`, nunca desaparecer |

## 3. Dónde se conecta con el motor de quórum

El `RegistroPipeline` es previo al testimonio (`Observacion`). Una vez que el usuario confirma, el `Observacion.provenance` (`hash`, `modeloSha256`, `delegado`) enlaza hacia atrás al `RegistroPipeline` por `notaHash` — así una observación en el motor de quórum siempre es rastreable hasta la traza completa de los 3 modelos que la produjeron.

## 4. Pendiente

- Implementar `src/audit/trace.ts` (no existe código todavía, solo el diseño de este documento).
- Decidir si `data/audit-pipeline.jsonl` sincroniza por P2P junto con las observaciones o se queda local — no está resuelto en el doc maestro para la parte mobile.
