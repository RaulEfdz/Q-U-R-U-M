import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import CapturarScreen from './src/app/CapturarScreen.tsx';
import Cliente360Screen from './src/app/Cliente360Screen.tsx';
import { BarraSuperior } from './src/app/components/BarraSuperior.tsx';
import { precargarModelos } from './src/qvac/pool.ts';
import { color, espacio, tap, tipografia } from './src/app/theme.ts';

type Pestana = 'capturar' | 'clientes';

/**
 * Fase 10 del orden de construcción (mobile CLAUDE.md): UI Capturar +
 * Cliente 360. Reemplaza el "hola mundo" de Fase 3 (portero cargando en
 * el teléfono) — esa verificación ya quedó cerrada.
 *
 * Navegación a mano, sin `react-navigation`: son dos pantallas y agregar
 * la librería significa dependencias nativas nuevas, y con ellas
 * `expo prebuild --clean` obligatorio y el riesgo de tocar el linkeo de
 * `react-native-bare-kit@0.14.5`, que está pineado por un crash conocido
 * (mobile CLAUDE.md §Trampas). No vale el costo para dos pestañas.
 *
 * Las dos pantallas quedan MONTADAS y se alternan con `display`: si se
 * desmontara Capturar al cambiar de pestaña, un borrador a medio confirmar
 * se perdería sin haberse persistido — justo lo que el proyecto promete que
 * no pasa. Cliente 360 relee el store vía `recargarToken`.
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
 * Los insets se aplican a mano en la barra superior y en la de pestañas, en
 * vez de envolver todo en un `SafeAreaView`: así el fondo de las barras
 * llega hasta el borde de la pantalla y solo el CONTENIDO se corre. Con
 * `SafeAreaView` quedaba una franja del color del fondo detrás de la barra
 * de estado, separada visualmente de la barra de marca.
 */
function Marco() {
  const insets = useSafeAreaInsets();
  const [pestana, setPestana] = useState<Pestana>('capturar');
  const [recargarToken, setRecargarToken] = useState(0);

  function ir(destino: Pestana) {
    if (destino === pestana) return;
    if (destino === 'clientes') setRecargarToken((n) => n + 1);
    setPestana(destino);
  }

  // El botón/gesto Atrás del sistema en la pestaña Clientes vuelve a
  // Capturar en vez de cerrar la app. En Capturar lo maneja `CapturarScreen`
  // (sus sub-pantallas) y, más adentro, `ConfirmacionBorrador`; cuando esos
  // dejan pasar el evento, Atrás cierra la app como corresponde. Los tres
  // handlers componen porque `BackHandler` los evalúa en orden LIFO.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pestana === 'clientes') {
        setPestana('capturar');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [pestana]);

  return (
    <View style={estilos.contenedor}>
      <BarraSuperior paddingTop={insets.top} />

      <View style={estilos.cuerpo}>
        <View style={[estilos.pantalla, pestana !== 'capturar' && estilos.oculta]}>
          <CapturarScreen />
        </View>
        <View style={[estilos.pantalla, pestana !== 'clientes' && estilos.oculta]}>
          <Cliente360Screen recargarToken={recargarToken} />
        </View>
      </View>

      {/* El inset de abajo es la barra de gestos: sin él las pestañas quedan
          pegadas a ella y se tocan sin querer al navegar. */}
      <View style={[estilos.barra, { paddingBottom: insets.bottom + espacio.xs }]}>
        <Pestania etiqueta="Capturar" glifo="✎" activa={pestana === 'capturar'} onPress={() => ir('capturar')} />
        <Pestania etiqueta="Clientes" glifo="◍" activa={pestana === 'clientes'} onPress={() => ir('clientes')} />
      </View>
    </View>
  );
}

function Pestania({
  etiqueta, glifo, activa, onPress,
}: {
  etiqueta: string; glifo: string; activa: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      style={[estilos.pestana, activa && estilos.pestanaActiva]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: activa }}
    >
      <Text style={[estilos.glifoPestana, activa && estilos.textoPestanaActiva]}>{glifo}</Text>
      <Text
        style={[estilos.textoPestana, activa && estilos.textoPestanaActiva]}
        numberOfLines={1}
      >
        {etiqueta}
      </Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: color.fondo },
  cuerpo: { flex: 1 },
  // Las dos pantallas ocupan el mismo espacio; solo una se muestra.
  pantalla: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  oculta: { display: 'none' },
  barra: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: color.borde,
    backgroundColor: color.superficie,
  },
  // `minHeight` = objetivo táctil a escala de fuente 1.0; con la fuente del
  // sistema grande la barra crece (el contenido, `flex: 1`, cede) en vez de
  // recortar el glifo o la etiqueta.
  pestana: {
    flex: 1, minHeight: tap.normal, alignItems: 'center', justifyContent: 'center',
    paddingVertical: espacio.sm, gap: 2, borderTopWidth: 3, borderTopColor: 'transparent',
  },
  pestanaActiva: { borderTopColor: color.primario },
  glifoPestana: { fontSize: 18, color: color.textoTenue },
  textoPestana: { ...tipografia.etiqueta, color: color.textoTenue },
  textoPestanaActiva: { color: color.primario },
});
