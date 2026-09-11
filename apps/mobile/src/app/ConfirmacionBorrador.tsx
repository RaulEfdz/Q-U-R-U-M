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
import { Icono } from './components/Icono.tsx';
import { LoteEditable } from './components/LoteEditable.tsx';
import { LoteDescartado } from './components/LoteDescartado.tsx';
import { color, elevacion, espacio, radio, tap, tipografia } from './theme.ts';

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

/** Pastilla del índice: cuántos lotes, cuántos descartados, cuántas
 *  preguntas. Se lee antes de bajar — dice qué tan larga es la revisión. */
function PastillaIndice({ tinta, children }: { tinta: string; children: string }) {
  return (
    <View style={estilos.pastilla}>
      <View style={[estilos.pastillaPunto, { backgroundColor: tinta }]} />
      <Text style={estilos.pastillaTexto}>{children}</Text>
    </View>
  );
}

export function ConfirmacionBorrador({
  salida, nota, onConfirmado, onVolver,
}: {
  salida: SalidaPipeline;
  nota: string;
  onConfirmado: (r: {
    estadoRevision: EstadoRevision;
    guardadas: number;
    observaciones: Observacion[];
  }) => void;
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

      onConfirmado({ estadoRevision, guardadas, observaciones: finales });
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
        <Text style={estilos.titulo} accessibilityRole="header">Revisá antes de guardar</Text>
        <Text style={estilos.bajada}>
          El teléfono propuso esto a partir de tu nota. Vos decidís qué se guarda.
        </Text>

        {/* Índice de lo que hay abajo. En el caso vacío no hay nada que
            contar y el resumen textual —que conserva la nota literal— es lo
            único que queda de la visita: ahí va ese, no las pastillas. */}
        {vacio ? (
          <Text style={estilos.resumen}>{resumen}</Text>
        ) : (
          <View style={estilos.indice}>
            <PastillaIndice tinta={color.primario}>
              {`${observaciones.length} lote${observaciones.length === 1 ? '' : 's'}`}
            </PastillaIndice>
            {salida.descartados.length > 0 ? (
              <PastillaIndice tinta={color.peligro}>
                {`${salida.descartados.length} descartado${salida.descartados.length === 1 ? '' : 's'}`}
              </PastillaIndice>
            ) : null}
            {salida.pregunta ? (
              <PastillaIndice tinta={color.reportado}>1 pregunta</PastillaIndice>
            ) : null}
          </View>
        )}

        {vacio && (
          <View style={estilos.cajaVacio}>
            <Text style={estilos.textoVacio}>
              Visitaste el sitio y no se observó equipo. Es un dato válido — se
              guarda así, sin ningún lote.
            </Text>
          </View>
        )}

        {observaciones.map((o, i) => (
          <LoteEditable key={i} obs={o} indice={i + 1} onCambiar={(sig) => actualizar(i, sig)} />
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
              placeholder="Escribí tu respuesta…"
              placeholderTextColor={color.sinDatosTinta}
              multiline
            />
            <Text style={estilos.pista}>Podés guardar sin responder.</Text>
          </View>
        )}

        {error && (
          <Text style={estilos.error} accessibilityLiveRegion="polite">
            No se pudo guardar: {error}
          </Text>
        )}
      </ScrollView>

      <View style={estilos.pie}>
        <View style={estilos.notaPie}>
          <Icono nombre="candado" tamano={13} color={color.textoTenue} />
          <Text style={estilos.notaPieTexto}>Nada se guarda hasta que confirmás.</Text>
        </View>
        <View style={estilos.filaBotones}>
          <Pressable
            style={[estilos.botonSecundario, guardando && estilos.botonDeshabilitado]}
            onPress={intentarVolver}
            disabled={guardando}
            accessibilityRole="button"
            accessibilityState={{ disabled: guardando }}
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
            <Icono nombre="chequeo" tamano={19} color={color.primarioTexto} />
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
  contenedor: { flex: 1, backgroundColor: color.fondo },
  scroll: { padding: espacio.lg, paddingTop: espacio.xl, paddingBottom: espacio.lg },
  titulo: { ...tipografia.titulo, color: color.texto },
  bajada: {
    ...tipografia.cuerpo, fontSize: 15, lineHeight: 21,
    color: color.textoTenue, marginTop: 5,
  },
  resumen: { ...tipografia.cuerpo, color: color.textoTenue, marginTop: espacio.md, marginBottom: espacio.lg },

  indice: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: espacio.md, marginBottom: espacio.xl },
  pastilla: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingLeft: 9, paddingRight: 11,
    backgroundColor: color.superficie, borderRadius: radio.pastilla,
    borderWidth: 1, borderColor: color.bordeSutil, ...elevacion.sutil,
  },
  pastillaPunto: { width: 7, height: 7, borderRadius: radio.pastilla },
  pastillaTexto: {
    ...tipografia.pequeno, fontWeight: '600', color: color.textoTenue,
    fontVariant: ['tabular-nums'],
  },

  cajaVacio: {
    backgroundColor: color.superficie, borderRadius: radio.xl,
    borderWidth: 1, borderColor: color.bordeSutil,
    padding: espacio.lg, marginBottom: espacio.lg, ...elevacion.tarjeta,
  },
  textoVacio: { ...tipografia.cuerpo, color: color.texto, lineHeight: 22 },

  cajaPregunta: {
    backgroundColor: color.advertenciaFondo, borderRadius: radio.xl,
    borderWidth: 1, borderColor: 'rgba(145,96,0,0.2)',
    padding: espacio.lg, gap: espacio.sm,
    ...elevacion.tarjeta, shadowColor: color.reportadoTinta, shadowOpacity: 0.24,
  },
  etiquetaPregunta: { ...tipografia.overline, color: color.reportadoTinta },
  pregunta: { ...tipografia.subtitulo, fontWeight: '700', color: color.texto, lineHeight: 23 },
  inputPregunta: {
    ...tipografia.cuerpo,
    minHeight: tap.normal, borderWidth: 1, borderColor: 'rgba(145,96,0,0.18)', borderRadius: radio.md,
    paddingHorizontal: espacio.lg - 2, paddingVertical: espacio.md - 2,
    color: color.texto, backgroundColor: color.superficie,
  },
  pista: { ...tipografia.pequeno, color: color.reportadoTinta },

  error: { ...tipografia.secundario, color: color.peligro, marginTop: espacio.md },

  pie: {
    paddingHorizontal: espacio.lg, paddingTop: espacio.md, paddingBottom: espacio.xl,
    borderTopWidth: 1, borderTopColor: color.bordeSutil, backgroundColor: color.fondo,
    gap: 11,
  },
  notaPie: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  notaPieTexto: { ...tipografia.pequeno, color: color.textoTenue },
  filaBotones: { flexDirection: 'row', gap: espacio.md },
  botonSecundario: {
    flex: 1, minHeight: tap.grande, borderRadius: radio.pastilla, borderWidth: 1.5,
    borderColor: color.borde, backgroundColor: color.superficie,
    alignItems: 'center', justifyContent: 'center', ...elevacion.sutil,
  },
  textoBotonSecundario: { fontSize: 16, fontWeight: '700', color: color.texto },
  botonPrimario: {
    flex: 2, minHeight: tap.grande, borderRadius: radio.pastilla, backgroundColor: color.primario,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    paddingHorizontal: espacio.md, ...elevacion.primaria,
  },
  botonDeshabilitado: { opacity: 0.5, shadowOpacity: 0, elevation: 0 },
  textoBotonPrimario: { ...tipografia.accion, color: color.primarioTexto, letterSpacing: 0.2 },
});
