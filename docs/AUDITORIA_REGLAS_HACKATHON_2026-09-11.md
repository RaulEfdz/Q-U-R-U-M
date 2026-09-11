# Auditoría contra las reglas oficiales — 11 de septiembre de 2026

Estado comprobado a las **00:36, hora de Panamá**, antes del cierre oficial de las 08:00.

Fuentes oficiales:

- [Ficha del Decentralized AI Hackathon](https://www.trydojo.io/hackathons/decentralized-ai-hackathon?tab=rules)
- [Términos y condiciones completos](https://ukwovawzehnebuoowcec.supabase.co/storage/v1/object/public/hackathon-assets/a9166428-01b8-436e-aff3-31681a55d0cf/rules/doc-1788551201926-5b88ae71.pdf)
- [Resumen oficial de reglas](https://ukwovawzehnebuoowcec.supabase.co/storage/v1/object/public/hackathon-assets/a9166428-01b8-436e-aff3-31681a55d0cf/rules/doc-1788556902010-2a515482.pdf)

## Veredicto

**El producto cumple el requisito técnico en el código y en la prueba física realizada, pero la entrega todavía no puede declararse completamente conforme.** El código verificado ya está publicado en `origin/rf/dev` y fusionado en `origin/main`. Faltan cerrar las condiciones externas: garantizar acceso del jurado al repositorio privado, entregar/probar el video en español de máximo cinco minutos y completar el envío en TryDojo.

## Matriz de cumplimiento

| Regla | Estado | Evidencia | Acción pendiente |
|---|---|---|---|
| Usar QVAC | Cumple | `@qvac/sdk` ejecuta `loadModel`, `completion` y `transcribe` en `apps/mobile`; el servidor también integra el SDK. | Mostrarlo funcionando en el video. |
| Inferencia en dispositivo o delegada P2P | Cumple | `getLoadedModelInfo().isDelegated !== false` falla cerrado para ruta local. El Pixel 7 ejecuta el cliente nativo. | Grabar una corrida local claramente identificable. |
| Ninguna inferencia en la nube | Cumple en código | `apps/server`: `npm run verify:no-cloud` → 7/7. Escaneo adicional de `apps/server` y `apps/mobile`: ningún proveedor cloud, Web Speech API ni URL ejecutable externa de inferencia. | Mantener este control en la toma final. |
| P2P genuino | Cumple | Hyperswarm móvil-servidor probado en Pixel 7; `hello_ack` real en 83 ms. Allowlist fail-closed, ACK por lote, idempotencia, reintentos y vínculo de identidad por sesión. | No prometer funcionamiento en LAN totalmente aislada: el descubrimiento usa DHT salvo bootstrap propio. |
| Producto sustancial construido en 48 horas | Cumple según historial | README declara la base previa; primer commit dentro de la ventana y dependencias/origen enumerados. | No borrar esa declaración. |
| Repositorio accesible al jurado | No verificable | GitHub reporta `RaulEfdz/Q-U-R-U-M` como **PRIVATE**. | Invitar al jurado o hacer público el repositorio y probar acceso en sesión privada. |
| Entrega antes de las 08:00 | Pendiente | A las 00:36 seguía dentro de plazo. | Enviar repo y video en TryDojo antes de las 08:00; no hay prórroga. |
| Video ≤5 minutos, en español y sin credenciales | Pendiente | Existe guion y tooling, pero no se encontró archivo o URL final. | Renderizar, medir duración y abrir el enlace en ventana privada. |
| Equipo de 1–4, aceptación individual y elegibilidad | No verificable desde el repo | Es información personal de registro. | Confirmar en TryDojo que cada integrante está registrado, aceptó y pertenece a un solo equipo. |
| Código de conducta, identidad y sanciones | No verificable desde el repo | Depende de participantes y conducta. | Confirmación humana del equipo. |

## Evidencia técnica ejecutada

```text
apps/mobile  npm run typecheck  → OK
apps/mobile  npm test           → 17/17
apps/server  npm run typecheck  → OK
apps/server  npm test           → 117/117
apps/server  npm run verify:no-cloud → 7/7
núcleo compartido server/mobile → diff byte a byte OK
Pixel 7 ↔ servidor Hyperswarm   → conectado
Pixel 7 hello ↔ hello_ack       → 83 ms
npm audit servidor, high        → 0 high/critical
npm audit móvil, high           → 0 high/critical; 10 moderate transitivas de tooling Expo
```

Los 17 tests móviles cubren protocolo, `hello_ack`, cola append-only, recuperación tras reinicio, corrupción parcial, orden, idempotencia, ACK parcial, rechazo, caída durante envío, timeout, reenvío y backoff acotado. Los 117 del servidor incluyen rechazo de lote sin `hello` y bloqueo de suplantación de dispositivo/observador.

## Riesgos antes de entregar

1. **Repositorio privado.** No incumple por sí solo, pero sí incumple si el jurado no tiene acceso durante toda la evaluación.
2. **Video no verificado.** El reglamento dice que es lo primero que revisa el jurado. Sin URL accesible, español y duración ≤5:00, la entrega es incompleta.
3. **Envío pendiente.** Código y evidencia técnica no sustituyen el formulario final de TryDojo antes del cierre.
4. **DHT no equivale a LAN aislada.** La inferencia sigue siendo local y el transporte es P2P, por lo que no viola la regla; aun así, la demo no debe afirmar que el descubrimiento funciona sin Internet hasta probar bootstrap propio.

## Prioridad según la rúbrica

- **Technical — 35%:** fuerte y demostrable con QVAC local, P2P real, política y pruebas.
- **Innovation — 25%:** fuerte: quórum por campo, conflicto preservado y evidencia explicable.
- **Impact — 20%:** fuerte si el video cuenta el problema de visitas de campo y base instalada incompleta.
- **Design — 10%:** ambas superficies existen; conviene mostrar una historia y no recorrer todas las pantallas.
- **Completion — 10%:** es el riesgo actual. El código ya está publicado; se cierra probando acceso al repo y al video sin credenciales y enviando antes de las 08:00.
