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
import { agregar, cargar } from '../store/observations.ts';
import { registrarAuditoria } from '../store/audit.ts';

const TOPIC = createHash('sha256').update('quorum/base-instalada/v1').digest();

export interface SyncHandle {
  destruir(): Promise<void>;
  pares(): number;
}

export interface IniciarSyncOptions {
  /** Claves públicas hex autorizadas. Vacía = rechaza a todos (fail-closed). */
  allowlist: string[];
  bootstrap?: Array<{ host: string; port: number }>;
  onCambio?: (n: number) => void;
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
    void registrarAuditoria({
      traceId: 'sync', accion: 'sync:peer-aceptado',
      detalle: { clave: clave.slice(0, 16) },
    });

    void enviarPropias(socket);

    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lineas = buffer.split('\n');
      buffer = lineas.pop() ?? '';
      void procesarLineas(lineas, clave, opts.onCambio);
    });

    socket.on('close', () => {
      pares--;
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
async function procesarLineas(
  lineas: string[], clave: string, onCambio?: (n: number) => void,
): Promise<void> {
  for (const linea of lineas) {
    if (!linea.trim()) continue;

    let mensaje: { tipo?: string; datos?: unknown[] };
    try {
      mensaje = JSON.parse(linea) as { tipo?: string; datos?: unknown[] };
    } catch {
      continue; // línea corrupta o hostil: se descarta, no rompe el socket
    }
    if (mensaje.tipo !== 'observaciones' || !Array.isArray(mensaje.datos)) continue;

    const validas: Observacion[] = [];
    for (const d of mensaje.datos) {
      const p = zObservacion.safeParse(d);
      if (!p.success) continue; // input hostil que no matchea el contrato: fuera
      validas.push({ ...p.data, origen: 'peer' }); // ★ marcado untrusted, siempre
    }
    if (!validas.length) continue;

    const n = await agregar(validas);
    if (n > 0) {
      await registrarAuditoria({
        traceId: 'sync', accion: 'sync:observaciones-recibidas',
        detalle: { clave: clave.slice(0, 16), nuevas: n },
      });
      onCambio?.(n);
    }
  }
}
