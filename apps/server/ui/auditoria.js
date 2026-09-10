/**
 * auditoria.js — pantalla 4. La cadena de hashes con su botón «Verificar
 * integridad», que invita al jurado a editar `data/audit.jsonl` a mano y
 * comprobarlo en vivo. Y cada llamada de inferencia con `delegado`
 * visible: ahí está la prueba de cumplimiento, no en una diapositiva
 * (§B.2).
 */
import { h, api, pintar, error } from './dom.js';

/** El detalle de un registro es un objeto arbitrario; se muestra como
 *  pares clave=valor por `textContent`. Nunca como marcado. */
function detalle(d) {
  if (!d || typeof d !== 'object') return h('span', { clase: 'small', texto: '—' });
  const pares = Object.entries(d);
  if (!pares.length) return h('span', { clase: 'small', texto: '—' });
  return h('span', { clase: 'small pares' },
    pares.map(([k, v]) => h('span', { clase: 'par' },
      h('i', { texto: `${k}=` }),
      h('span', { texto: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v) }))));
}

/** ¿Este registro habla de una inferencia, y fue local o delegada? */
function chipInferencia(r) {
  const d = r.detalle ?? {};
  if (!('delegado' in d)) return null;
  const delegado = d.delegado === true;
  return h('span', { clase: `chip-inferencia ${delegado ? 'delegada' : 'local'}` },
    h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: delegado ? '⇄' : '⌂' }),
    h('span', { texto: delegado ? 'delegada a peer autorizado' : 'local, en este equipo' }));
}

function hora(at) {
  if (typeof at !== 'string' || at.length < 19) return '—';
  return at.slice(11, 19);
}

function tabla(registros) {
  if (!registros.length) {
    return h('p', { clase: 'small', texto: 'La cadena está vacía. El primer registro se escribe con la primera captura.' });
  }
  return h('table', { clase: 'auditoria-tabla' },
    h('thead', null, h('tr', null,
      ['Hora', 'Acción', 'Inferencia', 'Detalle', 'Hash'].map((t) => h('th', { texto: t })))),
    h('tbody', null, registros.map((r) => h('tr', null,
      h('td', { clase: 'num', texto: hora(r.at) }),
      h('td', null, h('code', { texto: String(r.accion ?? '?') })),
      h('td', null, chipInferencia(r) ?? h('span', { clase: 'small', texto: '—' })),
      h('td', null, detalle(r.detalle)),
      h('td', { clase: 'small' },
        h('code', { texto: `${String(r.hash ?? '').slice(0, 12)}…` }))))));
}

export async function pintarAuditoria(seccion) {
  pintar(seccion, h('p', { clase: 'estado trabajando', texto: 'Verificando la cadena…' }));
  let d;
  try {
    d = await api('/api/auditoria');
  } catch (e) {
    pintar(seccion, error(e.message));
    return;
  }

  const integridad = d.integridad ?? {};
  // Los registros llegan en orden cronológico; se muestran del más nuevo
  // al más viejo, sin mutar el array de la respuesta.
  const registros = [...(d.registros ?? [])].reverse();

  const boton = h('button', { texto: 'Verificar integridad' });
  boton.onclick = () => pintarAuditoria(seccion);

  pintar(seccion,
    h('div', { clase: `integridad ${integridad.ok ? 'ok' : 'sinquorum'}` },
      h('span', { clase: 'glifo grande', 'aria-hidden': 'true', texto: integridad.ok ? '●' : '▲' }),
      h('div', null,
        h('b', { texto: integridad.ok
          ? 'Cadena de auditoría VERIFICADA'
          : 'Cadena de auditoría ROTA' }),
        h('p', { clase: 'small', texto: integridad.ok
          ? 'Cada registro encadena con el hash del anterior. Editá data/audit.jsonl a mano y volvé a verificar.'
          : `Se rompe en el registro ${integridad.roto ?? 'desconocido'}. Alguien alteró el archivo.` })),
      boton),
    h('p', { clase: 'leyenda small', texto: 'Últimos 50 registros, del más reciente al más antiguo. La columna «Inferencia» prueba dónde corrió cada modelo: en este equipo o delegado a un dispositivo autorizado de la red. Nunca en la nube.' }),
    tabla(registros));
}
