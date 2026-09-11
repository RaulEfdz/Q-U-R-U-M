# Plan de pruebas del servidor — QUÓRUM

Fecha: 2026-09-10. Alcance: `apps/server`.

Este documento convierte el reto original (`docs/RETO-HAKATON-INICIAL-TEXT/reto.md`) en evidencia reproducible. No afirma cobertura absoluta ni sustituye una demo: separa lo que CI puede demostrar sin red ni modelos descargados de lo que el jurado debe ejecutar en vivo.

## Comandos de evidencia

```bash
cd apps/server
npm run typecheck
npm test
npm run verify:no-cloud
# equivalente para CI / jurado:
npm run test:ci
```

Los tests usan `node:test`, directorios temporales para stores y `node:http` crudo para HTTP. No dependen de una API cloud, de una GPU, ni del puerto 3000 del usuario.

## Matriz contra el reto

| Requisito del reto | Evidencia automatizada | Verificación en demo |
| --- | --- | --- |
| Captura en lenguaje natural | `contratos-y-confianza`, `delegacion`, `servidor` | Escribir una nota y revisar el borrador antes de guardar. |
| Extracción local tolerante a datos incompletos | Zod, evidencia literal y estados se prueban en `contratos-y-confianza`, `reconcile`, `verificar` | Ejecutar una extracción QVAC real con una nota completa y otra parcial. |
| Dataset estructurado y estado de confianza | `reconcile`, `cohortes`, `multidispositivo`, `stores-integridad` | Confirmar una observación y abrir Cliente 360. |
| Vista por cliente y agregación geográfica | `servidor` (`proyeccion`, unidades disputadas) | Abrir Cliente 360 y Panorama. |
| Sin nube (requisito eliminatorio) | `verify:no-cloud`, `policy`, CSP/headers en `servidor` | Desactivar Wi‑Fi, arrancar la app y capturar localmente. |
| Dictado | configuración ASR y rutas HTTP se validan estáticamente; no se finge audio en CI | Dictar un audio corto en español; verificar texto y que el temporal se elimina. |
| Duplicados y corroboración | `multidispositivo`, `reconcile`, `contratos-y-confianza` | Cargar dos observadores y mostrar el ascenso a quórum. |
| Puntaje, frescura y oportunidad | `score`, `reconcile`, `filtro-y-export` | Mostrar puntaje y alerta de visita vieja. |
| Pregunta de seguimiento | `pendientes`, confirmación y auditoría | Confirmar sin responder una pregunta y revisar la cola. |
| Consulta en lenguaje natural | límite de contexto y ejecución determinista en `servidor`, `filtro-y-export`, `policy` | Consultar “MR de más de siete años en Brasil”. |
| Export Philips | `filtro-y-export`, `policy` | Descargar CSV local y abrirlo. |

## Suite por frontera

| Archivo | Frontera que protege |
| --- | --- |
| `reconcile.test.ts` | RD-0 a RD-7: datos ausentes, independencia, desacuerdo, frescura y hedging. |
| `cohortes.test.ts`, `multidispositivo.test.ts` | Cohortes, multi-dispositivo, deduplicación y quórum. |
| `score.test.ts` | Completitud, frescura y corroboración sin premiar conflictos. |
| `contratos-y-confianza.test.ts` | Zod, normalización, hedging, similitud y candidatos de fusión. |
| `filtro-y-export.test.ts` | Filtros deterministas y CSV Philips escapado/trazable. |
| `policy.test.ts`, `injection.test.ts` | PEP, deny-by-default, origen modelo, egress y spotlighting. |
| `servidor.test.ts` | Host, CSP, no-store, CSRF/Origin, JSON estricto y proyección. |
| `stores-integridad.test.ts`, `pendientes.test.ts` | Append-only, corrupción visible, cadena hash y borradores en memoria. |
| `peer.test.ts`, `revisiones-peer.test.ts` | Límite de memoria P2P y revisión humana previa a persistir. |
| `delegacion.test.ts` | Cliente identificable obliga ruta local. |

## Reglas que no se negocian

- Un test nunca llama una API de inferencia externa.
- Las pruebas de stores cambian a un directorio temporal; no leen ni borran `data/` del usuario.
- Las pruebas HTTP usan un puerto efímero y `node:http`; nunca `fetch` para validar `Host` u `Origin`.
- El modelo no ejecuta acciones: toda tool de origen modelo cruza PEP con `origenArgumentos: 'modelo'`.
- Un test de éxito no basta: cada frontera tiene al menos un caso de rechazo, desacuerdo, dato ausente o input hostil.

## Pruebas de aceptación manual obligatorias

Estas dependen de hardware, permisos o un modelo real; automatizarlas con mocks no probaría el requisito del reto.

1. Con Wi‑Fi apagado, ejecutar `npm start`, abrir `http://127.0.0.1:3000` y capturar una nota por texto.
2. Dictar una nota en español; comprobar que la transcripción queda en español y que no queda audio en `data/tmp/`.
3. Confirmar una nota, cargar un segundo observador y mostrar `Quórum`; luego introducir una cantidad incompatible y mostrar `Sin quórum` sin promedio.
4. Enviar una observación desde un peer permitido: debe aparecer en “Revisión P2P pendiente”, no en la base instalada. Confirmarla explícitamente y comprobar su incorporación/auditoría.
5. Intentar la consulta/inyección de export desde un texto peer; debe generar `policy:deny` y no producir CSV.
6. Exportar desde el botón humano y abrir el CSV: 19 columnas, datos dummy y status Philips.

## Límites honestos

La suite no prueba que QVAC pueda descargar o ejecutar un modelo específico en cada laptop, ni que Hyperswarm descubra peers en una LAN aislada. Esos dos puntos requieren la prueba manual anterior y deben presentarse como tales ante el jurado.
