import { StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { MARCAS_DUMMY, MODALIDADES, NATURALEZAS, type Observacion } from '../../core/contracts.ts';
import { color, elevacion, espacio, radio, tap, tipografia } from '../theme.ts';
import { Icono, ICONO_MODALIDAD } from './Icono.tsx';
import { InsigniaNaturaleza } from './InsigniaNaturaleza.tsx';
import { SelectorChips } from './SelectorChips.tsx';

/** Separador de rubro: rótulo corto + filete hasta el borde. Parte la
 *  tarjeta en tres preguntas ("qué es", "qué tan seguro estás", "con qué
 *  evidencia") en vez de nueve campos seguidos. */
function Rubro({ children }: { children: string }) {
  return (
    <View style={estilos.rubro} accessible accessibilityRole="header">
      <Text style={estilos.rubroTexto}>{children}</Text>
      <View style={estilos.rubroLinea} />
    </View>
  );
}

function edadLegible(edad: Observacion['lote']['edadAnios']): string {
  if (edad === undefined) return 'edad sin dato';
  return Array.isArray(edad) ? `${edad.join('–')} años` : `${edad} años`;
}

/**
 * Bug #14 del server, no repetir acá: la revisión tiene que ser
 * "confirma, corrige o descarta" — si el modelo dijo "3 resonadores" y
 * eran 2, el usuario tiene que poder arreglarlo ACÁ, antes de confirmar.
 * Todo excepto `evidencia` es editable — la evidencia es el registro de
 * auditoría de lo que el extractor citó y ya pasó el verificador
 * determinista; editarla después rompería el enlace evidencia↔verificación.
 *
 * La tarjeta abre con QUÉ ES ("2 × MR · NovaMed · 5 años"), no con "Lote 1":
 * el ordinal es cómo lo numeró el sistema y no le dice nada a quien está
 * revisando; el equipo sí. El ordinal queda arriba, en chico, solo para
 * poder referirse a una tarjeta cuando hay varias.
 */
export function LoteEditable({
  obs, indice, onCambiar,
}: {
  obs: Observacion;
  /** Posición en el borrador, base 1. Solo para rotular la tarjeta. */
  indice: number;
  onCambiar: (siguiente: Observacion) => void;
}) {
  const edadEsRango = Array.isArray(obs.lote.edadAnios);

  // "Cantidad" y "Edad" van lado a lado, pero en un teléfono angosto —o con
  // la fuente del sistema grande— las dos etiquetas no entran en media
  // pantalla y se parten. Debajo de ~360 dp se apilan a lo ancho.
  const { width } = useWindowDimensions();
  const apilarCampos = width < 360;

  return (
    <View style={estilos.tarjeta}>
      <Text style={estilos.ordinal}>Lote {indice}</Text>

      <View style={estilos.encabezado}>
        <View style={estilos.mosaico}>
          <Icono nombre={ICONO_MODALIDAD[obs.lote.modalidad]} tamano={24} color={color.primario} />
        </View>
        <View style={estilos.encabezadoTextos}>
          <Text style={estilos.tituloLote} accessibilityRole="header">
            {obs.lote.cantidad ?? 1} × {obs.lote.modalidad}
          </Text>
          <Text style={estilos.subLote} numberOfLines={2}>
            {[obs.lote.marca, edadLegible(obs.lote.edadAnios)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <InsigniaNaturaleza naturaleza={obs.naturaleza} />
      </View>

      <Rubro>Qué es</Rubro>

      <Text style={estilos.etiqueta}>Modalidad</Text>
      <SelectorChips
        etiquetaGrupo="Modalidad"
        opciones={MODALIDADES}
        valor={obs.lote.modalidad}
        onCambiar={(modalidad) => onCambiar({ ...obs, lote: { ...obs.lote, modalidad } })}
      />

      <View style={[estilos.filaCampos, apilarCampos && estilos.filaCamposApilada]}>
        <View style={estilos.campoCorto}>
          <Text style={estilos.etiqueta}>Cantidad</Text>
          <TextInput
            style={estilos.input}
            accessibilityLabel="Cantidad de unidades"
            keyboardType="number-pad"
            value={obs.lote.cantidad !== undefined ? String(obs.lote.cantidad) : ''}
            placeholder="1"
            placeholderTextColor={color.sinDatosTinta}
            onChangeText={(t) => {
              const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
              onCambiar({
                ...obs,
                lote: { ...obs.lote, cantidad: Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : undefined },
              });
            }}
          />
        </View>

        <View style={estilos.campoCorto}>
          <Text style={estilos.etiqueta}>Edad (años)</Text>
          {edadEsRango ? (
            <View style={[estilos.input, estilos.inputInerte]}>
              <Text style={estilos.textoRango}>
                {(obs.lote.edadAnios as [number, number]).join('–')} · rango, no editable
              </Text>
            </View>
          ) : (
            <TextInput
              style={estilos.input}
              accessibilityLabel="Edad en años"
              keyboardType="number-pad"
              value={obs.lote.edadAnios !== undefined ? String(obs.lote.edadAnios) : ''}
              placeholder="—"
              placeholderTextColor={color.sinDatosTinta}
              onChangeText={(t) => {
                const limpio = t.replace(/[^0-9]/g, '');
                const n = limpio ? Math.min(60, parseInt(limpio, 10)) : undefined;
                onCambiar({ ...obs, lote: { ...obs.lote, edadAnios: n } });
              }}
            />
          )}
        </View>
      </View>

      <Text style={estilos.etiqueta}>Marca</Text>
      <SelectorChips
        etiquetaGrupo="Marca"
        opciones={MARCAS_DUMMY}
        valor={obs.lote.marca as (typeof MARCAS_DUMMY)[number] | undefined}
        onCambiar={(marca) => onCambiar({ ...obs, lote: { ...obs.lote, marca } })}
      />
      <TextInput
        style={estilos.input}
        accessibilityLabel="Marca, si no está en la lista de arriba"
        value={obs.lote.marca ?? ''}
        placeholder="Otra marca…"
        placeholderTextColor={color.sinDatosTinta}
        onChangeText={(marca) => onCambiar({ ...obs, lote: { ...obs.lote, marca: marca || undefined } })}
      />

      <Text style={estilos.etiqueta}>Modelo (opcional)</Text>
      <TextInput
        style={estilos.input}
        accessibilityLabel="Modelo del equipo, opcional"
        value={obs.lote.modelo ?? ''}
        placeholder="—"
        placeholderTextColor={color.sinDatosTinta}
        onChangeText={(modelo) => onCambiar({ ...obs, lote: { ...obs.lote, modelo: modelo || undefined } })}
      />

      <Rubro>Qué tan seguro estás</Rubro>
      <Text style={estilos.etiqueta}>Naturaleza del testimonio</Text>
      <SelectorChips
        etiquetaGrupo="Naturaleza del testimonio"
        opciones={NATURALEZAS}
        valor={obs.naturaleza}
        onCambiar={(naturaleza) => onCambiar({ ...obs, naturaleza })}
      />

      <Rubro>Evidencia en tu nota</Rubro>
      <View style={estilos.cajaEvidencia}>
        <Text style={estilos.evidencia}>“{obs.evidencia}”</Text>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  tarjeta: {
    backgroundColor: color.superficie, borderRadius: radio.xl, borderWidth: 1,
    borderColor: color.bordeSutil, padding: espacio.lg, marginBottom: espacio.lg,
    ...elevacion.tarjeta,
  },
  ordinal: { ...tipografia.overline, color: color.sinDatosTinta, marginBottom: espacio.md },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: espacio.md },
  mosaico: {
    width: 44, height: 44, borderRadius: 13, backgroundColor: color.primarioTinte,
    alignItems: 'center', justifyContent: 'center',
  },
  encabezadoTextos: { flex: 1, minWidth: 0, gap: 2 },
  tituloLote: { fontSize: 19, fontWeight: '700', color: color.texto, fontVariant: ['tabular-nums'] },
  subLote: { ...tipografia.etiqueta, fontWeight: '400', color: color.textoTenue, lineHeight: 16 },

  rubro: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm, marginTop: espacio.lg },
  rubroTexto: { ...tipografia.overline, color: color.textoTenue },
  rubroLinea: { flex: 1, height: 1, backgroundColor: color.bordeSutil },

  etiqueta: { ...tipografia.etiqueta, color: color.texto, marginTop: espacio.md },
  filaCampos: { flexDirection: 'row', gap: espacio.md },
  filaCamposApilada: { flexDirection: 'column' },
  // `minWidth: 0` deja que el campo se achique por debajo de su contenido en
  // la fila (si no, dos inputs lado a lado desbordan); apilado, `alignItems`
  // por defecto (`stretch`) lo lleva a ancho completo.
  campoCorto: { flex: 1, minWidth: 0 },
  // Campo HUNDIDO, no otra caja con contorno: en una tarjeta blanca elevada
  // el dato editable se lee mejor como un hueco que como un recuadro más.
  // `minHeight` garantiza el objetivo táctil a escala de fuente 1.0;
  // `paddingVertical` deja que la caja crezca sin que el texto toque el borde
  // cuando la fuente del sistema está en grande.
  input: {
    ...tipografia.cuerpo,
    minHeight: tap.normal, borderWidth: 1, borderColor: color.bordeSutil, borderRadius: radio.md,
    paddingHorizontal: espacio.lg - 2, paddingVertical: espacio.sm,
    color: color.texto, backgroundColor: color.fondo,
    fontVariant: ['tabular-nums'], marginTop: espacio.sm,
  },
  inputInerte: { justifyContent: 'center' },
  textoRango: { ...tipografia.secundario, color: color.textoTenue },

  cajaEvidencia: {
    backgroundColor: color.primarioTinteSuave, borderRadius: radio.md,
    borderLeftWidth: 3, borderLeftColor: color.primario,
    paddingHorizontal: espacio.lg - 2, paddingVertical: espacio.md, marginTop: espacio.md,
  },
  evidencia: { ...tipografia.secundario, fontStyle: 'italic', color: color.texto, lineHeight: 20 },
});
