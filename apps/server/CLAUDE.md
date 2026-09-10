# QUÓRUM · server (app central)

Node ≥22.17, TypeScript sin build step (`--experimental-strip-types`), 3 dependencias totales: `@qvac/sdk`, `hyperswarm`, `zod`. Ver monorepo raíz `../../CLAUDE.md` para restricciones duras (sin nube, sin Vercel).

## Dónde corre la inferencia (regla de oro)

| Tarea | Motor | Dónde |
|---|---|---|
| Voz → texto | QVAC `transcribe` (whisper.cpp) | on-device |
| Texto → estructura | QVAC `completion()` + tool + Zod | on-device o delegado P2P |
| Todo lo demás (normalización, cohortes, quórum, puntaje, query) | código determinista | nunca inferencia |

Dictado: `MediaRecorder` → POST server local → whisper QVAC on-device. Nunca Web Speech API.

## Estructura prevista (del doc maestro §II.1)

```
src/
├── core/{ids,errors,contracts}.ts     # contratos Zod — congelados tras diseño
├── qvac/{gateway,extract,delegation}.ts
├── trust/{normalize,similarity,entity,reconcile,score}.ts   # ★ motor, puro, sin I/O
├── store/{observations,drafts,audit}.ts
├── policy/{engine,pep}.ts             # policy enforcement point
├── tools/{filtrar,exportar}.ts
├── context/spotlight.ts               # marca contenido peer como untrusted
├── export/philips.ts                  # CSV esquema exacto de 19 columnas
├── sync/peer.ts                       # Hyperswarm, Noise E2E
└── server/index.ts
ui/{index.html,app.js,style.css}       # sin framework, servido en 127.0.0.1
data/seed.json
test/{reconcile,cohortes,policy,injection,score}.test.ts
scripts/{seed,provider,probar-dht,verify-no-cloud.sh}.ts
```

## Reglas duras del motor (`trust/reconcile.ts`)

RD-0 sin datos nunca se rellena · RD-1 un observador no da quórum · RD-2 discrepancia = `Sin quórum`, nunca promedio · RD-3 un observador cuenta una vez (su testimonio más reciente) · RD-4 confianza por campo · RD-5 todos hedgeados → techo `Reportado` · RD-6 frescura desde `visitadoEn`, no `capturadaEn` · RD-7 solo testimonio `Directo` y asertivo da quórum.

Texto completo y código de referencia: `../../docs/QUORUM_documento_unico.md` §I.2, §II.8.

## Antes de tocar código

1. `core/contracts.ts` es el contrato — no romper sin actualizar el doc maestro.
2. `.npmrc` tiene `ignore-scripts=true` — no lo saques. Si un addon nativo necesita rebuild, hacelo selectivo (`npm rebuild <pkg> --ignore-scripts=false`), nunca global, nunca en máquina con tokens de CI/prod.
3. `verify-no-cloud.sh` es el control que corre antes de cualquier demo — no romperlo.
