import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  SectionList, StyleSheet, Text, View,
} from 'react-native';
import type { GrupoEquipo, Observacion } from '../core/contracts.ts';
import { reconciliar } from '../trust/reconcile.ts';
import { cargar, diagnosticoUltimaCarga } from '../store/expo-store.ts';
import { obtenerIdentidad } from './identidad.ts';
import { mapaTestigos, type Testigo } from './testigos.ts';
import { FilaCampo, FilaCohorte } from './components/FilaCampo.tsx';
import { InsigniaNaturaleza } from './components/InsigniaNaturaleza.tsx';
import { colorEstado, InsigniaQuorum } from './components/InsigniaQuorum.tsx';
import { color, espacio, radio, tap, tipografia } from './theme.ts';

interface Datos {
  grupos: GrupoEquipo[];
  observaciones: Observacion[];
  observadorIdLocal: string;
  corruptas: number;
}

interface Seccion {
  nombre: string;
  ubicacion: string;
  data: GrupoEquipo[];
}

/** Los grupos vienen ordenados por `clave` (que empieza por el nombre del
 *  cliente normalizado), así que agrupar por cliente conserva ese orden. */
function porCliente(grupos: GrupoEquipo[]): Seccion[] {
  const mapa = new Map<string, GrupoEquipo[]>();
  for (const g of grupos) {
    const arr = mapa.get(g.cliente.nombre);
    if (arr) arr.push(g); else mapa.set(g.cliente.nombre, [g]);
  }
  return [...mapa.entries()].map(([nombre, gs]) => ({
    nombre,
    ubicacion: [gs[0]!.cliente.ciudad, gs[0]!.cliente.pais].filter(Boolean).join(', '),
    data: gs,
  }));
}

function tituloGrupo(g: GrupoEquipo): string {
  const modalidad = g.campos.modalidad.valor ?? '—';
  const marca = g.campos.marca.valor;
  return marca ? `${modalidad} · ${marca}` : String(modalidad);
}

function textoCohorte(c: GrupoEquipo['cohortes'][number]): string {
  const uds = c.cantidad.valor ?? '?';
  const edad = Array.isArray(c.edad) ? `${c.edad[0]}–${c.edad[1]}` : c.edad;
  return `${uds} uds · ${edad} años`;
}

/**
 * Cliente 360 — la vista de reconciliación. Lo que tiene que quedar claro,
 * en este orden (doc maestro §B.2):
 *   1. la confianza es POR CAMPO, no por registro;
 *   2. las cohortes explican que no hay contradicción sino composición;
 *   3. el conflicto no parece un error — `Sin quórum` muestra AMBAS
 *      versiones con quién dijo cada una, nunca un promedio;
 *   4. la frescura se distingue del estado de confianza (dos ejes).
 *
 * No consulta ninguna API: lee el store local y corre el mismo motor de
 * quórum que el server (`trust/reconcile.ts`, uno de los 10 archivos
 * compartidos). Cero red, cero nube.
 *
 * `SectionList` (no `ScrollView`): una "base instalada" real son cientos de
 * clientes, y montarlos todos a la vez sin reciclar es lo que la hace pesada
 * al scrollear. Una sección por cliente, `TarjetaGrupo` como fila.
 */
