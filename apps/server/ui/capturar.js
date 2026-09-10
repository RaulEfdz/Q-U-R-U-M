/**
 * capturar.js — pantalla 1. Debe transmitir VELOCIDAD (§B.2): un campo
 * grande, cero formularios. Los campos extraídos aparecen como
 * CONFIRMACIÓN, no como formulario a rellenar — pero son EDITABLES, porque
 * H-03 promete «confirma, corrige o descarta» (corrección obligatoria #14
 * de apps/server/CLAUDE.md: la UI del doc dejaba `#campos` en solo lectura
 * y llamaba a `/api/confirmar` sin `correcciones`).
 *
 * DICTADO: `MediaRecorder` → POST `/api/transcribir` → whisper de QVAC
 * on-device. La API de reconocimiento de voz que trae el navegador está
 * PROHIBIDA: manda el audio a un servidor del proveedor y rompe el
 * requisito de que ninguna inferencia salga del equipo. Acá el navegador
 * solo GRABA; quien transcribe es el modelo local del servidor. Este
 * archivo no la nombra ni la referencia por ningún nombre, a propósito:
 * el control de cumplimiento es un grep automatizado.
 */
import { $, h, api, pintar, formatearValor, icono } from './dom.js';

/** Campos del lote que el humano puede corregir antes de guardar. */
const EDITABLES = [
  { llave: 'cantidad', etiqueta: 'Cantidad', tipo: 'number', min: 1, max: 500, paso: 1 },
  { llave: 'modalidad', etiqueta: 'Modalidad', tipo: 'text' },
  { llave: 'marca', etiqueta: 'Marca', tipo: 'text' },
  { llave: 'modelo', etiqueta: 'Modelo', tipo: 'text' },
  { llave: 'edadAnios', etiqueta: 'Edad (años)', tipo: 'number', min: 0, max: 60, paso: 1 },
];

let borradorActual = null;
/** `{ [observacionId]: { cantidad?, modalidad?, marca?, modelo?, edadAnios? } }` */
let correcciones = {};
let alRefrescar = () => {};

/* ─────────────────────────── Revisión (H-03) ─────────────────────────── */

function anotarCorreccion(obsId, llave, valor) {
  const parche = (correcciones[obsId] ??= {});
  if (valor === undefined) delete parche[llave];
  else parche[llave] = valor;
  if (!Object.keys(parche).length) delete correcciones[obsId];
  $('#corregido').hidden = !Object.keys(correcciones).length;
}

function campoEditable(obs, def) {
  const original = obs.lote?.[def.llave];
  // `edadAnios` puede venir como rango `[a,b]`: eso no se edita con un
  // input numérico, se muestra tal cual y se deja intacto.
  const esRango = Array.isArray(original);

  const input = h('input', {
    // `name` explícito: el `label` que lo envuelve ya lo asocia, pero sin
    // nombre el navegador lo reporta como campo no identificable.
    name: `${obs.id}-${def.llave}`,
    autocomplete: 'off',
    type: esRango ? 'text' : def.tipo,
    value: original === undefined || original === null ? '' : formatearValor(original),
    placeholder: '—',
    readonly: esRango || undefined,
    ...(def.min !== undefined ? { min: String(def.min) } : {}),
    ...(def.max !== undefined ? { max: String(def.max) } : {}),
    ...(def.paso !== undefined ? { step: String(def.paso) } : {}),
    clase: def.tipo === 'number' ? 'num' : '',
    oninput: (e) => {
      if (esRango) return;
      const crudo = e.target.value.trim();
      if (crudo === '') { anotarCorreccion(obs.id, def.llave, undefined); e.target.classList.remove('editado'); return; }
      if (def.tipo === 'number') {
        const n = Number(crudo);
        // `zRangoEdad` y `lote.cantidad` exigen ENTEROS acotados
        // (corrección #13): validamos acá para no perder el lote entero
        // en el servidor por un "7.5".
        const ok = Number.isInteger(n) && n >= def.min && n <= def.max;
        e.target.classList.toggle('invalido', !ok);
        if (!ok) return;
        anotarCorreccion(obs.id, def.llave, n === original ? undefined : n);
      } else {
        anotarCorreccion(obs.id, def.llave, crudo === original ? undefined : crudo);
      }
      e.target.classList.toggle('editado', correcciones[obs.id]?.[def.llave] !== undefined);
    },
  });

  return h('label', { clase: 'campo-editable' },
    h('span', { clase: 'etiqueta', texto: def.etiqueta }), input);
}

