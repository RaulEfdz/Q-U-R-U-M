---
name: QUÓRUM
description: Base instalada con confianza medible por campo. La verdad tiene quórum.
colors:
  primary: "#2d64d8"
  primary-deep: "#2456bc"
  action-surface: "#edf3ff"
  neutral-bg: "#f6f8fc"
  neutral-surface: "#ffffff"
  neutral-sunken: "#f0f3f8"
  neutral-border: "#e1e6ef"
  neutral-border-strong: "#cbd3df"
  text: "#172033"
  text-muted: "#687386"
  quorum: "#1a7f5a"
  quorum-ink: "#0f7954"
  reported: "#b8860b"
  reported-ink: "#916000"
  estimated-ink: "#6b6b63"
  no-data-ink: "#6d6a61"
  no-quorum: "#b0413e"
  no-quorum-surface: "#fbeceb"
  denied: "#7d1f1c"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14.5px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12.5px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.06em"
rounded:
  sm: "7px"
  md: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "28px"
  xxl: "42px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
    height: "40px"
  nav-active:
    backgroundColor: "{colors.action-surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
  card:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "22px"
---

# Design System: QUÓRUM

## Overview

**Creative North Star: “La sala de evidencias”**

QUÓRUM es una herramienta de trabajo para transformar testimonios de campo en una base instalada confiable. Su interfaz toma la calma visual de una sala de evidencias: cada dato tiene procedencia, cada conflicto queda visible y ninguna superficie compite con la pregunta que la persona vino a resolver.

La referencia visual aprobada aporta el carácter de producto operativo: sidebar persistente, header contextual, superficies blancas, azul de acción, bordes suaves y densidad controlada. No se copia una pantalla ni se introducen datos ficticios. El color de confianza conserva su significado de producto y nunca se usa como decoración.

**Key Characteristics:**

- Claro, alto contraste y optimizado para proyector.
- Densidad alta con ritmo visible entre bloques.
- Azul para acciones; glifos y color reservado para confianza.
- Sin gradientes, sin recursos externos, sin iconografía de librería.
- El conflicto se muestra; no se promedia ni se oculta.

## Colors

La paleta tiene dos sistemas independientes: acción/navegación y confianza/evidencia. Mezclarlos destruye el significado de la interfaz.

### Primary

- **Azul de decisión** (`#2d64d8`): botones primarios, foco, navegación activa y elementos que permiten avanzar.
- **Azul profundo** (`#2456bc`): estado hover de acciones primarias.
- **Superficie de acción** (`#edf3ff`): fondo de navegación activa y selección.

### Neutral

- **Niebla de workspace** (`#f6f8fc`): fondo general.
- **Papel de evidencia** (`#ffffff`): cards, inputs, sidebar y header.
- **Hundida técnica** (`#f0f3f8`): agrupación secundaria, barras y filas sangradas.
- **Borde suave** (`#e1e6ef`): separación estructural.
- **Borde fuerte** (`#cbd3df`): inputs, tablas y controles.
- **Tinta principal** (`#172033`): texto de lectura.
- **Tinta secundaria** (`#687386`): metadata y explicaciones; nunca debe ser la única señal de estado.

### Trust ramp

- **Quórum** (`#1a7f5a` / tinta `#0f7954`): corroboración suficiente.
- **Reportado** (`#b8860b` / tinta `#916000`): una versión respaldada.
- **Estimado** (`#6b6b63`): dato débil o indirecto.
- **Sin datos** (`#6d6a61`): ausencia declarada.
- **Sin quórum** (`#b0413e`): versiones en conflicto.
- **Superficie de conflicto** (`#fbeceb`): únicamente para conflicto declarado.

### Named Rules

**The Two Axes Rule.** Confianza y frescura nunca comparten color. La frescura se expresa con `◷`, tinta neutra y subrayado punteado.

**The Meaningful Blue Rule.** El azul significa acción o navegación. Nunca se usa para afirmar que un dato es verdadero.

## Typography

**Display Font:** system sans (`ui-sans-serif`, `system-ui`, `Segoe UI` fallback).

**Body Font:** la misma familia sans del sistema.

**Label/Mono Font:** la familia mono del sistema (`ui-monospace`, Menlo, Consolas) solo para IDs, trazas y mediciones técnicas.

**Character:** sobria, legible y directa. La jerarquía sale del peso, tamaño y espacio; no de tipografías ornamentales.

### Hierarchy

- **Display** (700, `21px`, line-height `1.2`): marca QUÓRUM.
- **Headline** (700, `28px`, line-height `1.2`): nombres de clientes y títulos de pantalla.
- **Title** (700, `14.5px`, line-height `1.4`): encabezados de grupos y acciones.
- **Body** (400, `14.5px`, line-height `1.4`): lectura, formularios y tablas.
- **Label** (700, `12.5px`, uppercase solo cuando es metadata): etiquetas, estados y captions.

