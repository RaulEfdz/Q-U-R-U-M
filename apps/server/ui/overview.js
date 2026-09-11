/**
 * overview.js — pantalla 3. KPIs grandes, distribución por país y modalidad
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
import { h, api, pintar, formatearValor, vacio, error, icono, iconoModalidad, testigos } from './dom.js';
import { claseEstado, insignia, insigniaFrescura } from './states.js';

function kpi(valor, etiqueta, clase) {
  return h('div', { clase: ['kpi', clase] },
    h('b', { clase: 'num', texto: String(valor ?? 0) }),
    h('span', { texto: etiqueta }));
}

/* Gráfico de composición: responde una sola pregunta útil antes de entrar a
 * las listas: ¿cuánta de la base ya tiene quórum y cuánta exige revisión?
 * Los valores también se muestran como texto; el color nunca es la única vía
 * para leer un estado. */
function repartoEstados(totales) {
  const total = Math.max(0, Number(totales?.grupos ?? 0));
  const quorum = Math.min(total, Math.max(0, Number(totales?.conQuorum ?? 0)));
  const disputa = Math.min(total - quorum, Math.max(0, Number(totales?.sinQuorum ?? 0)));
  const pendientes = Math.max(0, total - quorum - disputa);
  const partes = [
    ['con quórum', quorum, 'quorum'],
    ['en disputa', disputa, 'disputa'],
    ['por resolver', pendientes, 'pendiente'],
  ];

  return h('figure', { clase: 'reparto-estados', 'aria-label': 'Estado de los grupos de equipo' },
    h('figcaption', { texto: total
      ? `${total} grupos de equipo: estado de corroboración`
      : 'Aún no hay grupos de equipo para resumir.' }),
    total
      ? h('div', { clase: 'reparto-pista' }, partes.map(([etiqueta, valor, clase]) =>
          h('span', {
            clase: `reparto-segmento ${clase}`,
            style: { flexGrow: String(valor || 0), flexBasis: valor ? '0' : '0px' },
            title: `${valor} ${valor === 1 ? 'grupo' : 'grupos'} ${etiqueta}`,
            tabindex: '0',
            'aria-label': `${valor} ${valor === 1 ? 'grupo' : 'grupos'} ${etiqueta}`,
          })))
      : null,
    h('ul', { clase: 'reparto-leyenda' }, partes.map(([etiqueta, valor, clase]) =>
      h('li', { clase },
        h('span', { clase: 'reparto-marca', 'aria-hidden': 'true' }),
        h('b', { clase: 'num', texto: String(valor) }),
        h('span', { texto: ` ${etiqueta}` })))));
}

const ETIQUETA_OPORTUNIDAD = {
  potential_refresh: 'Posible renovación',
  requires_verification: 'Requiere verificación',
  conflicting_installed_base: 'Base instalada en disputa',
  missing_critical_information: 'Información crítica faltante',
};

function oportunidad(o) {
  const p = o.puntaje ?? {};
  const partesPuntaje = [
    ['edad', p.edad, 30], ['calidad', p.calidad, 25], ['evidencia', p.evidencia, 20],
    ['frescura', p.frescura, 10], ['relevancia', p.relevanciaNegocio, 15],
  ];
  return h('article', { clase: ['oportunidad-central', `prioridad-${o.prioridad ?? 'baja'}`] },
    h('div', { clase: 'oportunidad-cabecera' },
      h('div', null,
        h('span', { clase: 'etiqueta', texto: ETIQUETA_OPORTUNIDAD[o.tipo] ?? 'Prioridad de inteligencia' }),
        h('h5', { texto: `${o.cliente ?? 'Cliente sin nombre'} · ${o.equipo ?? 'Equipo'}` })),
      h('b', { clase: 'oportunidad-puntaje num', texto: `${p.total ?? 0}/100` })),
    h('ul', { clase: 'oportunidad-razones' }, (o.razon ?? []).map((razon) => h('li', { texto: razon }))),
    h('div', { clase: 'oportunidad-meta' },
      h('span', { texto: `confianza ${o.confianza ?? '—'}` }),
      h('span', { texto: `· ${o.frescura ?? '—'}` }),
      h('span', { texto: `· ${Array.isArray(o.evidenciaIds) ? o.evidenciaIds.length : 0} evidencia(s)` })),
    h('p', { clase: 'oportunidad-accion' },
      h('b', { texto: 'Siguiente acción: ' }), o.proximaAccion ?? 'Revisar la evidencia disponible.'),
    h('details', { clase: 'desglose-oportunidad' },
      h('summary', { texto: 'Por qué este puntaje' }),
      h('div', { clase: 'puntaje-barras' }, partesPuntaje.map(([nombre, valor, maximo]) =>
        h('div', { clase: 'puntaje-fila' },
          h('span', { texto: nombre }),
          h('span', { clase: 'puntaje-pista' }, h('i', { style: { width: `${Math.min(100, Math.max(0, Number(valor ?? 0) / maximo * 100))}%` } })),
          h('b', { clase: 'num', texto: `${valor ?? 0}/${maximo}` })) ))));
}

