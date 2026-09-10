# Auditoría de UI — QUÓRUM Desktop

Fecha: 2026-09-10  
Superficie: `apps/server/ui/`  
Modo: Operate / escritorio local  

## Alcance

Se revisaron el shell HTML, navegación, captura, confirmación de borrador, Cliente 360, Panorama, Auditoría, estados vacíos/errores, responsive CSS y el detector mecánico de Impeccable.

La instalación actual no expone el comando `impeccable audit`; solo expone `detect`. Por eso este documento combina el resultado real de `detect` con una revisión manual siguiendo la matriz de auditoría técnica del skill. El detector sí fue ejecutado sobre `apps/server/ui/index.html`, `style.css` y `app.js`.

## Health score

| Dimensión | Score | Hallazgo principal |
|---|---:|---|
| Accesibilidad | 3/4 | Buena base ARIA/foco; faltan pruebas automatizadas de contraste y una revisión de headings dinámicos. |
| Performance | 4/4 | Vanilla ES modules, sin dependencias visuales, sin imágenes ni loops de layout observados. |
| Responsive | 3/4 | Shell responsive y tablas con overflow; conviene probar zoom 200% y teclado en navegación horizontal. |
| Theming | 3/4 | Tokens sólidos, pero la hoja conserva una base histórica y un bloque de overrides al final. |
| Integridad | 4/4 | Sistema específico de QUÓRUM, SVG propio, semántica de estados y detector sin findings finales relevantes. |
| **Total** | **17/20** | **Good — address weak dimensions before release.** |

## Verdict de integridad

**Pasa.** La implementación expresa un sistema propio: sidebar contextual, glifo `●`, rampa de quórum, frescura separada, estados de conflicto explícitos y SVG inline. No es una plantilla intercambiable con un CRM genérico. El detector inicialmente marcó contraste, texto pequeño y sombras cromáticas en el nuevo shell; se corrigieron y el segundo scan quedó reducido a hallazgos heredados/heurísticos: un `11px` residual en la base y sombras interpretadas de forma conservadora.

## Hallazgos prioritarios

### [P1] Verificar contraste real de todos los estados

- **Ubicación:** `style.css`, tokens de trust ramp y `.badge`.
- **Categoría:** Accesibilidad / Theming.
- **Impacto:** reportado, estimado y sin datos son estados frecuentes; un proyector o una pantalla lavada puede reducir legibilidad.
- **Estándar:** WCAG 1.4.3 AA, mínimo 4.5:1 para texto normal.
- **Recomendación:** capturar la UI con datos reales y validar cada combinación texto/fondo, incluyendo tabla, footer y error de política.
- **Comando sugerido:** `$impeccable audit` cuando la instalación lo soporte; luego `$impeccable polish`.

### [P1] Probar zoom 200% y reflow de tablas

- **Ubicación:** `.confianza`, `.resultados`, `.auditoria-tabla`, breakpoint de `720px`.
- **Categoría:** Responsive / Accesibilidad.
- **Impacto:** el uso analítico puede requerir zoom del navegador; el overflow intencional no debe cortar la lectura ni esconder el identificador del campo.
- **Estándar:** WCAG 1.4.4 Resize Text y 1.4.10 Reflow.
- **Recomendación:** ejecutar una pasada con 200% y 400% de zoom; asegurar que la tabla anuncie su relación de columnas y que el scroll sea evidente.
- **Comando sugerido:** `$impeccable adapt`.

### [P2] Consolidar tokens históricos y overrides

- **Ubicación:** `style.css`, `:root` inicial y `:root` del workspace shell al final.
- **Categoría:** Theming / Integridad.
- **Impacto:** el sistema funciona, pero hay dos fuentes declarativas para fondo, espacios y tipografía; futuras pantallas pueden tomar el valor equivocado.
- **Recomendación:** migrar el bloque final a la raíz principal en una refactorización aislada y eliminar duplicados, manteniendo comentarios de producto.
- **Comando sugerido:** `$impeccable extract` seguido de `$impeccable polish`.

### [P2] Añadir prueba de regresión visual con datos del seed

- **Ubicación:** `apps/server/data/seed.json` + cuatro pantallas.
- **Categoría:** Performance / Integridad.
- **Impacto:** la UI depende de estados de datos, especialmente conflicto y quórum; un cambio de CSS puede romperlos sin que typecheck lo detecte.
- **Recomendación:** guardar una captura por pantalla en viewport desktop y una captura móvil, con los cuatro estados de confianza representados.
- **Comando sugerido:** `$impeccable polish`.

### [P3] Reemplazar metadata menor a 12px

- **Ubicación:** `.sidebar .tesis`, `.sidebar-bottom`, `.marcador` y `.conexion`.
- **Categoría:** Accesibilidad.
- **Impacto:** microcopy de conexión y contexto puede perderse en pantallas de alta densidad.
- **Recomendación:** conservar mínimo 12px para información operativa; usar peso y color para jerarquía.
- **Comando sugerido:** `$impeccable typeset`.

## Lo que está funcionando

- La navegación usa botones reales, `aria-current` y movimiento de foco al cambiar de pantalla.
- La captura separa interpretación, confirmación y guardado; no persiste sin confirmación humana.
- La UI no depende de Web Speech, CDNs, fuentes externas ni librerías de iconos.
- El conflicto tiene tratamiento semántico y copia de producto: no se promedia ni se elige.
- La conexión y el procesamiento local están declarados, no disfrazados como éxito.
- Los datos numéricos usan cifras tabulares y las tablas conservan la frase de confianza.

## Orden recomendado

1. Validar contraste y zoom con render real.
2. Consolidar tokens para que `DESIGN.md` y CSS tengan una única autoridad.
3. Añadir regresión visual de las cuatro pantallas.
4. Diseñar la siguiente capa de creatividad: filtros guardados, timeline de evidencia y comparación de conflictos, sin ocultar estados.

Repetir la auditoría después de esos cambios.
