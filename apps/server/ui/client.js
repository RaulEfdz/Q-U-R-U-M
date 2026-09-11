/**
 * client.js — ★ CLIENTE 360. La pantalla que gana.
 *
 * Acá vive el 35% de Technical hecho visible. Tiene que lograr, EN ESTE
 * ORDEN (doc maestro §B.2):
 *   1. que se vea que la confianza es POR CAMPO, no por registro;
 *   2. que las COHORTES expliquen que no hay contradicción sino composición;
 *   3. que el CONFLICTO no parezca un error;
 *   4. que la FRESCURA se distinga del estado de confianza — dos ejes.
 *
 * `Sin quórum` NUNCA muestra un promedio ni elige una versión: muestra
 * todas las versiones en conflicto con quién dijo cada una (RD-2). Es la
 * tesis del proyecto. Si esta pantalla promediara, el proyecto perdería su
 * argumento, así que el bloque de versiones va SIEMPRE visible, nunca
 * detrás de un click.
 */
import { h, pintar, formatearValor, testigos, testimonios, vacio, error, iconoModalidad } from './dom.js';
import { claseEstado, insignia, insigniaFrescura, esAscensoAQuorum, esNuevoConflicto } from './states.js';

/** Estados de la pasada anterior, para detectar el ascenso a quórum y la
 *  aparición de un conflicto nuevo. Clave: `${grupo.clave}|${nombreCampo}`. */
const estadoPrevio = new Map();

function marcarAscenso(fila, clave, estado) {
  const anterior = estadoPrevio.get(clave);
  estadoPrevio.set(clave, estado);
  if (esAscensoAQuorum(anterior, estado)) fila.classList.add('ascenso');
  // La mala noticia recibe la misma cortesía que la buena: RD-2 existe para
  // que un conflicto nuevo se note, no para que se filtre entre repintados.
  else if (esNuevoConflicto(anterior, estado)) fila.classList.add('conflicto-nuevo');
}

/**
 * Bloque de conflicto: todas las versiones y quién sostiene cada una.
 * No hay promedio, no hay "valor más probable", no hay ganador.
 */
function bloqueConflicto(campo) {
  const clusters = campo.clusters ?? [];
  return h('tr', { clase: 'detalle conflicto' },
    h('td', { colspan: '4' },
      h('p', { clase: 'conflicto-titulo', texto: 'No se promedia ni se elige. Cada versión, con quién la dijo:' }),
      h('ul', { clase: 'versiones' },
        clusters.map((k) => h('li', null,
          h('b', { clase: 'num', texto: formatearValor(k.valor) }),
          h('span', { clase: 'quien', texto: (k.observadores ?? []).join(', ') || 'observador sin identificar' }),
          h('span', { clase: 'small', texto: testimonios((k.observadores ?? []).length) })))),
      h('p', { clase: 'conflicto-pie', texto: 'Hace falta una visita más de un observador independiente para resolverlo.' })));
}

/** Una fila de campo: nombre · valor · estado de quórum · quién y desde cuándo. */
function filaCampo(clave, nombre, campo, { sangrada = false } = {}) {
  if (!campo) return null;
  const esConflicto = campo.estado === 'Sin quórum';
  const valor = esConflicto
    ? 'en disputa'
    : formatearValor(campo.rango ?? campo.valor);

  const fila = h('tr', { clase: [claseEstado(campo.estado), sangrada && 'sangrada', esConflicto && 'es-conflicto'] },
    h('td', { clase: 'campo', texto: nombre }),
    h('td', { clase: esConflicto ? 'num disputa' : 'num', texto: valor }),
    h('td', null, insignia(campo.estado)),
    // `display: flex` va en un `<div>` DENTRO del `<td>`, nunca en el `<td>`
    // mismo: un `<td>` con `display: flex` deja de comportarse como celda
    // de tabla para `table-layout: fixed` (varios navegadores lo miden por
    // contenido en vez de respetar el ancho de columna) — el bug real detrás
    // de que «Quién lo sostiene» apareciera comprimido/superpuesto en el
    // layout de Cliente 360 en dos columnas.
    h('td', null, h('div', { clase: 'quienes' },
      campo.estado === 'Sin datos' ? h('span', { clase: 'small', texto: 'nadie lo reportó' })
        : h('span', { texto: testigos((campo.observadores ?? []).length) }),
      insigniaFrescura(campo))));

  marcarAscenso(fila, clave, campo.estado);
  return esConflicto ? [fila, bloqueConflicto(campo)] : fila;
}

/** Fila de cohorte (H-02): el valor lo compone la pantalla, no la API.
 *  Las cohortes son la respuesta visual a "tres MR, dos viejos y uno nuevo":
 *  composición, no contradicción. */
