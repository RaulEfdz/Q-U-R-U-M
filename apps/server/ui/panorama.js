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
 */
import { h, api, pintar, formatearValor, vacio, error, icono, iconoModalidad } from './dom.js';
import { claseEstado, insignia } from './estados.js';

function kpi(valor, etiqueta, clase) {
  return h('div', { clase: ['kpi', clase] },
    h('b', { clase: 'num', texto: String(valor ?? 0) }),
    h('span', { texto: etiqueta }));
}

function barras(pares, { conIconoModalidad = false } = {}) {
  const filas = pares ?? [];
  if (!filas.length) return h('p', { clase: 'small', texto: 'Sin datos suficientes todavía.' });
  const max = Math.max(...filas.map(([, v]) => Number(v) || 0)) || 1;
  return h('div', { clase: 'barras' },
    filas.map(([k, v]) => h('div', { clase: 'barra' },
      // Solo el eje de modalidad lleva icono: para país no existe un set, y
      // meter una bandera ahí sería ornamento — el nombre ya lo dice.
      conIconoModalidad
        ? h('span', { clase: 'barra-etiqueta con-icono' },
            iconoModalidad(String(k), { clase: 'icono-modalidad' }), String(k))
        : h('span', { clase: 'barra-etiqueta', texto: String(k) }),
      h('span', { clase: 'barra-pista' }, h('i', { style: `width:${(Number(v) / max) * 100}%` })),
      h('b', { clase: 'num', texto: String(v) }))));
}

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
    h('thead', null, h('tr', null,
      ['Cliente', 'Ubicación', 'Modalidad', 'Marca', 'Unidades', 'Estado', 'Puntaje']
        .map((t) => h('th', { clase: t === 'Unidades' || t === 'Puntaje' ? 'num' : '', texto: t })))),
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
    URL.revokeObjectURL(url);
    aviso.className = 'estado bueno';
    aviso.textContent = 'CSV descargado. Export local, autorizado por un humano.';
  } catch (e) {
    aviso.className = 'estado malo';
    aviso.textContent = `Export bloqueado o fallido: ${e.message}`;
  } finally {
    boton.disabled = false;
  }
}

export function pintarPanorama(seccion, datos) {
  const t = datos?.totales ?? {};
  const candidatos = datos?.candidatosFusion ?? [];

  const cajaConsulta = h('input', {
    id: 'pregunta-nl', type: 'text', autocomplete: 'off',
    placeholder: 'Clientes en Panamá con resonadores de más de siete años',
  });
  const salidaConsulta = h('div', { clase: 'salida-consulta' });
  const botonPreguntar = h('button', { clase: 'primario', texto: 'Preguntar' });
  botonPreguntar.onclick = () => preguntar(cajaConsulta, salidaConsulta);
  cajaConsulta.onkeydown = (e) => { if (e.key === 'Enter') preguntar(cajaConsulta, salidaConsulta); };

  const avisoExport = h('p', { clase: 'estado', hidden: true });
  const botonExport = h('button', null,
    icono('exportar'), 'Exportar CSV (esquema del workbook, 19 columnas)');
  botonExport.onclick = () => exportar(botonExport, avisoExport);

  pintar(seccion,
    h('div', { clase: 'kpis' },
      kpi(t.testimonios, 'testimonios'),
      kpi(t.grupos, 'grupos de equipo'),
      kpi(t.conQuorum, 'con quórum', 'ok'),
      kpi(t.sinQuorum, 'sin quórum', 'sinquorum'),
      kpi(t.oportunidades, 'oportunidades'),
      kpi(t.desactualizados, 'sin verificar')),

    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Consultar en lenguaje natural' }),
      h('p', { clase: 'small', texto: 'El modelo local traduce la pregunta a un filtro. No cuenta ni estima: el filtro lo ejecuta el código.' }),
      h('div', { clase: 'fila' }, cajaConsulta, botonPreguntar),
      salidaConsulta),

    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Unidades por país' }), barras(datos?.porPais)),

    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Unidades por modalidad' }),
      barras(datos?.porModalidad, { conIconoModalidad: true })),

    candidatos.length
      ? h('section', { clase: 'bloque aviso-humano' },
          h('h4', { texto: 'Posibles duplicados de cliente' }),
          h('p', { clase: 'nota', texto: 'Revisión humana requerida. El sistema no fusiona clientes por su cuenta.' }),
          h('ul', { clase: 'duplicados' },
            candidatos.map((c) => h('li', null,
              h('b', { texto: String(c.clienteA ?? '?') }),
              h('span', { clase: 'small', texto: ' ↔ ' }),
              h('b', { texto: String(c.clienteB ?? '?') }),
              h('span', { clase: 'small num', texto: ` · similitud ${Number(c.similitud ?? 0).toFixed(2)}` })))))
      : null,

    h('section', { clase: 'bloque' },
      h('h4', { texto: 'Export' }),
      h('div', { clase: 'fila' }, botonExport),
      avisoExport),

    (t.grupos ?? 0) === 0
      ? vacio('Sin base instalada todavía.', 'Los KPIs se llenan cuando haya testimonios confirmados.')
      : null);
}

export function pintarPanoramaError(seccion, mensaje) {
  pintar(seccion, error(mensaje));
}
