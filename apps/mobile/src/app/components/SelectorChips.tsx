import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { color, espacio, radio, tap } from '../theme.ts';

/** Fila horizontal de chips seleccionables — un dedo, sin picker nativo
 *  (los pickers nativos de Android son lentos de tocar con guantes). */
export function SelectorChips<T extends string>({
  opciones, valor, onCambiar,
}: {
  opciones: readonly T[];
  valor: T | undefined;
  onCambiar: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.fila}>
      {opciones.map((op) => {
        const activo = op === valor;
        return (
          <Pressable
            key={op}
            onPress={() => onCambiar(op)}
            style={[estilos.chip, activo && estilos.chipActivo]}
            hitSlop={6}
          >
            <Text style={[estilos.texto, activo && estilos.textoActivo]} numberOfLines={1}>{op}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  fila: { flexGrow: 0 },
  // `minHeight` = objetivo táctil a escala de fuente 1.0; `paddingVertical`
  // deja crecer el chip con la fuente del sistema sin apretar el texto.
  chip: {
    minHeight: tap.normal, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: espacio.sm,
    borderRadius: radio.md, borderWidth: 1.5,
    borderColor: color.borde, backgroundColor: color.superficie, marginRight: 8,
  },
  chipActivo: { backgroundColor: color.primario, borderColor: color.primario },
  texto: { fontSize: 15, fontWeight: '600', color: color.texto },
  textoActivo: { color: color.primarioTexto },
});
