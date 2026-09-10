/**
 * dom.js — construcción de DOM sin asignar marcado crudo.
 *
 * REGLA DURA de esta app: todo dato que llega de la API es contenido NO
 * CONFIABLE. Una nota de campo (`notas`, `textoOriginal`) puede contener
 * HTML, y un testimonio puede venir de un peer por Hyperswarm. El doc
 * maestro lo marca como corrección obligatoria #7 (XSS que podía llamar
 * `/api/confirmar` o `/api/exportar` desde la propia sesión del usuario).
 *
 * Por eso en toda la UI no existe una sola asignación de marcado crudo a
 * un nodo, ni por propiedad ni por inserción adyacente: todo texto entra
 * por `textContent` o por `createTextNode`, que no interpretan HTML. Este
 * es el único constructor de nodos de la UI — si algo necesita pintar
 * datos de la API, pasa por `h()`.
 */

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

/** Fetch JSON. GET si no hay cuerpo, POST JSON si lo hay. */
export async function api(ruta, cuerpo) {
  const res = await fetch(ruta, cuerpo
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }
    : undefined);
  const texto = await res.text();
  let datos;
  try { datos = texto ? JSON.parse(texto) : {}; }
  catch { throw new Error(`Respuesta no-JSON de ${ruta} (${res.status})`); }
  if (!res.ok) throw new Error(datos.mensaje ?? datos.error ?? `${ruta} devolvió ${res.status}`);
  return datos;
}

function agregar(el, hijos) {
  for (const hijo of hijos) {
    if (hijo === null || hijo === undefined || hijo === false || hijo === true) continue;
    if (Array.isArray(hijo)) { agregar(el, hijo); continue; }
    // Nodo ya construido, o TEXTO. Nunca marcado interpretado.
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

/**
 * `h('td', { clase: 'num', texto: valor }, ...hijos)`.
 *
 * Props soportadas: `clase`, `texto` (→ textContent), `datos` (→ dataset),
 * `on*` (handler), cualquier otra → `setAttribute`. Los hijos string se
 * insertan como nodos de texto. No hay forma de inyectar marcado.
 */
/**
 * `icono('mr')` → un <svg><use href="#ic-mr"> listo para insertar.
 *
 * Los paths viven una sola vez en el sprite de `index.html`; esto los
 * instancia. `createElementNS` es obligatorio: `createElement('svg')` crea un
 * elemento HTML con ese nombre, no un SVG, y no renderiza nada.
 *
 * Decorativo por defecto (`aria-hidden`), porque en esta UI el icono siempre
 * acompaña a un texto que ya dice lo mismo — anunciarlo dos veces con lector
 * de pantalla es ruido. Cuando el icono va SOLO (un botón sin etiqueta
 * visible), se le pasa `etiqueta` y entonces sí se expone con `role="img"` y
 * su nombre accesible.
 */
export function icono(nombre, { etiqueta, clase } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', clase ? `icono ${clase}` : 'icono');
  svg.setAttribute('viewBox', '0 0 24 24');
  if (etiqueta) {
    svg.setAttribute('role', 'img');
    const titulo = document.createElementNS(NS, 'title');
    titulo.textContent = etiqueta;      // textContent, igual que todo acá
    svg.append(titulo);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  const use = document.createElementNS(NS, 'use');
  // href y xlink:href: el segundo es el que entienden los WebKit viejos.
  use.setAttribute('href', `#ic-${nombre}`);
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#ic-${nombre}`);
  svg.append(use);
  return svg;
}

/**
 * Icono de una modalidad del vocabulario controlado (`MODALIDADES` en
 * `core/contracts.ts`). Devuelve `null` para lo que no reconoce, en vez de un
 * icono genérico: un icono equivocado sobre un dato clínico es peor que
 * ninguno.
 */
const ICONO_MODALIDAD = {
  MR: 'mr', CT: 'ct', Ultrasound: 'ultrasound', XRay: 'xray',
  PatientMonitoring: 'monitoring', ImageGuidedTherapy: 'therapy',
};

export function iconoModalidad(modalidad, opciones) {
  const nombre = ICONO_MODALIDAD[modalidad];
  return nombre ? icono(nombre, opciones) : null;
}

export function h(tag, props, ...hijos) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'clase') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      else if (k === 'texto') el.textContent = String(v);
      else if (k === 'datos') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
      else if (k.startsWith('on')) el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  agregar(el, hijos);
  return el;
}

/** Reemplaza el contenido de `el` por `hijos`, quitando nodo por nodo. */
export function pintar(el, ...hijos) {
  while (el.firstChild) el.removeChild(el.firstChild);
  agregar(el, hijos);
  return el;
}

/** Estado vacío: la pantalla nunca queda en blanco sin explicación. */
export function vacio(titulo, detalle) {
  return h('div', { clase: 'vacio' },
    h('p', { clase: 'vacio-titulo', texto: titulo }),
    detalle ? h('p', { clase: 'vacio-detalle', texto: detalle }) : null);
}

export function error(mensaje) {
  return h('div', { clase: 'error-caja' },
    h('b', { texto: 'No se pudo leer del servidor' }),
    h('p', { clase: 'small', texto: mensaje }));
}

/** `2` → `"2"`, `[7,8]` → `"7–8"`, ausente → `"—"`. */
export function formatearValor(valor) {
  if (valor === undefined || valor === null || valor === '') return '—';
  if (Array.isArray(valor) && valor.length === 2) return `${valor[0]}–${valor[1]}`;
  return String(valor);
}

export function testigos(n) {
  return n === 1 ? '1 testigo' : `${n} testigos`;
}

export function testimonios(n) {
  return n === 1 ? '1 testimonio' : `${n} testimonios`;
}
