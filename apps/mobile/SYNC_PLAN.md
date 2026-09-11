# Plan de sincronización móvil

## Objetivo

El celular procesa y confirma una visita sin conexión. Cuando recupera una red,
envía únicamente observaciones confirmadas al servidor central. La observación
se mantiene en la cola hasta recibir un ACK por su `id`.

## Bloques de entrega

1. **Cola offline** — persistencia, estados y reintento seguro.
2. **Identidad** — dispositivo estable y clave pública del transporte.
3. **Protocolo** — `hello`, lote y `ack` versión 1.
4. **Transporte** — Hyperswarm/Noise y descubrimiento del peer autorizado.
5. **Ciclo de vida** — sincronizar al volver la red, backoff y timeout.
6. **UI** — pendiente, sincronizando, recibido, error y última sincronización.
7. **Pruebas** — reenvío, corte, duplicado, rechazo y dos dispositivos.

## Regla de seguridad

La cola contiene observaciones ya confirmadas por una persona. No debe incluir
audio, prompts ni borradores sin confirmar. El ACK significa “recibido por el
servidor”, no “convertido en verdad”: el servidor todavía puede dejarlo en
revisión humana.

Contrato completo: `../server/SYNC_P2P_MOBILE_CONTRACT.md`.
