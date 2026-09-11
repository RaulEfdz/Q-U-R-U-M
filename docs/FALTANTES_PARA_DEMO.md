# Faltantes para la demo y la entrega del reto

Estado comprobado el **11 de septiembre de 2026**. Esta es la lista operativa de cierre; la auditoría completa contra las reglas oficiales está en [AUDITORIA_REGLAS_HACKATHON_2026-09-11.md](AUDITORIA_REGLAS_HACKATHON_2026-09-11.md).

## Ya cumplido y demostrado

- QVAC integrado y modelos ejecutándose localmente.
- Cero proveedores de inferencia cloud: `verify:no-cloud` pasa **7/7**.
- Servidor: typecheck y **117/117 tests**.
- Mobile: typecheck y **17/17 tests**.
- Núcleo compartido idéntico byte a byte entre servidor y mobile.
- Cola offline append-only, recuperación, ACK parcial, reintentos, backoff e idempotencia.
- P2P físico Pixel 7 ↔ servidor: conexión y `hello_ack` real en **83 ms**.
- Allowlist fail-closed y bloqueo de suplantación de identidad por sesión.
- Confirmación humana antes de incorporar evidencia remota a la base instalada.
- Cliente 360, conflictos, quórum, frescura, oportunidades explicables y trazabilidad.
- Código publicado en `origin/rf/dev` y fusionado en `origin/main`.

## P0 — bloquea una entrega completa

### 1. Dar acceso al repositorio

El repositorio aparece privado. Invitar a las cuentas indicadas por la organización o hacerlo público, y abrir la URL desde una ventana sin sesión.

**Cierre:** una persona sin credenciales del equipo puede acceder exactamente al commit enviado.

### 2. Producir y verificar el video final

Grabar el producto real en español, mantener la duración en **5:00 o menos**, evitar credenciales y datos reales, publicar el archivo y probar la URL en incógnito.

**Cierre:** el enlace abre, reproduce, tiene audio entendible y muestra QVAC local, quórum/conflicto, explicación y el control `7/7`.

### 3. Completar el envío de TryDojo

Enviar el repositorio y el video antes de las **08:00, hora de Panamá, del 11/09/2026**. Confirmar además que cada integrante está registrado, aceptó las reglas y pertenece a un solo equipo.

**Cierre:** la plataforma muestra la entrega recibida y el equipo conserva evidencia del envío.

## P1 — necesario para una demo robusta

### 4. Construir y probar el APK release

La app instalada y verificada es debug. Si se reinicia sin Wi-Fi, depende de Metro y no arranca aunque la inferencia sea local.

```bash
cd apps/mobile
npx expo run:android --variant release
```

**Cierre:** con Metro detenido y Wi-Fi apagado, la app reinicia, captura y conserva una observación.

### 5. Ensayar el relato integral una vez

Hacer una toma continua:

```text
voz/texto → IA local → revisión humana → store offline
→ recuperación de conexión → sync P2P + ACK
→ revisión en servidor → Cliente 360 → oportunidad → evidencia original
```

**Cierre:** ninguna descarga de modelos, permiso inesperado, seed manual o error de red interrumpe la historia.

### 6. Validar dictado móvil con una voz real y vocabulario del dominio

Dictar cliente, modalidad, fabricante ficticio, cantidad y edad. Comprobar transcripción, extracción, edición y eliminación del audio temporal.

**Cierre:** una persona completa el recorrido sin ayuda del desarrollador y el texto no pierde los datos esenciales.

### 7. Preparar el escenario reproducible

Dejar listo el seed con quórum, conflicto, estimación, dato incompleto, dato stale y oportunidad; documentar cómo restaurarlo sin borrar información por accidente.

**Cierre:** cualquier integrante puede recuperar el estado de demo en pocos minutos.

## Límites que deben decirse con precisión

- El P2P móvil-servidor está probado usando descubrimiento DHT; una LAN **100% aislada** requiere bootstrap propio y no fue verificada.
- Confianza y confirmación son ejes diferentes: `REPORTED + HIGH` no significa `CONFIRMED`.
- Una posible duplicación se señala; no se fusiona automáticamente sin evidencia suficiente.
- La reconciliación actual no atribuye inventario por `site` de forma completa porque hacerlo bien requiere cambiar el contrato compartido en ambas apps.
- La relevancia comercial de una oportunidad permanece en cero hasta que exista una política humana explícita.

## P2 — después de entregar

- Bootstrap propio para descubrimiento P2P en una red aislada.
- Firma criptográfica completa, rotación/revocación operativa y protección anti-replay persistente.
- Reconciliación `customer → site → equipment` mediante decisión explícita de contrato compartido.
- Evaluación reproducible de precisión y latencia con un dataset etiquetado.
- Captura asistida por foto, si aporta a una versión posterior.

## No hacer antes del envío

- No agregar proveedores cloud, Vercel, CDN ni otra vía de inferencia remota.
- No cambiar contratos compartidos sin actualizar y verificar ambas apps byte a byte.
- No prometer LAN aislada, firma completa o deduplicación automática.
- No sumar pantallas antes de cerrar acceso, video, release y ensayo integral.