function arbolGeografico(paises) {
  if (!Array.isArray(paises) || !paises.length) return h('p', { clase: 'small', texto: 'Todavía no hay observaciones con ubicación.' });
  const equipo = (g) => h('li', null,
    h('b', { texto: `${g.modalidad ?? 'Equipo'}${g.marca ? ` · ${g.marca}` : ''}` }),
    h('span', { clase: 'small', texto: g.enDisputa
      ? ' · cantidad en disputa'
      : typeof g.unidades === 'number' ? ` · ${g.unidades} unidad(es)` : ' · cantidad desconocida' }),
    Array.isArray(g.sitiosObservados) && g.sitiosObservados.length
      ? h('span', { clase: 'small', texto: ` · sitio(s) observado(s): ${g.sitiosObservados.join(', ')}` }) : null);
  const cliente = (c) => h('details', { clase: 'geo-nivel cliente' },
    h('summary', { texto: c.cliente ?? 'Cliente sin nombre' }),
    h('ul', { clase: 'geo-equipos' }, (c.grupos ?? []).map(equipo)));
  const ciudad = (c) => h('details', { clase: 'geo-nivel ciudad' },
    h('summary', { texto: c.ciudad ?? 'Sin ciudad' }),
    (c.clientes ?? []).map(cliente));
  const pais = (p) => h('details', { clase: 'geo-nivel', open: true },
    h('summary', { texto: p.pais ?? 'Sin país' }),
    (p.ciudades ?? []).map(ciudad));
  return h('div', { clase: 'arbol-geografico' }, paises.map(pais));
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
  // Mismo dato que Cliente 360 ya trata como el eje central para juzgar una
  // fila (RD-4): quién lo sostiene y hace cuánto se verificó. Sin esto, una
  // pregunta como «clientes con resonadores de más de 7 años» devolvía un
  // resultado con badge de estado pero para saber quién lo dijo había que
  // volver a Cliente 360 y buscar el mismo cliente a mano.
  const campoTestigos = c.totalUnidades ?? c.modalidad ?? {};
  return h('tr', { clase: claseEstado(g.estadoGeneral) },
    h('td', { texto: g.cliente?.nombre ?? '—' }),
    h('td', { texto: [g.cliente?.ciudad, g.cliente?.pais].filter(Boolean).join(', ') || '—' }),
    h('td', { texto: formatearValor(c.modalidad?.valor) }),
    h('td', { texto: formatearValor(c.marca?.valor) }),
    h('td', { clase: 'num', texto: formatearValor(c.totalUnidades?.valor) }),
    // Mismo cuidado que en client.js: `.quienes` es `display: flex` y eso
    // tiene que vivir en un `<div>` adentro del `<td>`, nunca en el `<td>`
    // mismo — o rompe el ancho de columna de la tabla.
    h('td', null, h('div', { clase: 'quienes' },
      campoTestigos.estado === 'Sin datos' ? h('span', { clase: 'small', texto: 'nadie lo reportó' })
        : h('span', { texto: testigos((campoTestigos.observadores ?? []).length) }),
      insigniaFrescura(campoTestigos))),
    h('td', null, insignia(g.estadoGeneral)),
    h('td', { clase: 'num', texto: String(g.puntaje?.total ?? '—') }));
}

function tablaResultados(grupos) {
  if (!grupos.length) return h('p', { clase: 'small', texto: 'El filtro no devolvió clientes.' });
  return h('table', { clase: 'resultados' },
    // `scope="col"`: un lector de pantalla necesita poder nombrar la columna
    // al leer una celda; ocho columnas sueltas no se entienden.
    h('thead', null, h('tr', null,
      ['Cliente', 'Ubicación', 'Modalidad', 'Marca', 'Unidades', 'Testigos', 'Estado', 'Puntaje']
        .map((t) => h('th', {
          scope: 'col',
          clase: t === 'Unidades' || t === 'Puntaje' ? 'num' : '',
          texto: t,
        })))),
    h('tbody', null, grupos.map(filaResultado)));
}

