import { StyleSheet, Text, View } from 'react-native';
import type { Observacion } from '../../core/contracts.ts';
import { color, espacio, radio, tipografia } from '../theme.ts';

/**
 * `EVIDENCIA_FABRICADA`: el lote se MARCA, no se borra — queda visible con
 * el motivo, para que el usuario entienda por qué no llegó al borrador
 * confirmable. No editable: la evidencia ya falló el verificador
 * determinista, y reescribirla acá no arregla la afirmación subyacente
 * (mobile CLAUDE.md — el verificador es la pieza anti-fabricación).
 */
export function LoteDescartado({ lote, razon }: { lote: Observacion; razon: string }) {
  return (
    <View style={estilos.tarjeta}>
      <View style={estilos.encabezado}>
        <Text style={estilos.marca}>⚠ Sin respaldo en la nota</Text>
      </View>
      <Text style={estilos.resumen}>
        {lote.lote.cantidad ?? '?'} × {lote.lote.modalidad}
        {lote.lote.marca ? ` · ${lote.lote.marca}` : ''}
      </Text>
      <Text style={estilos.razon}>{razon}</Text>
      <View style={estilos.cajaEvidencia}>
        <Text style={estilos.evidencia}>“{lote.evidencia}”</Text>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  tarjeta: {
    backgroundColor: color.peligroFondo, borderRadius: radio.lg, borderWidth: 1.5,
    borderColor: color.peligro, padding: espacio.lg, marginBottom: espacio.md, gap: espacio.xs,
  },
  encabezado: { flexDirection: 'row', justifyContent: 'space-between' },
  marca: { ...tipografia.etiqueta, color: color.peligro },
  resumen: { ...tipografia.cuerpo, fontWeight: '600', color: color.texto },
  razon: { fontSize: 13, color: color.peligro },
  cajaEvidencia: { backgroundColor: color.superficie, borderRadius: radio.md, padding: espacio.md, marginTop: 4 },
  evidencia: { fontSize: 14, fontStyle: 'italic', color: color.textoTenue },
});
