/**
 * auditoria.js — pantalla 4. La cadena de hashes con su botón «Verificar
 * integridad», que invita al jurado a editar `data/audit.jsonl` a mano y
 * comprobarlo en vivo. Y cada llamada de inferencia con `delegado`
 * visible: ahí está la prueba de cumplimiento, no en una diapositiva
 * (§B.2).
 */
import { h, api, pintar, error, icono } from './dom.js';

/*
 * Tope de longitud por valor. El detalle de un registro es un objeto
 * ARBITRARIO — y en un registro de error puede traer el mensaje crudo del
 * SDK, que llega a miles de caracteres (por ejemplo, la lista completa de
 * modelos del registro local). Sin tope, UN registro empuja los otros 49
 * fuera de la pantalla y la cadena de auditoría deja de poder leerse: justo
 * la pantalla donde se demuestra la integridad.
 *
 * El valor completo queda en el `title`, así que no se pierde nada: se puede
 * leer al pasar el mouse, y sigue estando entero en `data/audit.jsonl`, que
 * es la fuente que el jurado puede abrir y alterar.
 */
const TOPE_VALOR = 240;

function detalle(d) {
  if (!d || typeof d !== 'object') return h('span', { clase: 'small', texto: '—' });
  const pares = Object.entries(d);
  if (!pares.length) return h('span', { clase: 'small', texto: '—' });
  return h('span', { clase: 'small pares' },
    pares.map(([k, v]) => {
      const completo = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
      const recortado = completo.length > TOPE_VALOR
        ? `${completo.slice(0, TOPE_VALOR)}… (+${completo.length - TOPE_VALOR} caracteres)`
        : completo;
      return h('span', { clase: 'par' },
        h('i', { texto: `${k}=` }),
        h('span', {
          texto: recortado,
          // `title` solo cuando hay algo mas que ver.
          ...(recortado === completo ? {} : { title: completo }),
        }));
    }));
}

/** ¿Este registro habla de una inferencia, y fue local o delegada? */
function chipInferencia(r) {
  const d = r.detalle ?? {};
  if (!('delegado' in d)) return null;
  const delegado = d.delegado === true;
  return h('span', { clase: `chip-inferencia ${delegado ? 'delegada' : 'local'}` },
    h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: delegado ? '⇄' : '⌂' }),
    h('span', { texto: delegado ? 'delegada a peer autorizado' : 'local, en este equipo' }));
}

function hora(at) {
  if (typeof at !== 'string' || at.length < 19) return '—';
  return at.slice(11, 19);
}

function tabla(registros) {
  if (!registros.length) {
    return h('p', { clase: 'small', texto: 'La cadena está vacía. El primer registro se escribe con la primera captura.' });
  }
  return h('table', { clase: 'auditoria-tabla' },
    h('thead', null, h('tr', null,
      // `scope="col"`: sin esto un lector de pantalla lee las celdas sin
      // poder nombrar su columna, y «Detalle» y «Hash» sueltos no dicen nada.
      ['Hora', 'Acción', 'Inferencia', 'Detalle', 'Hash']
        .map((t) => h('th', { scope: 'col', texto: t })))),
    h('tbody', null, registros.map((r) => h('tr', null,
      h('td', { clase: 'num', texto: hora(r.at) }),
      h('td', null, h('code', { texto: String(r.accion ?? '?') })),
      h('td', null, chipInferencia(r) ?? h('span', { clase: 'small', texto: '—' })),
      h('td', null, detalle(r.detalle)),
      h('td', { clase: 'small' },
        h('code', { texto: `${String(r.hash ?? '').slice(0, 12)}…` }))))));
}

/**
 * Tarjeta de un indicador de integridad. Los TRES que devuelve
 * `/api/auditoria` se pintan con esta misma función, y por lo tanto con la
 * misma jerarquía visual: glifo + etiqueta + color, nunca color solo.
 *
 * `estado` es `'ok'`, `'roto'` o `'desconocido'` — el tercero existe porque
 * los campos de la respuesta pueden faltar, y «no me lo informaron» no es lo
 * mismo que «está sano»: afirmar salud sin dato sería justo la clase de
 * mentira que esta pantalla existe para hacer imposible.
 */
