# Sincronización offline → servidor central

## Propósito

El celular es el dispositivo de campo: procesa la nota con sus modelos locales,
muestra un borrador y solo guarda una observación después de la confirmación
humana. La conexión no es permanente. Cuando el dispositivo recupera una red y
encuentra un peer autorizado, entrega las observaciones confirmadas que aún no
han sido reconocidas.

```text
voz/foto offline
  → inferencia local
  → borrador
  → confirmación humana
  → store local del celular
  → cola de sincronización
  → Hyperswarm / Noise E2E
  → servidor central
  → validación de contrato
  → bandeja de revisión P2P
  → confirmación humana en el servidor
  → store append-only
  → reconciliación, Customer 360 e inteligencia
```

El servidor no necesita recibir audio ni volver a interpretar la visita. Su
trabajo empieza con una observación estructurada y confirmada por la persona
que la capturó.

## Contrato de conexión

El transporte usa Hyperswarm. Ambos peers se unen al topic estable:

```text
sha256("quorum/base-instalada/v1")
```

Cada peer se identifica por su clave pública ed25519. Noise cifra y autentica
el canal. La clave debe estar autorizada explícitamente en la allowlist del
servidor; una allowlist vacía rechaza todo peer.

El transporte intercambia líneas JSON delimitadas por `\n`:

```json
{
  "tipo": "observaciones",
  "datos": [
    {
      "id": "obs-123",
      "observadorId": "empleado-7",
      "dispositivoId": "phone-panama-2",
      "origen": "local"
    }
  ]
}
```

El ejemplo omite campos para legibilidad. Cada elemento completo debe cumplir
`zObservacion`.

## Recepción segura

Al recibir un lote, el servidor debe:

1. validar cada observación de forma independiente;
2. rechazar entradas inválidas sin tirar las válidas del mismo lote;
3. conservar el `id` original para idempotencia;
4. registrar el dispositivo, peer, hora de recepción y resultado;
5. marcar el transporte como `peer` para que ningún dato remoto se confunda
   con una acción local;
6. dejar el lote en una bandeja persistente de revisión;
7. devolver un ACK con `recibidas`, `duplicadas` y `rechazadas`;
8. no escribir en la base instalada hasta una confirmación humana local.

El sync transporta evidencia; no otorga confianza ni resuelve conflictos.
`reconciliar()` decide quórum por observadores independientes después de que la
persona local incorpore la evidencia.

## Estados de entrega

El celular necesita distinguir, por observación:

```text
pendiente-local
  → enviando
  → recibida-pendiente-de-revision
  → incorporada
```

Y también:

```text
enviando → reintentar
enviando → rechazada
recibida-pendiente-de-revision → descartada
```

Un corte después de enviar no debe generar pérdida ni duplicado: el celular
reenvía hasta recibir ACK y el servidor procesa el mismo `id` una sola vez.

## Descubrimiento y alcance de la afirmación

Hyperswarm puede descubrir por DHT pública o por un bootstrap local. La frase
de la demo depende de la prueba real:

- con bootstrap local: los dispositivos se encuentran en LAN aislada;
- con DHT y salida a internet: el descubrimiento requiere red y el canal queda
  cifrado entre peers;
- con relay: la sincronización depende de internet aunque el relay no lea el
  contenido.

No se debe afirmar “funciona completamente offline”: offline aplica a captura e
inferencia local, no a la sincronización.

## Trabajo del servidor

La base existente ya tiene validación, allowlist, marcado de origen, auditoría
y revisión humana. Para cerrar este flujo faltan, en orden:

1. bandeja P2P persistente, no solo memoria/TTL;
2. ACK por observación y resultados parciales;
3. idempotencia explícita del protocolo;
4. registro/revocación de dispositivos;
5. estado de sync visible en la UI;
6. sync incremental en lugar de enviar el corpus completo;
7. prueba física E3 y, si se necesita, E1 del Anexo A.

Este documento describe el contrato operativo. No modifica `core/contracts.ts`:
los cambios al contrato compartido requieren decisión y réplica en ambas apps.
