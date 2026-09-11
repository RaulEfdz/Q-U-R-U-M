/**
 * app.js — cascarón: navegación entre las cinco pantallas, refresco de
 * datos y stream de eventos del servidor.
 *
 * Cero dependencias, cero build, cero framework. Módulos ES nativos
 * servidos como archivos estáticos desde `apps/server/ui/`.
 */
import { $, api, pintar, h } from './dom.js';
import { montarCapturar } from './capture.js';
import { pintarCliente, pintarClienteError } from './client.js';
import { pintarPanorama, pintarPanoramaError } from './overview.js';
import { pintarAuditoria } from './audit.js';
import { pintarConexiones } from './connections.js';
import { pintarComoFunciona } from './how-it-works.js';
import { actualizarAyuda, montarAyuda } from './help.js';

let vistaActual = 'panorama';
let resumenBase = '0 grupos · 0 con quórum · 0 sin quórum';

function mostrarResumenConexiones({ total, conectados }) {
  if (vistaActual !== 'conexiones') return;
  $('#marcador').textContent = `${total} ${total === 1 ? 'dispositivo visto' : 'dispositivos vistos'} · ${conectados} ${conectados === 1 ? 'conectado' : 'conectados'} ahora`;
}

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
  if (d.meta?.modeloIA) {
    $('#modelo-ia').textContent = `IA local · ${d.meta.modeloIA}`;
    const captura = $('#modelo-captura-label');
    if (captura) captura.textContent = `IA local · ${d.meta.modeloIA}`;
  }
  const t = d.totales ?? {};
  resumenBase = `${t.grupos ?? 0} grupos · ${t.conQuorum ?? 0} con quórum · ${t.sinQuorum ?? 0} sin quórum`;
  if (vistaActual !== 'conexiones') $('#marcador').textContent = resumenBase;

  /*
   * Pendiente #5 de SYNC_P2P.md: "estado de sync visible en la UI". El
   * servidor ya cuenta peers conectados AHORA (`syncActivo.pares()`, no el
   * tamaño de la allowlist) y lo manda en `meta.peersConectados`; el evento
   * SSE `cambio` se dispara solo cuando esa cifra cambia (peer.ts), así que
   * este chip queda al día sin polling propio.
   */
  const peers = d.meta?.peersConectados ?? 0;
  const chipPeers = $('#sync-peers');
  if (chipPeers) {
    chipPeers.hidden = peers === 0;
    chipPeers.textContent = peers === 1
      ? '● 1 dispositivo sincronizando'
      : `● ${peers} dispositivos sincronizando`;
  }
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
 * cumplir. Hoy nadie la espera (`capture.js` llama `alRefrescar()` sin
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
  actualizarAyuda(vista);
  const titulo = document.querySelector('#vista-titulo');
  if (titulo) titulo.textContent = { capturar: 'Capturar', cliente: 'Cliente 360', panorama: 'Inteligencia', auditoria: 'Auditoría', conexiones: 'Conexiones', comofunciona: 'Cómo funciona' }[vista] ?? vista;
  document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.id !== vista; });
  document.querySelectorAll('nav button').forEach((b) => {
    const activo = b.dataset.vista === vista;
    b.classList.toggle('activo', activo);
    b.setAttribute('aria-current', activo ? 'page' : 'false');
  });
  if (vista === 'auditoria') pintarAuditoria($('#auditoria'));
  if (vista === 'conexiones') pintarConexiones($('#conexiones'), mostrarResumenConexiones);
  else $('#marcador').textContent = resumenBase;
  // «Cómo funciona» no depende de datos, así que se pinta al abrirla y una
  // sola vez (el módulo lleva su propia guarda): no entra en `repintar()`
  // porque no hay nada que refrescar, y repintarla perdería la posición de
  // scroll de quien está leyendo.
  if (vista === 'comofunciona') pintarComoFunciona($('#comofunciona'));
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
    // Mismo evento que dispara el chip de peers del sidebar (onParesCambio,
    // ver index.ts): un dispositivo que se conecta o se cae repinta la
    // lista si es lo que se está mirando ahora mismo.
    if (vistaActual === 'conexiones') pintarConexiones($('#conexiones'), mostrarResumenConexiones);
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
montarAyuda();
conectarStream();
mostrar('panorama', { foco: false });
refrescar();
