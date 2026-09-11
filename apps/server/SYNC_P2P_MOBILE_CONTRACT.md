# Contrato de sincronización móvil ↔ servidor

## Objetivo

El móvil es un dispositivo de campo que puede pasar horas sin conectividad.
Procesa la nota localmente, obtiene la confirmación humana y guarda la
observación estructurada en su propio store. El servidor no espera una conexión
permanente y no recibe audio para volver a interpretar la visita.

```text
MÓVIL A · Panamá       ┐
MÓVIL B · São Paulo    ├─ sincronización P2P cuando hay red ─→ SERVIDOR
MÓVIL C · Bogotá       ┘
```

La sincronización es **store-and-forward**: una visita confirmada permanece en
la cola del móvil hasta que el servidor confirma su recepción. Un corte nunca
debe obligar a capturar de nuevo ni crear una segunda evidencia.

## Responsabilidad de cada lado

### Cada celular

- Capturar voz o texto, y en el futuro foto/OCR.
- Ejecutar ASR, portero, extractor y verificador localmente.
- Mostrar el borrador y obtener confirmación humana.
- Guardar la observación confirmada offline.
- Mantener una cola de observaciones no reconocidas.
- Descubrir peers autorizados cuando recupere conectividad.
- Enviar observaciones estructuradas, nunca audio ni prompts.
- Conservar pendientes hasta recibir ACK definitivo.
- Reintentar con backoff después de cortes.

### Servidor central

- Autenticar el peer mediante la clave pública del transporte.
- Validar el protocolo y cada `Observacion` con Zod.
- Registrar dispositivo, lote, recepción y resultado.
- Deduplicar por `observacion.id` y `loteId`.
- Devolver resultado individual para que el móvil pueda avanzar su cola.
- Poner lo recibido en revisión humana.
- No incorporar al store hasta la decisión humana local.
- Después de incorporar, recalcular quórum, conflictos, frescura e inteligencia.

El servidor no convierte una recepción P2P en confianza. El origen del
transporte y el estado de corroboración son ejes distintos.

## Identidad y conexión

Cada instalación móvil genera o conserva una identidad estable:

```text
dispositivoId     identificador legible y estable
observadorId      persona que usa el dispositivo
clave pública     identidad criptográfica del peer
```

Hyperswarm descubre peers mediante el topic:

```text
sha256("quorum/base-instalada/v1")
```

Noise aporta cifrado y autenticación del canal. El servidor acepta únicamente
claves públicas autorizadas; una allowlist vacía rechaza todos los peers.

El servidor debe conservar un registro local de dispositivos:

```json
{
  "dispositivoId": "phone-panama-2",
  "observadorId": "empleado-7",
  "clavePublica": "hex...",
  "registradoEn": "2026-09-10T14:00:00.000Z",
  "estado": "activo",
  "ultimoContactoEn": "2026-09-10T16:30:00.000Z",
  "ultimoSyncEn": "2026-09-10T16:30:00.000Z"
}
```

La clave pública identifica el transporte; no sustituye la identidad humana.
El quórum cuenta `observadorId`, no cantidad de dispositivos.

## Protocolo de mensajes

Todos los mensajes viajan como JSON delimitado por salto de línea. El protocolo
debe incluir una versión para rechazar cambios incompatibles de forma clara.

### 1. Hello

El móvil inicia cada sesión con:

```json
{
  "tipo": "hello",
  "versionProtocolo": 1,
  "dispositivoId": "phone-panama-2",
  "observadorId": "empleado-7",
  "cursorServidor": "obs-122"
}
```

El servidor comprueba que el peer criptográfico autorizado corresponde al
dispositivo registrado. Si no coincide, cierra la conexión y audita el rechazo.

Respuesta:

```json
{
  "tipo": "hello_ack",
  "versionProtocolo": 1,
  "servidorId": "central-01",
  "sesionId": "sync-abc123",
  "cursorServidor": "obs-122"
}
```

### 2. Lote de observaciones

El móvil manda únicamente observaciones confirmadas que siguen pendientes:

```json
{
  "tipo": "observaciones",
  "versionProtocolo": 1,
  "loteId": "lote-phone-panama-0007",
  "dispositivoId": "phone-panama-2",
  "datos": [
    {
      "id": "obs-123",
      "observadorId": "empleado-7",
      "dispositivoId": "phone-panama-2",
      "origen": "local",
      "visitadoEn": "2026-09-10T14:00:00.000Z"
    }
  ]
}
```

El ejemplo abrevia campos. Cada observación completa debe cumplir el contrato
congelado de `zObservacion`.

### 3. ACK individual

El servidor responde siempre, incluso si algunas entradas son inválidas:

```json
{
  "tipo": "ack",
  "versionProtocolo": 1,
  "loteId": "lote-phone-panama-0007",
  "recibidas": ["obs-123"],
  "duplicadas": ["obs-122"],
  "rechazadas": [
    { "id": "obs-124", "motivo": "CONTRATO_INVALIDO" }
  ],
  "revisionId": "revision-456"
}
```

