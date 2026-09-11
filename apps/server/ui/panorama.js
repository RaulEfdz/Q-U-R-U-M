/**
 * panorama.js — pantalla 3. KPIs grandes, distribución por país y modalidad
 * en BARRAS SIMPLES (`div` con porcentaje), no un mapa: un mapa cuesta
 * horas y comunica menos (§B.2/§B.6). Posibles duplicados con su nota de
 * revisión humana requerida, y el export CSV.
 *
 * Incluye la consulta en lenguaje natural (`/api/consultar`): el modelo
 * solo TRADUCE la pregunta a un filtro; el filtro lo ejecuta código
 * determinista del servidor. Si el modelo intenta llamar a una tool que la
 * política prohíbe, la respuesta trae `bloqueado` y además llega el evento
 * SSE `policy-denied` que pinta la banda roja (ver `app.js`).
 *
 * ★ ARMAZÓN FIJO, DATOS REPINTADOS. La pantalla se construye UNA vez y
 * después solo se repinta lo que depende de `datos`. Antes se reconstruía
 * entera en cada refresco, y como el bloque de consulta vivía adentro,
 * cualquier confirmación de captura o sync de un peer —que llegan por SSE,
 * solos— borraba la pregunta tipeada y los resultados en pantalla. Con dos
 * dispositivos en una demo eso pasa sin que nadie toque nada. El bloque de
 * consulta no depende de `datos`: reconstruirlo en cada refresco era el bug
 * de raíz, no el síntoma.
 */
import { h, api, pintar, formatearValor, vacio, error, icono, iconoModalidad } from './dom.js';
import { claseEstado, insignia } from './estados.js';

function kpi(valor, etiqueta, clase) {
  return h('div', { clase: ['kpi', clase] },
    h('b', { clase: 'num', texto: String(valor ?? 0) }),
    h('span', { texto: etiqueta }));
}

/* ────────── Lectura TOLERANTE de los datos de distribución ────────── */

/*
 * Los pares de `porPais`/`porModalidad` son hoy `[clave, unidades]`, y el
 * servidor está por informar además cuántos grupos quedaron FUERA de la suma
 * por estar en disputa; `totales` va a ganar un contador de unidades no
 * computadas por lo mismo.
 *
 * Como la forma exacta todavía no está fijada, acá NO se adivinan nombres de
 * campo: se lee por FORMA (¿es par de dos, o trae un tercer valor?, ¿el valor
 * es un número o un objeto?) y, cuando hay que mirar nombres, por PATRÓN. Si
 * el dato extra no viene, la pantalla se comporta exactamente como hoy; si
 * viene, lo muestra. Ningún camino puede reventar por un campo ausente:
 * Panorama es la pantalla que se proyecta.
 */

/** Normaliza un nombre de campo a solo letras minúsculas, para comparar. */
const llave = (k) => String(k).toLowerCase().replace(/[^a-z]/g, '');

/** ¿Este nombre de campo habla de lo que quedó FUERA de la suma? */
const esFuera = (k) => /(disput|fuera|excluid|omitid|nocomput|sincomput|nocontabiliz)/.test(llave(k));

/** ¿Y de la magnitud que se suma? Lista corta y anclada a propósito: un
 *  patrón laxo acá elegiría como valor cualquier campo numérico nuevo. */
const esValor = (k) => /^(unidades|unidad|valor|total|totales|suma|cantidad|count|n|v)$/.test(llave(k));

const numero = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : undefined);

/** El primer número de un objeto cuyo nombre de campo cumpla `predicado`. */
function numeroDe(obj, predicado) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (predicado(k)) {
      const n = numero(v);
      if (n !== undefined) return n;
    }
  }
  return undefined;
}

/**
 * Un par de distribución, en cualquiera de sus formas: `[k, v]`,
 * `[k, v, fuera]`, `[k, { … }]` o un objeto suelto. Devuelve siempre
 * `{ clave, valor, fuera }` con `fuera` en 0 si no vino.
 */
function leerPar(par) {
  if (Array.isArray(par)) {
    const [clave, segundo, tercero] = par;
    const valor = numero(segundo) ?? numeroDe(segundo, (k) => !esFuera(k) && esValor(k)) ?? 0;
    const fuera = numero(tercero) ?? numeroDe(tercero, esFuera) ?? numeroDe(segundo, esFuera) ?? 0;
    return { clave: String(clave ?? '—'), valor, fuera };
  }
  if (par && typeof par === 'object') {
    const entradas = Object.entries(par);
    const claveEntrada = entradas.find(([k, v]) => typeof v === 'string' && !esFuera(k));
    return {
      clave: String(claveEntrada?.[1] ?? '—'),
      valor: numeroDe(par, (k) => !esFuera(k) && esValor(k)) ?? numeroDe(par, (k) => !esFuera(k)) ?? 0,
      fuera: numeroDe(par, esFuera) ?? 0,
    };
  }
  return { clave: '—', valor: 0, fuera: 0 };
}

