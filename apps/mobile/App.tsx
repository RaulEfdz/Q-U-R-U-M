import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import CapturarScreen from './src/app/CapturarScreen.tsx';
import { BarraSuperior } from './src/app/components/BarraSuperior.tsx';
import { precargarModelos } from './src/qvac/pool.ts';
import { color } from './src/app/theme.ts';

/**
 * Fase 10 del orden de construcción (mobile CLAUDE.md): UI Capturar.
 * Reemplaza el "hola mundo" de Fase 3 (portero cargando en el teléfono) —
 * esa verificación ya quedó cerrada.
 *
 * La pestaña Cliente 360 que vivía acá se sacó de la app: la reconciliación
 * se visualiza del lado del server (misma `trust/reconcile.ts`, ahí ya hay
 * UI para eso), no duplicada en el teléfono. El celular es puro dictado en
 * campo; una sola pantalla, sin barra de pestañas.
 */
export default function App() {
  // Precarga portero + extractor apenas abre la app, en segundo plano, para
  // que la primera nota no espere los ~25 s de carga. Fire-and-forget: si
  // falla, `obtener()` reintenta cuando el pipeline lo pide. Ver
  // `qvac/pool.ts` → `precargarModelos`.
  useEffect(() => {
    void precargarModelos();
  }, []);

  return (
    <SafeAreaProvider>
      <Marco />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

/**
 * `useSafeAreaInsets` solo funciona dentro de `SafeAreaProvider`, de ahí el
 * componente aparte.
 *
 * Los insets se aplican a mano en la barra superior, en vez de envolver todo
 * en un `SafeAreaView`: así el fondo de la barra llega hasta el borde de la
 * pantalla y solo el CONTENIDO se corre. Con `SafeAreaView` quedaba una
 * franja del color del fondo detrás de la barra de estado, separada
 * visualmente de la barra de marca.
 */
function Marco() {
  const insets = useSafeAreaInsets();

  return (
    <View style={estilos.contenedor}>
      <BarraSuperior paddingTop={insets.top} />
      <View style={estilos.cuerpo}>
        <CapturarScreen />
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: color.fondo },
  cuerpo: { flex: 1 },
});
