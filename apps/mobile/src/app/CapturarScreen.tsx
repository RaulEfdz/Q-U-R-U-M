import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { EstadoRevision } from '../core/contracts.ts';
import { procesarNota, type SalidaPipeline } from '../pipeline/cruzar.ts';
import type { ContextoExtraccion } from '../pipeline/extractor.ts';
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

export default function CapturarScreen() {
  const [nota, setNota] = useState('');
  const [diasAtras, setDiasAtras] = useState(0);
  const [vista, setVista] = useState<Vista>({ paso: 'capturar' });
  const [error, setError] = useState<string | null>(null);

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
        <Text style={estilos.glifoExito}>✓</Text>
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
          <Pressable
            style={[estilos.botonDictar]}
            disabled
            // Dictado por voz: pipeline de whisper.cpp on-device, lo integra
            // otro agente (audio con expo-audio, paso 11 del orden de
            // construcción de CLAUDE.md). Queda preparado y deshabilitado
            // acá — NUNCA Web Speech API, ver restricciones duras.
          >
            <Text style={estilos.textoBotonDictar}>🎙 Dictar (pronto)</Text>
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
  scroll: { padding: espacio.lg, gap: espacio.sm },
  etiqueta: { ...tipografia.subtitulo, marginTop: espacio.md, marginBottom: espacio.xs },
  // La primera etiqueta no lleva margen de arriba: ya la separa la barra.
  etiquetaPrimera: { ...tipografia.subtitulo, marginBottom: espacio.xs },
  textarea: {
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
  notaProcesando: { textAlign: 'center', color: color.textoTenue, marginTop: espacio.md, fontSize: 13 },
  glifoExito: { fontSize: 56, color: color.exito },
  mensajeExito: { ...tipografia.cuerpo, textAlign: 'center', color: color.texto },
});