function barras(pares, { conIconoModalidad = false } = {}) {
  const filas = (Array.isArray(pares) ? pares : []).map(leerPar);
  if (!filas.length) return h('p', { clase: 'small', texto: 'Sin datos suficientes todavía.' });
  const max = Math.max(...filas.map((f) => f.valor)) || 1;
  return h('div', { clase: 'barras' },
    filas.map((f) => h('div', { clase: 'barra' },
      // Solo el eje de modalidad lleva icono: para país no existe un set, y
      // meter una bandera ahí sería ornamento — el nombre ya lo dice.
      conIconoModalidad
        ? h('span', { clase: 'barra-etiqueta con-icono' },
            iconoModalidad(f.clave, { clase: 'icono-modalidad' }), f.clave)
        : h('span', { clase: 'barra-etiqueta', texto: f.clave }),
      h('span', { clase: 'barra-pista' }, h('i', { style: `width:${(f.valor / max) * 100}%` })),
      h('b', { clase: 'num', texto: String(f.valor) }),
      // Lo que NO entró en la barra, dicho al lado de la barra. Glifo y
      // etiqueta, no solo color: es el mismo `▲` de `Sin quórum`, porque es
      // exactamente eso lo que dejó estos grupos afuera de la suma.
      f.fuera > 0
        ? h('span', { clase: 'barra-fuera' },
            h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: '▲' }),
            h('span', { texto: `${f.fuera} en disputa` }))
        : null)));
}

/**
 * Nota de unidades NO COMPUTADAS en los totales, si el servidor la informa.
 *
 * Se busca por patrón de nombre entre los totales, no por un campo fijo. Un
 * total que excluye unidades sin decirlo es una cifra que miente por omisión
 * — y este proyecto se apoya en que sus números no lo hagan.
 */
function notaNoComputadas(totales) {
  if (!totales || typeof totales !== 'object') return null;
  const entrada = Object.entries(totales)
    .find(([k, v]) => esFuera(k) && numero(v) !== undefined && numero(v) > 0);
  if (!entrada) return null;
  const n = numero(entrada[1]);
  // El sustantivo sale del nombre del campo, no de una suposición: si el
  // servidor cuenta grupos, la nota dice grupos.
  const cuentaGrupos = /grupo/.test(llave(entrada[0]));
  const cosa = cuentaGrupos
    ? (n === 1 ? 'grupo no se suma' : 'grupos no se suman')
    : (n === 1 ? 'unidad no se suma' : 'unidades no se suman');
  return h('p', { clase: 'nota no-computadas' },
    h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: '▲' }),
    h('span', { texto: `${n} ${cosa} en estos totales: están en disputa, y el ` +
      'sistema no elige una versión ni promedia (RD-2).' }));
}

/* ───────────────────── Consulta en lenguaje natural ───────────────────── */

function filaResultado(g) {
  const c = g.campos ?? {};
  return h('tr', { clase: claseEstado(g.estadoGeneral) },
    h('td', { texto: g.cliente?.nombre ?? '—' }),
    h('td', { texto: [g.cliente?.ciudad, g.cliente?.pais].filter(Boolean).join(', ') || '—' }),
    h('td', { texto: formatearValor(c.modalidad?.valor) }),
    h('td', { texto: formatearValor(c.marca?.valor) }),
    h('td', { clase: 'num', texto: formatearValor(c.totalUnidades?.valor) }),
    h('td', null, insignia(g.estadoGeneral)),
    h('td', { clase: 'num', texto: String(g.puntaje?.total ?? '—') }));
}

function tablaResultados(grupos) {
  if (!grupos.length) return h('p', { clase: 'small', texto: 'El filtro no devolvió clientes.' });
  return h('table', { clase: 'resultados' },
    // `scope="col"`: un lector de pantalla necesita poder nombrar la columna
    // al leer una celda; siete columnas sueltas no se entienden.
    h('thead', null, h('tr', null,
      ['Cliente', 'Ubicación', 'Modalidad', 'Marca', 'Unidades', 'Estado', 'Puntaje']
        .map((t) => h('th', {
          scope: 'col',
          clase: t === 'Unidades' || t === 'Puntaje' ? 'num' : '',
          texto: t,
        })))),
    h('tbody', null, grupos.map(filaResultado)));
}