Semántica para el móvil:

- `recibidas`: puede quitarlas de la cola de envío; quedan en revisión del
  servidor, no necesariamente incorporadas al conocimiento.
- `duplicadas`: puede quitarlas de la cola; el servidor ya conoce ese `id`.
- `rechazadas`: no debe borrarlas automáticamente. Debe conservarlas como
  error visible y permitir corregir/reintentar según el motivo.
- Ausencia de ACK: no cambia ningún estado; el lote se reintenta.

## Estados de sincronización en el móvil

Cada observación debe tener estado de transporte separado de su estado de
dominio:

```text
pendiente-local
  → enviando
  → recibida-pendiente-de-revision
  → incorporada
```

Errores posibles:

```text
enviando → reintentar
enviando → error-visible
recibida-pendiente-de-revision → descartada-en-servidor
```

No mezclar estos estados con `CONFIRMED`, `REPORTED`, `ESTIMATED` o `UNKNOWN`.
Una observación puede estar `CONFIRMED` por la persona del móvil y, a la vez,
`recibida-pendiente-de-revision` en el servidor.

## Reintentos e idempotencia

El móvil debe usar backoff, por ejemplo 2 s, 5 s, 15 s, 30 s y luego una pausa
mayor. Nunca debe eliminar una observación solo porque el socket se cerró.

El servidor debe ser idempotente en dos niveles:

```text
mismo loteId + mismo dispositivoId
  → no crea otra revisión

mismo observacion.id
  → no crea otra evidencia
```

El ACK puede repetirse sin cambiar el resultado. Esto cubre el caso crítico:
el servidor recibió el lote, pero la conexión se cortó antes de que el móvil
leyera el ACK.

## Validación y confianza

El servidor valida cada entrada independientemente. Una entrada defectuosa no
debe descartar las válidas del mismo lote.

Al recibir por P2P:

```text
origen de transporte = peer
```

Eso activa el tratamiento `untrusted` para cualquier uso posterior como
contexto de modelo. No se debe confiar en un campo `origen: local` enviado por
el móvil sin comprobar la sesión.

La recepción no genera quórum. El quórum se calcula después, por observadores
independientes, al incorporar la evidencia mediante revisión humana.

## Cortes y casos límite

### Corte antes de enviar

El móvil conserva `pendiente-local` y no cambia nada.

### Corte durante el envío

El móvil conserva el lote y vuelve a enviarlo. El servidor deduplica.

### Corte después de recibir, antes del ACK

El móvil reenvía. El servidor responde con los mismos IDs como `duplicadas` o
con el ACK original, sin crear otra revisión.

### Servidor reiniciado

La bandeja P2P debe recuperarse desde almacenamiento append-only. No se debe
perder una recepción porque el proceso se reinició.

### Observación inválida

Se devuelve en `rechazadas` con motivo estable y se conserva auditoría.

### Dos móviles reportan lo mismo

No se fusionan observaciones por texto parecido. Se conservan sus IDs,
observadores, fechas y evidencias para que `reconciliar()` resuelva el campo.

## Red de demo

`127.0.0.1` protege el servidor local, pero un celular físico no puede acceder
al loopback de la laptop. La demo debe elegir explícitamente una opción:

1. P2P Hyperswarm con el servidor manteniendo HTTP en loopback.
2. Adaptador LAN controlado para una prueba móvil concreta.
3. Servidor ejecutándose en un dispositivo accesible por los celulares.

La frase “funciona offline” solo puede referirse a captura e inferencia local.
La sincronización requiere una red disponible. El escenario exacto debe quedar
registrado según el Anexo A del documento único.

## Checklist para el desarrollador móvil

- [ ] Generar identidad estable de dispositivo.
- [ ] Asociar dispositivo con observador.
- [ ] Guardar observaciones confirmadas en store local.
- [ ] Mantener cola de sync separada del store de dominio.
- [ ] Implementar `hello` versión 1.
- [ ] Implementar lote JSON delimitado por `\n`.
- [ ] Implementar ACK parcial.
- [ ] Marcar como sincronizadas solo las entradas con ACK.
- [ ] Reintentar sin duplicar después de cortes.
- [ ] Mostrar pendientes, errores y última sincronización.
- [ ] No enviar audio, prompts ni borradores sin confirmación.
- [ ] Probar dos dispositivos con dos observadores.
- [ ] Probar reenvío del mismo lote.
- [ ] Probar reinicio del servidor.

## Estado actual del servidor

El servidor ya tiene Hyperswarm, allowlist, validación, marcado de origen,
auditoría, revisión humana y bandeja persistente. Todavía debe completar el
`hello`, ACK individual, idempotencia por `loteId`, registro de dispositivos,
sync incremental y métricas visibles para que este contrato sea ejecutable de
punta a punta.
