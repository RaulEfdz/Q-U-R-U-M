# QUÓRUM server — Arquitectura y diseño

> **v0.2.0 · 2026-09-10** — corregido tras la auditoría (`../../docs/AUDITORIA.md`). Ver `CLAUDE.md` para la tabla de 16 bugs a corregir al implementar.

Fuente: `../../docs/QUORUM_documento_unico.md` PARTE I y PARTE II. Reglas de trabajo: `CLAUDE.md`. Trazabilidad requisito→código: `TRAZABILIDAD.md`.

## 1. Diagrama del flujo

```
   VOZ (MediaRecorder)          TEXTO (input directo)
        │                              │
        ▼                              │
┌──────────────────────────┐           │
│ WHISPER · whisper.cpp    │           │
│ (QVAC, on-device)        │           │
└──────────────┬───────────┘           │
               └───────────┬───────────┘
                            ▼ texto
               ┌──────────────────────────────┐
               │ EXTRACCIÓN · completion()    │
               │ + tools:true + esquema Zod   │  on-device o delegado P2P
               └──────────────┬────────────────┘
                              ▼
               ┌──────────────────────────────┐
               │ BORRADOR (no persistido)      │  ← H-03
               └──────────────┬────────────────┘
                              ▼
                  CONFIRMACIÓN HUMANA (UI)
                  confirma · corrige · descarta
                              │
                              ▼
               ┌──────────────────────────────┐
               │ STORE append-only (.jsonl)    │  ← única escritura
               └──────────────┬────────────────┘
                              ▼
               ┌──────────────────────────────┐
               │ MOTOR DE RECONCILIACIÓN       │  puro, determinista
               │ reconciliar() — RD-0..RD-7    │
               └──────────────┬────────────────┘
                              ▼
              ┌───────────────┴────────────────┐
              ▼                                 ▼
     Vista Cliente 360                 Export CSV Philips (19 col.)
              │
              ▼
   Consulta en lenguaje natural → tool `filtrar_base_instalada`
   → filtro determinista → resultado (SIN pasar por completion() de nuevo)
```

Camino paralelo, sin tocar el store: **sync P2P** (`sync/peer.ts`, Hyperswarm) transmite testimonios entre dispositivos; cada testimonio que llega marca `origen:'peer'` y entra por `context/spotlight.ts` como `untrusted` antes de cualquier prompt.

## 2. Dónde ocurre la inferencia (tabla de referencia)

| Tarea | Motor | Dónde |
|---|---|---|
| Voz → texto | QVAC `transcribe` (whisper.cpp) | on-device |
| Texto → estructura | QVAC `completion()` + tools + Zod | on-device o delegado P2P |
| Consulta en lenguaje natural | QVAC `completion()` + tool de filtro | on-device |
| Normalización, cohortes, quórum, puntaje, export, año derivado | código determinista | nunca inferencia |
| UI | HTML/CSS/JS en `127.0.0.1` | sin nube |
| Persistencia | `data/*.jsonl` append-only | sin nube |
| Sync | Hyperswarm, Noise E2E | sin servidor |

Cero llamadas de inferencia a la nube, cero servicios cloud en la ruta — ni los que el reglamento permitiría (hosting, auth, storage). Se evita a propósito para que ISD no tenga ni la duda al verificar.

## 3. Modelo de confianza — dos ejes, siete reglas

**Eje 1 · Naturaleza** (por observación, declarado o inferido del lenguaje): `Directo` / `Referido` / `Estimado` / `Desconocido` — mapea 1:1 al `Status` de Philips (`Confirmed`/`Reported`/`Estimated`/`Unknown`).

**Eje 2 · Quórum** (por campo de la proyección): `Sin datos` → `Estimado` → `Reportado` → `Quórum`, o `Sin quórum` si los observadores discrepan.

