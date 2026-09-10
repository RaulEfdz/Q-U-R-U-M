import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Naturaleza } from '../../core/contracts.ts';
import { color, tipografia } from '../theme.ts';

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

export const InsigniaNaturaleza = memo(function InsigniaNaturaleza({ naturaleza }: { naturaleza: Naturaleza }) {
  const info = INFO[naturaleza];
  // Un solo nodo para TalkBack, con nombre hablado limpio — si no, lee el
  // glifo suelto antes de la etiqueta.
  return (
    <View
      style={[estilos.chip, { borderColor: info.color }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Naturaleza del testimonio: ${naturaleza}`}
    >
      <Text style={[estilos.glifo, { color: info.color }]} importantForAccessibility="no">{info.glifo}</Text>
      <Text style={[estilos.texto, { color: info.color }]} importantForAccessibility="no">{naturaleza}</Text>
    </View>
  );
});

const estilos = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    borderWidth: 1.5, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, gap: 5,
  },
  glifo: { fontSize: 13, fontWeight: '700' },
  texto: { ...tipografia.etiqueta, fontWeight: '700' },
});