/**
 * Consulta en vuelo, si hay una. Igual que la fuga de instancias documentada
 * en `CLAUDE.md` (bug #15, `cargarLLMDelegado` no cachea por request): sin
 * bloquear el botón/input, un doble click o un Enter repetido mientras el
 * modelo local todavía piensa dispara una segunda llamada a `/api/consultar`
 * encima de la primera, y la agrava. `exportar()`, en este mismo archivo, sí
 * se protege así — esta era la única acción de la pantalla que no lo hacía.
 */
let consultaEnCurso = null;

async function preguntar(cajaTexto, salida, boton) {
  if (consultaEnCurso) return;
  const pregunta = cajaTexto.value.trim();
  if (!pregunta) return;

  const control = new AbortController();
  consultaEnCurso = control;
  boton.disabled = true;
  cajaTexto.disabled = true;

  const cancelar = h('button', { type: 'button', clase: 'small', texto: 'Cancelar' });
  cancelar.onclick = () => control.abort();
  pintar(salida, h('p', { clase: 'estado trabajando', texto: 'Consultando al modelo local…' }), cancelar);

  try {
    const r = await api('/api/consultar', { pregunta }, { senal: control.signal });
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
    pintar(salida, control.signal.aborted
      ? h('p', { clase: 'estado aviso', texto: 'Consulta cancelada.' })
      : error(e));
  } finally {
    boton.disabled = false;
    cajaTexto.disabled = false;
    consultaEnCurso = null;
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
  botonPreguntar.onclick = () => preguntar(cajaConsulta, salidaConsulta, botonPreguntar);
  cajaConsulta.onkeydown = (e) => { if (e.key === 'Enter') preguntar(cajaConsulta, salidaConsulta, botonPreguntar); };

  const avisoExport = h('p', { clase: 'estado', hidden: true });
  const botonExport = h('button', null,
    icono('exportar'), 'Exportar CSV (esquema del workbook, 19 columnas)');
  botonExport.onclick = () => exportar(botonExport, avisoExport);

  const kpis = h('div', { clase: 'kpis' });
  const contexto = h('div', { clase: 'contexto-control' });
  const noComputadas = h('div', { clase: 'no-computadas-caja' });
  const prioridades = h('div', { clase: 'lista-oportunidades' });
  const resumenPrioridades = h('div', { clase: 'resumen-prioridades' });
  const calidad = h('div', { clase: 'calidad-inteligencia' });
  const estadoGrupos = h('div');
  const geografia = h('div');
  const pais = h('div');
  const modalidad = h('div');
  const duplicados = h('ul', { clase: 'duplicados' });
  const bloqueDuplicados = h('section', { clase: 'bloque aviso-humano', hidden: true },
    h('h4', { texto: 'Posibles duplicados de cliente' }),
    h('p', { clase: 'nota', texto: 'Revisión humana requerida. El sistema no fusiona clientes por su cuenta.' }),
    duplicados);
  const cajaVacio = h('div');

  const panelDecisiones = h('div', { id: 'panel-decisiones', clase: 'seccion-inteligencia' },
    h('section', { clase: 'bloque bloque-prioridades' },
      h('div', { clase: 'cabecera-prioridades' },
        h('div', null,
          h('h4', { texto: 'Prioridades explicables' }),
          h('p', { clase: 'nota', texto: 'Señales de evidencia para decidir qué verificar primero.' })),
        resumenPrioridades),
      prioridades),
    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Calidad de la base instalada' }), estadoGrupos, calidad));

  const panelCobertura = h('div', { id: 'panel-cobertura', clase: 'seccion-inteligencia' },
    h('div', { clase: 'tablero-doble' },
      h('section', { clase: 'bloque' }, h('h4', { texto: 'Unidades por país' }), pais),
      h('section', { clase: 'bloque' }, h('h4', { texto: 'Unidades por modalidad' }), modalidad)),
    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Panorama geográfico' }),
      h('p', { clase: 'nota', texto: 'País → ciudad → cliente → equipo. Los sitios se muestran como observados: todavía no son una asignación reconciliada de equipo.' }),
      geografia));

  const panelExplorar = h('div', { id: 'panel-explorar', clase: 'seccion-inteligencia' },
    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Consultar en lenguaje natural' }),
      h('p', { clase: 'small', texto: 'El modelo local traduce la pregunta a un filtro. No cuenta ni estima: el filtro lo ejecuta el código.' }),
      h('div', { clase: 'fila' }, etiquetaConsulta, cajaConsulta, botonPreguntar),
      salidaConsulta),
    bloqueDuplicados,
    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Exportar evidencia' }),
      h('p', { clase: 'small', texto: 'El CSV conserva el esquema de 19 columnas y solo se genera por una acción humana local.' }),
      h('div', { clase: 'fila' }, botonExport),
      avisoExport));

  pintar(seccion,
    contexto,
    kpis,
    noComputadas,
    panelDecisiones,
    panelCobertura,
    panelExplorar,

    cajaVacio);

  return { seccion, contexto, kpis, noComputadas, prioridades, resumenPrioridades, calidad, estadoGrupos, geografia, pais, modalidad, duplicados, bloqueDuplicados, cajaVacio };
}

