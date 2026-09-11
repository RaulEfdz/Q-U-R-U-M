import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  iniciarSyncMovil, refrescarEstadoSync, sincronizarAhora, suscribirSync, verificarConexion,
  type EstadoSyncGlobal,
} from '../../sync/controller.ts';
import { color, elevacion, espacio, radio, tap, tipografia } from '../theme.ts';

const INICIAL: EstadoSyncGlobal = {
  transporte: 'desconectado', pendientes: 0, publicKey: null,
  ultimoSyncEn: null, error: null,
  verificando: false, ultimaVerificacionEn: null, latenciaMs: null,
};

export interface VistaSync {
  sync: EstadoSyncGlobal;
  /** Una línea para la pastilla de la cabecera. */
  resumen: string;
  /** La explicación completa — solo se ve con el panel abierto. */
  detalle: string;
}

/**
 * Suscripción al controlador de sync. Vive en un hook aparte porque el
 * estado se dibuja en DOS lugares de la cabecera: la pastilla siempre
 * visible y el panel que se despliega al tocarla.
 */
export function useEstadoSync(): VistaSync {
  const [sync, setSync] = useState(INICIAL);

  useEffect(() => {
    const cancelar = suscribirSync(setSync);
    void iniciarSyncMovil();
    const reloj = setInterval(() => { void refrescarEstadoSync(); }, 2_000);
    return () => { cancelar(); clearInterval(reloj); };
  }, []);

  const resumen = sync.pendientes
    ? `${sync.pendientes} sin sincronizar`
    : sync.transporte === 'conectado' ? 'Todo sincronizado' : 'Sin peer';

  const detalle = sync.error
    ? `No se pudo sincronizar: ${sync.error}`
    : sync.transporte === 'conectado'
      ? `${sync.pendientes} pendiente${sync.pendientes === 1 ? '' : 's'} · el ACK retira cada observación de la cola.`
      : sync.pendientes
        ? `${sync.pendientes} observación${sync.pendientes === 1 ? '' : 'es'} espera conexión y ACK.`
        : 'Las observaciones nuevas quedarán aquí hasta encontrar un peer autorizado.';

  return { sync, resumen, detalle };
}

/**
 * Pastilla de estado de la cabecera. Es chica a propósito —el estado de
 * sync es contexto, no la tarea— pero el `hitSlop` le devuelve el objetivo
 * táctil de 52 dp que exige una app que se usa parada y con guantes: el
 * área que responde al dedo es la del control normal, solo la tinta es
 * discreta.
 */
export function PastillaSync({
  vista, abierto, onAlternar,
}: {
  vista: VistaSync;
  abierto: boolean;
  onAlternar: () => void;
}) {
  const { sync, resumen, detalle } = vista;
  const tinta = sync.error
    ? color.sinQuorum
    : sync.pendientes ? color.reportado : sync.transporte === 'conectado' ? color.quorum : color.sinDatos;

  return (
    <Pressable
      style={estilos.pastilla}
      onPress={onAlternar}
      hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={`Estado de sincronización: ${resumen}. ${detalle}`}
      accessibilityState={{ expanded: abierto }}
    >
      <View style={[estilos.punto, { backgroundColor: tinta }]} />
      <Text style={estilos.pastillaTexto} numberOfLines={1}>{resumen}</Text>
    </Pressable>
  );
}

/** Detalle y acciones de sync. Solo se monta con la pastilla abierta. */
export function PanelSync({ vista }: { vista: VistaSync }) {
  const { sync, detalle } = vista;

  return (
    <View style={estilos.panel} accessibilityLiveRegion="polite">
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
            accessibilityState={{ disabled: sync.verificando }}
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
  );
}

const estilos = StyleSheet.create({
  pastilla: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 6, paddingLeft: 9, paddingRight: 11,
    borderRadius: radio.pastilla, backgroundColor: color.superficie,
    borderWidth: 1, borderColor: color.bordeSutil,
    ...elevacion.sutil,
  },
  punto: { width: 7, height: 7, borderRadius: radio.pastilla },
  pastillaTexto: {
    fontSize: 11, fontWeight: '600', color: color.textoTenue,
    fontVariant: ['tabular-nums'],
  },

  panel: {
    marginTop: espacio.sm, padding: espacio.md, gap: espacio.xs,
    borderRadius: radio.md, backgroundColor: color.fondo,
    borderWidth: 1, borderColor: color.bordeSutil,
  },
  detalle: { ...tipografia.pequeno, color: color.textoTenue, lineHeight: 16 },
  clave: { ...tipografia.pequeno, color: color.textoTenue, marginTop: espacio.xs },
  verificado: { ...tipografia.pequeno, color: color.quorumTinta, marginTop: espacio.xs },
  acciones: { flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm, marginTop: espacio.sm },
  boton: {
    minHeight: tap.normal, justifyContent: 'center', paddingHorizontal: espacio.lg,
    borderRadius: radio.pastilla, backgroundColor: color.primario,
  },
  botonTexto: { ...tipografia.etiqueta, color: color.primarioTexto },
  botonSecundario: {
    minHeight: tap.normal, justifyContent: 'center', paddingHorizontal: espacio.lg,
    borderRadius: radio.pastilla, borderWidth: 1.5, borderColor: color.borde,
    backgroundColor: color.superficie,
  },
  botonSecundarioTexto: { ...tipografia.etiqueta, color: color.texto },
});