async function preguntar(cajaTexto, salida) {
  const pregunta = cajaTexto.value.trim();
  if (!pregunta) return;
  pintar(salida, h('p', { clase: 'estado trabajando', texto: 'Consultando al modelo local…' }));
  try {
    const r = await api('/api/consultar', { pregunta });
    const hijos = [];
    if (r.respuesta) hijos.push(h('p', { clase: 'respuesta', texto: r.respuesta }));
    if (r.bloqueado) {
      hijos.push(h('div', { clase: 'bloqueado' },
        h('b', { texto: 'Acción bloqueada por política' }),
        h('p', { clase: 'small' },
          h('span', { texto: 'herramienta ' }), h('code', { texto: String(r.bloqueado.tool ?? '?') }),
          h('span', { texto: ' · política ' }), h('code', { texto: String(r.bloqueado.policyId ?? '?') })),
        h('p', { clase: 'small', texto: String(r.bloqueado.reason ?? '') })));
    }
    if (r.filtro) {
      hijos.push(h('p', { clase: 'filtro' },
        h('span', { clase: 'etiqueta', texto: 'Filtro determinista ejecutado por el código:' }),
        h('code', { texto: Object.entries(r.filtro).map(([k, v]) => `${k}=${v}`).join(' · ') || 'sin condiciones' })));
    }
    if (r.invalidas?.length) {
      // El modelo llamó a una tool con argumentos que no pasan el esquema.
      // Se muestra: es evidencia de que el código valida y no obedece.
      hijos.push(h('p', { clase: 'small' },
        h('span', { texto: 'Llamadas del modelo descartadas por argumentos inválidos: ' }),
        h('code', { texto: r.invalidas.map((x) => (typeof x === 'string' ? x : x?.tool ?? '?')).join(', ') })));
    }
    if (r.resultados) hijos.push(tablaResultados(r.resultados));
    pintar(salida, hijos.length ? hijos : h('p', { clase: 'small', texto: 'El modelo no produjo ningún filtro.' }));
  } catch (e) {
    pintar(salida, error(e));
  }
}

/* ──────────────────────────────── Export ──────────────────────────────── */

/** Export CSV. `/api/exportar` es POST (el `window.location.href` del doc
 *  maestro pegaba un GET y daba 404), así que se baja por fetch → Blob. */
async function exportar(boton, aviso) {
  boton.disabled = true;
  aviso.hidden = false;
  aviso.className = 'estado trabajando';
  aviso.textContent = 'Generando CSV con esquema de 19 columnas…';
  try {
    const res = await fetch('/api/exportar', { method: 'POST' });
    if (!res.ok) {
      let mensaje = `El servidor respondió ${res.status}`;
      try { const j = JSON.parse(await res.text()); mensaje = j.mensaje ?? j.error ?? mensaje; } catch { /* texto plano */ }
      throw new Error(mensaje);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'quorum-base-instalada.csv' });
    document.body.append(a);
    a.click();
    a.remove();
    /*
     * La revocación va DESPUÉS, no en la línea siguiente al `click()`.
     *
     * `click()` solo AGENDA la descarga; Safari y Firefox leen la URL del
     * blob un instante más tarde, y revocarla en el mismo tick cancela la
     * descarga sin decir nada — el aviso de arriba dice «CSV descargado» y no
     * hay archivo. Un timeout basta y no filtra nada: el blob se libera
     * igual, un segundo después.
     */
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    aviso.className = 'estado bueno';
    aviso.textContent = 'CSV descargado. Export local, autorizado por un humano.';
  } catch (e) {
    aviso.className = 'estado malo';
    aviso.textContent = `Export bloqueado o fallido: ${e.message}`;
  } finally {
    boton.disabled = false;
  }
}

/* ───────────────────── Armazón fijo + repintado ───────────────────── */

/**
 * Referencias a los huecos que dependen de `datos`. `null` cuando hay que
 * construir el armazón de nuevo: primera vez, o después de que
 * `pintarPanorama Error()` haya reemplazado la sección por una caja de error.
 */
let ui = null;

