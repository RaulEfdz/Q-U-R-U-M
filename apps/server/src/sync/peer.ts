// sync/peer.ts — sincronización P2P de testimonios sobre Hyperswarm.
//
// Declaración honesta (doc maestro §II.18): QVAC provee delegación de
// inferencia, no un almacén replicado. La sincronización de observaciones
// la construimos nosotros sobre Hyperswarm, el mismo stack Holepunch sobre
// el que QVAC se apoya.
//
// Corrección #6 de ../../CLAUDE.md: el doc maestro nunca pasa `allowlist`
// desde el llamador y la guarda es `if (opts.allowlist?.length && …)` — con
// la lista vacía o ausente, esa condición es `false` y el `if` de rechazo
// nunca corre: acepta CUALQUIER peer. Es lo opuesto de "deny-by-default en
// el transporte". Acá `allowlist` es un parámetro REQUERIDO (no opcional,
// no con default `[]` oculto): quien llama a `iniciarSync` tiene que decidir
// explícitamente quién entra, y una lista vacía rechaza a todos — fail
// closed hasta que se configure, nunca fail open.
import Hyperswarm from 'hyperswarm';
import type { PeerSocket } from 'hyperswarm';
import { createHash } from 'node:crypto';
import { zObservacion, type Observacion } from '../core/contracts.ts';
import { cargar } from '../store/observations.ts';
import { registrarAuditoria } from '../store/audit.ts';
import { encolarRevisionPeer, idsObservacionesPendientes } from '../store/revisiones-peer.ts';
import { registrarConexion, registrarDesconexion, registrarActividad } from '../store/dispositivos.ts';
import { nuevoId } from '../core/ids.ts';

const TOPIC = createHash('sha256').update('quorum/base-instalada/v1').digest();

/**
 * Tope de bytes de UNA línea acumulada (hallazgo A-8).
 *
 * `buffer += chunk.toString('utf8')` sin límite: un peer de la allowlist —o
 * uno cuya máquina fue comprometida, que es el caso realista— que abre el
 * socket y escribe sin mandar nunca un `\n` hace crecer ese string hasta
 * comerse la RAM del proceso. Todo el resto de este transporte es fail-closed
 * (allowlist explícita, `zObservacion` estricto, re-marcado `origen: 'peer'`);
 * esto era el único punto que fallaba abierto, y encima sin ruido.
 *
 * ¿Por qué 16 MB y no 64 KB? Porque `enviarPropias()` manda el dataset ENTERO
 * en UNA sola línea JSON. Una observación serializada ronda los 700-900 bytes
 * (cliente, lote, evidencia, `textoOriginal` completo, provenance), así que
 * 16 MB dan margen para ~20.000 testimonios en un solo mensaje — dos órdenes
 * de magnitud por encima de cualquier cosa que este producto vea en campo,
 * mientras sigue siendo un techo que una máquina de demo absorbe sin sudar. Un
 * tope de kilobytes rompería el sync legítimo el día que la base crezca, que
 * es el peor momento para descubrirlo.
 *
 * Si se cambia este número, cambiarlo también en `apps/mobile`: el formato de
 * la línea es el mismo a los dos lados del socket.
 */
export const MAX_BYTES_LINEA = 16 * 1024 * 1024;

/**
 * Acumulador de líneas con techo, extraído de la callback de `data`.
 *
 * Vive como función aparte y exportada por una razón concreta: es la única
 * pieza de este módulo que se puede testear sin levantar un swarm ni tocar la
 * red. La lógica de "cuándo descarto y destruyo" no puede quedar sepultada
 * dentro de un handler que solo corre con dos peers reales conectados.
 *
 * `excedido: true` es terminal para la conexión: el llamador destruye el
 * socket. No se intenta resincronizar buscando el próximo `\n` — un peer que
 * mandó 16 MB sin delimitador no está teniendo un problema de red, está
 * mandando otra cosa, y seguir leyéndolo es seguirle el juego.
 */
export interface AcumuladorLineas {
  /** Bytes pendientes en la línea incompleta actual (para auditoría). */
  pendientes(): number;
  alRecibir(chunk: Buffer): { lineas: string[]; excedido: boolean };
}

