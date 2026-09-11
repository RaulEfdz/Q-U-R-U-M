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

/**
 * ¿Hay algún campo marcado inválido en el panel de revisión ahora mismo?
 *
 * Antes de este cambio, un valor fuera de rango solo ponía un borde rojo:
 * sin texto, sin `aria-invalid`, y la corrección NO se mandaba — nada le
 * avisaba al usuario que su edición se había ignorado y que «Sí, es
 * correcto — guardar» iba a persistir el valor original del modelo, no el
 * que escribió. Ahora ese botón se bloquea mientras quede algo inválido.
 */
function hayCamposInvalidos() {
  return !!$('#campos')?.querySelector('.invalido');
}

function actualizarBotonGuardar() {
  const boton = $('#confirmar');
  if (!boton) return;
  boton.disabled = hayCamposInvalidos();
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

  const idError = `error-${obs.id}-${def.llave}`;
  // Texto de la restricción, para el mensaje inline y para lectores de
  // pantalla — no solo un borde rojo, que no dice nada de qué se espera ni
  // se anuncia con teclado o táctil.
  const restriccion = def.tipo === 'number'
    ? `Tiene que ser un entero de ${def.min} a ${def.max}.`
    : '';

  const input = h('input', {
    // `name` explícito: el `label` que lo envuelve ya lo asocia, pero sin
    // nombre el navegador lo reporta como campo no identificable.
    name: `${obs.id}-${def.llave}`,
    autocomplete: 'off',
    type: esRango ? 'text' : def.tipo,
    value: original === undefined || original === null ? '' : formatearValor(original),
    placeholder: '—',
    readonly: esRango || undefined,
    'aria-invalid': 'false',
    ...(restriccion ? { 'aria-describedby': idError } : {}),
    ...(def.min !== undefined ? { min: String(def.min) } : {}),
    ...(def.max !== undefined ? { max: String(def.max) } : {}),
    ...(def.paso !== undefined ? { step: String(def.paso) } : {}),
    clase: def.tipo === 'number' ? 'num' : '',
    oninput: (e) => {
      if (esRango) return;
      const crudo = e.target.value.trim();
      if (crudo === '') {
        anotarCorreccion(obs.id, def.llave, undefined);
        e.target.classList.remove('editado', 'invalido');
        e.target.setAttribute('aria-invalid', 'false');
        actualizarBotonGuardar();
        return;
      }
      if (def.tipo === 'number') {
        const n = Number(crudo);
        // `zRangoEdad` y `lote.cantidad` exigen ENTEROS acotados
        // (corrección #13): validamos acá para no perder el lote entero
        // en el servidor por un "7.5".
        const ok = Number.isInteger(n) && n >= def.min && n <= def.max;
        e.target.classList.toggle('invalido', !ok);
        e.target.setAttribute('aria-invalid', String(!ok));
        actualizarBotonGuardar();
        if (!ok) return;
        anotarCorreccion(obs.id, def.llave, n === original ? undefined : n);
      } else {
        anotarCorreccion(obs.id, def.llave, crudo === original ? undefined : crudo);
      }
      e.target.classList.toggle('editado', correcciones[obs.id]?.[def.llave] !== undefined);
    },
  });

  return h('label', { clase: 'campo-editable' },
    h('span', { clase: 'etiqueta', texto: def.etiqueta }), input,
    // Vive siempre en el DOM (para que `aria-describedby` no apunte a nada
    // cuando está oculto) y solo se ve/anuncia mientras el campo es inválido.
    restriccion ? h('span', { id: idError, clase: 'campo-restriccion', role: 'alert' }, restriccion) : null);
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

  /*
   * Borrador SIN lotes: la nota existe y no describe ningún equipo.
   *
   * No es un error. «Fui y no vi equipo» es información sobre la base
   * instalada, y la app móvil ya lo trata así. Antes esta pantalla ni llegaba
   * a abrirse: el servidor abortaba la extracción y el cartel de error
   * prometía «se puede guardar igual y quedar pendiente de revisión» sin que
   * existiera forma de hacerlo. Ahora la promesa es real — se guarda como
   * pendiente, con su texto, su fecha y su pregunta abierta.
   *
   * El botón cambia de etiqueta porque cambia lo que hace: no hay nada que
   * confirmar como correcto, hay una nota que se archiva para revisar.
   */
  const sinLotes = !(borrador.observaciones ?? []).length;
  pintar($('#campos'), sinLotes
    ? h('div', { clase: 'vacio' },
        h('p', { clase: 'vacio-titulo', texto: 'Ningún equipo reconocido en esta nota' }),
        h('p', { clase: 'vacio-detalle', texto: 'No se va a registrar ningún equipo: un dato que nadie observó no se inventa. La nota se guarda con su fecha y su pregunta abierta, y queda en la lista de pendientes de revisión.' }))
    : (borrador.observaciones ?? []).map(tarjetaLote));

  $('#confirmar').textContent = sinLotes
    ? 'Guardar la nota como pendiente'
    : 'Sí, es correcto — guardar';

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
  // Borrador nuevo: ningún campo está marcado inválido todavía.
  actualizarBotonGuardar();

  // El composer (dictado + texto + fecha) se oculta mientras hay algo para
  // revisar: dos bloques grandes a la vez competían por el foco, y acá solo
  // hay una decisión por vez — revisar el borrador o seguir dictando, nunca
  // las dos. Vuelve con `cerrarRevision()`.
  $('.capturar-centro').hidden = true;

  /*
   * El panel más importante de la pantalla acababa de reemplazar al
   * composer, y nada lo anunciaba: `estado('', null)` vacía la región viva
   * justo en el momento del cambio de estado más grande de la pantalla, y el
   * foco se quedaba en el botón «Interpretar» que ya no está visible. Un
   * lector de pantalla no se enteraba de que había algo nuevo para revisar.
   * `tabindex="-1"` en el HTML lo hace enfocable por script sin sumarlo al
   * orden de tabulación normal.
   */
  $('#revision').focus();
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
  $('.capturar-centro').hidden = false;
}

