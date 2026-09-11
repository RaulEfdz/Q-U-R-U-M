import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Naturaleza } from '../../core/contracts.ts';
import { color, radio, tipografia } from '../theme.ts';

/**
 * Eje 1 (naturaleza del testimonio). Siempre glifo + etiqueta, nunca solo
 * color — mismo criterio que §II.20 del doc maestro para el eje de quórum.
 *
 * `fondo` es la MISMA tinta a baja opacidad: la insignia pasó de contorno a
 * pastilla rellena porque en la tarjeta de lote convive con chips que sí
 * son contornos accionables, y un contorno más se leía como un control
 * tocable que no lo es.
 */
const INFO: Record<Naturaleza, { glifo: string; color: string; fondo: string; etiqueta: string }> = {
  Directo: { glifo: '●', color: color.directo, fondo: color.primarioTinte, etiqueta: 'Directo — lo viste vos' },
  Referido: { glifo: '◐', color: color.referido, fondo: 'rgba(107,79,160,0.10)', etiqueta: 'Referido — te lo contaron' },
  Estimado: { glifo: '○', color: color.estimadoNaturaleza, fondo: 'rgba(153,92,12,0.10)', etiqueta: 'Estimado — a ojo' },
  Desconocido: { glifo: '?', color: color.desconocido, fondo: 'rgba(107,107,99,0.12)', etiqueta: 'Desconocido' },
};

export const InsigniaNaturaleza = memo(function InsigniaNaturaleza({ naturaleza }: { naturaleza: Naturaleza }) {
  const info = INFO[naturaleza];
  // Un solo nodo para TalkBack, con nombre hablado limpio — si no, lee el
  // glifo suelto antes de la etiqueta.
  return (
    <View
      style={[estilos.chip, { backgroundColor: info.fondo }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Naturaleza del testimonio: ${naturaleza}`}
    >
      <Text style={[estilos.glifo, { color: info.color }]} importantForAccessibility="no">{info.glifo}</Text>
      <Text style={[estilos.texto, { color: info.color }]} importantForAccessibility="no">{naturaleza}</Text>
    </View>
  );
});

// Misma forma que la insignia de quórum del server (par visual: distinto
// eje, mismo chip). Esa vive del lado server (`apps/server/ui`); acá ya no
// hay pantalla que reconcilie, solo captura.
const estilos = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    borderRadius: radio.pastilla,
    paddingVertical: 7, paddingLeft: 10, paddingRight: 12, gap: 6,
  },
  glifo: { fontSize: 11, fontWeight: '700' },
  texto: { ...tipografia.pequeno, fontWeight: '700' },
});
