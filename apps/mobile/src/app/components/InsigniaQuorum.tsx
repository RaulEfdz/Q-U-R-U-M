import { StyleSheet, Text, View } from 'react-native';
import type { EstadoCampo } from '../../core/contracts.ts';
import { color } from '../theme.ts';

/**
 * Eje 2 (quórum, por campo de la proyección). Glifos y colores literales de
 * §II.20 del doc maestro — el color NUNCA es el único portador de
 * significado: cada estado lleva glifo + etiqueta, por accesibilidad y para
 * que sobreviva la compresión del video.
 *
 * Deliberadamente distinta de `InsigniaNaturaleza` (eje 1): un usuario nunca
 * debe confundir "quién lo vio" con "cuánto se corroboró".
 */
/*
 * `color` es la IDENTIDAD del estado (glifo y borde) y `tinta` la que se usa
 * para TEXTO. Varios valores de §II.20 no llegan a 4.5:1 como texto sobre
 * los fondos de esta app, y se usa a sol directo — ver la nota de las tintas
 * en `theme.ts`. Donde el original ya pasaba, ambos son el mismo valor.
 */
const INFO: Record<EstadoCampo, { glifo: string; color: string; tinta: string }> = {
  'Quórum': { glifo: '●', color: color.quorum, tinta: color.quorumTinta },
  'Reportado': { glifo: '◐', color: color.reportado, tinta: color.reportadoTinta },
  'Estimado': { glifo: '○', color: color.estimado, tinta: color.estimado },
  'Sin datos': { glifo: '·', color: color.sinDatos, tinta: color.sinDatosTinta },
  'Sin quórum': { glifo: '▲', color: color.sinQuorum, tinta: color.sinQuorum },
};

export function colorEstado(estado: EstadoCampo): string {
  return INFO[estado].color;
}

/** Para pintar el ESTADO como texto. Ver la nota de `INFO`. */
export function tintaEstado(estado: EstadoCampo): string {
  return INFO[estado].tinta;
}

export function glifoEstado(estado: EstadoCampo): string {
  return INFO[estado].glifo;
}

export function InsigniaQuorum({ estado }: { estado: EstadoCampo }) {
  const info = INFO[estado];
  // Un solo nodo para TalkBack, con nombre hablado limpio — si no, lee el
  // glifo como ruido ("círculo negro, Quórum").
  return (
    <View
      style={[estilos.chip, { borderColor: info.color }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Estado de quórum: ${estado}`}
    >
      <Text style={[estilos.glifo, { color: info.color }]} importantForAccessibility="no">{info.glifo}</Text>
      <Text style={[estilos.texto, { color: info.tinta }]} importantForAccessibility="no">{estado}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    borderWidth: 1.5, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9, gap: 5,
  },
  glifo: { fontSize: 13, fontWeight: '700' },
  texto: { fontSize: 13, fontWeight: '700' },
});