export default function Cliente360Screen({ recargarToken = 0 }: { recargarToken?: number }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refrescando, setRefrescando] = useState(false);

  const leer = useCallback(async () => {
    try {
      setError(null);
      const [observaciones, identidad] = await Promise.all([cargar(), obtenerIdentidad()]);
      // `cargar()` devuelve el MISMO array (por referencia) mientras nada
      // cambió en el store; `agregar()` crea uno nuevo. Si es el mismo, ya
      // está reconciliado — no hace falta volver a correr el motor de quórum
      // (que es trabajo real en el hilo JS) en cada toque a la pestaña.
      setDatos((prev) =>
        prev && prev.observaciones === observaciones
          ? prev
          : {
              grupos: reconciliar(observaciones),
              observaciones,
              observadorIdLocal: identidad.observadorId,
              corruptas: diagnosticoUltimaCarga().corruptas,
            });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // `recargarToken` lo incrementa `App.tsx` cada vez que esta pestaña pasa
  // a estar visible: la pantalla queda montada (para no perder lo que el
  // usuario esté escribiendo en Capturar) pero relee el store al volver,
  // así una nota recién confirmada aparece sin pull-to-refresh manual.
  useEffect(() => { void leer(); }, [leer, recargarToken]);

  const refrescar = useCallback(async () => {
    setRefrescando(true);
    await leer();
    setRefrescando(false);
  }, [leer]);

  const secciones = useMemo<Seccion[]>(
    () => (datos ? porCliente(datos.grupos) : []),
    [datos],
  );

  const renderItem = useCallback(
    ({ item }: { item: GrupoEquipo }) => {
      if (!datos) return null;
      return (
        <TarjetaGrupo
          grupo={item}
          observaciones={datos.observaciones}
          observadorIdLocal={datos.observadorIdLocal}
        />
      );
    },
    [datos],
  );

  const primerCliente = secciones[0]?.nombre;
  const renderSectionHeader = useCallback(
    ({ section }: { section: Seccion }) => (
      <View style={[estilos.cliente, section.nombre !== primerCliente && estilos.clienteSeparado]}>
        <Text style={tipografia.subtitulo} numberOfLines={3}>{section.nombre}</Text>
        {section.ubicacion !== '' && (
          <Text style={estilos.ubicacion} numberOfLines={2}>{section.ubicacion}</Text>
        )}
      </View>
    ),
    [primerCliente],
  );

  const control = (
    <RefreshControl refreshing={refrescando} onRefresh={() => void refrescar()} />
  );

  if (error) {
    return (
      <View style={estilos.centro}>
        <Text style={estilos.error} accessibilityLiveRegion="polite">
          No se pudo leer la base local: {error}
        </Text>
        <Pressable
          style={estilos.botonReintentar}
          onPress={() => void leer()}
          accessibilityRole="button"
        >
          <Text style={estilos.textoBotonReintentar}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  if (!datos) {
    return (
      <View style={estilos.centro}>
        <ActivityIndicator color={color.primario} />
        <Text style={estilos.textoTenue}>Reconciliando lo que ya capturaste…</Text>
      </View>
    );
  }

  if (!datos.grupos.length) {
    return (
      <ScrollView contentContainerStyle={estilos.centro} refreshControl={control}>
        <Text style={estilos.glifoVacio} importantForAccessibility="no">·</Text>
        <Text style={tipografia.subtitulo}>Todavía no hay nada que reconciliar</Text>
        <Text style={estilos.textoTenue}>
          Capturá una nota y confirmala. Cuando dos personas describan el mismo equipo,
          acá vas a ver si coinciden.
        </Text>
      </ScrollView>
    );
  }

  return (
    <SectionList
      sections={secciones}
      keyExtractor={(g) => g.clave}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={estilos.lista}
      refreshControl={control}
      ListHeaderComponent={
        <View>
          {/* Sin título "Clientes": lo dice la pestaña activa. Esta línea sí
              se queda — es la tesis de ESTA pantalla, no la marca de la app. */}
          <Text style={estilos.tesis}>
            La confianza es por campo, no por registro.
          </Text>
          {datos.corruptas > 0 && (
            <Text style={estilos.avisoCorruptas}>
              {datos.corruptas} línea(s) del archivo local no se pudieron leer y quedaron
              registradas en observaciones.corruptas.jsonl — no se perdieron en silencio.
            </Text>
          )}
        </View>
      }
      ListFooterComponent={<Leyenda />}
    />
  );
}

const TarjetaGrupo = memo(function TarjetaGrupo({
  grupo, observaciones, observadorIdLocal,
}: {
  grupo: GrupoEquipo;
  observaciones: Observacion[];
  observadorIdLocal: string;
}) {
  // Set y no `observacionesIds.includes(...)` dentro del filter: eso era
  // O(n*m) por tarjeta, y se recorre en cada render de cada grupo.
  const delGrupo = useMemo(() => {
    const ids = new Set(grupo.observacionesIds);
    return observaciones.filter((o) => ids.has(o.id));
  }, [observaciones, grupo.observacionesIds]);
  const testigos = useMemo(
    () => mapaTestigos(delGrupo, observadorIdLocal),
    [delGrupo, observadorIdLocal]);

  const p = grupo.puntaje;

  return (
    <View style={[estilos.tarjeta, { borderTopColor: colorEstado(grupo.estadoGeneral) }]}>
      <View style={estilos.tarjetaCabecera}>
        <Text style={estilos.tituloGrupo} numberOfLines={2}>{tituloGrupo(grupo)}</Text>
        <Text style={estilos.puntaje} numberOfLines={1}>{p.total}/100</Text>
      </View>

      <View style={estilos.filaEstadoGeneral}>
        <InsigniaQuorum estado={grupo.estadoGeneral} />
        <Text style={estilos.textoTenue}>estado general del grupo</Text>
      </View>

      {/* 45×completitud + 25×frescura + 30×corroboración (trust/score.ts) */}
      <Text style={estilos.desglose}>
        completitud {p.completitud} · frescura {p.frescura} · corroboración {p.corroboracion}
      </Text>

      {grupo.oportunidadRenovacion && (
        <Text style={estilos.oportunidad}>Oportunidad de renovación</Text>
      )}

      <View style={estilos.tabla}>
        <FilaCampo nombre="Modalidad" campo={grupo.campos.modalidad} testigos={testigos} />
        <FilaCampo nombre="Marca" campo={grupo.campos.marca} testigos={testigos} />
        <FilaCampo nombre="Modelo" campo={grupo.campos.modelo} testigos={testigos} />
        <FilaCampo nombre="Total unidades" campo={grupo.campos.totalUnidades} testigos={testigos} />
        {/* La fila `Edad` solo cuando NO hay cohortes. Con cohortes es
            engañosa: `resolverEdad` aplica RD-3 (cada observador cuenta con
            su testimonio más reciente), así que un parque de 4 equipos de 3
            años + 2 de 13 muestra "Edad 13 · Quórum" y se lee como si TODO
            tuviera 13. Las cohortes dicen la verdad completa y son la
            respuesta correcta a esa pregunta — el mockup del doc maestro
            §B.2 tampoco lleva fila de edad por este motivo.
            El estado del campo sigue pesando en `estadoGeneral`: eso lo
            decide el motor (`MIN_ESTADO`), no esta pantalla. */}
        {grupo.cohortes.length === 0 && (
          <FilaCampo nombre="Edad" campo={grupo.campos.edad} testigos={testigos} />
        )}
        {grupo.cohortes.map((c, i) => (
          <FilaCohorte
            key={i}
            valor={textoCohorte(c)}
            estado={c.estado}
            cantidadObservadores={c.observadores.length}
            {...(c.anioInstalacion !== undefined ? { anioInstalacion: c.anioInstalacion } : {})}
          />
        ))}
      </View>

      {grupo.cohortes.length > 1 && (
        <Text style={estilos.notaCohortes}>
          Son {grupo.cohortes.length} cohortes de edad distintas, no una contradicción:
          el parque se compró en tandas.
        </Text>
      )}

      <Text style={estilos.dupes}>
        {grupo.observacionesIds.length} testimonio(s) se refieren a este mismo equipo
      </Text>

      <View style={estilos.testigos}>
        {[...testigos.values()].map((t) => (
          <FichaTestigo key={t.id} testigo={t} />
        ))}
      </View>
    </View>
  );
});

/** Eje 1 hecho visible: quién testificó y de qué naturaleza fue su
 *  testimonio. Sin esto la pantalla solo muestra el eje 2 y los dos ejes
 *  del proyecto quedan a medias. */
const FichaTestigo = memo(function FichaTestigo({ testigo }: { testigo: Testigo }) {
  return (
    <View style={estilos.fichaTestigo}>
      <Text style={[estilos.etiquetaTestigo, testigo.esVos && estilos.etiquetaVos]}>
        {testigo.etiqueta}
      </Text>
      <InsigniaNaturaleza naturaleza={testigo.naturaleza} />
      {testigo.hedging && <Text style={estilos.hedging}>dijo "creo que"</Text>}
    </View>
  );
});

function Leyenda() {
  return (
    <View style={estilos.leyenda}>
      <Text style={estilos.leyendaTitulo}>Dos ejes, dos preguntas distintas</Text>
      <Text style={estilos.leyendaTexto}>
        <Text style={estilos.leyendaFuerte}>Naturaleza</Text> (por testimonio): quién lo vio.
        Directo, referido o estimado.
      </Text>
      <Text style={estilos.leyendaTexto}>
        <Text style={estilos.leyendaFuerte}>Quórum</Text> (por campo): cuánto se corroboró.
        Hacen falta dos testimonios directos y sin dudas para que un campo llegue a Quórum.
      </Text>
      <Text style={estilos.leyendaTexto}>
        <Text style={estilos.leyendaFuerte}>Frescura</Text> es un tercer eje aparte: un dato con
        quórum puede estar viejo, y se avisa por separado.
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  lista: { padding: espacio.lg, paddingBottom: espacio.xxl },
  centro: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    padding: espacio.xl, gap: espacio.md,
  },
  tesis: { ...tipografia.cuerpo, color: color.textoTenue, marginBottom: espacio.md },
  textoTenue: { ...tipografia.pequeno, color: color.textoTenue, textAlign: 'center' },
  glifoVacio: { fontSize: 56, color: color.sinDatos },
  error: { ...tipografia.secundario, color: color.peligro, textAlign: 'center' },
  botonReintentar: {
    minHeight: tap.normal, paddingHorizontal: espacio.xl, borderRadius: radio.lg,
    backgroundColor: color.primario, alignItems: 'center', justifyContent: 'center',
  },
  textoBotonReintentar: { ...tipografia.accion, color: color.primarioTexto },
  avisoCorruptas: {
    ...tipografia.pequeno, color: color.texto, backgroundColor: color.advertenciaFondo,
    padding: espacio.sm, borderRadius: radio.sm, marginBottom: espacio.sm,
  },

  cliente: { gap: espacio.xs },
  clienteSeparado: { marginTop: espacio.lg },
  ubicacion: { ...tipografia.pequeno, color: color.textoTenue, marginBottom: espacio.xs },

  tarjeta: {
    backgroundColor: color.superficie, borderRadius: radio.lg, borderWidth: 1,
    borderColor: color.borde, borderTopWidth: 4, overflow: 'hidden',
    marginTop: espacio.sm, paddingBottom: espacio.sm,
  },
  tarjetaCabecera: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: espacio.md, paddingTop: espacio.md, gap: espacio.sm,
  },
  tituloGrupo: { ...tipografia.subtitulo, color: color.texto, flexShrink: 1 },
  puntaje: {
    ...tipografia.dato, color: color.texto, fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  filaEstadoGeneral: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    paddingHorizontal: espacio.md, paddingTop: espacio.xs,
  },
  desglose: {
    ...tipografia.pequeno, color: color.textoTenue,
    paddingHorizontal: espacio.md, paddingTop: espacio.xs, fontVariant: ['tabular-nums'],
  },
  oportunidad: {
    ...tipografia.etiqueta, color: color.quorum,
    paddingHorizontal: espacio.md, paddingTop: espacio.xs,
  },
  tabla: { marginTop: espacio.md },
  notaCohortes: {
    ...tipografia.pequeno, color: color.textoTenue,
    paddingHorizontal: espacio.md, paddingTop: espacio.sm,
  },
  dupes: {
    ...tipografia.pequeno, color: color.textoTenue,
    paddingHorizontal: espacio.md, paddingTop: espacio.sm,
  },
  testigos: {
    flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm,
    paddingHorizontal: espacio.md, paddingTop: espacio.sm,
  },
  fichaTestigo: { flexDirection: 'row', alignItems: 'center', gap: espacio.xs },
  etiquetaTestigo: { ...tipografia.pequeno, fontWeight: '700', color: color.textoTenue },
  etiquetaVos: { color: color.primario },
  hedging: { ...tipografia.pequeno, color: color.estimadoNaturaleza, fontStyle: 'italic' },

  leyenda: {
    marginTop: espacio.lg, padding: espacio.md, gap: espacio.xs,
    backgroundColor: color.superficieHundida, borderRadius: radio.md,
  },
  leyendaTitulo: { ...tipografia.etiqueta, color: color.texto, marginBottom: espacio.xs },
  leyendaTexto: { ...tipografia.pequeno, color: color.textoTenue, lineHeight: 17 },
  leyendaFuerte: { fontWeight: '700', color: color.texto },
});