### Named Rules

**The Evidence Rule.** La cita literal de una observación siempre se lee como cita: tinta secundaria, superficie hundida y comillas; jamás como copy generado por la UI.

## Layout

El escritorio usa un shell de dos columnas: sidebar de `238px` y un frame flexible. El header del frame mide aproximadamente `72px` y siempre comunica contexto (`Workspace / Pantalla`). El contenido se limita a `1240px` y respira con padding de `34px 38px`.

La estructura prioriza una lectura de arriba abajo: acción primaria o pregunta al inicio, resultado inmediatamente después, evidencia y detalle más abajo. Las tablas mantienen columnas estables y admiten scroll horizontal en viewport angosto.

En menos de `800px`, el sidebar se convierte en una navegación horizontal, el header baja a `58px`, desaparece metadata no esencial y el contenido conserva padding lateral de `18px`. Los targets de controles principales no bajan de `40px` en escritorio; en Android se mantiene el contrato de `52px`/`64px` definido en PRODUCT.md.

## Elevation & Depth

QUÓRUM usa profundidad tonal antes que sombra. Las superficies blancas se separan con borde; la sombra solo aparece en cards de trabajo para sugerir una capa de revisión, nunca como glow de marca. No hay blur ni glassmorphism.

### Shadow Vocabulary

- **Work surface** (`0 4px 16px rgba(0, 0, 0, .045)`): cards principales y bloques de revisión.
- **Input focus** (`0 0 0 3px rgba(45, 100, 216, .12)`): foco visible de textarea; no es elevación.

### Named Rules

**The Flat-by-Default Rule.** Si un borde puede explicar la jerarquía, no se agrega sombra. Si aparece sombra, debe haber una razón estructural.

## Shapes

La geometría es contenida: `7px` para controles y `10px` para cards. Los pills (`999px`) quedan reservados a badges, estados y oportunidades; no se usan para convertir bloques completos en pastillas. Bordes de `1px` separan superficies y el conflicto puede usar borde completo + fondo tintado, nunca una franja decorativa lateral.

## Components

### Buttons

- **Shape:** radio `7px`, altura mínima `40px`.
- **Primary:** azul de decisión, texto blanco, peso 700, padding `8px 15px`.
- **Hover / Focus:** azul profundo en hover; anillo azul de `2px` en `:focus-visible`.
- **Secondary:** superficie blanca, borde fuerte, texto principal; hover sobre superficie hundida.
- **Destructive:** no se usa como color de acción por defecto; aparece solo cuando descartar o denegar necesita explicación.

### Navigation

- **Sidebar:** navegación persistente en desktop, horizontal desplazable en mobile.
- **Active:** fondo azul muy claro, texto azul y una marca vertical de `3px` en desktop.
- **Context:** el header refleja la pantalla actual y mantiene conexión/usuario al alcance.

### Badges & Trust States

- Siempre llevan glifo + etiqueta + color.
- `● ◐ ○ · ▲` son semántica de producto, no decoración.
- `◷` identifica frescura y nunca se confunde con confianza.

### Cards / Containers

- **Corner style:** `10px` para cards, `7px` para controles.
- **Card behavior:** una card agrupa una decisión o evidencia; no se anidan cards sin razón.
- **Conflict behavior:** el conflicto es visible dentro de la tabla, con todas las versiones y sus observadores.

### Tables

- Header en label uppercase, cuerpo con cifras tabulares y filas con separación fina.
- La frase mental es `campo → valor → estado → quién lo sostiene`.
- En mobile se conserva la tabla como superficie desplazable antes que comprimirla hasta volverla ilegible.

### Empty, Error & Loading

- Empty states explican qué falta y por qué es una respuesta válida.
- Errores dicen qué ocurrió, por qué importa y qué puede hacer la persona.
- Loading usa texto de progreso y una sola animación de producto: el ascenso a quórum, `600ms`, con alternativa bajo `prefers-reduced-motion`.

## Do's and Don'ts

### Do's

- Mostrar la procedencia antes de resumir.
- Mantener el texto útil incluso con color desactivado.
- Diseñar para la pantalla de proyector y para el operador que está de pie.
- Usar SVG propio y `currentColor` para iconos.
- Explicar la razón de cada estado en castellano rioplatense.

### Don'ts

- No inventar benchmarks, clientes, testimonios ni resultados.
- No usar verde para “guardado” si el verde ya significa quórum.
- No esconder discrepancias detrás de modales o tabs secundarias.
- No agregar fuentes, iconos, CDNs ni dependencias externas.
- No convertir una pantalla de operación en una landing de marketing.