export function pintarPanorama(seccion, datos) {
  const t = datos?.totales ?? {};
  const candidatos = datos?.candidatosFusion ?? [];
  const inteligencia = datos?.inteligencia ?? {};
  const resumen = inteligencia.resumen ?? {};
  const calidad = inteligencia.calidad ?? {};
  const oportunidades = Array.isArray(inteligencia.oportunidades) ? inteligencia.oportunidades : [];

  // El armazón se rehace solo si no existe, si es otra sección, o si algo lo
  // sacó del documento (una caja de error, típicamente).
  if (!ui || ui.seccion !== seccion || !seccion.contains(ui.kpis)) ui = construir(seccion);

  const alertas = (calidad.conflictos ?? 0) + (calidad.desactualizados ?? 0) + (calidad.faltantesCriticos ?? 0);
  pintar(ui.contexto,
    h('div', null,
      h('h2', { texto: 'Qué necesita decisión ahora' }),
      h('p', { texto: 'La vista central ordena evidencia de campo en prioridades verificables. Ningún total en disputa se presenta como un hecho.' })),
    h('p', { clase: ['estado-control', alertas > 0 && 'con-alertas'],
      texto: alertas > 0
        ? `${alertas} señal(es) requieren revisión entre ${resumen.clientes ?? 0} customer(s).`
        : `Sin señales abiertas en ${resumen.clientes ?? 0} customer(s) con evidencia actual.` }));

  pintar(ui.kpis,
    kpi(resumen.clientes, 'customers'),
    kpi(resumen.sitiosObservados, 'sitios observados'),
    kpi(resumen.equiposConCantidadConocida, 'equipos conocidos'),
    kpi(t.testimonios, 'testimonios'),
    kpi(t.grupos, 'grupos de equipo'),
    kpi(t.conQuorum, 'con quórum', 'ok'),
    kpi(t.sinQuorum, 'sin quórum', 'sinquorum'),
    kpi(oportunidades.length, 'prioridades abiertas'),
    kpi(t.desactualizados, 'sin verificar'));

  pintar(ui.noComputadas, notaNoComputadas(t));
  pintar(ui.prioridades,
    oportunidades.length
      ? oportunidades.map(oportunidad)
      : h('p', { clase: 'small', texto: 'No hay prioridades generadas todavía. La evidencia nueva aparecerá acá cuando requiera una acción.' }));
  const altas = oportunidades.filter((o) => o.prioridad === 'alta').length;
  const requierenRevision = oportunidades.filter((o) => o.frescura !== 'vigente').length;
  pintar(ui.resumenPrioridades,
    h('b', { clase: 'num', texto: String(oportunidades.length) }), h('span', { texto: ' abiertas' }),
    altas ? h('b', { clase: 'prioridades-alerta num', texto: `${altas} alta${altas === 1 ? '' : 's'}` }) : null,
    requierenRevision ? h('span', { clase: 'prioridades-revision', texto: `${requierenRevision} revisar` }) : null);
  pintar(ui.calidad,
    h('p', { texto: `${calidad.conflictos ?? 0} conflicto(s) · ${calidad.desactualizados ?? 0} grupo(s) sin verificar · ${calidad.faltantesCriticos ?? 0} con información crítica faltante.` }),
    h('p', { clase: 'small', texto: `${calidad.sitiosNoReconciliados ?? 0} sitio(s) observados. La asignación de equipo por site requiere extender el contrato compartido; no se infiere acá.` }));
  pintar(ui.estadoGrupos, repartoEstados(t));
  pintar(ui.geografia, arbolGeografico(inteligencia.geografia));
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