function tarjetaLote(obs) {
  const l = obs.lote ?? {};
  return h('div', { clase: 'lote' },
    h('div', { clase: 'lote-cabecera' },
      h('b', { clase: 'num', texto: `${l.cantidad ?? '?'} × ${l.modalidad ?? '?'}` }),
      h('span', { texto: l.marca ?? 'marca desconocida' }),
      h('span', { clase: 'badge naturaleza', texto: obs.naturaleza ?? 'Desconocido' })),
    // La cita literal que justifica ESTE lote: el auditor puede ver qué
    // fragmento de la nota lo produjo (contratos: `evidencia`, requerida).
    obs.evidencia ? h('blockquote', { clase: 'evidencia', texto: obs.evidencia }) : null,
    h('div', { clase: 'campos-editables' }, EDITABLES.map((def) => campoEditable(obs, def))));
}

function pintarRevision(borrador) {
  borradorActual = borrador;
  correcciones = {};
  $('#resumen').textContent = borrador.resumen ?? '';
  pintar($('#campos'), (borrador.observaciones ?? []).map(tarjetaLote));

  const pregunta = borrador.siguientePregunta ?? '';
  const cajaPregunta = $('#pregunta');
  if (pregunta) {
    // Máximo UNA pregunta por nota (regla dura). Si no se responde, el
    // borrador queda 'pendiente-de-revision': nunca se descarta.
    pintar(cajaPregunta,
      h('label', { clase: 'seguimiento-label' },
        h('span', { texto: pregunta }),
        h('input', { id: 'respuesta', type: 'text', placeholder: 'Respuesta (opcional)' })));
    cajaPregunta.hidden = false;
  } else {
    pintar(cajaPregunta);
    cajaPregunta.hidden = true;
  }

  const pendiente = borrador.estadoRevision === 'pendiente-de-revision';
  $('#pendiente').hidden = !pendiente;
  $('#corregido').hidden = true;
  $('#revision').hidden = false;
}

function cerrarRevision() {
  $('#revision').hidden = true;
  pintar($('#campos'));
  borradorActual = null;
  correcciones = {};
}

/* ─────────────────────────── Interpretar ─────────────────────────── */

async function interpretar() {
  const texto = $('#texto').value.trim();
  if (!texto) { estado('Escribí o dictá una nota antes de interpretar.', 'aviso'); return; }
  const boton = $('#enviar');
  boton.disabled = true;
  estado('Interpretando on-device…', 'trabajando');
  try {
    const r = await api('/api/observar', {
      texto,
      // Se manda el `YYYY-MM-DD` crudo del `input[type=date]`: el servidor lo
      // normaliza a ISO (`zFechaVisita`). Convertirlo acá con `new Date()`
      // introduciría el huso horario del navegador en la fecha de la visita.
      ...($('#visita').value ? { visitadoEn: $('#visita').value } : {}),
      fuente: $('#texto').dataset.fuente === 'voz' ? 'voz' : 'texto',
    });
    const inf = r.inferencia ?? {};
    // Chip de ruta de inferencia: pequeño y permanente. Nunca dice "nube",
    // porque nunca la hay: local u otro dispositivo autorizado por P2P.
    pintar($('#ruta'),
      h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: inf.delegado ? '⇄' : '⌂' }),
      h('span', { texto: inf.delegado
        ? 'Inferencia delegada a un dispositivo autorizado de la red'
        : `Inferencia local en este equipo${inf.politica?.razon ? ` · ${inf.politica.razon}` : ''}` }));
    $('#ruta').hidden = false;
    pintarRevision(r.borrador ?? {});
    estado('', null);
  } catch (e) {
    estado(e.message, 'malo');
  } finally {
    boton.disabled = false;
  }
}

