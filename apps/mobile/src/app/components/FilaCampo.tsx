import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CampoResuelto, EstadoCampo } from '../../core/contracts.ts';
import { color, espacio, radio, tipografia } from '../theme.ts';
import { etiquetaDe, type Testigo } from '../testigos.ts';
import { colorEstado, InsigniaQuorum } from './InsigniaQuorum.tsx';

/** `clusters[].valor` es `unknown` en los contratos y `valor` es genérico:
 *  el formateo tiene que tolerar número, tupla de rango, string o ausencia. */
export function formatearValor(valor: unknown): string {
  if (valor === undefined || valor === null) return '—';
  if (Array.isArray(valor) && valor.length === 2) return `${valor[0]}–${valor[1]}`;
  return String(valor);
}

function testigosTexto(n: number): string {
  return n === 1 ? '1 testigo' : `${n} testigos`;
}

/** Frescura es un eje DISTINTO del estado de confianza. Confundirlos es el
 *  error de diseño más fácil en esta pantalla (doc maestro §B.2), así que
 *  nunca se pinta con el color del estado: va como texto aparte. */
function textoFrescura(campo: CampoResuelto<unknown>): string | null {
  if (campo.estado === 'Sin datos' || campo.fresco) return null;
  if (campo.ultimaVisita === 'nunca') return null;
  const dias = Math.floor((Date.now() - new Date(campo.ultimaVisita).getTime()) / 86_400_000);
  const meses = Math.floor(dias / 30);
  return meses >= 1
    ? `sin verificar desde hace ${meses} mes${meses === 1 ? '' : 'es'}`
    : `sin verificar desde hace ${dias} días`;
}

/**
 * Una fila de la tabla de confianza por campo. Dos líneas, no cuatro
 * columnas: en un teléfono la tabla del mockup de escritorio no cabe sin
 * achicar la tipografía por debajo de lo legible al sol (ver `theme.ts`).
 *
 * Cuando el campo está en `Sin quórum` las versiones en conflicto se
 * muestran SIEMPRE, no detrás de un tap: es la pieza central de la tesis
 * del proyecto — el sistema no promedia ni elige, muestra ambas y quién
 * dijo cada una. Esconderla la convertiría en un detalle.
 */
export const FilaCampo = memo(function FilaCampo({
  nombre, campo, testigos, sangrada = false,
}: {
  nombre: string;
  campo: CampoResuelto<unknown>;
  testigos: Map<string, Testigo>;
  sangrada?: boolean;
}) {
  const valor = campo.rango
    ? formatearValor(campo.rango)
    : formatearValor(campo.valor);
  const frescura = textoFrescura(campo);
  const esConflicto = campo.estado === 'Sin quórum';

  return (
    <View style={[
      estilos.fila,
      { borderLeftColor: colorEstado(campo.estado) },
      sangrada && estilos.filaSangrada,
      esConflicto && estilos.filaConflicto,
    ]}>
      <View style={estilos.cabecera}>
        <Text style={[estilos.nombre, sangrada && estilos.nombreSangrado]} numberOfLines={1}>
          {nombre}
        </Text>
        <Text style={estilos.valor} numberOfLines={2}>
          {esConflicto ? 'en disputa' : valor}
        </Text>
      </View>

      <View style={estilos.meta}>
        <InsigniaQuorum estado={campo.estado} />
        {campo.estado !== 'Sin datos' && (
          <Text style={estilos.textoMeta}>{testigosTexto(campo.observadores.length)}</Text>
        )}
      </View>

      {frescura && <Text style={estilos.frescura}>{frescura}</Text>}

      {esConflicto && campo.clusters && (
        <View style={estilos.conflicto}>
          <Text style={estilos.conflictoTitulo}>
            No se promedia. Cada versión con quién la dijo:
          </Text>
          {campo.clusters.map((c, i) => (
            <View key={i} style={estilos.version}>
              <Text style={estilos.versionValor}>{formatearValor(c.valor)}</Text>
              <Text style={estilos.versionQuien}>
                {c.observadores.map((id) => etiquetaDe(testigos, id)).join(', ')}
              </Text>
            </View>
          ))}
          <Text style={estilos.conflictoPie}>
            Hace falta una visita más para resolverlo.
          </Text>
        </View>
      )}
    </View>
  );
});

