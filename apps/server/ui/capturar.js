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
import { $, h, api, pintar, formatearValor, icono, error, testimonios } from './dom.js';
import { explicar } from './errores.js';

/*
 * VOCABULARIO CONTROLADO de modalidad — copia literal de `MODALIDADES` en
 * `src/core/contracts.ts`.
 *
 * Está duplicado a mano porque esta UI es JS plano sin build y no puede
 * importar de un `.ts`. SI CAMBIA EL CONTRATO, HAY QUE ACTUALIZAR ESTA LISTA:
 * es el único lugar de `ui/` donde vive el vocabulario.
 *
 * Y tiene que estar acá porque `modalidad` era un input de texto libre contra
 * un `z.enum` cerrado del servidor: quien escribía «MRI», «mr» o «resonador»
 * —lo que una persona escribe naturalmente— se comía un 400 de
 * `/api/confirmar` que tiraba TODAS las correcciones del lote, no solo la
 * mala. Un vocabulario cerrado no se corrige escribiendo; se elige.
 *
 * `marca` NO recibe el mismo trato a propósito: el servidor la acepta como
 * string libre (`z.string().min(1).max(120)`), así que ahí no hay nada que
 * cerrar y una lista de marcas sería una restricción inventada por la UI.
 */
const MODALIDADES = [
  'MR', 'CT', 'Ultrasound', 'XRay', 'PatientMonitoring', 'ImageGuidedTherapy',
];

