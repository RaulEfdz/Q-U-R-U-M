import { aplicarAck, listarPendientes, marcarEnviando, marcarError } from './queue.ts';
import type { Ack } from './protocol.ts';
import { ejecutarSincronizacion, type OperacionesCola, type SyncIdentidad, type SyncTransport } from './manager-core.ts';

export type { OperacionesCola, SyncIdentidad, SyncTransport } from './manager-core.ts';

const colaReal: OperacionesCola = { listarPendientes, marcarEnviando, aplicarAck, marcarError };

export async function sincronizar(
  identidad: SyncIdentidad,
  transporte: SyncTransport,
  esperarAck: (loteId: string) => Promise<Ack>,
  cola: OperacionesCola = colaReal,
): Promise<Ack | null> {
  return ejecutarSincronizacion(identidad, transporte, esperarAck, cola);
}