function tarjetaIntegridad({ estado, titulo, detalle, extra, boton }) {
  const GLIFO = { ok: '●', roto: '▲', desconocido: '·' };
  const CLASE = { ok: 'ok', roto: 'sinquorum', desconocido: 'nulo' };
  return h('div', { clase: `integridad ${CLASE[estado]}` },
    h('span', { clase: 'glifo grande', 'aria-hidden': 'true', texto: GLIFO[estado] }),
    h('div', null,
      h('b', { texto: titulo }),
      h('p', { clase: 'small', texto: detalle }),
      extra ?? null),
    boton ?? null);
}

/** Lista de números de línea, acotada: con 400 líneas corruptas la pantalla
 *  dejaría de poder leerse, que es lo contrario de lo que se demuestra acá. */
const TOPE_LINEAS = 40;

function listaLineas(lineas) {
  const nums = lineas.filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  const visibles = nums.slice(0, TOPE_LINEAS);
  const resto = nums.length - visibles.length;
  return h('p', { clase: 'small num', texto:
    `Líneas: ${visibles.join(', ')}${resto > 0 ? ` … y ${resto} más` : ''}` });
}

/**
 * Indicador 2 — el ARCHIVO de testimonios, verificado línea por línea contra
 * `zObservacion` (`verificarArchivo()` en el store).
 */
function tarjetaObservaciones(o) {
  if (!o || typeof o !== 'object') {
    return tarjetaIntegridad({
      estado: 'desconocido',
      titulo: 'Store de testimonios sin verificar',
      detalle: 'La respuesta no trajo el resultado de la verificación del archivo.',
    });
  }
  const total = Number.isFinite(o.total) ? o.total : 0;
  const corruptas = Array.isArray(o.corruptas) ? o.corruptas : [];
  const sano = o.ok === true && corruptas.length === 0;
  return tarjetaIntegridad({
    estado: sano ? 'ok' : 'roto',
    titulo: sano
      ? 'Store de testimonios ÍNTEGRO'
      : `Store de testimonios con ${corruptas.length} ${corruptas.length === 1 ? 'línea corrupta' : 'líneas corruptas'}`,
    detalle: sano
      ? `Las ${total} ${total === 1 ? 'línea' : 'líneas'} de data/observations.jsonl cumplen el contrato de datos.`
      : `De ${total} ${total === 1 ? 'línea' : 'líneas'} en data/observations.jsonl, ` +
        `${corruptas.length} no cumplen el contrato: esos testimonios no entran en la base instalada.`,
    extra: sano ? null : listaLineas(corruptas),
  });
}

/**
 * Indicador 3 — las líneas que el ARRANQUE descartó al leer el archivo.
 *
 * Es la contracara de la corrección #9: en vez de vaciar la base instalada
 * por una línea mala, el store filtra la línea y sigue. Filtrar en silencio
 * sería pérdida invisible de datos, así que el número se muestra acá.
 */
function tarjetaDescartadas(dato) {
  /*
   * Lectura TOLERANTE de la forma: el campo llegó primero como un array de
   * números y ahora viene envuelto (`{ lineas, medidoEn, origen }`). Se
   * aceptan las dos y cualquier otro envoltorio que traiga un array adentro,
   * porque el contrato de esta respuesta todavía se está moviendo del lado
   * del servidor y esta pantalla no puede quedar diciendo «sin informar»
   * cada vez que ese campo cambia de envase.
   */
  const lineas = Array.isArray(dato)
    ? dato
    : (dato && typeof dato === 'object'
        ? Object.values(dato).find((v) => Array.isArray(v))
        : undefined);
  if (!lineas) {
    return tarjetaIntegridad({
      estado: 'desconocido',
      titulo: 'Lectura del store sin informar',
      detalle: 'La respuesta no trajo las líneas descartadas al leer el archivo.',
    });
  }
  const n = lineas.length;
  return tarjetaIntegridad({
    estado: n === 0 ? 'ok' : 'roto',
    titulo: n === 0
      ? 'Ninguna línea descartada al leer'
      : `${n} ${n === 1 ? 'línea descartada' : 'líneas descartadas'} al leer el store`,
    detalle: n === 0
      ? 'El último arranque leyó el archivo completo: ninguna línea quedó afuera.'
      : 'El arranque filtró estas líneas para no vaciar la base instalada por un ' +
        'archivo dañado, y siguió con el resto. Los testimonios de esas líneas NO están cargados.',
    extra: n === 0 ? null : listaLineas(lineas),
  });
}