export function crearAcumuladorLineas(maxBytes: number = MAX_BYTES_LINEA): AcumuladorLineas {
  let buffer = '';
  // Se cuentan BYTES, no caracteres: el tope es de memoria, y en UTF-8 un
  // carácter puede ocupar hasta 4. Contar `buffer.length` dejaría pasar 4x.
  // Se acumula desde los chunks (que ya son bytes) y solo se recalcula sobre
  // el resto cuando una línea se completó, para no hacer un `byteLength` del
  // buffer entero en cada chunk.
  let bytes = 0;

  return {
    pendientes: () => bytes,
    alRecibir(chunk: Buffer) {
      bytes += chunk.length;

      if (bytes > maxBytes) {
        // Se descarta el buffer ANTES de devolver: si el llamador tardara en
        // destruir el socket, la memoria ya está liberada.
        buffer = '';
        bytes = 0;
        return { lineas: [], excedido: true };
      }

      buffer += chunk.toString('utf8');
      const lineas = buffer.split('\n');
      buffer = lineas.pop() ?? '';
      if (lineas.length) bytes = Buffer.byteLength(buffer, 'utf8');
      return { lineas, excedido: false };
    },
  };
}

export interface SyncHandle {
  destruir(): Promise<void>;
  pares(): number;
}

export interface IniciarSyncOptions {
  /** Claves públicas hex autorizadas. Vacía = rechaza a todos (fail-closed). */
  allowlist: string[];
  bootstrap?: Array<{ host: string; port: number }>;
  onCambio?: (n: number) => void;
  /**
   * Se dispara cada vez que cambia la cantidad de peers CONECTADOS ahora
   * mismo (no el tamaño de la allowlist, que es estático). Es lo que le
   * faltaba al pendiente #5 de `SYNC_P2P.md` ("estado de sync visible en la
   * UI"): antes `pares()` existía pero nada lo leía ni lo empujaba afuera de
   * este módulo — un dispositivo se conectaba o se caía y la interfaz nunca
   * se enteraba.
   */
  onParesCambio?: (n: number) => void;
}

export async function iniciarSync(opts: IniciarSyncOptions): Promise<SyncHandle> {
  const swarm = new Hyperswarm(opts.bootstrap ? { bootstrap: opts.bootstrap } : {});
  let pares = 0;

  swarm.on('connection', (socket: PeerSocket, info) => {
    const clave = info.publicKey.toString('hex');

    // ── Deny-by-default en el transporte ──
    // Sin `?.length &&`: una allowlist vacía hace que `includes` sea siempre
    // `false`, así que TODO peer cae acá y se rechaza. La única forma de
    // aceptar un peer es que su clave esté explícitamente en la lista.
    if (!opts.allowlist.includes(clave)) {
      void registrarAuditoria({
        traceId: 'sync', accion: 'sync:peer-rechazado',
        detalle: { clave: clave.slice(0, 16), razon: 'fuera de allowlist' },
      });
      socket.destroy();
      return;
    }

    pares++;
    opts.onParesCambio?.(pares);
    registrarConexion(clave.slice(0, 16));
    void registrarAuditoria({
      traceId: 'sync', accion: 'sync:peer-aceptado',
      detalle: { clave: clave.slice(0, 16) },
    });

    void enviarPropias(socket);

    const acumulador = crearAcumuladorLineas();
    socket.on('data', (chunk: Buffer) => {
      const { lineas, excedido } = acumulador.alRecibir(chunk);

      // Hallazgo A-8: un peer que nunca manda `\n` no puede hacer crecer la
      // memoria del proceso sin límite. Se audita con la clave RECORTADA, el
      // mismo criterio que el resto de este módulo — la clave completa
      // identifica un dispositivo y no hace falta para investigar el hecho.
      if (excedido) {
        void registrarAuditoria({
          traceId: 'sync', accion: 'sync:linea-excedida',
          detalle: {
            clave: clave.slice(0, 16), maxBytes: MAX_BYTES_LINEA,
            razon: 'línea sin delimitador por encima del tope',
          },
        });
        socket.destroy();
        return;
      }

      void procesarLineas(lineas, clave, opts.onCambio, (mensaje) => {
        socket.write(JSON.stringify(mensaje) + '\n');
      });
    });

    socket.on('close', () => {
      pares--;
      opts.onParesCambio?.(pares);
      registrarDesconexion(clave.slice(0, 16));
    });
    socket.on('error', () => {
      // conexión ruidosa de un peer no debe tumbar el proceso de sync.
    });
  });

  await swarm.join(TOPIC, { server: true, client: true }).flushed();

  return {
    pares: () => pares,
    async destruir() {
      await swarm.destroy();
    },
  };
}

async function enviarPropias(socket: PeerSocket): Promise<void> {
  const propias = await cargar();
  socket.write(JSON.stringify({ tipo: 'observaciones', datos: propias }) + '\n');
}

