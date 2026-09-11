import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, espacio } from '../theme.ts';
import { Icono } from './Icono.tsx';
import { PanelSync, PastillaSync, useEstadoSync } from './EstadoSync.tsx';
// Metro soporta `import` de JSON nativo — se evita agregar `expo-constants`
// como dependencia nueva solo para leer un string que ya vive acá.
import pkg from '../../../package.json';

/**
 * Cabecera única de la app: marca, tesis y estado de sincronización en una
 * sola fila, fija arriba de todas las pantallas.
 *
 * El estado de sync vivía como una tarjeta dentro del scroll de Capturar:
 * ocupaba el ancho entero, competía con "¿Qué viste?" por la primera
 * mirada y desaparecía al bajar. Es contexto permanente, no un paso de la
 * tarea — su lugar es la cabecera, reducido a una pastilla que se despliega
 * al tocarla cuando hace falta el detalle o las acciones.
 *
 * `paddingTop` lo inyecta `App.tsx` con el inset real del dispositivo: la
 * app corre edge-to-edge (obligatorio desde Android 15), así que sin ese
 * inset la hora y la batería del sistema se dibujan encima del título.
 */
export function BarraSuperior({ paddingTop }: { paddingTop: number }) {
  const vista = useEstadoSync();
  const [abierto, setAbierto] = useState(false);

  return (
    <View style={[estilos.barra, { paddingTop: paddingTop + espacio.sm }]}>
      <View style={estilos.fila}>
        <View style={estilos.insignia}>
          <Icono nombre="marca" tamano={18} color={color.primarioTexto} />
        </View>
        <View style={estilos.textos}>
          <View style={estilos.filaNombre}>
            <Text style={estilos.nombre}>QUÓRUM</Text>
            {/* Visible para el jurado: qué build es este APK exacto, sin tener
                que preguntar. Mismo dato que `package.json`, nunca hardcodeado
                aparte — se lee de ahí para no quedar desactualizado. */}
            <Text style={estilos.version}>v{pkg.version}</Text>
          </View>
          <Text style={estilos.tesis} numberOfLines={1}>La verdad tiene quórum</Text>
        </View>
        <PastillaSync vista={vista} abierto={abierto} onAlternar={() => setAbierto((a) => !a)} />
      </View>
      {abierto ? <PanelSync vista={vista} /> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  barra: {
    backgroundColor: color.superficie,
    borderBottomWidth: 1, borderBottomColor: color.bordeSutil,
    paddingHorizontal: espacio.lg, paddingBottom: espacio.md,
  },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  insignia: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: color.primario,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: color.primario, shadowOpacity: 0.45, shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 }, elevation: 4,
  },
  textos: { flex: 1, minWidth: 0, gap: 1 },
  filaNombre: { flexDirection: 'row', alignItems: 'baseline', gap: espacio.sm },
  nombre: { fontSize: 16, fontWeight: '700', letterSpacing: 1.7, color: color.texto },
  version: { fontSize: 11, color: color.textoTenue },
  tesis: { fontSize: 11, color: color.textoTenue },
});