/** Campos del lote que el humano puede corregir antes de guardar. */
const EDITABLES = [
  { llave: 'cantidad', etiqueta: 'Cantidad', tipo: 'number', min: 1, max: 500, paso: 1 },
  { llave: 'modalidad', etiqueta: 'Modalidad', tipo: 'seleccion', opciones: MODALIDADES },
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

/**
 * Control de un campo con VOCABULARIO CERRADO: un `<select>`, no un input.
 *
 * Comparte la marca de `editado` con los inputs de texto —borde de acción
 * cuando el valor difiere del que propuso el modelo— y el mismo
 * `anotarCorreccion`, así que la nota «Corregiste campos» y el envío de
 * `correcciones` funcionan igual sin saber qué tipo de control lo produjo.
 */
function selectorVocabulario(obs, def, original) {
  const actual = original === undefined || original === null ? '' : String(original);
  // Si el modelo devolvió un valor fuera de la lista (no debería: el servidor
  // ya lo validó contra el enum), se agrega como opción en vez de cambiarlo
  // por lo bajo. La UI no decide por el humano, ni siquiera para corregir.
  const opciones = actual && !def.opciones.includes(actual)
    ? [actual, ...def.opciones]
    : def.opciones;

  const select = h('select', {
    name: `${obs.id}-${def.llave}`,
    clase: 'select-vocabulario',
    onchange: (e) => {
      const valor = e.target.value;
      // El valor vacío no se manda: `modalidad` es requerida en el lote y un
      // `''` volvería a ser el 400 que este cambio vino a eliminar.
      anotarCorreccion(obs.id, def.llave, !valor || valor === actual ? undefined : valor);
      e.target.classList.toggle('editado', correcciones[obs.id]?.[def.llave] !== undefined);
    },
  },
  // La opción vacía existe SOLO cuando el modelo no extrajo nada: si extrajo
  // una modalidad, vaciarla no es una corrección posible.
  actual === '' ? h('option', { value: '', texto: '—' }) : null,
  opciones.map((v) => h('option', { value: v, texto: v })));

  select.value = actual;
  return select;
}

function campoEditable(obs, def) {
  const original = obs.lote?.[def.llave];

  if (def.tipo === 'seleccion') {
    return h('label', { clase: 'campo-editable' },
      h('span', { clase: 'etiqueta', texto: def.etiqueta }),
      selectorVocabulario(obs, def, original));
  }

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
  // El chip de ruta describe DÓNDE corrió la inferencia de un borrador
  // concreto. Si el borrador se va, el chip se va con él: dejarlo en pantalla
  // afirmaba «Inferencia local en este equipo» sobre algo que ya no existe.
  $('#ruta').hidden = true;
  pintar($('#ruta'));
  borradorActual = null;
  correcciones = {};
}

/* ─────────────────────────── Interpretar ─────────────────────────── */

/**
 * Muestra una falla con el texto accionable de `errores.js`: el titular en la
 * región viva (se anuncia una vez) y la explicación con sus pasos en la caja
 * de abajo. Acá NO se redacta nada: si falta un caso, la entrada nueva va en
 * el diccionario, no en esta pantalla.
 */
function fallar(e) {
  estado(explicar(e).titulo, 'malo');
  const caja = $('#falla-captura');
  pintar(caja, error(e));
  caja.hidden = false;
}

function limpiarFalla() {
  const caja = $('#falla-captura');
  pintar(caja);
  caja.hidden = true;
}

/** ¿Hay una interpretación en vuelo? Mientras la haya, dictar está vedado:
 *  la transcripción escribe en el textarea que se está interpretando y
 *  pisaría el texto que produjo el borrador que está por aparecer. */
let interpretando = false;

async function interpretar() {
  if (interpretando) return;
  const texto = $('#texto').value.trim();
  if (!texto) { estado('Escribí o dictá una nota antes de interpretar.', 'aviso'); return; }
  const boton = $('#enviar');
  interpretando = true;
  boton.disabled = true;
  $('#dictar').disabled = true;
  limpiarFalla();
  estado('Interpretando on-device… la primera vez puede incluir la carga del modelo.', 'trabajando');
  const detenerLatido = latido();
  const tope = conTope(TOPE_INTERPRETAR, 'interpretación');
  try {
    const r = await api('/api/observar', {
      texto,
      // Se manda el `YYYY-MM-DD` crudo del `input[type=date]`: el servidor lo
      // normaliza a ISO (`zFechaVisita`). Convertirlo acá con `new Date()`
      // introduciría el huso horario del navegador en la fecha de la visita.
      ...($('#visita').value ? { visitadoEn: $('#visita').value } : {}),
      fuente: $('#texto').dataset.fuente === 'voz' ? 'voz' : 'texto',
    }, { senal: tope.senal });
    const inf = r.inferencia ?? {};
    // Chip de ruta de inferencia: pequeño y permanente. Nunca dice "nube",
    // porque nunca la hay: local u otro dispositivo autorizado por P2P.
    const modelo = inf.modelo ? ` · modelo ${inf.modelo}` : '';
    pintar($('#ruta'),
      h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: inf.delegado ? '⇄' : '⌂' }),
      h('span', { texto: inf.delegado
        ? `Inferencia delegada a un dispositivo autorizado de la red${modelo}`
        : `Inferencia local en este equipo${modelo}${inf.politica?.razon ? ` · ${inf.politica.razon}` : ''}` }));
    $('#ruta').hidden = false;
    pintarRevision(r.borrador ?? {});
    estado('', null);
  } catch (e) {
    fallar(tope.traducir(e));
  } finally {
    tope.fin();
    detenerLatido();
    interpretando = false;
    // El botón vuelve a quedar usable SIEMPRE, también al vencer el tope: la
    // nota sigue escrita en el campo y reintentar es lo que hay que hacer.
    boton.disabled = false;
    $('#dictar').disabled = false;
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
    informarGuardado(r);
    alRefrescar();
  } catch (e) {
    fallar(e);
  } finally {
    boton.disabled = false;
  }
}

/**
 * Resultado del guardado, incluidos los lotes que el servidor DESCARTÓ.
 *
 * `/api/confirmar` responde `{ persistidas, descartadas: [{id, issues}] }`:
 * un lote que no pasa `zObservacion` se degrada solo (corrección #13, para no
 * perder la nota entera) y el resto se guarda. Antes se leía un éxito liso
 * —«Guardado: 1 testimonio(s)»— aunque se hubieran caído 2 de 3, y esa es
 * justo la pérdida silenciosa que `src/store/observations.ts` declara
 * inaceptable. Así que la pérdida se cuenta con el mismo peso que el éxito, y
 * se dice que NO se recupera reintentando: el borrador ya se consumió del
 * lado del servidor y el único camino es volver a capturar la nota.
 */
