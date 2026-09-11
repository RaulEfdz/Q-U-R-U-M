# Faltantes para la demo y la entrega del reto

Este documento separa lo que QUÓRUM ya implementa de lo que aún falta probar o cerrar para presentarlo con rigor. No son promesas de funcionalidades ya terminadas: son condiciones verificables para sostener la demo frente al jurado.

## Qué ya está cubierto

- Captura conversacional por texto y una vía de dictado local.
- Extracción a un borrador estructurado, editable antes de guardar.
- Confirmación humana antes de persistir una observación.
- Estados de evidencia, confianza, procedencia, conflictos y quórum por campo.
- Cliente 360, Panorama, filtros, oportunidades y exportación.
- Política de deny-by-default, servidor limitado a `127.0.0.1`, y guardas contra inferencia cloud.
- Revisión humana local para testimonios recibidos por P2P antes de incorporarlos a la base.

## P0 — necesario antes de presentar

### 1. Ensayo completo sin Wi-Fi

Hacer una toma continua en la máquina de demo: desconectar Wi-Fi, capturar una nota real, ejecutar la inferencia QVAC local, revisar el borrador, confirmarlo y mostrar el cambio en Cliente 360 y Panorama.

**Cierre:** la demostración ocurre sin una API cloud, sin una descarga pendiente de modelo y sin intervención manual fuera de la interfaz.

### 2. Probar dictado real en español

Dictar una visita con vocabulario del dominio —por ejemplo MR, CT, fabricante, modelo, edad y cantidad— y verificar la transcripción, la extracción y el borrado del audio temporal.

**Cierre:** una persona distinta de quien desarrolló el flujo puede completar el recorrido en una sola toma.

### 3. Probar P2P con dos dispositivos autorizados

Enviar un testimonio desde un peer autorizado. En el receptor debe aparecer en **Revisión P2P pendiente**; solo después de una confirmación humana debe modificar Cliente 360.

**Cierre:** hay evidencia grabada de que el dato remoto no entra al store definitivo de manera automática.

### 4. Hacer el seed de demo reproducible

Preparar un comando seguro o una guía corta para reiniciar datos de demo sin sobrescribir por accidente trabajo real. El escenario debe incluir, como mínimo: quórum, conflicto, estimación, dato incompleto, dato antiguo y oportunidad.

**Cierre:** cualquier integrante puede dejar la demo en el mismo estado inicial antes de una presentación.

## P1 — mejora fuerte para el jurado

### Evidencia negativa de seguridad

Guardar capturas o una salida reproducible de estos casos: Origin externo rechazado, Host externo rechazado, pedido de exportación iniciado por un modelo denegado y exportación humana local permitida.

### Prueba de integración del extractor con fixture local

Cuando sea posible sin descargar modelos ni usar red, fijar casos de nota incompleta, edades por cohortes, evidencia demasiado extensa, datos inventados y normalización de cliente/país.

### Ensayo de UX en proyector

Validar que una persona entienda a primera vista los estados, el conflicto por campo y las acciones de Revisión P2P. Ajustar solamente lo que confunda durante ese ensayo.

### Sincronizar el relato y la documentación

Actualizar el documento maestro y el guion de demo para que describan con precisión el comportamiento actual: P2P transporta testimonios, pero una persona los revisa antes de incorporarlos como observaciones locales.

## P2 — solo si P0 y P1 están cerrados

- Captura asistida por foto, como objetivo adicional del reto.
- Importación/exportación P2P incremental y firmada; requiere una decisión explícita sobre el contrato compartido entre móvil y servidor.
- Métricas de precisión y velocidad con protocolo, dataset de evaluación y resultados reproducibles.

## Qué no conviene hacer antes de la demo

- No agregar proveedores cloud, CDN, Vercel ni dependencias que contradigan la propuesta local.
- No cambiar los contratos compartidos entre móvil y servidor sin una decisión de producto y la actualización simultánea de ambas apps.
- No sumar funciones decorativas antes de probar el recorrido completo con datos y personas reales.

La referencia detallada de planificación se conserva en [BACKLOG_RETO_PRIORIZADO.md](BACKLOG_RETO_PRIORIZADO.md).
