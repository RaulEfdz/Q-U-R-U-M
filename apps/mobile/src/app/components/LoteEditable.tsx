import { StyleSheet, Text, TextInput, View } from 'react-native';
import { MARCAS_DUMMY, MODALIDADES, NATURALEZAS, type Observacion } from '../../core/contracts.ts';
import { color, espacio, radio, tipografia } from '../theme.ts';
import { InsigniaNaturaleza } from './InsigniaNaturaleza.tsx';
import { SelectorChips } from './SelectorChips.tsx';

/**
 * Bug #14 del server, no repetir acá: la revisión tiene que ser
 * "confirma, corrige o descarta" — si el modelo dijo "3 resonadores" y
 * eran 2, el usuario tiene que poder arreglarlo ACÁ, antes de confirmar.
 * Todo excepto `evidencia` es editable — la evidencia es el registro de
 * auditoría de lo que el extractor citó y ya pasó el verificador
 * determinista; editarla después rompería el enlace evidencia↔verificación.
 */
export function LoteEditable({
  obs, onCambiar,
}: {
  obs: Observacion;
  onCambiar: (siguiente: Observacion) => void;
}) {
  const edadEsRango = Array.isArray(obs.lote.edadAnios);

  return (
    <View style={estilos.tarjeta}>
      <View style={estilos.encabezado}>
        <Text style={tipografia.subtitulo}>Lote</Text>
        <InsigniaNaturaleza naturaleza={obs.naturaleza} />
      </View>

      <Text style={estilos.etiqueta}>Modalidad</Text>
      <SelectorChips
        opciones={MODALIDADES}
        valor={obs.lote.modalidad}
        onCambiar={(modalidad) => onCambiar({ ...obs, lote: { ...obs.lote, modalidad } })}
      />

      <View style={estilos.filaCampos}>
        <View style={estilos.campoCorto}>
          <Text style={estilos.etiqueta}>Cantidad</Text>
          <TextInput
            style={estilos.input}
            keyboardType="number-pad"
            value={obs.lote.cantidad !== undefined ? String(obs.lote.cantidad) : ''}
            placeholder="1"
            placeholderTextColor={color.textoTenue}
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
            <Text style={estilos.textoRango}>
              {(obs.lote.edadAnios as [number, number]).join('–')} · rango, no editable
            </Text>
          ) : (
            <TextInput
              style={estilos.input}
              keyboardType="number-pad"
              value={obs.lote.edadAnios !== undefined ? String(obs.lote.edadAnios) : ''}
              placeholder="—"
              placeholderTextColor={color.textoTenue}
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
        opciones={MARCAS_DUMMY}
        valor={obs.lote.marca as (typeof MARCAS_DUMMY)[number] | undefined}
        onCambiar={(marca) => onCambiar({ ...obs, lote: { ...obs.lote, marca } })}
      />
      <TextInput
        style={estilos.input}
        value={obs.lote.marca ?? ''}
        placeholder="Marca (si no está en la lista)"
        placeholderTextColor={color.textoTenue}
        onChangeText={(marca) => onCambiar({ ...obs, lote: { ...obs.lote, marca: marca || undefined } })}
      />

      <Text style={estilos.etiqueta}>Modelo (opcional)</Text>
      <TextInput
        style={estilos.input}
        value={obs.lote.modelo ?? ''}
        placeholder="—"
        placeholderTextColor={color.textoTenue}
        onChangeText={(modelo) => onCambiar({ ...obs, lote: { ...obs.lote, modelo: modelo || undefined } })}
      />

      <Text style={estilos.etiqueta}>Naturaleza del testimonio</Text>
      <SelectorChips
        opciones={NATURALEZAS}
        valor={obs.naturaleza}
        onCambiar={(naturaleza) => onCambiar({ ...obs, naturaleza })}
      />

      <Text style={estilos.etiquetaEvidencia}>Evidencia citada en tu nota</Text>
      <View style={estilos.cajaEvidencia}>
        <Text style={estilos.evidencia}>“{obs.evidencia}”</Text>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  tarjeta: {
    backgroundColor: color.superficie, borderRadius: radio.lg, borderWidth: 1,
    borderColor: color.borde, padding: espacio.lg, marginBottom: espacio.md, gap: espacio.sm,
  },
  encabezado: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  etiqueta: { ...tipografia.etiqueta, color: color.textoTenue, marginTop: espacio.sm },
  filaCampos: { flexDirection: 'row', gap: espacio.md },
  campoCorto: { flex: 1 },
  input: {
    minHeight: 48, borderWidth: 1.5, borderColor: color.borde, borderRadius: radio.md,
    paddingHorizontal: espacio.md, fontSize: 16, color: color.texto, backgroundColor: color.superficie,
    marginTop: 4,
  },
  textoRango: { fontSize: 15, color: color.textoTenue, marginTop: 4 },
  etiquetaEvidencia: { ...tipografia.etiqueta, color: color.textoTenue, marginTop: espacio.md },
  cajaEvidencia: {
    backgroundColor: color.superficieHundida, borderRadius: radio.md,
    padding: espacio.md, marginTop: 4,
  },
  evidencia: { fontSize: 14, fontStyle: 'italic', color: color.textoTenue },
});