/** Igual que `FilaCampo` pero para una cohorte (H-02): el valor lo compone
 *  la pantalla (`2 uds · 7–8 años`), no sale de un `CampoResuelto`. */
export const FilaCohorte = memo(function FilaCohorte({
  valor, estado, cantidadObservadores, anioInstalacion,
}: {
  valor: string;
  estado: EstadoCampo;
  cantidadObservadores: number;
  anioInstalacion?: number;
}) {
  return (
    <View style={[estilos.fila, estilos.filaSangrada, { borderLeftColor: colorEstado(estado) }]}>
      <View style={estilos.cabecera}>
        <Text style={[estilos.nombre, estilos.nombreSangrado]} numberOfLines={1}>— cohorte</Text>
        <Text style={estilos.valor} numberOfLines={2}>{valor}</Text>
      </View>
      <View style={estilos.meta}>
        <InsigniaQuorum estado={estado} />
        <Text style={estilos.textoMeta}>{testigosTexto(cantidadObservadores)}</Text>
        {anioInstalacion !== undefined && (
          <Text style={estilos.textoMeta}>· instaladas ≈{anioInstalacion}</Text>
        )}
      </View>
    </View>
  );
});

const estilos = StyleSheet.create({
  fila: {
    borderLeftWidth: 4, backgroundColor: color.superficie,
    paddingVertical: espacio.sm, paddingHorizontal: espacio.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.borde,
    gap: espacio.xs,
  },
  filaSangrada: { backgroundColor: color.superficieHundida },
  filaConflicto: { backgroundColor: color.sinQuorumFondo },
  cabecera: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: espacio.sm },
  // El nombre del campo no se achica: si algo tiene que truncar es el valor
  // (que además se puede editar en la pantalla de confirmación).
  nombre: { ...tipografia.etiqueta, color: color.texto, flexShrink: 0 },
  nombreSangrado: { color: color.textoTenue },
  // `fontVariant` tabular: las columnas de cifras se alinean entre filas.
  valor: {
    ...tipografia.cuerpo, fontWeight: '700', color: color.texto,
    flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'],
  },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: espacio.sm },
  textoMeta: { ...tipografia.pequeno, color: color.textoTenue },
  /*
   * ★ La frescura NO lleva un color de la rampa de quórum. Estaba en
   * `color.reportado`, y eso rompía dos cosas a la vez: se leía como el
   * estado «Reportado» — el cruce de ejes que el propio proyecto marca como
   * el error de diseño más fácil de cometer acá — y encima ese ocre da
   * 2.76:1 sobre el fondo hundido, en texto de 12px, en una app que se usa a
   * sol directo. Va en tinta neutra con su propio peso, igual que en la UI
   * de escritorio.
   */
  frescura: { ...tipografia.pequeno, color: color.texto, fontWeight: '700' },
  conflicto: {
    marginTop: espacio.xs, padding: espacio.sm, gap: espacio.xs,
    backgroundColor: color.superficie, borderRadius: radio.sm,
    borderWidth: 1, borderColor: color.sinQuorum,
  },
  conflictoTitulo: { ...tipografia.pequeno, fontWeight: '700', color: color.sinQuorum },  /* 4.84:1, pasa */
  version: { flexDirection: 'row', alignItems: 'baseline', gap: espacio.sm },
  versionValor: {
    ...tipografia.cuerpo, fontWeight: '700', color: color.texto,
    minWidth: 56, fontVariant: ['tabular-nums'],
  },
  versionQuien: { ...tipografia.pequeno, color: color.textoTenue, flex: 1 },
  conflictoPie: { ...tipografia.pequeno, color: color.textoTenue, fontStyle: 'italic' },
});
