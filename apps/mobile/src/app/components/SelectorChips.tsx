import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { color, elevacion, espacio, radio, tap, tipografia } from '../theme.ts';

/** Fila horizontal de chips seleccionables — un dedo, sin picker nativo
 *  (los pickers nativos de Android son lentos de tocar con guantes).
 *
 *  Para TalkBack: la fila es un `radiogroup` (una sola opción activa) y cada
 *  chip un `radio` con estado `checked` — sin eso el lector no puede decir
 *  cuál está elegido, porque la única diferencia visible es el color. */
export function SelectorChips<T extends string>({
  opciones, valor, onCambiar, etiquetaGrupo,
}: {
  opciones: readonly T[];
  valor: T | undefined;
  onCambiar: (v: T) => void;
  /** Qué elige este grupo — lo anuncia TalkBack ("Modalidad", "Marca"…). */
  etiquetaGrupo?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={estilos.fila}
      accessibilityRole="radiogroup"
      {...(etiquetaGrupo ? { accessibilityLabel: etiquetaGrupo } : {})}
    >
      {opciones.map((op) => {
        const activo = op === valor;
        return (
          <Pressable
            key={op}
            onPress={() => onCambiar(op)}
            style={[estilos.chip, activo && estilos.chipActivo]}
            hitSlop={6}
            accessibilityRole="radio"
            accessibilityState={{ checked: activo }}
            accessibilityLabel={op}
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
  // Contorno por defecto, relleno SOLO el elegido: con todos los chips
  // rellenos la fila lee como cuatro botones compitiendo, y cuál está activo
  // deja de ser lo primero que se ve. El peso visual marca la respuesta.
  //
  // `minHeight` = objetivo táctil a escala de fuente 1.0; `paddingVertical`
  // deja crecer el chip con la fuente del sistema sin apretar el texto.
  chip: {
    minHeight: tap.normal, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 15, paddingVertical: espacio.sm,
    borderRadius: radio.lg, borderWidth: 1.5,
    borderColor: color.borde, backgroundColor: color.superficie, marginRight: espacio.sm,
    ...elevacion.sutil,
  },
  chipActivo: {
    backgroundColor: color.primario, borderColor: color.primario,
    ...elevacion.primaria, shadowRadius: 12, elevation: 4,
  },
  // Tamaño de `cuerpo` (no de etiqueta): es un control que se toca con
  // guantes, tiene que leerse tan bien como el texto principal.
  texto: { ...tipografia.cuerpo, fontSize: 15, fontWeight: '600', color: color.textoTenue },
  textoActivo: { color: color.primarioTexto },
});
