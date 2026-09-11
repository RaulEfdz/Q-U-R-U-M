import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  iniciarSyncMovil, refrescarEstadoSync, sincronizarAhora, suscribirSync, verificarConexion,
  type EstadoSyncGlobal,
} from '../../sync/controller.ts';
import { color, espacio, radio, tap, tipografia } from '../theme.ts';

const INICIAL: EstadoSyncGlobal = {
  transporte: 'desconectado', pendientes: 0, publicKey: null,
  ultimoSyncEn: null, error: null,
  verificando: false, ultimaVerificacionEn: null, latenciaMs: null,
};

export function EstadoSync() {
  const [sync, setSync] = useState(INICIAL);

  useEffect(() => {
    const cancelar = suscribirSync(setSync);
    void iniciarSyncMovil();
    const reloj = setInterval(() => { void refrescarEstadoSync(); }, 2_000);
    return () => { cancelar(); clearInterval(reloj); };
  }, []);

  const titulo = sync.transporte === 'conectado'
    ? 'Peer conectado'
    : sync.pendientes ? 'Guardado offline' : 'Buscando servidor';
  const detalle = sync.error
    ? `No se pudo sincronizar: ${sync.error}`
    : sync.transporte === 'conectado'
      ? `${sync.pendientes} pendiente${sync.pendientes === 1 ? '' : 's'} · el ACK retira cada observación de la cola.`
      : sync.pendientes
        ? `${sync.pendientes} observación${sync.pendientes === 1 ? '' : 'es'} espera conexión y ACK.`
        : 'Las observaciones nuevas quedarán aquí hasta encontrar un peer autorizado.';

  return (
    <View
      style={[estilos.contenedor, sync.pendientes ? estilos.pendiente : estilos.listo]}
      accessibilityLabel={`${titulo}. ${detalle}`}
    >
      <View style={[estilos.punto, sync.transporte === 'conectado' && estilos.puntoConectado]} />
      <View style={estilos.textos}>
        <Text style={estilos.titulo}>{titulo}</Text>
        <Text style={estilos.detalle}>{detalle}</Text>
        {sync.publicKey ? (
          <Text selectable style={estilos.clave}>Clave para QUORUM_PEERS: {sync.publicKey}</Text>
        ) : null}
        {sync.ultimaVerificacionEn ? (
          <Text style={estilos.verificado}>Conexión verificada · {sync.latenciaMs} ms</Text>
        ) : null}
        {sync.transporte === 'conectado' ? (
          <View style={estilos.acciones}>
            <Pressable
              style={estilos.botonSecundario}
              disabled={sync.verificando}
              onPress={() => { void verificarConexion(); }}
              accessibilityRole="button"
            >
              <Text style={estilos.botonSecundarioTexto}>{sync.verificando ? 'Verificando…' : 'Verificar conexión'}</Text>
            </Pressable>
            {sync.pendientes > 0 ? (
              <Pressable style={estilos.boton} onPress={() => { void sincronizarAhora(); }} accessibilityRole="button">
                <Text style={estilos.botonTexto}>Sincronizar ahora</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    marginHorizontal: espacio.lg, marginTop: espacio.sm, padding: espacio.sm,
    borderRadius: radio.md, borderWidth: 1,
  },
  pendiente: { backgroundColor: color.advertenciaFondo, borderColor: color.reportado },
  listo: { backgroundColor: color.superficie, borderColor: color.borde },
  punto: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.reportado },
  puntoConectado: { backgroundColor: color.quorum },
  textos: { flex: 1 },
  titulo: { ...tipografia.etiqueta, color: color.texto },
  detalle: { ...tipografia.pequeno, color: color.textoTenue, marginTop: 2 },
  clave: { ...tipografia.pequeno, color: color.textoTenue, marginTop: espacio.xs },
  verificado: { ...tipografia.pequeno, color: color.quorum, marginTop: espacio.xs },
  acciones: { flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm, marginTop: espacio.sm },
  boton: { alignSelf: 'flex-start', minHeight: tap.normal, justifyContent: 'center', paddingHorizontal: espacio.md, borderRadius: radio.md, backgroundColor: color.primario },
  botonTexto: { ...tipografia.etiqueta, color: color.primarioTexto },
  botonSecundario: { alignSelf: 'flex-start', minHeight: tap.normal, justifyContent: 'center', paddingHorizontal: espacio.md, borderRadius: radio.md, borderWidth: 1, borderColor: color.borde, backgroundColor: color.superficie },
  botonSecundarioTexto: { ...tipografia.etiqueta, color: color.texto },
});
