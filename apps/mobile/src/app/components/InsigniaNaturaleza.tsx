import { StyleSheet, Text, View } from 'react-native';
import type { Naturaleza } from '../../core/contracts.ts';
import { color } from '../theme.ts';

/**
 * Eje 1 (naturaleza del testimonio). Siempre glifo + etiqueta, nunca solo
 * color — mismo criterio que §II.20 del doc maestro para el eje de quórum.
 */
const INFO: Record<Naturaleza, { glifo: string; color: string; etiqueta: string }> = {
  Directo: { glifo: '●', color: color.directo, etiqueta: 'Directo — lo viste vos' },
  Referido: { glifo: '◐', color: color.referido, etiqueta: 'Referido — te lo contaron' },
  Estimado: { glifo: '○', color: color.estimadoNaturaleza, etiqueta: 'Estimado — a ojo' },
  Desconocido: { glifo: '?', color: color.desconocido, etiqueta: 'Desconocido' },
};

export function InsigniaNaturaleza({ naturaleza }: { naturaleza: Naturaleza }) {
  const info = INFO[naturaleza];
  return (
    <View style={[estilos.chip, { borderColor: info.color }]}>
      <Text style={[estilos.glifo, { color: info.color }]}>{info.glifo}</Text>
      <Text style={[estilos.texto, { color: info.color }]}>{naturaleza}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    borderWidth: 1.5, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, gap: 5,
  },
  glifo: { fontSize: 13, fontWeight: '700' },
  texto: { fontSize: 13, fontWeight: '700' },
});