/**
 * «Volver a editar»: distinto de `descartar()`. Libera el borrador en el
 * servidor (no queda flotando sin dueño) pero NO toca `#texto` — la nota
 * sigue ahí para corregirla y volver a interpretar, y no se anuncia como
 * pérdida de datos porque no la hay.
 */
async function volverAEditar() {
  if (borradorActual) {
    await api('/api/descartar', { borradorId: borradorActual.id }).catch(() => undefined);
  }
  cerrarRevision();
  actualizarComposer();
  $('#texto').focus();
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
    const caja = $('#texto');
    caja.value = '';
    delete caja.dataset.fuente;
    ajustarAlto(caja);          // sin esto el campo queda alto y vacío
    actualizarComposer();       // con el texto vacío, Interpretar vuelve a ocultarse
    // La nota que esos fragmentos ayudaron a armar ya se guardó: los chips
    // de ESE dictado no tienen nada más que decir de la nota en blanco que
    // sigue.
    fragmentos = new Map();
    pintarFragmentos();
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

  // Nota sin equipos: no se persistió ninguna observación y no es una falla.
  // Decir «Guardado: 0 testimonios» sería técnicamente cierto y leerse como un
  // error, justo en el caso que este cambio vino a dejar de tratar como error.
  if (!perdidas && guardadas === 0 && r.pendiente) {
    estado('Nota guardada como pendiente de revisión. No se registró ningún equipo.', 'bueno');
    return;
  }

  if (!perdidas) {
    estado(
      guardadas === 0
        ? 'No se registró ningún equipo con esta nota.'
        : `Guardado: ${testimonios(guardadas)}.`,
      guardadas === 0 ? 'aviso' : 'bueno');
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
const TOPE_TRANSCRIBIR = 120_000;   // 2 min: whisper tiny sobre un fragmento corto

/**
 * DICTADO POR FRAGMENTOS (chunking), no todo al final.
 *
 * Antes, `stop()` recién armaba el WAV y llamaba a whisper cuando la persona
 * terminaba de grabar — con una visita larga (varios equipos, 5-10 min
 * hablando) eso significa: grabar TODO, después esperar TODO. Acá el audio
 * se corta cada `DURACION_FRAGMENTO_MS` mientras se sigue grabando, cada
 * trozo se transcribe apenas se corta, y el texto entra al campo en cuanto
 * whisper lo devuelve — para cuando la persona toca «Detener» ya está
 * transcrita casi toda la nota, y solo falta el último pedacito.
 *
 * Es rescatable como feature de pitch por sí sola: procesamiento continuo
 * on-device sin bloquear al usuario, no solo transcripción on-device. Ver
 * `docs/FUNCIONALIDADES_RESCATABLES.md`.
 */
const DURACION_FRAGMENTO_MS = 20_000;

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

/*
 * Estado visible de cada fragmento del dictado en curso — la prueba en
 * pantalla de que el chunking realmente procesa mientras se sigue grabando,
 * no solo una línea de `estado()` que la próxima línea pisa. Un `Map`
 * ordenado por inserción: los chips salen en el orden en que se cortaron.
 */
const ETIQUETA_FRAGMENTO = {
  subiendo: 'transcribiendo…',
  transcrito: 'transcrito',
  vacio: 'sin voz',
  error: 'no se pudo',
};
let fragmentos = new Map();

function pintarFragmentos() {
  const lista = $('#fragmentos-dictado');
  if (!lista) return;
  if (!fragmentos.size) { pintar(lista); lista.hidden = true; return; }
  lista.hidden = false;
  pintar(lista, [...fragmentos.entries()].map(([numero, est]) => h('li', { clase: est },
    est === 'subiendo' ? h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: '◐' }) : null,
    h('span', { texto: `Fragmento ${numero} · ${ETIQUETA_FRAGMENTO[est] ?? est}` }))));
}

