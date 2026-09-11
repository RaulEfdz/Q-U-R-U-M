# Backlog para cerrar el reto de QUÓRUM

Fuente: reto inicial, especificación única, auditoría del servidor y matriz de pruebas. Esta lista separa lo que falta demostrar de lo que falta construir: no conviene construir una meta adicional antes de poder probar el requisito eliminatorio.

## P0 — obligatorio antes de presentar

1. **Ensayo de punta a punta de QVAC local, sin Wi‑Fi.**
   - Evidencia: video continuo de dictado/texto → borrador → confirmación → Cliente 360.
   - Criterio: no hay red, no hay API cloud, y se ve la inferencia real del modelo configurado.
   - Razón: el script verifica ausencia de egress, pero no demuestra que la inferencia real esté operativa en esa laptop.

2. **Ensayo P2P con dos dispositivos autorizados.**
   - Evidencia: un peer envía un testimonio; el receptor lo muestra en Revisión P2P pendiente; una confirmación humana lo incorpora y cambia la proyección.
   - Criterio: ningún dato peer entra a `observaciones.jsonl` antes de la revisión.
   - Razón: la lógica está cubierta por tests, pero discovery/red física depende del entorno.

3. **Guion de demo reproducible con seed reiniciable.**
   - Entregar un comando seguro que copie un fixture de demo a un directorio temporal o documentar el reset manual.
   - Criterio: cada toma empieza con los mismos estados: Reportado, Quórum, Sin quórum, dato viejo y oportunidad.

4. **Prueba real de dictado en español.**
   - Evidencia: permiso de micrófono, audio corto, transcripción en español, borrado de `data/tmp/*.webm`.
   - Razón: no se puede probar Whisper real con un mock sin dejar de probar el requisito.

## P1 — mejora directa de puntaje

1. **Tests de integración del extractor QVAC con fixture local.**
   - Añadirlos solo si se puede inyectar un resultado del SDK sin llamar a red ni descargar modelos.
   - Casos: nota incompleta, dos cohortes de edad, evidencia inventada, cita de más de 500 caracteres, cliente/país normalizados.

2. **Informe de prueba negativo para seguridad.**
   - Guardar evidencia de: Origin externo rechazado, Host externo 421, intento de export iniciado por modelo denegado y CSV humano permitido localmente.
   - Es más persuasivo que declarar “seguro”: muestra el ataque y el bloqueo.

3. **Revisión de la UX de Revisión P2P en una sesión real.**
   - Confirmar que es visible sin navegar demasiado y que las acciones “Confirmar e incorporar” / “Descartar” se entienden en proyector.

4. **Actualizar documento maestro y guion.**
   - Reflejar el flujo actual: P2P transporta, pero la evidencia entra a la base solo tras revisión humana local.
   - Evita prometer sync automático que el servidor ya no hace por seguridad.

## P2 — metas adicionales, solo después de P0 y P1

1. **Captura asistida por foto.** El reto la marca como meta adicional y depende de un modelo de visión disponible; no presentarla como existente hasta probarla en el dispositivo.
2. **Import/export incremental P2P firmado.** Mejoraría recuperación tras reinicio y atribución de origen, pero requiere decisión de contrato compartido entre móvil y servidor.
3. **Métricas de evaluación.** Solo publicar precisión/tiempo después de un protocolo, un dataset de evaluación y resultados reproducibles. Nunca inventar benchmarks.

## No hacer antes de la demo

- No agregar dependencias, CDN, Vercel ni proveedores cloud.
- No cambiar `core/contracts.ts` sin la decisión conjunta para móvil y servidor.
- No convertir la interfaz en una landing: el jurado necesita ver una herramienta operativa y evidencia verificable.