/**
 * Todo lo que llega de un peer es UNTRUSTED por definición: se valida
 * estrictamente con `zObservacion` (lo que no matchea se descarta, nunca se
 * confía a medias) y se re-marca `origen: 'peer'` sin importar lo que el
 * peer haya mandado — así ningún dato ajeno puede hacerse pasar por 'local'
 * y saltarse el spotlighting (`context/spotlight.ts`) antes de llegar a
 * cualquier modelo.
 */
export async function procesarLineas(
  lineas: string[], clave: string, onCambio?: (n: number) => void,
  responder?: (mensaje: MensajeSalidaSync) => void,
): Promise<void> {
  for (const linea of lineas) {
    if (!linea.trim()) continue;

    let mensaje: MensajeEntradaSync;
    try {
      mensaje = JSON.parse(linea) as MensajeEntradaSync;
    } catch {
      continue; // línea corrupta o hostil: se descarta, no rompe el socket
    }
    if (mensaje.tipo === 'hello') {
      if (mensaje.versionProtocolo !== 1 || !mensaje.dispositivoId || !mensaje.observadorId) continue;
      registrarActividad(clave.slice(0, 16), {
        dispositivoId: mensaje.dispositivoId, observadorId: mensaje.observadorId,
      });
      responder?.({
        tipo: 'hello_ack', versionProtocolo: 1,
        servidorId: 'quorum-central', sesionId: nuevoId(),
      });
      continue;
    }
    if (mensaje.tipo !== 'observaciones' || !Array.isArray(mensaje.datos)) continue;

    const loteV1 = mensaje.versionProtocolo === 1 && typeof mensaje.loteId === 'string';
    const loteId = loteV1 ? mensaje.loteId! : undefined;
    const almacenadas = new Set((await cargar()).map((o) => o.id));
    const pendientes = idsObservacionesPendientes();

    const validas: Observacion[] = [];
    const duplicadas: string[] = [];
    const rechazadas: Array<{ id: string; motivo: string }> = [];
    for (const d of mensaje.datos) {
      const p = zObservacion.safeParse(d);
      if (!p.success) {
        const id = typeof d === 'object' && d !== null && 'id' in d && typeof d.id === 'string'
          ? d.id : 'sin-id';
        rechazadas.push({ id, motivo: 'CONTRATO_INVALIDO' });
        continue;
      }
      if (almacenadas.has(p.data.id) || pendientes.has(p.data.id)) {
        duplicadas.push(p.data.id);
        continue;
      }
      validas.push({ ...p.data, origen: 'peer' }); // ★ marcado untrusted, siempre
    }
    if (!validas.length) {
      if (loteId) responder?.({
        tipo: 'ack', versionProtocolo: 1, loteId,
        recibidas: [], duplicadas, rechazadas,
      });
      continue;
    }

    // Primera vez que se sabe QUIÉN es este peer más allá de su clave: el
    // registro de dispositivos se enriquece con lo que trae la propia
    // observación (dato de peer, por eso solo se guarda para mostrar en la
    // UI — nunca decide confianza ni quórum, eso es trabajo exclusivo de
    // `trust/reconcile.ts` sobre la Observacion ya persistida).
    registrarActividad(clave.slice(0, 16), {
      dispositivoId: validas[0]!.dispositivoId, observadorId: validas[0]!.observadorId,
    });

    // Un peer puede entregar testimonios, pero ni su allowlist ni Zod son una
    // confirmación humana. Se mantienen fuera de observations.jsonl hasta que
    // una persona los revise desde la interfaz local.
    const revisionId = nuevoId();
    encolarRevisionPeer({
      id: revisionId, clavePeer: clave.slice(0, 16), observaciones: validas,
      recibidoEn: new Date().toISOString(),
    });
    await registrarAuditoria({
      traceId: revisionId, accion: 'sync:revision-pendiente',
      detalle: { clave: clave.slice(0, 16), testimonios: validas.length },
    });
    if (loteId) responder?.({
      tipo: 'ack', versionProtocolo: 1, loteId,
      recibidas: validas.map((o) => o.id), duplicadas, rechazadas, revisionId,
    });
    onCambio?.(0);
  }
}

type MensajeEntradaSync = {
  tipo?: string;
  versionProtocolo?: number;
  dispositivoId?: string;
  observadorId?: string;
  loteId?: string;
  datos?: unknown[];
};

export type MensajeSalidaSync =
  | { tipo: 'hello_ack'; versionProtocolo: 1; servidorId: string; sesionId: string }
  | {
    tipo: 'ack'; versionProtocolo: 1; loteId: string;
    recibidas: string[]; duplicadas: string[];
    rechazadas: Array<{ id: string; motivo: string }>;
    revisionId?: string;
  };
