import { useEffect, useRef, useState } from 'react';
import {
  Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { Observacion, EstadoRevision, Borrador } from '../core/contracts.ts';
import { nuevoId } from '../core/ids.ts';
import { agregar, confirmarParaGuardar } from '../store/expo-store.ts';
import type { SalidaPipeline } from '../pipeline/cruzar.ts';
import { agregarPendiente } from './pendientes-store.ts';
import { encolar } from '../sync/queue.ts';
import { refrescarEstadoSync } from '../sync/controller.ts';
import { LoteEditable } from './components/LoteEditable.tsx';
import { LoteDescartado } from './components/LoteDescartado.tsx';
import { color, espacio, radio, tap, tipografia } from './theme.ts';

function clonar(o: Observacion): Observacion {
  return { ...o, lote: { ...o.lote }, seguimiento: [...o.seguimiento] };
}

/**
 * Resumen del borrador. Cuando no hay lotes estructurados (el atajo vacío,
 * o `POSIBLE_OMISION_EXTRACTOR`), la nota original se conserva TEXTUAL
 * acá — es lo único que queda de la visita si no hay equipo estructurado,
 * y "nunca se descarta la nota" incluye ese caso.
 */
function construirResumen(observaciones: Observacion[], nota: string): string {
  if (observaciones.length === 0) {
    const recorte = nota.trim().length > 240 ? `${nota.trim().slice(0, 240)}…` : nota.trim();
    return `Sin equipo estructurado. Nota: “${recorte}”`;
  }
  const conteo = new Map<string, number>();
  for (const o of observaciones) {
    conteo.set(o.lote.modalidad, (conteo.get(o.lote.modalidad) ?? 0) + (o.lote.cantidad ?? 1));
  }
  return [...conteo.entries()].map(([m, c]) => `${c} × ${m}`).join(' · ');
}

export function ConfirmacionBorrador({
  salida, nota, onConfirmado, onVolver,
}: {
  salida: SalidaPipeline;
  nota: string;
  onConfirmado: (r: { estadoRevision: EstadoRevision; guardadas: number }) => void;
  onVolver: () => void;
}) {
  const [observaciones, setObservaciones] = useState<Observacion[]>(() => salida.lotes.map(clonar));
  const [respuesta, setRespuesta] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ¿Tocó el borrador? Si volvió sin tocar nada, no hay nada que descartar.
  const [tocado, setTocado] = useState(false);
  const guardandoRef = useRef(false);

  const vacio = salida.resultado === 'ACUERDO_VACIO';
  const resumen = construirResumen(observaciones, nota);

  function actualizar(indice: number, siguiente: Observacion) {
    setTocado(true);
    setObservaciones((arr) => arr.map((o, i) => (i === indice ? siguiente : o)));
  }

  // "Editar nota" y el botón Atrás del sistema pasan por acá: si editaste algo,
  // pregunta antes de tirar el borrador (la nota queda para interpretarla de
  // nuevo, pero las correcciones a mano se pierden). Un `Alert` nativo es el
  // patrón correcto acá — es una decisión destructiva que debe interrumpir.
  function intentarVolver() {
    if (guardando) return;
    if (!tocado) { onVolver(); return; }
    Alert.alert(
      'Descartar los cambios',
      'Editaste el borrador. Si volvés ahora se pierden las correcciones que hiciste — la nota queda igual para interpretarla de nuevo.',
      [
        { text: 'Seguir editando', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: onVolver },
      ],
    );
  }

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (guardando) return true; // guardando: no interrumpir
      intentarVolver();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardando, tocado]);

  async function confirmar() {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      // Máx. 1 pregunta por nota, y contestarla es OPCIONAL — si `respuesta`
      // queda vacía la nota se guarda igual, nunca se descarta.
      const contesto = Boolean(salida.pregunta && respuesta.trim().length > 0);
      const estadoRevision: EstadoRevision =
        salida.pregunta && !contesto ? 'pendiente-de-revision' : 'confirmada';

      const finales = contesto
        ? observaciones.map((o) => ({
            ...o,
            seguimiento: [...o.seguimiento, { pregunta: salida.pregunta!, respuesta: respuesta.trim() }],
          }))
        : observaciones;

      let guardadas = 0;
      if (finales.length > 0) {
        // Único punto de la app que llama `confirmarParaGuardar` — el
        // usuario acaba de aprobar explícitamente lo que ve en pantalla.
        const confirmadas = confirmarParaGuardar(finales);
        guardadas = await agregar(confirmadas);
        await encolar(confirmadas);
        await refrescarEstadoSync();
      }

      if (estadoRevision === 'pendiente-de-revision') {
        const borrador: Borrador = {
          id: nuevoId(),
          sesionId: finales[0]?.sesionId ?? nuevoId(),
          observaciones: finales,
          resumen: construirResumen(finales, nota),
          siguientePregunta: salida.pregunta,
          creadoEn: new Date().toISOString(),
          estadoRevision,
        };
        await agregarPendiente(borrador);
      }

      onConfirmado({ estadoRevision, guardadas });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={estilos.contenedor}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={estilos.scroll} keyboardShouldPersistTaps="handled">
        <Text style={tipografia.titulo}>Revisá antes de guardar</Text>
        <Text style={estilos.resumen}>{resumen}</Text>

        {vacio && (
          <View style={estilos.cajaVacio}>
            <Text style={estilos.textoVacio}>
              Visitaste el sitio y no se observó equipo. Es un dato válido — se
              guarda así, sin ningún lote.
            </Text>
          </View>
        )}

        {observaciones.map((o, i) => (
          <LoteEditable key={i} obs={o} onCambiar={(sig) => actualizar(i, sig)} />
        ))}

        {salida.descartados.map((d, i) => (
          <LoteDescartado key={i} lote={d.lote} razon={d.razon} />
        ))}

        {salida.pregunta && (
          <View style={estilos.cajaPregunta}>
            <Text style={estilos.etiquetaPregunta}>Una pregunta (opcional)</Text>
            <Text style={estilos.pregunta}>{salida.pregunta}</Text>
            <TextInput
              style={estilos.inputPregunta}
              accessibilityLabel="Tu respuesta a la pregunta, opcional"
              value={respuesta}
              onChangeText={(t) => { setTocado(true); setRespuesta(t); }}
              placeholder="Podés dejarlo así y guardar igual"
              placeholderTextColor={color.textoTenue}
              multiline
            />
          </View>
        )}

        {error && (
          <Text style={estilos.error} accessibilityLiveRegion="polite">
            No se pudo guardar: {error}
          </Text>
        )}
      </ScrollView>

      <View style={estilos.pie}>
        <Text style={estilos.notaPie}>Nada se guarda hasta que confirmás.</Text>
        <View style={estilos.filaBotones}>
          <Pressable
            style={estilos.botonSecundario}
            onPress={intentarVolver}
            disabled={guardando}
            accessibilityRole="button"
          >
            <Text style={estilos.textoBotonSecundario} numberOfLines={2}>Editar nota</Text>
          </Pressable>
          <Pressable
            style={[estilos.botonPrimario, guardando && estilos.botonDeshabilitado]}
            onPress={confirmar}
            disabled={guardando}
            accessibilityRole="button"
            accessibilityState={{ disabled: guardando, busy: guardando }}
          >
            <Text style={estilos.textoBotonPrimario} numberOfLines={2}>
              {guardando ? 'Guardando…' : 'Confirmar y guardar'}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1 },
  scroll: { padding: espacio.lg, paddingBottom: espacio.xxl },
  resumen: { ...tipografia.cuerpo, color: color.textoTenue, marginTop: espacio.xs, marginBottom: espacio.lg },
  cajaVacio: {
    backgroundColor: color.superficieHundida, borderRadius: radio.lg,
    padding: espacio.lg, marginBottom: espacio.lg,
  },
  textoVacio: { ...tipografia.cuerpo, color: color.texto },
  cajaPregunta: {
    backgroundColor: color.advertenciaFondo, borderRadius: radio.lg,
    padding: espacio.lg, marginTop: espacio.sm, gap: espacio.sm,
  },
  etiquetaPregunta: { ...tipografia.etiqueta, color: color.reportado },
  pregunta: { ...tipografia.cuerpo, fontWeight: '600', color: color.texto },
  inputPregunta: {
    ...tipografia.cuerpo,
    minHeight: 48, borderWidth: 1.5, borderColor: color.borde, borderRadius: radio.md,
    paddingHorizontal: espacio.md, paddingVertical: espacio.sm,
    color: color.texto, backgroundColor: color.superficie,
  },
  error: { ...tipografia.secundario, color: color.peligro, marginTop: espacio.md },
  pie: {
    padding: espacio.lg, borderTopWidth: 1, borderTopColor: color.borde, backgroundColor: color.superficie,
  },
  notaPie: { ...tipografia.pequeno, color: color.textoTenue, textAlign: 'center', marginBottom: espacio.sm },
  filaBotones: { flexDirection: 'row', gap: espacio.md },
  botonSecundario: {
    flex: 1, minHeight: tap.grande, borderRadius: radio.lg, borderWidth: 1.5, borderColor: color.borde,
    alignItems: 'center', justifyContent: 'center',
  },
  textoBotonSecundario: { ...tipografia.accion, color: color.texto },
  botonPrimario: {
    flex: 2, minHeight: tap.grande, borderRadius: radio.lg, backgroundColor: color.primario,
    alignItems: 'center', justifyContent: 'center',
  },
  botonDeshabilitado: { opacity: 0.6 },
  textoBotonPrimario: { ...tipografia.accion, color: color.primarioTexto },
});