function informarGuardado(r) {
  const guardadas = r.persistidas ?? 0;
  const perdidas = Array.isArray(r.descartadas) ? r.descartadas.length : (r.descartadas ?? 0);
  if (!perdidas) {
    estado(`Guardado: ${testimonios(guardadas)}.`, 'bueno');
    return;
  }
  // Tono `malo`, no `bueno` ni `aviso`: hubo pérdida de datos, y el titular
  // de la línea no puede ser el éxito parcial.
  estado(
    `Guardado: ${testimonios(guardadas)}. SE DESCARTARON ${perdidas} ` +
    `${perdidas === 1 ? 'equipo' : 'equipos'} y no se recuperan reintentando.`,
    'malo');
  const caja = $('#falla-captura');
  pintar(caja,
    h('div', { clase: 'error-caja grave' },
      h('b', { clase: 'error-titulo',
        texto: `${perdidas} ${perdidas === 1 ? 'equipo no se guardó' : 'equipos no se guardaron'}` }),
      h('p', { clase: 'error-explicacion', texto:
        'El servidor aceptó el resto de la nota y rechazó estos lotes porque no ' +
        'cumplen el contrato de datos. El borrador ya se consumió: volver a ' +
        'tocar «guardar» no los recupera.' }),
      h('ul', { clase: 'error-pasos' },
        (Array.isArray(r.descartadas) ? r.descartadas : []).map((d) => h('li', null,
          h('code', { texto: String(d?.id ?? '?') }),
          h('span', { texto: ` · ${d?.issues ?? '?'} ${d?.issues === 1 ? 'problema' : 'problemas'} de validación` })))),
      h('p', { clase: 'error-explicacion', texto:
        'Para no perder esos equipos: volvé a capturar la nota nombrando el tipo ' +
        'de equipo, la cantidad y la edad de forma directa, y revisá los campos ' +
        'antes de guardar.' })));
  caja.hidden = false;
}

async function descartar() {
  if (!borradorActual) return;
  try {
    await api('/api/descartar', { borradorId: borradorActual.id });
    limpiarFalla();
    estado('Borrador descartado. No se guardó nada.', null);
  } catch (e) {
    fallar(e);
  } finally {
    cerrarRevision();
  }
}

/**
 * Nodo del contador de segundos de la espera en curso. Vive DENTRO de
 * `#estado-captura`, que es región viva (`role="status"`), pero marcado
 * `aria-hidden`: el mensaje se anuncia una vez y el contador cambia cada
 * segundo sin volver a anunciarse. Sin esa separación, dar señal de vida al
 * usuario que ve la pantalla significaría gritarle un número por segundo a
 * quien la escucha.
 */
let elContador = null;

function estado(mensaje, tono) {
  const el = $('#estado-captura');
  elContador = h('span', { clase: 'contador small', 'aria-hidden': 'true' });
  // El nodo del contador se mantiene aparte del texto anunciado: el latido
  // solo le escribe a él, nunca vuelve a tocar el mensaje.
  pintar(el, mensaje ? h('span', { texto: mensaje }) : null, elContador);
  el.className = tono ? `estado ${tono}` : 'estado';
  el.hidden = !mensaje;
}

/**
 * SEÑAL DE VIDA durante una espera larga: los segundos transcurridos, junto
 * al mensaje. Devuelve la función que lo detiene.
 *
 * Es la mitad importante del arreglo del tope de tiempo. Un tope corto
 * mentiría (la primera inferencia puede tardar minutos legítimamente) y un
 * tope largo sin señal de vida se ve idéntico a una app colgada. Con el
 * contador corriendo, esperar es una decisión informada del usuario.
 */
function latido() {
  const inicio = Date.now();
  const destino = elContador;
  const paso = () => {
    if (!destino.isConnected) return;   // `estado()` ya pintó otra cosa
    destino.textContent = ` · ${Math.round((Date.now() - inicio) / 1000)} s`;
  };
  const id = setInterval(paso, 1000);
  return () => clearInterval(id);
}

