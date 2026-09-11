import { StyleSheet, Text, View } from 'react-native';
import type { Observacion } from '../../core/contracts.ts';
import { color, elevacion, espacio, radio, tipografia } from '../theme.ts';
import { Icono } from './Icono.tsx';

/**
 * `EVIDENCIA_FABRICADA`: el lote se MARCA, no se borra — queda visible con
 * el motivo, para que el usuario entienda por qué no llegó al borrador
 * confirmable. No editable: la evidencia ya falló el verificador
 * determinista, y reescribirla acá no arregla la afirmación subyacente
 * (mobile CLAUDE.md — el verificador es la pieza anti-fabricación).
 *
 * Misma anatomía que `LoteEditable` (mosaico, qué es, sello a la derecha)
 * en la paleta de peligro: se lee como el mismo tipo de cosa, no como un
 * bloque de error ajeno a la lista.
 */
export function LoteDescartado({ lote, razon }: { lote: Observacion; razon: string }) {
  return (
    <View style={estilos.tarjeta}>
      <View style={estilos.encabezado}>
        <View style={estilos.mosaico}>
          <Icono nombre="alerta" tamano={22} color={color.peligro} />
        </View>
        <View style={estilos.encabezadoTextos}>
          <Text style={estilos.titulo} accessibilityRole="header">
            {lote.lote.cantidad ?? '?'} × {lote.lote.modalidad}
          </Text>
          {lote.lote.marca ? <Text style={estilos.sub}>{lote.lote.marca}</Text> : null}
        </View>
        <View style={estilos.sello} accessibilityLabel="No se guardó: sin respaldo en la nota">
          <Text style={estilos.selloTexto}>No se guardó</Text>
        </View>
      </View>

      <Text style={estilos.explicacion}>
        El extractor citó este fragmento como prueba, pero no aparece así en tu
        nota — pudo haberlo inventado.
      </Text>
      <View style={estilos.cajaEvidencia}>
        <Text style={estilos.evidencia}>“{lote.evidencia}”</Text>
      </View>
      <View style={estilos.filaChequeo}>
        <Icono nombre="falla" tamano={14} color={color.peligro} />
        <Text style={estilos.razon}>Chequeo que falló: {razon}</Text>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  tarjeta: {
    backgroundColor: color.peligroFondo, borderRadius: radio.xl, borderWidth: 1,
    borderColor: 'rgba(176,65,62,0.22)', padding: espacio.lg, marginBottom: espacio.lg,
    gap: espacio.md, ...elevacion.tarjeta, shadowColor: color.peligro, shadowOpacity: 0.28,
  },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: espacio.md },
  mosaico: {
    width: 44, height: 44, borderRadius: 13, backgroundColor: 'rgba(176,65,62,0.11)',
    alignItems: 'center', justifyContent: 'center',
  },
  encabezadoTextos: { flex: 1, minWidth: 0, gap: 2 },
  titulo: { ...tipografia.subtitulo, fontWeight: '700', color: color.denegado },
  sub: { ...tipografia.etiqueta, fontWeight: '400', color: color.denegado, opacity: 0.8 },
  sello: {
    paddingVertical: 7, paddingHorizontal: 11, borderRadius: radio.pastilla,
    backgroundColor: color.superficie, borderWidth: 1, borderColor: 'rgba(176,65,62,0.24)',
  },
  selloTexto: { ...tipografia.pequeno, fontWeight: '700', color: color.peligro },
  explicacion: { ...tipografia.secundario, color: color.texto, lineHeight: 20 },
  cajaEvidencia: {
    backgroundColor: color.superficie, borderRadius: radio.md,
    borderLeftWidth: 3, borderLeftColor: color.peligro,
    paddingHorizontal: espacio.lg - 2, paddingVertical: espacio.md,
  },
  evidencia: { ...tipografia.secundario, fontStyle: 'italic', color: color.textoTenue, lineHeight: 20 },
  filaChequeo: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  razon: { ...tipografia.pequeno, flex: 1, color: color.denegado },
});