function filaCohorte(clave, cohorte, indice) {
  const cantidad = cohorte.cantidad ?? {};
  /*
   * ★ `cohorte.estado` NO habla de la cantidad.
   *
   * Lo calcula el clúster de EDAD, mientras `cohorte.cantidad` se resuelve
   * por separado y puede quedar `Sin quórum` — y ahí `valor` viene
   * `undefined`, porque el motor no elige ni promedia (RD-2). La fila salía
   * entonces como «? uds · 8 años ● Quórum»: el conflicto desaparecía y
   * encima se mostraba con el glifo de máxima confianza.
   *
   * El motor está bien; lo que estaba mal era la presentación. Se resuelve
   * igual que `filaCampo()` resuelve el mismo caso para los campos —«en
   * disputa», clase `es-conflicto` y el bloque con todas las versiones y
   * quién sostiene cada una— porque es el mismo hecho y merece el mismo
   * tratamiento, no uno nuevo.
   */
  const enDisputa = cantidad.estado === 'Sin quórum';
  const uds = cantidad.valor;
  const edad = formatearValor(cohorte.edad);
  // «1 uds» se lee como un bug de plantilla en una pantalla que promete
  // precisión sobre los datos.
  const unidad = uds === 1 ? 'ud' : 'uds';
  const partes = [enDisputa
    ? `cantidad en disputa · ${edad} años`
    : `${formatearValor(uds)} ${unidad} · ${edad} años`];
  if (cohorte.anioInstalacion !== undefined) partes.push(`(≈${cohorte.anioInstalacion})`);

  // La insignia de la fila no puede afirmar quórum sobre una fila cuyo dato
  // principal está en conflicto: mientras la cantidad se discuta, la cohorte
  // entera es `Sin quórum`. Las versiones de la EDAD, que sí puede tener
  // quórum, siguen visibles en el valor.
  const estadoFila = enDisputa ? 'Sin quórum' : cohorte.estado;

  const fila = h('tr', { clase: [claseEstado(estadoFila), 'sangrada', enDisputa && 'es-conflicto'] },
    h('td', { clase: 'campo', texto: '— cohorte' }),
    h('td', { clase: enDisputa ? 'num disputa' : 'num', texto: partes.join(' ') }),
    h('td', null, insignia(estadoFila)),
    h('td', null, h('div', { clase: 'quienes' }, h('span', { texto: testigos((cohorte.observadores ?? []).length) }))));

  marcarAscenso(fila, `${clave}|cohorte${indice}`, estadoFila);
  // `cohorte.cantidad.clusters` trae las versiones en conflicto: mismo bloque
  // que usan los campos, siempre visible y nunca detrás de un click.
  return enDisputa ? [fila, bloqueConflicto(cantidad)] : fila;
}

function tituloEquipo(g) {
  const modalidad = g.campos?.modalidad?.valor ?? '—';
  const marca = g.campos?.marca?.valor;
  return marca ? `${modalidad} · ${marca}` : String(modalidad);
}

const dec2 = (n) => (typeof n === 'number' ? n.toFixed(2) : '—');