/*
 * TOPES DE TIEMPO de las dos llamadas que invocan al modelo.
 *
 * Sin tope, un modelo colgado deja el botón `disabled` con «Interpretando
 * on-device…» para siempre y el único camino es recargar la página —
 * exactamente el bug que la app móvil ya corrigió (`feat/apk-v0.1-timeout-dictado`)
 * y que esta UI nunca recibió.
 *
 * Los valores son deliberadamente ALTOS. La primera interpretación de la
 * sesión puede incluir la descarga del modelo (alrededor de 1 GB, como ya
 * documenta `errores.js`), así que un tope de pocos segundos convertiría el
 * caso normal en un error y sería peor que no tener tope. Estos números no
 * están para acelerar nada: están para que exista un final. Quien mira la
 * pantalla no espera a ciegas — el contador de `latido()` le dice que sigue
 * viva.
 */
const TOPE_INTERPRETAR = 300_000;   // 5 min: descarga del modelo + inferencia
const TOPE_TRANSCRIBIR = 120_000;   // 2 min: whisper tiny sobre un dictado corto

/**
 * `AbortController` con tope de tiempo. `traducir()` distingue el vencimiento
 * de cualquier otro fallo: un `AbortError` crudo dice «The user aborted a
 * request», que es justo lo contrario de lo que pasó.
 */
function conTope(ms, etiqueta) {
  const control = new AbortController();
  let vencido = false;
  const t = setTimeout(() => { vencido = true; control.abort(); }, ms);
  return {
    senal: control.signal,
    fin: () => clearTimeout(t),
    traducir: (e) => (vencido
      // El prefijo es la llave del diccionario de `errores.js`, donde vive el
      // texto accionable. Acá no se redacta nada para el usuario.
      ? new Error(`Tope de tiempo · ${etiqueta}: no hubo respuesta en ${Math.round(ms / 1000)} s`)
      : e),
  };
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
  // El botón ya está `disabled` mientras se interpreta, pero la guarda vive
  // también acá: el atajo ⌘/Ctrl+Enter puede lanzar una interpretación sin
  // pasar por el botón, y una transcripción que llega después pisaría el
  // texto que produjo el borrador que está por aparecer.
  if (interpretando) return;

  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
    estado('Este navegador no puede grabar audio. Escribí la nota a mano.', 'malo');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    // El diccionario de `errores.js` tiene la entrada del permiso, con los
    // pasos para darlo desde la barra de direcciones.
    fallar(new Error('Sin permiso de micrófono'));
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

      limpiarFalla();
      estado('Transcribiendo on-device con whisper…', 'trabajando');
      // Mismo problema y mismo remedio que en `interpretar()`: sin tope, un
      // whisper colgado deja «Transcribiendo…» eterno y el botón inservible.
      const detenerLatido = latido();
      const tope = conTope(TOPE_TRANSCRIBIR, 'transcripción');
      boton.disabled = true;
      try {
        const res = await fetch('/api/transcribir', {
          method: 'POST',
          headers: { 'content-type': 'audio/wav' },
          body: aWav(trozos, muestras, tasa),
          signal: tope.senal,
        });
        if (!res.ok) throw new Error(`/api/transcribir devolvió ${res.status}`);
        const { texto } = await res.json();
        const caja = $('#texto');
        caja.value = [caja.value.trim(), (texto ?? '').trim()].filter(Boolean).join(' ');
        caja.dataset.fuente = 'voz';
        caja.focus();
        estado(texto ? 'Transcrito en este equipo. Revisá antes de interpretar.' : 'La transcripción vino vacía.', texto ? 'bueno' : 'aviso');
      } catch (e) {
        fallar(tope.traducir(e));
      } finally {
        tope.fin();
        detenerLatido();
        // El audio ya se fue del navegador, pero dictar de nuevo tiene que
        // ser posible incluso si esta transcripción no volvió.
        boton.disabled = false;
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
