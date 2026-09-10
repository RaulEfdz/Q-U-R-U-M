import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { obtener } from './src/qvac/pool';

/**
 * "Hola mundo" — Fase 3 de ORQUESTACION.md: cargar el portero real en el
 * teléfono y obtener un booleano. Si esto falla, PARAR y avisar — no seguir
 * depurando a ciegas (orden de construcción del doc maestro Anexo D).
 */
export default function App() {
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando');
  const [detalle, setDetalle] = useState('');

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const modelId = await obtener('portero');
        if (!cancelado) { setEstado('ok'); setDetalle(modelId); }
      } catch (e) {
        if (!cancelado) { setEstado('error'); setDetalle(e instanceof Error ? e.message : String(e)); }
      }
    })();
    return () => { cancelado = true; };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>QUÓRUM — hola mundo</Text>
      <Text>Portero (Qwen3.5 0.8B multimodal): {estado}</Text>
      {detalle ? <Text style={styles.detalle}>{detalle}</Text> : null}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  titulo: { fontWeight: 'bold', marginBottom: 12 },
  detalle: { marginTop: 8, fontSize: 12, color: '#555', textAlign: 'center' },
});
