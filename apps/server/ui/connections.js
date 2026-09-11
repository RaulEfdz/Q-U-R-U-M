/**
 * connections.js — pantalla «Conexiones». Detalle por dispositivo de la
 * sincronización P2P: no solo CUÁNTOS peers hay conectados (el chip del
 * sidebar, `app.js`), sino CUÁLES, desde cuándo, y si siguen conectados
 * ahora mismo. Cierra el pendiente #4 de `SYNC_P2P_MOBILE_CONTRACT.md`
 * ("registro/revocación de dispositivos") del lado de la interfaz — el
 * registro del lado del servidor vive en `store/dispositivos.ts`.
 */
import { h, api, pintar, error, vacio } from './dom.js';

function hace(iso) {
  if (typeof iso !== 'string') return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const seg = Math.floor(ms / 1000);
  if (seg < 60) return 'hace un instante';
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/**
 * `dispositivoId`/`observadorId` son DATO DE PEER, no confirmado por nadie
 * local — se muestran para identificar, nunca se usan acá para decidir
 * nada (eso es trabajo exclusivo de `trust/reconcile.ts` sobre las
 * observaciones ya persistidas, no de este registro de conexiones).
 */
function filaDispositivo(d) {
  const conectado = d.conectado === true;
  return h('tr', { clase: conectado ? 'conectado' : 'desconectado' },
    h('td', null,
      h('span', { clase: `badge ${conectado ? 'ok' : 'nulo'}` },
        h('i', { clase: 'glifo', 'aria-hidden': 'true', texto: conectado ? '●' : '·' }),
        h('span', { texto: conectado ? 'Conectado' : 'Desconectado' }))),
    h('td', { clase: 'campo', texto: d.dispositivoId ?? 'sin identificar todavía' }),
    h('td', { texto: d.observadorId ?? '—' }),
    h('td', { clase: 'small' }, h('code', { texto: d.clave ?? '—' })),
    h('td', { clase: 'small', texto: hace(d.primerContactoEn) }),
    h('td', { clase: 'small', texto: hace(d.ultimoContactoEn) }));
}

function tabla(dispositivos) {
  if (!dispositivos.length) {
    return vacio(
      'Ningún dispositivo se conectó todavía.',
      'Un celular con su clave en la allowlist del servidor va a aparecer acá apenas se una al topic de Hyperswarm.');
  }
  return h('table', { clase: 'conexiones-tabla' },
    h('thead', null, h('tr', null,
      ['Estado', 'Dispositivo', 'Observador', 'Clave', 'Primer contacto', 'Último contacto']
        .map((t) => h('th', { scope: 'col', texto: t })))),
    h('tbody', null, dispositivos.map(filaDispositivo)));
}

export async function pintarConexiones(seccion) {
  pintar(seccion, h('p', { clase: 'estado trabajando', texto: 'Consultando dispositivos…' }));
  let d;
  try {
    d = await api('/api/dispositivos');
  } catch (e) {
    pintar(seccion, error(e));
    return;
  }
  const dispositivos = Array.isArray(d.dispositivos) ? d.dispositivos : [];
  const conectados = dispositivos.filter((x) => x.conectado).length;

  pintar(seccion,
    h('p', { clase: 'leyenda small', texto:
      'Cada dispositivo que se unió por P2P, autorizado por su clave en la allowlist del servidor. ' +
      '«Dispositivo» y «Observador» son dato del propio peer: se muestran para identificar, ' +
      'nunca deciden confianza — eso lo resuelve el motor de quórum sobre la evidencia ya confirmada.' }),
    h('p', { clase: 'small num', texto:
      `${dispositivos.length} ${dispositivos.length === 1 ? 'dispositivo visto' : 'dispositivos vistos'} · ${conectados} conectado(s) ahora` }),
    tabla(dispositivos));
}
