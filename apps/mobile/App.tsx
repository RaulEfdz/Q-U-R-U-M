import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import CapturarScreen from './src/app/CapturarScreen.tsx';
import { color } from './src/app/theme.ts';

/**
 * Fase 10 del orden de construcción (mobile CLAUDE.md): UI Capturar +
 * Cliente 360. Reemplaza el "hola mundo" de Fase 3 (portero cargando en
 * el teléfono) — esa verificación ya quedó cerrada.
 */
export default function App() {
  return (
    <SafeAreaView style={estilos.contenedor}>
      <CapturarScreen />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: color.fondo },
});