function construir(seccion) {
  const cajaConsulta = h('input', {
    id: 'pregunta-nl', type: 'text', autocomplete: 'off',
    placeholder: 'Clientes en Panamá con resonadores de más de siete años',
  });
  // Etiqueta de verdad, asociada por `for`. Un `placeholder` no es etiqueta:
  // desaparece al escribir y varios lectores de pantalla no lo anuncian, así
  // que el campo se leía como «entrada de texto» sin más. Va oculta a la
  // vista porque el título del bloque y el propio ejemplo ya lo explican a
  // quien mira, y duplicarlo sería ornamento.
  const etiquetaConsulta = h('label', {
    clase: 'oculto-visual', for: 'pregunta-nl',
    texto: 'Pregunta en lenguaje natural sobre la base instalada',
  });
  // Región viva: acá aparece la respuesta del modelo y la tabla de
  // resultados. Sin esto, con lector de pantalla la consulta es silencio.
  // `polite`, que es progreso y no una decisión.
  const salidaConsulta = h('div', { clase: 'salida-consulta', role: 'status', 'aria-live': 'polite' });
  const botonPreguntar = h('button', { clase: 'primario', texto: 'Preguntar' });
  botonPreguntar.onclick = () => preguntar(cajaConsulta, salidaConsulta);
  cajaConsulta.onkeydown = (e) => { if (e.key === 'Enter') preguntar(cajaConsulta, salidaConsulta); };

  const avisoExport = h('p', { clase: 'estado', hidden: true });
  const botonExport = h('button', null,
    icono('exportar'), 'Exportar CSV (esquema del workbook, 19 columnas)');
  botonExport.onclick = () => exportar(botonExport, avisoExport);

  const kpis = h('div', { clase: 'kpis' });
  const noComputadas = h('div', { clase: 'no-computadas-caja' });
  const pais = h('div');
  const modalidad = h('div');
  const duplicados = h('ul', { clase: 'duplicados' });
  const bloqueDuplicados = h('section', { clase: 'bloque aviso-humano', hidden: true },
    h('h4', { texto: 'Posibles duplicados de cliente' }),
    h('p', { clase: 'nota', texto: 'Revisión humana requerida. El sistema no fusiona clientes por su cuenta.' }),
    duplicados);
  const cajaVacio = h('div');

  pintar(seccion,
    kpis,
    noComputadas,

    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Consultar en lenguaje natural' }),
      h('p', { clase: 'small', texto: 'El modelo local traduce la pregunta a un filtro. No cuenta ni estima: el filtro lo ejecuta el código.' }),
      h('div', { clase: 'fila' }, etiquetaConsulta, cajaConsulta, botonPreguntar),
      salidaConsulta),

    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Unidades por país' }), pais),

    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Unidades por modalidad' }), modalidad),

    bloqueDuplicados,

    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Export' }),
      h('div', { clase: 'fila' }, botonExport),
      avisoExport),

    cajaVacio);

  return { seccion, kpis, noComputadas, pais, modalidad, duplicados, bloqueDuplicados, cajaVacio };
}

export function pintarPanorama(seccion, datos) {
  const t = datos?.totales ?? {};
  const candidatos = datos?.candidatosFusion ?? [];

  // El armazón se rehace solo si no existe, si es otra sección, o si algo lo
  // sacó del documento (una caja de error, típicamente).
  if (!ui || ui.seccion !== seccion || !seccion.contains(ui.kpis)) ui = construir(seccion);

  pintar(ui.kpis,
    kpi(t.testimonios, 'testimonios'),
    kpi(t.grupos, 'grupos de equipo'),
    kpi(t.conQuorum, 'con quórum', 'ok'),
    kpi(t.sinQuorum, 'sin quórum', 'sinquorum'),
    kpi(t.oportunidades, 'oportunidades'),
    kpi(t.desactualizados, 'sin verificar'));

  pintar(ui.noComputadas, notaNoComputadas(t));
  pintar(ui.pais, barras(datos?.porPais));
  pintar(ui.modalidad, barras(datos?.porModalidad, { conIconoModalidad: true }));

  pintar(ui.duplicados,
    candidatos.map((c) => h('li', null,
      h('b', { texto: String(c.clienteA ?? '?') }),
      h('span', { clase: 'small', texto: ' ↔ ' }),
      h('b', { texto: String(c.clienteB ?? '?') }),
      h('span', { clase: 'small num', texto: ` · similitud ${Number(c.similitud ?? 0).toFixed(2)}` }))));
  ui.bloqueDuplicados.hidden = candidatos.length === 0;

  pintar(ui.cajaVacio, (t.grupos ?? 0) === 0
    ? vacio('Sin base instalada todavía.', 'Los KPIs se llenan cuando haya testimonios confirmados.')
    : null);
}

export function pintarPanoramaError(seccion, mensaje) {
  // La caja de error reemplaza la sección entera, así que el armazón deja de
  // existir: el próximo repintado lo reconstruye.
  ui = null;
  pintar(seccion, error(mensaje));
}
