import { StyleSheet, Text, View } from 'react-native';
import { color, espacio, tipografia } from '../theme.ts';

/**
 * Barra de marca, fija arriba de las dos pantallas.
 *
 * El glifo `●` no es decoración: es el mismo que marca `Quórum` en el eje 2
 * (`InsigniaQuorum`, §II.20 del doc maestro). La marca de la app y el estado
 * al que aspira el dato son la misma cosa, y no hay archivo de logo en
 * `assets/` fuera del icono de launcher — un glifo del propio sistema visual
 * dice más que un logotipo inventado acá.
 *
 * `paddingTop` lo inyecta `App.tsx` con el inset real del dispositivo: la
 * app corre edge-to-edge (obligatorio desde Android 15), así que sin ese
 * inset la hora y la batería del sistema se dibujan encima del título.
 */
export function BarraSuperior({ paddingTop }: { paddingTop: number }) {
  return (
    <View style={[estilos.barra, { paddingTop: paddingTop + espacio.sm }]}>
      <View style={estilos.marca}>
        <Text style={estilos.glifo}>●</Text>
        <Text style={estilos.nombre}>QUÓRUM</Text>
      </View>
      <Text style={estilos.tesis}>La verdad tiene quórum.</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  barra: {
    backgroundColor: color.superficie,
    borderBottomWidth: 1, borderBottomColor: color.borde,
    paddingHorizontal: espacio.lg, paddingBottom: espacio.sm,
  },
  marca: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm },
  glifo: { fontSize: 15, color: color.quorum },
  nombre: { ...tipografia.subtitulo, letterSpacing: 1.5, color: color.texto },
  tesis: { ...tipografia.pequeno, color: color.textoTenue, marginTop: 2 },
});
