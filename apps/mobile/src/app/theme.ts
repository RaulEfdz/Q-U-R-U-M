/**
 * Tokens visuales de QUÓRUM mobile. App de CAMPO: se usa parado, con una
 * mano, con poca luz o sol directo, a veces con guantes. Por eso:
 *   - objetivos táctiles grandes (`tap` = 52, `tapGrande` = 64)
 *   - contraste real (nunca gris claro sobre blanco — ver `texto.tenue`,
 *     que es lo bastante oscuro para leerse al sol)
 *   - el color NUNCA es el único portador de significado: cada estado de
 *     confianza lleva glifo + etiqueta además del color (ver `componentes/`)
 *
 * Paleta de quórum tomada literal de docs/QUORUM_documento_unico.md §II.20
 * (`--quorum`, `--reportado`, etc.) — es una decisión ya tomada del
 * proyecto, no un gusto de esta pantalla.
 */
export const color = {
  fondo: '#f7f6f3',
  superficie: '#ffffff',
  superficieHundida: '#eeece7',
  borde: '#d8d5cd',
  texto: '#1c1b18',
  textoTenue: '#55524a', // suficientemente oscuro para sol directo — nunca #999+
  textoInvertido: '#ffffff',

  primario: '#1a4d8f',
  primarioTexto: '#ffffff',

  // Eje 2 — Quórum (por campo). Literal de §II.20.
  quorum: '#1a7f5a',
  reportado: '#b8860b',
  estimado: '#6b6b63',
  sinDatos: '#8f8c82',
  sinQuorum: '#b0413e',

  /*
   * ★ Tintas de la MISMA rampa, para cuando el estado se pinta como TEXTO.
   *
   * Los valores de §II.20 están elegidos como color de identidad (glifo,
   * borde, franja) y varios no llegan a 4.5:1 como texto. Medido sobre
   * `superficieHundida` (#eeece7), el peor fondo donde aparecen:
   * `reportado` da 2.76 y `sinDatos` 2.85 — bien por debajo del mínimo — y
   * `quorum` queda en 4.21. Y esta app se usa A SOL DIRECTO, que es donde
   * el contraste real importa más, no menos. `reportado` es además el
   * estado más frecuente en datos reales (un solo testigo), así que la
   * etiqueta más repetida de la interfaz era la menos legible.
   *
   * No se cambia la rampa: se deriva. Mismo hue y mismo croma en OKLCH,
   * bajando solo la luminosidad hasta pasar AA. Ratios sobre #eeece7:
   *   quorumTinta 4.58 · reportadoTinta 4.59 · sinDatosTinta 4.58
   * `estimado` y `sinQuorum` ya pasaban y quedan igual, sin token propio.
   */
  quorumTinta: '#0f7954',
  reportadoTinta: '#916000',
  sinDatosTinta: '#6d6a61',
  sinQuorumFondo: '#fbeceb',
  denegado: '#7d1f1c',

  // Eje 1 — Naturaleza del testimonio (por observación). No la define el
  // doc maestro; paleta propia, deliberadamente distinta de la del quórum
  // para que un usuario nunca confunda "quién lo vio" con "cuánto se
  // corroboró" — son dos preguntas distintas.
  directo: '#1a4d8f',
  referido: '#6b4fa0',
  // 4.01:1 sobre `superficieHundida` con el ocre original (#a3651b): mismo
  // criterio que las tintas de arriba, oscurecido a 4.57:1.
  estimadoNaturaleza: '#995c0c',
  desconocido: '#6b6b63',

  exito: '#1a7f5a',
  peligro: '#b0413e',
  peligroFondo: '#fbeceb',
  advertenciaFondo: '#fdf3e0',
} as const;

export const espacio = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radio = { sm: 6, md: 10, lg: 14 } as const;

export const tipografia = {
  titulo: { fontSize: 22, fontWeight: '700' as const },
  subtitulo: { fontSize: 17, fontWeight: '600' as const },
  cuerpo: { fontSize: 16, fontWeight: '400' as const },
  etiqueta: { fontSize: 13, fontWeight: '600' as const },
  pequeno: { fontSize: 12, fontWeight: '400' as const },
};

/** Altura mínima de objetivo táctil. 52 para controles normales, 64 para
 *  la acción primaria de la pantalla (la que se toca parado, con guantes). */
export const tap = { normal: 52, grande: 64 };
