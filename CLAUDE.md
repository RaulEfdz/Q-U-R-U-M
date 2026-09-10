# QUÓRUM

> **v0.4.0 · 2026-09-10** — las dos apps corren en su plataforma real. Historial: `README.md`. Hallazgos: `docs/AUDITORIA.md`.

Monorepo. Reto: Customer Installed Base Intelligence (Philips) · Decentralized AI Hackathon · ISD Summit Panamá.
Doc fuente completo: `docs/QUORUM_documento_unico.md` (leer ahí antes de tocar reglas de negocio — este archivo es resumen operativo).

## Qué es

App de campo: colaborador dicta/escribe lo que ve en una visita, el sistema extrae equipos médicos instalados (modalidad, marca, edad, cantidad), y reconcilia múltiples testimonios en un **quórum** — verdad que exige corroboración, no un solo reporte.

Principio rector: **El LLM entiende. El código decide. El humano confirma.**

## Estructura monorepo

```
apps/
├── server/   # app central — motor de reconciliación, store, QVAC, UI 127.0.0.1
└── mobile/   # app celular Android/Expo — pipeline 3 modelos (whisper+portero+extractor)
docs/         # documento maestro + doc único (MD) + anexo D pipeline android (MD)
```

Las dos apps tienen código. El núcleo compartido (contratos, motor de quórum, puntaje, policy, spotlighting, export) está escrito, congelado e **idéntico byte a byte entre las dos** — cualquier cambio ahí se replica a ambos lados. Estado por fase y pendientes: `CONTINUAR.md`. Historial de decisiones: `BITACORA.md`.

La prioridad escritorio-vs-móvil sigue formalmente abierta (`ARCHITECTURE.md` §9), pero hoy el móvil está más avanzado y ya demostró lo que más pesa en este reto: el modelo corriendo on-device en un teléfono real.

## Restricciones duras (no negociables)

- **Cero inferencia en la nube.** Nada de OpenAI/Anthropic/Gemini/Groq/Together/HF Inference. Requisito del reto, verificado por ISD antes de pasar a Philips.
- **Nada de Vercel** (deploy/preview/CI-CD) — política de organización, no solo del hackathon. Incluye **`@qvac/ai-sdk-provider` y el Vercel AI SDK**: son paquetes oficiales de QVAC pero arrastran Vercel. Usar `@qvac/sdk` puro.
- **`Web Speech API` del navegador prohibida** — envía audio a servidor del proveedor, es la trampa más fácil de pisar.
- Dependencias npm: revisar antes de instalar (Socket.dev/Snyk/GitHub Advisory), ojo con `postinstall`/`preinstall`/`binding.gyp`, preferir versiones ancladas. Contexto: incidentes de cadena de suministro 2026 (Shai-Hulud, axios, node-ipc).
- **Nada se persiste sin confirmación humana** — todo extraído por modelo es borrador hasta que el usuario confirma.

## Modelo de confianza (dos ejes)

1. **Naturaleza** (`Directo`/`Referido`/`Estimado`/`Desconocido`) — por observación, mapea a `Status` de Philips.
2. **Quórum** (`Sin datos`→`Estimado`→`Reportado`→`Quórum`, o `Sin quórum` si discrepan) — por campo, requiere corroboración de ≥2 testimonios `Directo` y no-hedgeados (RD-7).

Reglas duras RD-0 a RD-7 en `docs/QUORUM_documento_unico.md` §I.2 — no reimplementar sin leerlas, son el núcleo del producto.

## Al trabajar acá

- Ver `apps/server/CLAUDE.md` para estructura de código del servidor.
- Ver `apps/mobile/CLAUDE.md` para el pipeline Android (Expo, 3 modelos, evidencia citada).
- Cambios a contratos (`core/contracts.ts`) se congelan tras diseño — se reutilizan sin tocar entre server y mobile. Tocar solo si el doc maestro cambia.
