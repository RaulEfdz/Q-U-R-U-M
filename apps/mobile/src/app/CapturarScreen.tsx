import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { EstadoRevision } from '../core/contracts.ts';
import { procesarNota, type EventoPipeline, type SalidaPipeline } from '../pipeline/cruzar.ts';
import type { ContextoExtraccion } from '../pipeline/extractor.ts';
import { estaListo } from '../qvac/pool.ts';
import { obtenerIdentidad } from './identidad.ts';
import { ConfirmacionBorrador } from './ConfirmacionBorrador.tsx';
import { color, espacio, radio, tap, tipografia } from './theme.ts';

type Vista =
  | { paso: 'capturar' }
  | { paso: 'procesando' }
  | { paso: 'revision'; salida: SalidaPipeline; nota: string }
  | { paso: 'confirmado'; estadoRevision: EstadoRevision; guardadas: number };

function etiquetaFecha(diasAtras: number): string {
  if (diasAtras === 0) return 'Hoy';
  if (diasAtras === 1) return 'Ayer';
  const f = new Date(Date.now() - diasAtras * 86_400_000);
  return f.toLocaleDateString('es-PA', { day: 'numeric', month: 'short' });
}

/** ms → "840 ms" / "12.3 s". Para las etapas ya terminadas. */
function formatoDuracion(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Una línea para que TalkBack anuncie EN QUÉ va el pipeline. Cambia solo
 *  cuando una etapa arranca o termina — nunca con el contador de segundos,
 *  que si no sería un anuncio por segundo. */
function resumenA11y(pasos: EventoPipeline[]): string {
  const ult = pasos[pasos.length - 1];
  if (!ult) return 'Interpretando la nota';
  if (ult.estado === 'error') return `Se cortó en: ${ult.etiqueta}`;
  if (ult.estado === 'ok') return `${ult.etiqueta}: ${ult.detalle ?? 'listo'}`;
  return `${ult.etiqueta}…`;
}

export default function CapturarScreen() {
  const [nota, setNota] = useState('');
  const [diasAtras, setDiasAtras] = useState(0);
  const [vista, setVista] = useState<Vista>({ paso: 'capturar' });
  const [error, setError] = useState<string | null>(null);

  // Progreso del pipeline: una fila por etapa (precheck → portero → extractor
  // → verificador). Se actualiza en su lugar cuando la etapa pasa de
  // 'corriendo' a 'ok'. Ver `EventoPipeline` en pipeline/cruzar.ts.
  const [pasos, setPasos] = useState<EventoPipeline[]>([]);
  const pasoCorriendoDesde = useRef<number | null>(null);
  // Fuerza re-render mientras hay una etapa corriendo, para que el contador
  // de segundos de la fila activa avance solo.
  const [, marcarTick] = useState(0);

  useEffect(() => {
    if (vista.paso !== 'procesando') return;
    const id = setInterval(() => marcarTick(Date.now()), 300);
    return () => clearInterval(id);
  }, [vista.paso]);

  // `App.tsx` precarga portero + extractor al abrir. Acá solo sondeamos si
  // ya terminaron, para avisar que la primera nota va a tardar más si no.
  const [modelosListos, setModelosListos] = useState(
    () => estaListo('portero') && estaListo('extractor'),
  );
  useEffect(() => {
    if (modelosListos) return;
    const id = setInterval(() => {
      if (estaListo('portero') && estaListo('extractor')) {
        setModelosListos(true);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [modelosListos]);

  // El botón/gesto Atrás del sistema no debe cerrar la app —ni perder lo
  // que el modelo extrajo— si estás en una sub-pantalla de la captura:
  //   - procesando: bloquea (la inferencia ya está corriendo).
  //   - confirmado: vuelve a una nota nueva.
  //   - revisión: NO lo toca acá — `ConfirmacionBorrador` registra su propio
  //     handler y, como se monta después, `BackHandler` (LIFO) lo evalúa
  //     primero; ahí está la pregunta de "¿descartar cambios?".
  //   - capturar: deja pasar el evento (App.tsx o el sistema deciden).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (vista.paso === 'procesando') return true;
      if (vista.paso === 'confirmado') { nuevaNota(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [vista.paso]);

  // Guarda contra doble tap: entre el toque y el re-render que deshabilita el
  // botón hay una ventana de un frame.
  const interpretando = useRef(false);

  function alProgreso(e: EventoPipeline) {
    if (e.estado === 'corriendo') pasoCorriendoDesde.current = Date.now();
    setPasos((prev) => {
      const i = prev.findIndex((p) => p.etapa === e.etapa);
      if (i === -1) return [...prev, e];
      const copia = prev.slice();
      copia[i] = e;
      return copia;
    });
  }

  async function interpretar() {
    const texto = nota.trim();
    if (!texto || interpretando.current) return;
    interpretando.current = true;
    setError(null);
    setPasos([]);
    pasoCorriendoDesde.current = null;
    setVista({ paso: 'procesando' });
    try {
      const identidad = await obtenerIdentidad();
      const visitadoEn = new Date(Date.now() - diasAtras * 86_400_000).toISOString();
      const ctx: ContextoExtraccion = {
        observadorId: identidad.observadorId,
        dispositivoId: identidad.dispositivoId,
        visitadoEn,
        fuente: 'texto',
      };
      const salida = await procesarNota(texto, ctx, alProgreso);
      setVista({ paso: 'revision', salida, nota: texto });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Marcá la etapa que estaba corriendo como cortada, así en pantalla
      // queda claro DÓNDE falló, no solo que falló.
      setPasos((prev) => prev.map((p) =>
        p.estado === 'corriendo' ? { ...p, estado: 'error', detalle: `se cortó acá: ${msg}` } : p));
      setVista({ paso: 'capturar' });
    } finally {
      interpretando.current = false;
    }
  }

  function nuevaNota() {
    setNota('');
    setDiasAtras(0);
    setPasos([]);
    setError(null);
    setVista({ paso: 'capturar' });
  }

  if (vista.paso === 'revision') {
    return (
      <ConfirmacionBorrador
        salida={vista.salida}
        nota={vista.nota}
        onVolver={() => setVista({ paso: 'capturar' })}
        onConfirmado={(r) => setVista({ paso: 'confirmado', ...r })}
      />
    );
  }

  if (vista.paso === 'confirmado') {
    const mensaje =
      vista.estadoRevision === 'pendiente-de-revision'
        ? 'Guardado. Quedó pendiente de revisión — no contestaste la pregunta, y eso está bien: no se perdió nada.'
        : vista.guardadas > 0
          ? `Guardado — ${vista.guardadas} lote(s) confirmado(s).`
          : 'Guardado — visita sin equipo observado.';
    return (
      <View style={estilos.contenedorCentro}>
        <Text style={estilos.glifoExito}>✓</Text>
        <Text style={estilos.mensajeExito}>{mensaje}</Text>
        <Pressable style={estilos.botonPrimario} onPress={nuevaNota}>
          <Text style={estilos.textoBotonPrimario}>Nueva nota</Text>
        </Pressable>
      </View>
    );
  }

  const procesando = vista.paso === 'procesando';
  const mostrarPanel = procesando || pasos.length > 0;

  return (
    <KeyboardAvoidingView
      style={estilos.contenedor}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={estilos.scroll} keyboardShouldPersistTaps="handled">
        {/* La marca y la tesis viven en `components/BarraSuperior.tsx`,
            fijas arriba de las dos pantallas — acá quedarían duplicadas y
            se irían con el scroll. */}
        <Text style={estilos.etiquetaPrimera}>¿Qué viste?</Text>
        <TextInput
          style={estilos.textarea}
          multiline
          value={nota}
          onChangeText={setNota}
          editable={!procesando}
          placeholder="Estoy en Hospital DemoCare Pacific, en Panamá. Tienen dos MR y un CT…"
          placeholderTextColor={color.textoTenue}
        />

        <Text style={estilos.etiqueta}>Fecha de visita</Text>
        <View style={estilos.filaFecha}>
          <Pressable
            style={estilos.botonFecha}
            onPress={() => setDiasAtras((d) => d + 1)}
            disabled={procesando}
            hitSlop={8}
          >
            <Text style={estilos.textoBotonFecha} numberOfLines={1}>◀ antes</Text>
          </Pressable>
          <View style={estilos.chipFecha}>
            <Text style={estilos.textoChipFecha} numberOfLines={1}>{etiquetaFecha(diasAtras)}</Text>
          </View>
          <Pressable
            style={[estilos.botonFecha, diasAtras === 0 && estilos.botonDeshabilitado]}
            onPress={() => setDiasAtras((d) => Math.max(0, d - 1))}
            disabled={procesando || diasAtras === 0}
            hitSlop={8}
          >
            <Text style={estilos.textoBotonFecha} numberOfLines={1}>después ▶</Text>
          </Pressable>
        </View>

        {error && (
          <Text style={estilos.error} accessibilityLiveRegion="polite">
            No se pudo interpretar la nota: {error}
          </Text>
        )}

        <View style={estilos.filaBotones}>
          <Pressable
            style={[estilos.botonDictar]}
            disabled
            // Dictado por voz: pipeline de whisper.cpp on-device, lo integra
            // otro agente (audio con expo-audio, paso 11 del orden de
            // construcción de CLAUDE.md). Queda preparado y deshabilitado
            // acá — NUNCA Web Speech API, ver restricciones duras.
          >
            <Text style={estilos.textoBotonDictar} numberOfLines={2}>🎙 Dictar (pronto)</Text>
          </Pressable>
          <Pressable
            style={[
              estilos.botonPrimario, estilos.botonInterpretar,
              (!nota.trim() || procesando) && estilos.botonDeshabilitado,
            ]}
            onPress={interpretar}
            disabled={!nota.trim() || procesando}
            accessibilityRole="button"
            accessibilityState={{ disabled: !nota.trim() || procesando, busy: procesando }}
            accessibilityLabel={procesando ? 'Interpretando la nota, esperá' : 'Interpretar'}
          >
            {procesando ? (
              <ActivityIndicator color={color.primarioTexto} />
            ) : (
              <Text style={estilos.textoBotonPrimario}>Interpretar</Text>
            )}
          </Pressable>
        </View>

        {!modelosListos && !procesando && (
          <View style={estilos.avisoModelos} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={color.textoTenue} />
            <Text style={estilos.avisoModelosTexto}>
              Preparando los modelos en el teléfono. Si interpretás una nota
              ahora, la primera va a tardar unos segundos más.
            </Text>
          </View>
        )}

        {procesando && (
          <Text accessibilityLiveRegion="polite" style={estilos.soloLector}>
            {resumenA11y(pasos)}
          </Text>
        )}

        {mostrarPanel && (
          <View style={estilos.panel}>
            <Text style={estilos.panelTitulo}>
              {procesando ? 'Corriendo en tu teléfono, sin nube' : 'Se cortó a mitad'}
            </Text>

            {pasos.map((p) => {
              const activo = p.estado === 'corriendo';
              const transcurrido =
                activo && pasoCorriendoDesde.current
                  ? Date.now() - pasoCorriendoDesde.current
                  : 0;
              return (
                <View key={p.etapa} style={estilos.paso}>
                  <View style={estilos.pasoIcono}>
                    {activo ? (
                      <ActivityIndicator size="small" color={color.primario} />
                    ) : (
                      <Text
                        style={[
                          estilos.pasoMarca,
                          p.estado === 'error' && estilos.pasoMarcaError,
                        ]}
                      >
                        {p.estado === 'error' ? '✕' : '✓'}
                      </Text>
                    )}
                  </View>
                  <View style={estilos.pasoCuerpo}>
                    <View style={estilos.pasoFila}>
                      <Text style={estilos.pasoEtiqueta}>{p.etiqueta}</Text>
                      <Text style={estilos.pasoMs}>
                        {p.estado === 'ok' && p.ms !== undefined
                          ? formatoDuracion(p.ms)
                          : activo && transcurrido >= 900
                            ? `${Math.round(transcurrido / 1000)} s`
                            : ''}
                      </Text>
                    </View>
                    {p.detalle ? (
                      <Text style={estilos.pasoDetalle}>{p.detalle}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}

            {procesando && (
              <Text style={estilos.panelPie}>
                Los modelos viven en el teléfono. La primera nota carga los
                pesados a memoria; las siguientes reúsan lo que ya está cargado.
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: color.fondo },
  contenedorCentro: {
    flex: 1, backgroundColor: color.fondo, alignItems: 'center',
    justifyContent: 'center', padding: espacio.xl, gap: espacio.lg,
  },
  scroll: { padding: espacio.lg, gap: espacio.sm },
  etiqueta: { ...tipografia.subtitulo, marginTop: espacio.md, marginBottom: espacio.xs },
  // La primera etiqueta no lleva margen de arriba: ya la separa la barra.
  etiquetaPrimera: { ...tipografia.subtitulo, marginBottom: espacio.xs },
  textarea: {
    minHeight: 140, borderWidth: 1.5, borderColor: color.borde, borderRadius: radio.lg,
    padding: espacio.md, fontSize: 16, color: color.texto, backgroundColor: color.superficie,
    textAlignVertical: 'top',
  },
  // `alignItems: 'flex-start'`: si la fuente del sistema grande hace que un
  // botón sea más alto que otro, no se estiran para igualarse.
  filaFecha: { flexDirection: 'row', alignItems: 'flex-start', gap: espacio.sm },
  // `minHeight` = objetivo táctil a escala 1.0; `paddingVertical` deja crecer
  // el control con la fuente del sistema sin apretar el texto.
  botonFecha: {
    minHeight: tap.normal, paddingHorizontal: espacio.md, paddingVertical: espacio.xs,
    borderRadius: radio.md,
    borderWidth: 1.5, borderColor: color.borde, alignItems: 'center', justifyContent: 'center',
  },
  textoBotonFecha: { fontSize: 14, fontWeight: '600', color: color.texto },
  chipFecha: {
    flex: 1, minHeight: tap.normal, paddingVertical: espacio.xs,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.superficieHundida, borderRadius: radio.md,
  },
  textoChipFecha: { fontSize: 16, fontWeight: '700', color: color.texto },
  error: { color: color.peligro, marginTop: espacio.md, fontSize: 14 },
  filaBotones: { flexDirection: 'row', gap: espacio.md, marginTop: espacio.lg },
  botonDictar: {
    flex: 1, minHeight: tap.grande, borderRadius: radio.lg, borderWidth: 1.5,
    borderColor: color.borde, backgroundColor: color.superficieHundida,
    alignItems: 'center', justifyContent: 'center', opacity: 0.55,
  },
  textoBotonDictar: { fontSize: 15, fontWeight: '600', color: color.textoTenue },
  botonInterpretar: { flex: 2 },
  botonPrimario: {
    minHeight: tap.grande, borderRadius: radio.lg, backgroundColor: color.primario,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: espacio.xl,
  },
  botonDeshabilitado: { opacity: 0.5 },
  textoBotonPrimario: { fontSize: 17, fontWeight: '700', color: color.primarioTexto },

  avisoModelos: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    marginTop: espacio.md, paddingHorizontal: espacio.xs,
  },
  avisoModelosTexto: { flex: 1, fontSize: 12, color: color.textoTenue, lineHeight: 16 },

  // Fuera de la vista pero en el árbol de accesibilidad: TalkBack lo lee, el
  // ojo no. `position: absolute` + offset — `display:'none'` o tamaño 0 lo
  // podarían del árbol.
  soloLector: { position: 'absolute', left: -9999, width: 1, height: 1 },

  // ── Panel de progreso del pipeline ────────────────────────────────────
  panel: {
    marginTop: espacio.lg, padding: espacio.md, borderRadius: radio.lg,
    borderWidth: 1.5, borderColor: color.borde, backgroundColor: color.superficie,
    gap: espacio.sm,
  },
  panelTitulo: { ...tipografia.etiqueta, color: color.textoTenue },
  paso: { flexDirection: 'row', gap: espacio.sm, alignItems: 'flex-start' },
  pasoIcono: { width: 20, alignItems: 'center', marginTop: 1 },
  pasoMarca: { fontSize: 15, fontWeight: '700', color: color.exito },
  pasoMarcaError: { color: color.peligro },
  pasoCuerpo: { flex: 1, gap: 1 },
  pasoFila: { flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm },
  pasoEtiqueta: { flex: 1, fontSize: 14, fontWeight: '600', color: color.texto },
  // `flexShrink: 0`: la duración no se aplasta cuando la etiqueta es larga o
  // la fuente del sistema está en grande.
  pasoMs: {
    fontSize: 13, fontWeight: '600', color: color.textoTenue,
    fontVariant: ['tabular-nums'], flexShrink: 0,
  },
  pasoDetalle: { fontSize: 12, color: color.textoTenue, lineHeight: 16 },
  panelPie: {
    fontSize: 12, color: color.textoTenue, lineHeight: 16, marginTop: espacio.xs,
  },

  glifoExito: { fontSize: 56, color: color.exito },
  mensajeExito: { ...tipografia.cuerpo, textAlign: 'center', color: color.texto },
});
