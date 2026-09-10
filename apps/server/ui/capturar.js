/**
 * capturar.js — pantalla 1. Debe transmitir VELOCIDAD (§B.2): un campo
 * grande, cero formularios. Los campos extraídos aparecen como
 * CONFIRMACIÓN, no como formulario a rellenar — pero son EDITABLES, porque
 * H-03 promete «confirma, corrige o descarta» (corrección obligatoria #14
 * de apps/server/CLAUDE.md: la UI del doc dejaba `#campos` en solo lectura
 * y llamaba a `/api/confirmar` sin `correcciones`).
 *
 * DICTADO: WebAudio (WAV PCM 16 kHz) → POST `/api/transcribir` → whisper de
 * QVAC on-device. El doc maestro dice `MediaRecorder`, pero eso solo produce
 * webm/opus a 48 kHz y whisper devuelve basura con ese formato; lo esencial de
 * la restricción se respeta igual — el audio se captura acá, va al server
 * LOCAL y lo transcribe whisper en este equipo. NUNCA Web Speech API.
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

/* ──────────────── Dictado: WebAudio → WAV PCM 16 kHz mono ──────────────── */

let grabadora = null;

/** Reemplaza el contenido de un boton por icono + etiqueta, sin marcado crudo. */
function etiquetarBoton(boton, nombreIcono, etiqueta) {
  boton.replaceChildren(icono(nombreIcono), document.createTextNode(etiqueta));
}

async function alternarDictado() {
  const boton = $('#dictar');
  if (grabadora) { grabadora.stop(); return; }

  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
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

  /*
   * ★ WAV PCM 16 kHz mono escrito a mano, NO `MediaRecorder`.
   *
   * `MediaRecorder` produce webm/opus a 48 kHz — es lo único que ofrece
   * Chrome — y whisper.cpp espera PCM de 16 kHz mono. Medido: el mismo audio
   * dictado dio `" you"` como webm y transcribió la frase completa como WAV
   * 16k. O sea, el dictado devolvía basura y parecía un problema del modelo.
   *
   * Se captura con WebAudio, se re-muestrea a 16 kHz y se arma la cabecera
   * RIFF acá. Cero dependencias y sin transcodificar en el server, que tiene
   * tres dependencias contadas y ninguna es ffmpeg.
   */
  const ctx = new AudioContext();
  const fuente = ctx.createMediaStreamSource(stream);
  // ScriptProcessor está deprecado pero es el único camino sin un archivo
  // aparte para el worklet: `addModule` necesita una URL, y eso significaría
  // servir otro estático solo para esto.
  const nodo = ctx.createScriptProcessor(4096, 1, 1);
  const trozos = [];
  let muestras = 0;

  nodo.onaudioprocess = (e) => {
    const entrada = e.inputBuffer.getChannelData(0);
    trozos.push(new Float32Array(entrada));   // copia: el buffer se reusa
    muestras += entrada.length;
  };
  fuente.connect(nodo);
  // Destino silenciado: sin conectar a algo, varios navegadores no corren el
  // procesador; con `gain 0` no se escucha el propio micrófono por el parlante.
  const silencio = ctx.createGain();
  silencio.gain.value = 0;
  nodo.connect(silencio);
  silencio.connect(ctx.destination);

  /** Float32 [-1,1] → PCM 16 bits little-endian, re-muestreado a 16 kHz. */
  function aWav(bloques, totalMuestras, tasaOriginal) {
    const DESTINO = 16_000;
    const plano = new Float32Array(totalMuestras);
    let i = 0;
    for (const b of bloques) { plano.set(b, i); i += b.length; }

    // Re-muestreo lineal: para voz a 16 kHz alcanza y no necesita librería.
    const largo = Math.max(1, Math.round(totalMuestras * DESTINO / tasaOriginal));
    const pcm = new Int16Array(largo);
    for (let n = 0; n < largo; n++) {
      const pos = n * tasaOriginal / DESTINO;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const a = plano[i0] ?? 0;
      const b = plano[i0 + 1] ?? a;
      const v = Math.max(-1, Math.min(1, a + (b - a) * frac));
      pcm[n] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }

    const cab = new ArrayBuffer(44);
    const d = new DataView(cab);
    const txt = (off, str) => { for (let k = 0; k < str.length; k++) d.setUint8(off + k, str.charCodeAt(k)); };
    txt(0, 'RIFF'); d.setUint32(4, 36 + pcm.byteLength, true); txt(8, 'WAVE');
    txt(12, 'fmt '); d.setUint32(16, 16, true);
    d.setUint16(20, 1, true);                 // PCM sin comprimir
    d.setUint16(22, 1, true);                 // mono
    d.setUint32(24, DESTINO, true);
    d.setUint32(28, DESTINO * 2, true);       // bytes por segundo
    d.setUint16(32, 2, true);                 // bytes por muestra
    d.setUint16(34, 16, true);                // bits por muestra
    txt(36, 'data'); d.setUint32(40, pcm.byteLength, true);
    return new Blob([cab, pcm], { type: 'audio/wav' });
  }

  // Corrección obligatoria #3: el POST vive DENTRO del handler de detención, y
  // no hay ningún `location.reload()` — el reload inmediato del doc maestro
  // cancelaba la subida antes de que whisper devolviera el texto.
  grabadora = {
    async stop() {
      grabadora = null;
      nodo.disconnect(); fuente.disconnect(); silencio.disconnect();
      nodo.onaudioprocess = null;
      const tasa = ctx.sampleRate;
      stream.getTracks().forEach((t) => t.stop());
      try { await ctx.close(); } catch { /* ya cerrado */ }

      etiquetarBoton(boton, 'microfono', 'Dictar');
      boton.classList.remove('grabando');
      if (!muestras) { estado('No se grabó audio.', 'aviso'); return; }

      estado('Transcribiendo on-device con whisper…', 'trabajando');
      try {
        const res = await fetch('/api/transcribir', {
          method: 'POST',
          headers: { 'content-type': 'audio/wav' },
          body: aWav(trozos, muestras, tasa),
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
    },
  };

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
