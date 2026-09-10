import { useCallback, useState } from 'react';
import { useAudioRecorder, requestRecordingPermissionsAsync } from 'expo-audio';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { EstadoRevision } from '../core/contracts.ts';
import { procesarNota, type SalidaPipeline } from '../pipeline/cruzar.ts';
import { OPCIONES_GRABACION, transcribirLocal } from '../pipeline/dictar.ts';
import type { ContextoExtraccion } from '../pipeline/extractor.ts';
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

export default function CapturarScreen() {
  const [nota, setNota] = useState('');
  const [diasAtras, setDiasAtras] = useState(0);
  const [vista, setVista] = useState<Vista>({ paso: 'capturar' });
  const [error, setError] = useState<string | null>(null);

  /* ── Fase 11 · dictado por voz, todo on-device ── */
  const grabadora = useAudioRecorder(OPCIONES_GRABACION);
  const [grabando, setGrabando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);

  const alternarDictado = useCallback(async () => {
    setError(null);

    if (grabando) {
      setGrabando(false);
      setTranscribiendo(true);
      try {
        await grabadora.stop();
        const uri = grabadora.uri;
        if (!uri) throw new Error('la grabación no dejó archivo de audio');
        const { texto } = await transcribirLocal(uri);
        if (!texto) {
          setError('No se entendió nada en el audio. Probá de nuevo, o escribilo.');
          return;
        }
        // Se AGREGA a lo que ya haya escrito en vez de reemplazarlo: perder
        // una nota a medio escribir por tocar el micrófono seria el peor
        // resultado posible en una app cuya premisa es no perder datos.
        setNota((previa) => (previa.trim() ? `${previa.trim()} ${texto}` : texto));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
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
      setGrabando(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [grabando, grabadora]);

  async function interpretar() {
    const texto = nota.trim();
    if (!texto) return;
    setError(null);
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
      const salida = await procesarNota(texto, ctx);
      setVista({ paso: 'revision', salida, nota: texto });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVista({ paso: 'capturar' });
    }
  }

  function nuevaNota() {
    setNota('');
    setDiasAtras(0);
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
        {/* Antes era el carácter «✓», que en Android se renderiza con la
            fuente de emoji del sistema y aparece en color, saltándose la
            paleta. Ahora es un trazo del set propio. */}
        <Icono nombre="chequeo" tamano={52} color={color.quorum} />
        <Text style={estilos.mensajeExito}>{mensaje}</Text>
        <Pressable style={estilos.botonPrimario} onPress={nuevaNota}>
          <Text style={estilos.textoBotonPrimario}>Nueva nota</Text>
        </Pressable>
      </View>
    );
  }

  const procesando = vista.paso === 'procesando';

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
          >
            <Text style={estilos.textoBotonFecha}>◀ antes</Text>
          </Pressable>
          <View style={estilos.chipFecha}>
            <Text style={estilos.textoChipFecha}>{etiquetaFecha(diasAtras)}</Text>
          </View>
          <Pressable
            style={[estilos.botonFecha, diasAtras === 0 && estilos.botonDeshabilitado]}
            onPress={() => setDiasAtras((d) => Math.max(0, d - 1))}
            disabled={procesando || diasAtras === 0}
            hitSlop={8}
          >
            <Text style={estilos.textoBotonFecha}>después ▶</Text>
          </Pressable>
        </View>

        {error && <Text style={estilos.error}>No se pudo interpretar la nota: {error}</Text>}

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
                <Text style={[estilos.textoBotonDictar, grabando && estilos.textoBotonGrabando]}>
                  {grabando ? 'Detener' : 'Dictar'}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable
            style={[
              estilos.botonPrimario, estilos.botonInterpretar,
              (!nota.trim() || procesando) && estilos.botonDeshabilitado,
            ]}
            onPress={interpretar}
            disabled={!nota.trim() || procesando}
          >
            {procesando ? (
              <ActivityIndicator color={color.primarioTexto} />
            ) : (
              <Text style={estilos.textoBotonPrimario}>Interpretar</Text>
            )}
          </Pressable>
        </View>

        {grabando && (
          <Text style={estilos.notaProcesando}>
            Grabando. Tocá «Detener» cuando termines — el audio se transcribe en
            este teléfono y no sale del dispositivo.
          </Text>
        )}

        {transcribiendo && (
          <Text style={estilos.notaProcesando}>
            Transcribiendo con whisper en tu teléfono, sin nube…
          </Text>
        )}

        {procesando && (
          <Text style={estilos.notaProcesando}>
            Corriendo en tu teléfono, sin nube — puede tardar unos segundos.
          </Text>
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
    // Crece con el espacio libre: la nota es lo único que se escribe acá, así
    // que el campo se queda con el alto que sobra en vez de dejarlo muerto.
    flex: 1,
    minHeight: 140, borderWidth: 1.5, borderColor: color.borde, borderRadius: radio.lg,
    padding: espacio.md, fontSize: 16, color: color.texto, backgroundColor: color.superficie,
    textAlignVertical: 'top',
  },
  filaFecha: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm },
  botonFecha: {
    minHeight: tap.normal, paddingHorizontal: espacio.md, borderRadius: radio.md,
    borderWidth: 1.5, borderColor: color.borde, alignItems: 'center', justifyContent: 'center',
  },
  textoBotonFecha: { fontSize: 14, fontWeight: '600', color: color.texto },
  chipFecha: {
    flex: 1, minHeight: tap.normal, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.superficieHundida, borderRadius: radio.md,
  },
  textoChipFecha: { fontSize: 16, fontWeight: '700', color: color.texto },
  error: { color: color.peligro, marginTop: espacio.md, fontSize: 14 },
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
  textoBotonDictar: { fontSize: 15, fontWeight: '600', color: color.textoTenue },
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
  textoBotonPrimario: { fontSize: 17, fontWeight: '700', color: color.primarioTexto },
  notaProcesando: { textAlign: 'center', color: color.textoTenue, marginTop: espacio.md, fontSize: 13 },
  glifoExito: { fontSize: 56, color: color.exito },
  mensajeExito: { ...tipografia.cuerpo, textAlign: 'center', color: color.texto },
});