/** Un grupo de equipo = un cliente + una modalidad reconciliada. */
export function pintarGrupo(g, meta = {}) {
  const c = g.campos ?? {};
  const p = g.puntaje ?? {};

  return h('article', { clase: `grupo ${claseEstado(g.estadoGeneral)}` },
    h('header', { clase: 'grupo-cabecera' },
      // El nombre del cliente NO se repite acá: lo pone `pintarCliente` una
      // vez por cliente. Con 16 grupos, repetirlo en cada tarjeta hacía que
      // el dato que cambia (la modalidad) quedara subordinado al que no
      // cambia. Es además el criterio que ya usa la app móvil, que agrupa por
      // cliente — mantenerlos distintos era drift entre las dos superficies.
      h('h3', { clase: 'equipo-titulo con-icono' },
        iconoModalidad(g.campos?.modalidad?.valor, { clase: 'icono-modalidad' }),
        tituloEquipo(g),
        meta.modeloIA ? h('span', { clase: 'modelo-card', title: 'Modelo local usado para interpretar las observaciones' }, `IA · ${meta.modeloIA}`) : null),
      h('div', { clase: 'puntaje-caja' },
        h('span', {
          clase: 'puntaje num',
          title: 'Puntaje de calidad del dato: 45×completitud + 25×frescura + 30×corroboración',
        }, h('b', { texto: String(p.total ?? '—') }), h('small', { texto: '/100' })),
        h('p', { clase: 'desglose num', texto:
          `completitud ${dec2(p.completitud)} · frescura ${dec2(p.frescura)} · corroboración ${dec2(p.corroboracion)}` }))),

    g.oportunidadRenovacion
      ? h('p', { clase: 'oportunidad' },
          h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: '↻' }),
          h('span', { texto: 'Oportunidad de renovación' }))
      : null,

    h('table', { clase: 'confianza' },
      // `scope="col"` en cada encabezado: sin eso un lector de pantalla no
      // puede nombrar la columna al leer una celda, y esta tabla es cuatro
      // columnas de contexto sobre un solo dato.
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', texto: 'Campo' }),
        h('th', { scope: 'col', clase: 'num', texto: 'Valor' }),
        h('th', { scope: 'col', texto: 'Estado de quórum' }),
        h('th', { scope: 'col', texto: 'Quién lo sostiene' }))),
      h('tbody', null,
        filaCampo(`${g.clave}|modalidad`, 'Modalidad', c.modalidad),
        filaCampo(`${g.clave}|marca`, 'Marca', c.marca),
        filaCampo(`${g.clave}|modelo`, 'Modelo', c.modelo),
        filaCampo(`${g.clave}|total`, 'Total unidades', c.totalUnidades),
        // La fila `Edad` SOLO cuando no hay cohortes. Con cohortes es
        // enganosa: `resolverEdad` aplica RD-3 (cada observador cuenta con su
        // testimonio mas reciente), asi que un parque de 4 equipos de 3 anos
        // mas 2 de 13 muestra "Edad 13 · Quorum" y se lee como si TODO
        // tuviera 13. Las cohortes cuentan esa historia completa, y el mockup
        // de §B.2 tampoco lleva fila de edad, por lo mismo. El estado del
        // campo sigue pesando en `estadoGeneral`: eso lo decide MIN_ESTADO en
        // el motor, no esta pantalla. Mismo criterio que la app movil
        // (`apps/mobile/src/app/Cliente360Screen.tsx`).
        (g.cohortes ?? []).length === 0
          ? filaCampo(`${g.clave}|edad`, 'Edad', c.edad)
          : null,
        (g.cohortes ?? []).map((co, i) => filaCohorte(g.clave, co, i)))),

    // Concordancia: «1 testimonio se refieren» se lee como un bug de
    // plantilla, y esta pantalla se apoya en parecer precisa.
    h('p', { clase: 'dupes', texto: (() => {
      const n = (g.observacionesIds ?? []).length;
      return `${testimonios(n)} se ${n === 1 ? 'refiere' : 'refieren'} a este mismo equipo`;
    })() }));
}

export function pintarCliente(seccion, datos) {
  const grupos = datos?.grupos ?? [];
  if (!grupos.length) {
    pintar(seccion, vacio(
      'Todavía no hay base instalada reconciliada.',
      'Capturá un primer testimonio en la pestaña «Capturar». Un solo testigo nunca da quórum (RD-1): hacen falta dos observadores independientes.'));
    return;
  }
  // Los grupos vienen ordenados por `clave`, que empieza con el nombre del
  // cliente normalizado, así que agrupar preserva ese orden.
  const porCliente = new Map();
  for (const g of grupos) {
    const nombre = g.cliente?.nombre ?? 'Cliente sin nombre';
    if (!porCliente.has(nombre)) porCliente.set(nombre, []);
    porCliente.get(nombre).push(g);
  }

  pintar(seccion,
    h('header', { clase: 'cliente-hero' },
      h('div', null,
        h('h2', { texto: 'Customer 360' }),
        h('p', { texto: 'La base instalada de cada cuenta, con evidencia, confianza y frescura por campo.' })),
      h('div', { clase: 'cliente-hero-meta' },
        h('b', { clase: 'num', texto: String(porCliente.size) }),
        h('span', { texto: porCliente.size === 1 ? 'cuenta' : 'cuentas' }))),
    h('p', { clase: 'leyenda cliente-leyenda' },
      h('span', { texto: 'La confianza es por campo. ' }),
      h('span', { clase: 'small', texto: 'El color codifica solo el estado de quórum; la frescura (◷) es un eje aparte.' })),
    [...porCliente.entries()].map(([nombre, suyos]) => {
      const ref = suyos[0];
      const ubicacion = [ref.cliente?.ciudad, ref.cliente?.pais].filter(Boolean).join(', ');
      return h('section', { clase: 'cliente-bloque' },
        h('header', { clase: 'cliente-cabecera' },
          h('h2', { clase: 'cliente-nombre', texto: nombre }),
          ubicacion ? h('p', { clase: 'ubicacion', texto: ubicacion }) : null,
          h('p', { clase: 'small', texto: suyos.length === 1
            ? '1 grupo de equipo' : `${suyos.length} grupos de equipo` })),
        suyos.map((g) => pintarGrupo(g, datos.meta ?? {})));
    }));
}

export function pintarClienteError(seccion, mensaje) {
  pintar(seccion, error(mensaje));
}
