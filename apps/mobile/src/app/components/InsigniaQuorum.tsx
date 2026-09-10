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
const INFO: Record<EstadoCampo, { glifo: string; color: string }> = {
  'Quórum': { glifo: '●', color: color.quorum },
  'Reportado': { glifo: '◐', color: color.reportado },
  'Estimado': { glifo: '○', color: color.estimado },
  'Sin datos': { glifo: '·', color: color.sinDatos },
  'Sin quórum': { glifo: '▲', color: color.sinQuorum },
};

export function colorEstado(estado: EstadoCampo): string {
  return INFO[estado].color;
}

export function glifoEstado(estado: EstadoCampo): string {
  return INFO[estado].glifo;
}

export function InsigniaQuorum({ estado }: { estado: EstadoCampo }) {
  const info = INFO[estado];
  return (
    <View style={[estilos.chip, { borderColor: info.color }]}>
      <Text style={[estilos.glifo, { color: info.color }]}>{info.glifo}</Text>
      <Text style={[estilos.texto, { color: info.color }]}>{estado}</Text>
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