async function confirmar() {
  if (!borradorActual) return;
  const boton = $('#confirmar');
  boton.disabled = true;
  try {
    const respuesta = $('#respuesta')?.value.trim();
    const cuerpo = { borradorId: borradorActual.id };
    if (Object.keys(correcciones).length) cuerpo.correcciones = correcciones;
    if (respuesta && borradorActual.siguientePregunta) {
      cuerpo.seguimiento = [{ pregunta: borradorActual.siguientePregunta, respuesta }];
    }
    const r = await api('/api/confirmar', cuerpo);
    cerrarRevision();
    $('#texto').value = '';
    delete $('#texto').dataset.fuente;
    estado(`Guardado: ${r.persistidas ?? 0} testimonio(s).`, 'bueno');
    alRefrescar();
  } catch (e) {
    estado(e.message, 'malo');
  } finally {
    boton.disabled = false;
  }
}

async function descartar() {
  if (!borradorActual) return;
  try {
    await api('/api/descartar', { borradorId: borradorActual.id });
    estado('Borrador descartado. No se guardó nada.', null);
  } catch (e) {
    estado(e.message, 'malo');
  } finally {
    cerrarRevision();
  }
}

function estado(mensaje, tono) {
  const el = $('#estado-captura');
  el.textContent = mensaje ?? '';
  el.className = tono ? `estado ${tono}` : 'estado';
  el.hidden = !mensaje;
}

/* ─────────────────────── Dictado: MediaRecorder ─────────────────────── */

let grabadora = null;

/** Reemplaza el contenido de un boton por icono + etiqueta, sin marcado crudo. */
function etiquetarBoton(boton, nombreIcono, etiqueta) {
  boton.replaceChildren(icono(nombreIcono), document.createTextNode(etiqueta));
}

async function alternarDictado() {
  const boton = $('#dictar');
  if (grabadora) { grabadora.stop(); return; }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    estado('Este navegador no puede grabar audio. Escribí la nota a mano.', 'malo');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    estado('Sin permiso de micrófono. Escribí la nota a mano.', 'malo');
    return;
  }

  const trozos = [];
  const rec = new MediaRecorder(stream);
  grabadora = rec;
  rec.ondataavailable = (e) => { if (e.data?.size) trozos.push(e.data); };

  // Corrección obligatoria #3: el POST vive DENTRO de `onstop`, y no hay
  // ningún `location.reload()` — el reload inmediato del doc maestro
  // cancelaba la subida antes de que whisper devolviera el texto.
  rec.onstop = async () => {
    grabadora = null;
    stream.getTracks().forEach((t) => t.stop());
    // `textContent = ...` borraria el <svg> del boton: se repuebla con el
    // icono del set mas la etiqueta.
    etiquetarBoton(boton, 'microfono', 'Dictar');
    boton.classList.remove('grabando');
    if (!trozos.length) { estado('No se grabó audio.', 'aviso'); return; }
    estado('Transcribiendo on-device con whisper…', 'trabajando');
    try {
      const res = await fetch('/api/transcribir', {
        method: 'POST',
        headers: { 'content-type': 'audio/webm' },
        body: new Blob(trozos, { type: rec.mimeType || 'audio/webm' }),
      });
      if (!res.ok) throw new Error(`/api/transcribir devolvió ${res.status}`);
      const { texto } = await res.json();
      const caja = $('#texto');
      caja.value = [caja.value.trim(), (texto ?? '').trim()].filter(Boolean).join(' ');
      caja.dataset.fuente = 'voz';
      caja.focus();
      estado(texto ? 'Transcrito en este equipo. Revisá antes de interpretar.' : 'La transcripción vino vacía.', texto ? 'bueno' : 'aviso');
    } catch (e) {
      estado(`No se pudo transcribir: ${e.message}`, 'malo');
    }
  };

  rec.start();
  etiquetarBoton(boton, 'detener', 'Detener');
  boton.classList.add('grabando');
  estado('Grabando… el audio no sale de este equipo.', 'trabajando');
}

/* ─────────────────────────────── Montaje ─────────────────────────────── */

export function montarCapturar(refrescar) {
  alRefrescar = refrescar;
  $('#enviar').onclick = interpretar;
  $('#confirmar').onclick = confirmar;
  $('#descartar').onclick = descartar;
  $('#dictar').onclick = alternarDictado;
  // Ctrl/Cmd + Enter interpreta: capturar debe tomar segundos, no minutos.
  $('#texto').onkeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); interpretar(); }
  };
}
