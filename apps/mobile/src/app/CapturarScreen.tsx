import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder, requestRecordingPermissionsAsync } from 'expo-audio';
import {
  ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { EstadoRevision } from '../core/contracts.ts';
import { procesarNota, type SalidaPipeline } from '../pipeline/cruzar.ts';
import { OPCIONES_GRABACION, transcribirLocal } from '../pipeline/dictar.ts';
import type { ContextoExtraccion } from '../pipeline/extractor.ts';
import { estaListo, MODELOS } from '../qvac/pool.ts';
import { obtenerIdentidad } from './identidad.ts';
import { ConfirmacionBorrador } from './ConfirmacionBorrador.tsx';
import { Icono } from './components/Icono.tsx';
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

/** bytes → "78 MB" / "1.0 GB". Mismo criterio que `mb()` en pipeline/cruzar.ts
 *  (no compartido: es una línea, no vale la pena un módulo por eso). */
function mb(bytes: number): string {
  const m = bytes / (1024 * 1024);
  return m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${Math.round(m)} MB`;
}

/**
 * El panel de "corriendo en tu teléfono" es el mismo para interpretar texto
 * y para dictar — mismo componente, misma fila por etapa — así que su forma
 * es más ancha que `EventoPipeline` (que es específica del pipeline de
 * `procesarNota`, con su propia unión de etapas). Un `EventoPipeline` entra
 * acá sin conversión (`etapa: string` es más amplio); lo que NO entraría al
 * revés es una `PasoUI` de dictado (`'grabando'`/`'transcribiendo'`) dentro
 * de un `EventoPipeline[]`.
 */
interface PasoUI {
  etapa: string;
  etiqueta: string;
  estado: 'corriendo' | 'ok' | 'error';
  ms?: number;
  detalle?: string;
}

/** Una línea para que TalkBack anuncie EN QUÉ va el pipeline. Cambia solo
 *  cuando una etapa arranca o termina — nunca con el contador de segundos,
 *  que si no sería un anuncio por segundo. */
function resumenA11y(pasos: PasoUI[]): string {
  const ult = pasos[pasos.length - 1];
  if (!ult) return 'Interpretando la nota';
  if (ult.estado === 'error') return `Se cortó en: ${ult.etiqueta}`;
  if (ult.estado === 'ok') return `${ult.etiqueta}: ${ult.detalle ?? 'listo'}`;
  return `${ult.etiqueta}…`;
}

/** Segundos transcurridos de la etapa activa. Tiene su propio `setInterval`
 *  para que el tick no re-renderice toda la pantalla — solo este `<Text>`.
 *  Se remonta al cambiar de etapa (la fila lleva `key={p.etapa}`). */
function ContadorEtapa({ desde }: { desde: number | null }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 300);
    return () => clearInterval(id);
  }, []);
  const ms = desde ? ahora - desde : 0;
  return <Text style={estilos.pasoMs}>{ms >= 900 ? `${Math.round(ms / 1000)} s` : ''}</Text>;
}

export default function CapturarScreen() {
  const [nota, setNota] = useState('');
  const [diasAtras, setDiasAtras] = useState(0);
  const [vista, setVista] = useState<Vista>({ paso: 'capturar' });
  const [error, setError] = useState<string | null>(null);

  // Progreso — una fila por etapa, compartido entre interpretar texto
  // (precheck → portero → extractor → verificador, ver `EventoPipeline` en
  // pipeline/cruzar.ts) y dictar (grabando → transcribiendo, más abajo). Se
  // actualiza en su lugar cuando la etapa pasa de 'corriendo' a 'ok'/'error'.
  // El contador de segundos de la etapa activa lo mueve `<ContadorEtapa>`
  // con su propio `setInterval` — así el tick de 300 ms no re-renderiza toda
  // la pantalla ~300 veces por captura, solo ese `<Text>`.
  const [pasos, setPasos] = useState<PasoUI[]>([]);
  const pasoCorriendoDesde = useRef<number | null>(null);

  function actualizarPaso(e: PasoUI) {
    if (e.estado === 'corriendo') pasoCorriendoDesde.current = Date.now();
    setPasos((prev) => {
      const i = prev.findIndex((p) => p.etapa === e.etapa);
      if (i === -1) return [...prev, e];
      const copia = prev.slice();
      copia[i] = e;
      return copia;
    });
  }

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

  /* ── Fase 11 · dictado por voz, todo on-device ── */
  const grabadora = useAudioRecorder(OPCIONES_GRABACION);
  const [grabando, setGrabando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);

  const alternarDictado = useCallback(async () => {
    setError(null);

    if (grabando) {
      // Cierra la fila "Grabando" con la duración real — `pasoCorriendoDesde`
      // todavía apunta a cuándo arrancó (la seteó `actualizarPaso` al abrir
      // la etapa, más abajo), así que hay que leerla ANTES de pisarla con la
      // etapa siguiente.
      const grabacionDesde = pasoCorriendoDesde.current;
      actualizarPaso({
        etapa: 'grabando', etiqueta: 'Grabando tu nota', estado: 'ok',
        ms: grabacionDesde ? Date.now() - grabacionDesde : undefined,
      });
      setGrabando(false);
      setTranscribiendo(true);
      const etqTranscribir = `Transcribiendo con whisper (${mb(MODELOS.asr.expectedSize)})`;
      actualizarPaso({ etapa: 'transcribiendo', etiqueta: etqTranscribir, estado: 'corriendo' });
      const transcribiendoDesde = Date.now();
      try {
        await grabadora.stop();
        const uri = grabadora.uri;
        if (!uri) throw new Error('la grabación no dejó archivo de audio');
        const { texto, descartadaPorAlucinacion } = await transcribirLocal(uri);
        const ms = Date.now() - transcribiendoDesde;
        if (descartadaPorAlucinacion) {
          // Whisper devolvió una frase repetida — su modo de falla típico con
          // audio sin voz. Se descarta en `dictar.ts` y acá se dice por qué:
          // meter quince frases inventadas en una nota que la persona va a
          // confirmar como propia es peor que no transcribir nada.
          actualizarPaso({
            etapa: 'transcribiendo', etiqueta: etqTranscribir, estado: 'error', ms,
            detalle: 'no se escuchó voz — se descartó, no se inventó texto',
          });
          setError('No se escuchó voz en la grabación. Acercá el micrófono y probá de nuevo, o escribí la nota.');
          return;
        }
        if (!texto) {
          actualizarPaso({
            etapa: 'transcribiendo', etiqueta: etqTranscribir, estado: 'error', ms,
            detalle: 'no se entendió nada en el audio',
          });
          setError('No se entendió nada en el audio. Probá de nuevo, o escribilo.');
          return;
        }
        actualizarPaso({
          etapa: 'transcribiendo', etiqueta: etqTranscribir, estado: 'ok', ms,
          detalle: `"${texto.length > 70 ? `${texto.slice(0, 70)}…` : texto}"`,
        });
        // Se AGREGA a lo que ya haya escrito en vez de reemplazarlo: perder
        // una nota a medio escribir por tocar el micrófono seria el peor
        // resultado posible en una app cuya premisa es no perder datos.
        setNota((previa) => (previa.trim() ? `${previa.trim()} ${texto}` : texto));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        actualizarPaso({
          etapa: 'transcribiendo', etiqueta: etqTranscribir, estado: 'error',
          ms: Date.now() - transcribiendoDesde, detalle: `se cortó acá: ${msg}`,
        });
        setError(msg);
      } finally {
        setTranscribiendo(false);
      }
      return;
    }

    try {
      const permiso = await requestRecordingPermissionsAsync();
      if (!permiso.granted) {
        setError('Sin permiso de micrófono no se puede dictar. Podés escribir la nota igual.');
        return;
      }
      await grabadora.prepareToRecordAsync();
      grabadora.record();
      // Nueva grabación: se limpia la traza de la anterior, igual que
      // `interpretar()` limpia la del texto al arrancar de nuevo.
      setPasos([]);
      actualizarPaso({ etapa: 'grabando', etiqueta: 'Grabando tu nota', estado: 'corriendo' });
      setGrabando(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [grabando, grabadora]);

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
      const salida = await procesarNota(texto, ctx, actualizarPaso);
      setVista({ paso: 'revision', salida, nota: texto });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // El prefijo va ACÁ, no en el banner de abajo: `error` también lo
      // setea `alternarDictado` con frases ya completas ("No se escuchó voz
      // en la grabación…", "Sin permiso de micrófono…"), y anteponerles
      // "No se pudo interpretar la nota" ahí las vuelve confusas — un
      // problema del micrófono se leía como si fuera del extractor.
      setError(`No se pudo interpretar la nota: ${msg}`);
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
        // Volver a editar la nota: se limpia la traza del pipeline. Sin esto,
        // Capturar mostraba el panel con la corrida ANTERIOR (que terminó bien,
        // llegó a la revisión) titulado "Se cortó a mitad" — el título de la
        // rama de error. La traza vieja además es de una nota que estás por
        // cambiar. El panel de "Se cortó a mitad" sigue apareciendo cuando la
        // interpretación falla de verdad (el `catch` de `interpretar`).
        onVolver={() => { setPasos([]); setVista({ paso: 'capturar' }); }}
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
        {/* Antes era el carácter «✓», que en Android se renderiza con la
            fuente de emoji del sistema y aparece en color, saltándose la
            paleta. Ahora es un trazo del set propio. */}
        <Icono nombre="chequeo" tamano={52} color={color.quorum} />
        <Text style={estilos.mensajeExito} accessibilityLiveRegion="polite">{mensaje}</Text>
        <Pressable style={estilos.botonPrimario} onPress={nuevaNota} accessibilityRole="button">
          <Text style={estilos.textoBotonPrimario}>Nueva nota</Text>
        </Pressable>
      </View>
    );
  }

  const procesando = vista.paso === 'procesando';
  // Corriendo: interpretando el texto O dictando (grabando/transcribiendo) —
  // el panel de abajo es el mismo para las dos cosas.
  const corriendo = procesando || grabando || transcribiendo;
  const mostrarPanel = corriendo || pasos.length > 0;
  const huboError = pasos.some((p) => p.estado === 'error');

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
          accessibilityLabel="¿Qué viste? Escribí lo que observaste en la visita"
          multiline
          value={nota}
          onChangeText={setNota}
          editable={!procesando && !grabando && !transcribiendo}
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
            accessibilityRole="button"
            accessibilityLabel="Un día antes"
          >
            <Text style={estilos.textoBotonFecha} numberOfLines={1}>◀ antes</Text>
          </Pressable>
          <View
            style={estilos.chipFecha}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`Fecha de visita: ${etiquetaFecha(diasAtras)}`}
          >
            <Text style={estilos.textoChipFecha} numberOfLines={1} importantForAccessibility="no">
              {etiquetaFecha(diasAtras)}
            </Text>
          </View>
          <Pressable
            style={[estilos.botonFecha, diasAtras === 0 && estilos.botonDeshabilitado]}
            onPress={() => setDiasAtras((d) => Math.max(0, d - 1))}
            disabled={procesando || diasAtras === 0}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Un día después"
            accessibilityState={{ disabled: procesando || diasAtras === 0 }}
          >
            <Text style={estilos.textoBotonFecha} numberOfLines={1}>después ▶</Text>
          </Pressable>
        </View>

        {error && (
          <Text style={estilos.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}

        <View style={estilos.filaBotones}>
          {/* Dictado por voz con whisper.cpp on-device (`pipeline/dictar.ts`).
              NUNCA Web Speech API: manda el audio a un servidor del
              proveedor, y es la restricción más fácil de romper sin darse
              cuenta. */}
          <Pressable
            style={[
              estilos.botonDictar,
              grabando && estilos.botonGrabando,
              (procesando || transcribiendo) && estilos.botonDeshabilitado,
            ]}
            onPress={() => { void alternarDictado(); }}
            disabled={procesando || transcribiendo}
            accessibilityRole="button"
            accessibilityLabel={grabando ? 'Detener y transcribir' : 'Dictar la nota'}
            accessibilityState={{ disabled: procesando || transcribiendo }}
          >
            {transcribiendo ? (
              <ActivityIndicator color={color.textoTenue} />
            ) : (
              <View style={estilos.contenidoBoton}>
                <Icono
                  nombre={grabando ? 'detener' : 'microfono'}
                  color={grabando ? color.peligro : color.textoTenue}
                />
                <Text
                  style={[estilos.textoBotonDictar, grabando && estilos.textoBotonGrabando]}
                  numberOfLines={1}
                >
                  {grabando ? 'Detener' : 'Dictar'}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable
            style={[
              estilos.botonPrimario, estilos.botonInterpretar,
              (!nota.trim() || corriendo) && estilos.botonDeshabilitado,
            ]}
            onPress={interpretar}
            disabled={!nota.trim() || corriendo}
            accessibilityRole="button"
            accessibilityState={{ disabled: !nota.trim() || corriendo, busy: procesando }}
            accessibilityLabel={procesando ? 'Interpretando la nota, esperá' : 'Interpretar'}
          >
            {procesando ? (
              <ActivityIndicator color={color.primarioTexto} />
            ) : (
              <Text style={estilos.textoBotonPrimario}>Interpretar</Text>
            )}
          </Pressable>
        </View>

        {!modelosListos && !procesando && !grabando && !transcribiendo && (
          <View style={estilos.avisoModelos} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={color.textoTenue} />
            <Text style={estilos.avisoModelosTexto}>
              Preparando los modelos en el teléfono. Si interpretás una nota
              ahora, la primera va a tardar unos segundos más.
            </Text>
          </View>
        )}

        {corriendo && (
          <Text accessibilityLiveRegion="polite" style={estilos.soloLector}>
            {resumenA11y(pasos)}
          </Text>
        )}

        {mostrarPanel && (
          <View style={estilos.panel}>
            <Text style={estilos.panelTitulo}>
              {corriendo
                ? 'Corriendo en tu teléfono, sin nube'
                : huboError ? 'Se cortó a mitad' : 'Listo'}
            </Text>

            {pasos.map((p) => {
              const activo = p.estado === 'corriendo';
              return (
                <View key={p.etapa} style={estilos.paso}>
                  <View style={estilos.pasoIcono}>
                    {activo ? (
                      <ActivityIndicator size="small" color={color.primario} />
                    ) : (
                      <Text
                        importantForAccessibility="no"
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
                      {p.estado === 'ok' && p.ms !== undefined ? (
                        <Text style={estilos.pasoMs}>{formatoDuracion(p.ms)}</Text>
                      ) : activo ? (
                        <ContadorEtapa desde={pasoCorriendoDesde.current} />
                      ) : (
                        <Text style={estilos.pasoMs} />
                      )}
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
  // `flexGrow: 1` para que el contenido ocupe el alto de la pantalla en vez de
  // apelotonarse arriba dejando medio teléfono vacío; sigue siendo scroll
  // cuando el teclado sube o la nota es larga.
  scroll: { padding: espacio.lg, gap: espacio.sm, flexGrow: 1 },
  etiqueta: { ...tipografia.subtitulo, marginTop: espacio.md, marginBottom: espacio.xs },
  // La primera etiqueta no lleva margen de arriba: ya la separa la barra.
  etiquetaPrimera: { ...tipografia.subtitulo, marginBottom: espacio.xs },
  textarea: {
    ...tipografia.cuerpo,
    // Crece con el espacio libre: la nota es lo único que se escribe acá, así
    // que el campo se queda con el alto que sobra en vez de dejarlo muerto.
    flex: 1,
    minHeight: 140, borderWidth: 1.5, borderColor: color.borde, borderRadius: radio.lg,
    padding: espacio.md, color: color.texto, backgroundColor: color.superficie,
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
  textoBotonFecha: { ...tipografia.etiqueta, color: color.texto },
  chipFecha: {
    flex: 1, minHeight: tap.normal, paddingVertical: espacio.xs,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.superficieHundida, borderRadius: radio.md,
  },
  textoChipFecha: { ...tipografia.cuerpo, fontWeight: '700', color: color.texto },
  error: { ...tipografia.secundario, color: color.peligro, marginTop: espacio.md },
  filaBotones: { flexDirection: 'row', gap: espacio.md, marginTop: espacio.lg },
  botonDictar: {
    flex: 1, minHeight: tap.grande, borderRadius: radio.lg, borderWidth: 1.5,
    borderColor: color.borde, backgroundColor: color.superficieHundida,
    alignItems: 'center', justifyContent: 'center',
    // Sin `opacity` — la tenía porque el botón estaba deshabilitado esperando
    // la Fase 11. Ahora dicta de verdad y un control activo al 55% se lee
    // como que no se puede tocar.
  },
  contenidoBoton: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm },
  textoBotonDictar: { ...tipografia.accion, color: color.textoTenue },
  // Grabando: el borde y el texto toman el color de peligro, que en esta app
  // NO es de la rampa de quórum — es un estado de la interfaz, no un nivel de
  // confianza sobre un dato.
  botonGrabando: {
    borderColor: color.peligro, backgroundColor: color.peligroFondo, opacity: 1,
  },
  textoBotonGrabando: { color: color.peligro, fontWeight: '700' },
  botonInterpretar: { flex: 2 },
  botonPrimario: {
    minHeight: tap.grande, borderRadius: radio.lg, backgroundColor: color.primario,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: espacio.xl,
  },
  botonDeshabilitado: { opacity: 0.5 },
  textoBotonPrimario: { ...tipografia.accion, color: color.primarioTexto },

  avisoModelos: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    marginTop: espacio.md, paddingHorizontal: espacio.xs,
  },
  avisoModelosTexto: { ...tipografia.pequeno, flex: 1, color: color.textoTenue, lineHeight: 16 },

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
  // Glifo ✓ / ✕ del panel — tamaño de ícono, no de la escala de texto.
  pasoMarca: { fontSize: 15, fontWeight: '700', color: color.exito },
  pasoMarcaError: { color: color.peligro },
  pasoCuerpo: { flex: 1, gap: 1 },
  pasoFila: { flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm },
  pasoEtiqueta: { ...tipografia.etiqueta, flex: 1, color: color.texto },
  // `flexShrink: 0`: la duración no se aplasta cuando la etiqueta es larga o
  // la fuente del sistema está en grande.
  pasoMs: {
    ...tipografia.etiqueta, color: color.textoTenue,
    fontVariant: ['tabular-nums'], flexShrink: 0,
  },
  pasoDetalle: { ...tipografia.pequeno, color: color.textoTenue, lineHeight: 16 },
  panelPie: {
    ...tipografia.pequeno, color: color.textoTenue, lineHeight: 16, marginTop: espacio.xs,
  },

  // Glifo grande del estado "confirmado" — decorativo, tamaño propio.
  glifoExito: { fontSize: 56, color: color.exito },
  mensajeExito: { ...tipografia.cuerpo, textAlign: 'center', color: color.texto },
});