function marcarFragmento(numero, est) {
  fragmentos.set(numero, est);
  pintarFragmentos();
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
  // `trozos`/`muestras` son el BUFFER DEL FRAGMENTO ACTUAL, no de toda la
  // grabación: `cortarFragmento()` los vacía cada vez que arma un WAV para
  // subir, y el `onaudioprocess` de abajo sigue llenándolos con lo que se
  // graba mientras ese WAV viaja al servidor.
  let trozos = [];
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

  /** Saca el audio acumulado del buffer del fragmento actual y lo deja vacío
   *  para lo próximo que grabe `onaudioprocess` mientras este WAV viaja. */
  function cortarFragmento() {
    if (!muestras) return null;
    const wav = aWav(trozos, muestras, ctx.sampleRate);
    trozos = [];
    muestras = 0;
    return wav;
  }

  let numeroFragmento = 0;
  // Si un fragmento tarda más que el intervalo (whisper lento, o el modelo
  // todavía cargando en el primer fragmento), el siguiente tick NO arranca
  // una segunda subida en paralelo: solo sigue acumulando audio. El próximo
  // fragmento sale más largo, pero nunca hay dos POST del mismo dictado
  // pisándose la respuesta el uno al otro en el textarea.
  let subiendoFragmento = false;

  /**
   * Transcribe UN fragmento y lo agrega al final de la nota, apenas vuelve.
   *
   * `silencioso`: los fragmentos intermedios no usan `fallar()` (esa caja es
   * para un problema que necesita acción del usuario) — un fragmento que
   * falla no para la grabación, así que se avisa con `estado()` y se sigue.
   * El último, en `stop()`, si falla sí es la falla real de la sesión de
   * dictado completa y se muestra con el diccionario de `errores.js`.
   */
  async function transcribirFragmento(wav, { silencioso }) {
    subiendoFragmento = true;
    numeroFragmento += 1;
    const miNumero = numeroFragmento;
    marcarFragmento(miNumero, 'subiendo');
    const tope = conTope(TOPE_TRANSCRIBIR, 'transcripción');
    try {
      const res = await fetch('/api/transcribir', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav,
        signal: tope.senal,
      });
      if (!res.ok) throw new Error(`/api/transcribir devolvió ${res.status}`);
      const { texto } = await res.json();
      if (texto?.trim()) {
        const caja = $('#texto');
        caja.value = [caja.value.trim(), texto.trim()].filter(Boolean).join(' ');
        caja.dataset.fuente = 'voz';
        ajustarAlto(caja);
        actualizarComposer();
        marcarFragmento(miNumero, 'transcrito');
      } else {
        marcarFragmento(miNumero, 'vacio');
      }
      if (grabadora) {
        // Sigue grabando: no pisar «Grabando…» con un aviso que ya pasó. El
        // detalle de CUÁL fragmento y en qué estado ya lo muestra el chip.
        estado('Grabando… el audio no sale de este equipo.', 'trabajando');
      }
      return true;
    } catch (e) {
      marcarFragmento(miNumero, 'error');
      if (silencioso) {
        estado(`Fragmento ${miNumero} no se pudo transcribir (se sigue grabando).`, 'aviso');
        return false;
      }
      fallar(tope.traducir(e));
      return false;
    } finally {
      tope.fin();
      subiendoFragmento = false;
    }
  }

  // Corta y sube un fragmento cada `DURACION_FRAGMENTO_MS`, mientras se
  // sigue grabando. Es la diferencia entera de esta técnica: para cuando la
  // persona toca «Detener» después de dictar varios minutos, casi toda la
  // nota ya está transcrita — solo falta el último pedacito.
  const intervalo = setInterval(() => {
    if (subiendoFragmento) return;
    const wav = cortarFragmento();
    if (wav) transcribirFragmento(wav, { silencioso: true });
  }, DURACION_FRAGMENTO_MS);

  // Corrección obligatoria #3: el POST vive DENTRO del handler de detención, y
  // no hay ningún `location.reload()` — el reload inmediato del doc maestro
  // cancelaba la subida antes de que whisper devolviera el texto.
  grabadora = {
    async stop() {
      grabadora = null;
      clearInterval(intervalo);
      nodo.disconnect(); fuente.disconnect(); silencio.disconnect();
      nodo.onaudioprocess = null;
      stream.getTracks().forEach((t) => t.stop());
      try { await ctx.close(); } catch { /* ya cerrado */ }

      etiquetarBoton(boton, 'microfono', 'Dictar');
      boton.classList.remove('grabando');

      const ultimoWav = cortarFragmento();
      if (!ultimoWav && numeroFragmento === 0) { estado('No se grabó audio.', 'aviso'); return; }
      if (!ultimoWav) {
        // Ya se transcribió todo por fragmentos; no queda audio colgado.
        estado('Transcrito en este equipo. Revisá antes de interpretar.', 'bueno');
        $('#texto').focus();
        return;
      }

      limpiarFalla();
      // Si mientras tanto un fragmento intermedio sigue subiendo, esperar a
      // que termine antes de mandar el último — dos POST del mismo dictado
      // en vuelo a la vez es exactamente lo que `subiendoFragmento` evita
      // en el `setInterval` de arriba, y acá aplica la misma regla.
      while (subiendoFragmento) await new Promise((r) => setTimeout(r, 100));
      estado('Transcribiendo el último fragmento…', 'trabajando');
      const detenerLatido = latido();
      boton.disabled = true;
      const ok = await transcribirFragmento(ultimoWav, { silencioso: false });
      detenerLatido();
      boton.disabled = false;
      if (ok) {
        estado('Transcrito en este equipo. Revisá antes de interpretar.', 'bueno');
        $('#texto').focus();
      }
    },
  };

  // Un dictado nuevo, chips nuevos: los de la grabación anterior ya
  // cumplieron su función (avisar que ESE audio se procesó) y no describen
  // nada de lo que está por grabarse ahora.
  fragmentos = new Map();
  pintarFragmentos();

  etiquetarBoton(boton, 'detener', 'Detener');
  boton.classList.add('grabando');
  estado('Grabando… el audio no sale de este equipo.', 'trabajando');
}

