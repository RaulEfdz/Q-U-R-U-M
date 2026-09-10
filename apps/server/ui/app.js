/**
 * app.js — cascarón: navegación entre las cuatro pantallas, refresco de
 * datos y stream de eventos del servidor.
 *
 * Cero dependencias, cero build, cero framework. Módulos ES nativos
 * servidos como archivos estáticos desde `apps/server/ui/`.
 */
import { $, api, pintar, h } from './dom.js';
import { montarCapturar } from './capturar.js';
import { pintarCliente, pintarClienteError } from './cliente.js';
import { pintarPanorama, pintarPanoramaError } from './panorama.js';
import { pintarAuditoria } from './auditoria.js';

let vistaActual = 'capturar';

/* ───────────────────────────── Refresco ───────────────────────────── */

async function repintar() {
  let d;
  try {
    d = await api('/api/base-instalada');
  } catch (e) {
    pintarClienteError($('#cliente'), e.message);
    pintarPanoramaError($('#panorama'), e.message);
    return;
  }
  pintarCliente($('#cliente'), d);
  pintarPanorama($('#panorama'), d);
  const t = d.totales ?? {};
  $('#marcador').textContent =
    `${t.grupos ?? 0} grupos · ${t.conQuorum ?? 0} con quórum · ${t.sinQuorum ?? 0} sin quórum`;
}

/*
 * Confirmar una captura dispara DOS refrescos casi simultáneos: el de la
 * propia pantalla de captura y el del evento SSE `cambio`. Sin coalescer,
 * el segundo repinta encima del primero y se COME la animación del ascenso
 * a quórum — que es el pico del video. Así que se agrupan en un solo
 * repintado, y nunca corren dos a la vez.
 */
const ESPERA_COALESCIDO = 150;
let temporizador = null;
let enVuelo = null;
let pendiente = false;
/*
 * Quienes esperan el repintado que está por venir.
 *
 * Coalescer significa descartar el temporizador anterior, y antes eso dejaba
 * colgado para siempre el `resolve` de la promesa que ese temporizador iba a
 * cumplir. Hoy nadie la espera (`capturar.js` llama `alRefrescar()` sin
 * `await`), así que no se veía — pero el primer `await refrescar()` que
 * alguien escribiera se colgaba. Los resolvedores se ACUMULAN: el refresco
 * que finalmente corre es también el de todos los pedidos que absorbió, así
 * que cumplirlos a todos es lo correcto, no un parche.
 */
let esperando = [];

export function refrescar() {
  if (temporizador) clearTimeout(temporizador);
  return new Promise((resolve) => {
    esperando.push(resolve);
    temporizador = setTimeout(async () => {
      temporizador = null;
      const cumplir = esperando;
      esperando = [];
      try {
        if (enVuelo) { pendiente = true; await enVuelo; }
        enVuelo = repintar();
        try { await enVuelo; } finally { enVuelo = null; }
        if (pendiente) { pendiente = false; await repintar(); }
      } finally {
        // `finally`: si el repintado explota, quien espera se entera igual.
        // Una promesa colgada es peor que un repintado fallido.
        for (const r of cumplir) r();
      }
    }, ESPERA_COALESCIDO);
  });
}

/* ──────────────────────────── Navegación ──────────────────────────── */

/**
 * `mostrar(vista, { foco })` — cambia de pantalla.
 *
 * `foco: true` mueve el foco a la sección que se abre. Sin eso, con teclado
 * el foco se quedaba en el botón de navegación y había que recorrer el header
 * entero otra vez para llegar al contenido recién abierto. Se mueve a la
 * sección y no al primer control de adentro: la sección tiene `aria-label`,
 * así que el lector de pantalla anuncia a dónde llegó, y no se decide por el
 * usuario cuál es el control importante.
 *
 * En el arranque va `foco: false`: robarle el foco a la página apenas carga
 * mueve el punto de lectura de quien todavía no pidió nada.
 */
function mostrar(vista, { foco = true } = {}) {
  vistaActual = vista;
  const titulo = document.querySelector('#vista-titulo');
  if (titulo) titulo.textContent = { capturar: 'Capturar', cliente: 'Cliente 360', panorama: 'Panorama', auditoria: 'Auditoría' }[vista] ?? vista;
  document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.id !== vista; });
  document.querySelectorAll('nav button').forEach((b) => {
    const activo = b.dataset.vista === vista;
    b.classList.toggle('activo', activo);
    b.setAttribute('aria-current', activo ? 'page' : 'false');
  });
  if (vista === 'auditoria') pintarAuditoria($('#auditoria'));
  if (foco) $(`#${vista}`)?.focus();
}

document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => mostrar(b.dataset.vista);
});

/* ─────────── SSE: el cambio y la denegación aparecen solos ─────────── */

function bandaDenegado(d) {
  const alerta = $('#alerta');
  // Todo lo que viene del evento es dato del servidor: `textContent`.
  pintar(alerta,
    h('div', { clase: 'alerta-cuerpo' },
      h('b', { texto: 'ACCIÓN DENEGADA POR POLÍTICA' }),
      h('div', null, h('span', { texto: 'herramienta: ' }), h('code', { texto: String(d.tool ?? '?') })),
      h('div', null, h('span', { texto: 'política: ' }),
        h('code', { texto: `${d.policyId ?? '?'}@${d.version ?? '?'}` })),
      h('div', null, h('span', { texto: 'razón: ' }), h('span', { texto: String(d.reason ?? '') })),
      h('div', null, h('span', { texto: 'trace: ' }), h('code', { texto: String(d.traceId ?? '?') }))),
    h('button', { clase: 'cerrar', 'aria-label': 'Cerrar aviso', texto: '×',
      onclick: () => { $('#alerta').hidden = true; } }));
  alerta.hidden = false;
}

function conectarStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('cambio', () => {
    refrescar();
    if (vistaActual === 'auditoria') pintarAuditoria($('#auditoria'));
  });
  es.addEventListener('policy-denied', (e) => {
    try { bandaDenegado(JSON.parse(e.data)); } catch { /* evento malformado: se ignora */ }
  });
  es.onopen = () => { $('#conexion').className = 'conexion viva'; $('#conexion').textContent = 'en vivo'; };
  es.onerror = () => { $('#conexion').className = 'conexion muerta'; $('#conexion').textContent = 'sin conexión'; };
  return es;
}

/* ────────────────────────────── Arranque ────────────────────────────── */

montarCapturar(refrescar);
conectarStream();
mostrar('capturar', { foco: false });
refrescar();