function tarjetaPendientes(o) {
  if (!o || typeof o !== 'object') return tarjetaIntegridad({
    estado: 'desconocido', titulo: 'Cola de pendientes sin verificar',
    detalle: 'La respuesta no informó la integridad de pendientes.jsonl.',
  });
  const corruptas = Array.isArray(o.corruptas) ? o.corruptas : [];
  const sano = o.ok === true && corruptas.length === 0;
  return tarjetaIntegridad({
    estado: sano ? 'ok' : 'roto',
    titulo: sano ? 'Cola de pendientes ÍNTEGRA' : `Cola de pendientes con ${corruptas.length} líneas corruptas`,
    detalle: sano
      ? 'Las notas con seguimiento pendiente siguen disponibles para revisión.'
      : 'Estas líneas no se pueden recuperar desde la cola y quedaron fuera del conteo de pendientes.',
    extra: sano ? null : listaLineas(corruptas),
  });
}

/** Datos P2P no son evidencia hasta que una persona local los confirme. */
function revisionesPeer(revisiones, alCambiar) {
  if (!Array.isArray(revisiones) || !revisiones.length) return null;
  return h('section', { clase: 'revisiones-peer' },
    h('h3', { texto: `Revisión P2P pendiente · ${revisiones.length}` }),
    h('p', { clase: 'small', texto: 'Estos testimonios no están en la base instalada. Revisalos antes de incorporarlos.' }),
    revisiones.map((r) => {
      const resumen = (r.observaciones ?? []).map((o) => {
        const cantidad = o?.lote?.cantidad ?? 'cantidad no indicada';
        return `${cantidad} ${o?.lote?.modalidad ?? 'equipo'} · ${o?.cliente?.nombre ?? 'cliente sin nombre'}`;
      }).join(' · ');
      const confirmar = h('button', { clase: 'primario', texto: 'Confirmar e incorporar' });
      confirmar.onclick = async () => { await api('/api/revisiones-peer/confirmar', { id: r.id }); alCambiar(); };
      const descartar = h('button', { texto: 'Descartar' });
      descartar.onclick = async () => { await api('/api/revisiones-peer/descartar', { id: r.id }); alCambiar(); };
      return h('article', { clase: 'revision-peer' },
        h('b', { texto: resumen || 'Testimonio peer sin resumen' }),
        h('p', { clase: 'small', texto: `Peer ${r.clavePeer ?? '—'} · recibido ${r.recibidoEn ?? '—'}` }),
        h('div', { clase: 'acciones' }, confirmar, descartar));
    }));
}

export async function pintarAuditoria(seccion) {
  pintar(seccion, h('p', { clase: 'estado trabajando', texto: 'Verificando la cadena…' }));
  let d;
  try {
    d = await api('/api/auditoria');
  } catch (e) {
    pintar(seccion, error(e));
    return;
  }

  const integridad = d.integridad ?? {};
  // Los registros llegan en orden cronológico; se muestran del más nuevo
  // al más viejo, sin mutar el array de la respuesta.
  const registros = [...(d.registros ?? [])].reverse();

  const boton = h('button', null, icono('integridad'), 'Verificar integridad');
  boton.onclick = () => pintarAuditoria(seccion);

  pintar(seccion,
    /*
     * TRES indicadores, no uno.
     *
     * `/api/auditoria` devuelve tres cosas y esta pantalla pintaba solo la
     * cadena de hashes. Las otras dos son la integridad del store de
     * TESTIMONIOS — el dato del producto — y quedaban invisibles justo en la
     * única pantalla que existe para mostrar integridad. Van los tres con la
     * misma jerarquía: si el store está sano se ve sano, y si no, se ve
     * cuántas líneas y cuáles.
     */
    tarjetaIntegridad({
      estado: integridad.ok ? 'ok' : 'roto',
      titulo: integridad.ok
        ? 'Cadena de auditoría VERIFICADA'
        : 'Cadena de auditoría ROTA',
      detalle: integridad.ok
        ? 'Cada registro encadena con el hash del anterior. Editá data/audit.jsonl a mano y volvé a verificar.'
        : `Se rompe en el registro ${integridad.roto ?? 'desconocido'}. Alguien alteró el archivo.`,
      boton,
    }),
    tarjetaObservaciones(d.observaciones),
    tarjetaDescartadas(d.lineasDescartadas),
    tarjetaPendientes(d.integridadPendientes),
    revisionesPeer(d.revisionesPeer, () => pintarAuditoria(seccion)),
    h('p', { clase: 'leyenda small', texto: 'Últimos 50 registros, del más reciente al más antiguo. La columna «Inferencia» prueba dónde corrió cada modelo: en este equipo o delegado a un dispositivo autorizado de la red. Nunca en la nube.' }),
    tabla(registros));
}
