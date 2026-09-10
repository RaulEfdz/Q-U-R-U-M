# Dirección creativa de UI — QUÓRUM

## Idea rectora

**La sala de evidencias:** una interfaz que se siente como un espacio donde cada dato está etiquetado, fechado y atribuido. La creatividad no agrega ruido; agrega mejores formas de leer procedencia, frescura y contradicción.

La imagen de referencia se usa para clima y lenguaje de producto: sidebar, superficies claras, azul de acción, módulos compactos y tablas con mucha información. No se copia su contenido ni se adoptan sus claims.

## Elementos creativos aprobados

### 1. Evidence rail

En Cliente 360, cada grupo puede mostrar una línea vertical fina de procedencia con hitos de observadores. No reemplaza la tabla ni el badge; sirve para responder “¿quién lo dijo y cuándo?” de un vistazo.

Regla: la línea usa neutros. El color de confianza aparece solo en el estado del campo.

### 2. Conflict comparison

Para `Sin quórum`, una comparación paralela de versiones puede aparecer encima de la tabla en pantallas anchas: valor A, valor B, observadores y antigüedad. En mobile se apila. No hay selector de “ganador”.

### 3. Freshness ribbon

Un indicador compacto de frescura puede acompañar al nombre del cliente: `◷ visitado hace 12 días`. Debe seguir siendo neutral y no confundirse con `Reportado`.

### 4. Saved views

Panorama puede incorporar vistas guardadas como acciones locales: “Solo sin quórum”, “Equipos viejos”, “Revisión de hoy”. Las vistas son filtros deterministas, nunca búsquedas vagas que parezcan inferencia.

### 5. Audit pulse

Auditoría puede mostrar un pulso textual de integridad: última verificación, cantidad de registros inspeccionados y resultado. Sin gráficos decorativos ni promesas de seguridad que no estén demostradas.

### 6. Capture confidence preview

Durante la confirmación, cada lote puede mostrar una mini lectura de evidencia: “3 campos respaldados por cita literal” y “1 campo pendiente”. Es una ayuda de revisión, no un score de precisión del modelo.

## Comportamiento de interacción

- Hover informa; no revela datos críticos que el teclado no pueda alcanzar.
- Focus es visible y consistente.
- Loading usa copy de progreso; no bloquea toda la aplicación si se puede seguir leyendo.
- Los mensajes de error incluyen causa y próximo paso.
- `prefers-reduced-motion` conserva el cambio de estado sin animación.

## Antipatterns prohibidos

- Dashboard de KPIs como primera pantalla si la tarea real es capturar evidencia.
- Gráficos que conviertan confianza en una puntuación única.
- Modal que oculte contradicciones.
- Gradientes, glassmorphism o sombras de glow como estilo.
- Iconos emoji o caracteres Unicode como sustituto del set SVG propio; la excepción son los cinco glifos semánticos de producto.
- Valores ilustrativos presentados como métricas reales.

## Secuencia ideal de pantalla

1. La persona entiende en qué workspace está.
2. Ve la acción principal o la pregunta pendiente.
3. Ejecuta la acción con una mano o teclado.
4. Revisa evidencia y procedencia.
5. Confirma, exporta o agenda una nueva visita.

Cada pantalla debe poder explicar su estado sin depender de color ni de memoria de otra pantalla.