/* ─────────────────────────────── Montaje ─────────────────────────────── */

/**
 * Fecha de la visita = HOY, por defecto.
 *
 * Vacía, `/api/observar` cae en `capturadaEn` — y RD-6 dice que la frescura se
 * mide desde `visitadoEn`, no desde cuándo se dictó. El caso normal (dicto lo
 * que acabo de ver) quedaba bien por accidente; el caso real de campo —cargo
 * el lunes la recorrida del viernes— quedaba fechado mal y movía el estado de
 * frescura de todo un grupo sin que nadie lo notara.
 *
 * Se arma con los componentes LOCALES y no con `toISOString()`: ese devuelve
 * UTC, y al este de Greenwich por la tarde ya es el día siguiente. Una fecha de
 * visita corrida un día es exactamente el tipo de error que este producto no
 * puede cometer.
 */
function fechaDeHoyLocal() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * El campo crece con la nota, hasta un tope.
 *
 * Un dictado largo entraba en un textarea de altura fija y había que
 * desplazarse dentro de él para releer lo que se acababa de decir — justo
 * antes de confirmar, que es el momento en que hay que poder leerlo todo.
 */
function ajustarAlto(caja) {
  const TOPE = 420;
  caja.style.height = 'auto';
  caja.style.height = `${Math.min(caja.scrollHeight, TOPE)}px`;
  caja.style.overflowY = caja.scrollHeight > TOPE ? 'auto' : 'hidden';
}

/**
 * «Interpretar» y su atajo solo se muestran con nota escrita o dictada.
 *
 * Antes estaban siempre visibles, aunque con el campo vacío apretarlos no
 * hacía nada más que devolver «Escribí o dictá una nota antes de
 * interpretar» — un botón permanentemente activo para una acción que todavía
 * no tiene sentido. Diseño minimalista (NN/g #8) y revelación progresiva
 * (HIG): con la nota vacía la única acción posible es Dictar o escribir, y
 * es lo único que queda a la vista.
 */
function actualizarComposer() {
  const hayTexto = $('#texto').value.trim().length > 0;
  $('#enviar').hidden = !hayTexto;
  $('#pista-atajo').hidden = !hayTexto;
}

export function montarCapturar(refrescar) {
  alRefrescar = refrescar;

  const visita = $('#visita');
  if (visita && !visita.value) visita.value = fechaDeHoyLocal();

  const caja = $('#texto');
  ajustarAlto(caja);
  actualizarComposer();
  caja.addEventListener('input', () => { ajustarAlto(caja); actualizarComposer(); });
  $('#enviar').onclick = interpretar;
  $('#confirmar').onclick = confirmar;
  $('#volver').onclick = volverAEditar;
  $('#descartar').onclick = descartar;
  $('#dictar').onclick = alternarDictado;
  // Ctrl/Cmd + Enter interpreta: capturar debe tomar segundos, no minutos.
  $('#texto').onkeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); interpretar(); }
  };
}