Reglas duras — ver `CLAUDE.md` para el texto completo. Nota de auditoría: la corroboración (RD-4/score) debe mirar **convergencia**, no solo conteo de testigos `Directo` — el código de la fuente falla esto (corrección #11 de `CLAUDE.md`), y `Sin quórum` por edad no existe si la edad no pasa por `resolverCampo` además de por cohortes (corrección #12).

## 4. Puntaje de confianza

```
puntaje = 45·completitud + 25·frescura + 30·corroboración      (0–100)
```

Siempre desglosado en la UI — un número solo es opaco. No reemplaza al quórum: es un resumen para ordenar y priorizar; el quórum es la afirmación de verdad.

## 5. Decisiones cerradas

| Decisión | Elección | Razón |
|---|---|---|
| Plataforma para la demo | Dos laptops, UI en `127.0.0.1` | Expo + móvil + sync en 48h compite con el tiempo que puntúa. Ver `apps/mobile/ARCHITECTURE.md` §9 para la condición bajo la cual sí se justifica móvil |
| Modelo | Qwen3 1.7B–4B Q4 | Punto de partida; ajustar con `qvac doctor`. Verificado: `Qwen3-1.7B-Q4_0` existe en el registro real (1057 MB) |
| Datos | Solo el workbook dummy de Philips | Exigido por el brief; cero marcas reales |
| Sync | Construido sobre Hyperswarm | QVAC da delegación de inferencia, no un almacén replicado |
| Vector store | Ninguno | RAG interno de QVAC marcado "prototype only"; resolución de entidad es determinista y no lo necesita |
| Framework UI | Ninguno | Cuatro pantallas en HTML plano, sin sistema de diseño |
| Dependencias | 3 totales (`@qvac/sdk`, `hyperswarm`, `zod`) | Clone limpio rápido, `npm audit` limpio, postura de supply chain verificable |

## 6. Estructura de carpetas

```
apps/server/
├── .npmrc                          # ignore-scripts=true, min-release-age=7, audit-level=high
├── package.json                    # 3 dependencias
├── tsconfig.json                   # strict
├── src/
│   ├── core/{ids,errors,contracts}.ts
│   ├── qvac/{gateway,extract,delegation}.ts
│   ├── trust/{normalize,similarity,entity,reconcile,score}.ts   # ★ el motor
│   ├── store/{observations,drafts,audit}.ts
│   ├── policy/{engine,pep}.ts
│   ├── tools/{filtrar,exportar}.ts
│   ├── context/spotlight.ts
│   ├── export/philips.ts           # CSV, 19 columnas exactas de Philips
│   ├── sync/peer.ts
│   └── server/index.ts
├── ui/{index.html,app.js,style.css}
├── data/seed.json
├── test/{reconcile,cohortes,policy,injection,score}.test.ts
└── scripts/{seed,provider,probar-dht,verify-no-cloud.sh}.ts
```

Nota de auditoría: el doc maestro declara 5 archivos de test pero solo escribe 3 (`policy.test.ts` y `score.test.ts` faltan por crear). `scripts/verify-no-cloud.sh` es un `.sh`, no `.ts` — no seguir la expansión literal de la estructura original.

## 7. Principio rector

> **El LLM entiende. El código decide. El humano confirma.**

1. La salida del modelo es input hostil: se valida contra esquema; si no valida, se rechaza.
2. Ningún estado de confianza cambia por decisión del modelo.
3. Ninguna acción con efecto lateral se ejecuta sin pasar por el PEP.
4. Todo contenido de origen peer entra al contexto con spotlighting y etiqueta `untrusted`.
5. Los testimonios son inmutables. Todo lo demás es proyección recalculable.
6. Nada se persiste sin confirmación humana.

## 8. Gate antes de escribir código

```bash
npm audit --audit-level=high
```
Confirmar `@qvac/sdk@0.18.2` (no 0.17.1 del doc), y que `WHISPER_TINY` esté descargado en `~/.qvac/models` — hoy falta.

## 9. Pendiente / no cerrado

- Las 16 correcciones de `CLAUDE.md` deben aplicarse durante la escritura, no como parche.
- `export-local-por-humano` inalcanzable en el policy engine de la fuente (corrección #1) — bloquea toda la demo de export si se copia tal cual.
- `verify-no-cloud.sh` con solo 5 controles automatizados reales, no 7 (corrección de `CLAUDE.md` §3).
- Gestor de tickets real de Bladex sin confirmar (fuera del alcance de este repo, pendiente de negocio).
