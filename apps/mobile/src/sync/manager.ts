import { nuevoId } from '../core/ids.ts';
import { aplicarAck, listarPendientes, marcarEnviando, marcarError } from './queue.ts';
import { crearHello, crearLote, type Ack } from './protocol.ts';
import type { Observacion } from '../core/contracts.ts';

export interface SyncTransport {
  enviar(linea: string): Promise<void>;
  cerrar(): Promise<void>;
}

export interface SyncIdentidad {
  dispositivoId: string;
  observadorId: string;
}

export async function sincronizar(
  identidad: SyncIdentidad,
  transporte: SyncTransport,
  esperarAck: (loteId: string) => Promise<Ack>,
): Promise<Ack | null> {
  const pendientes = await listarPendientes();
  if (!pendientes.length) return null;

  const ids = pendientes.map((e) => e.observacion.id);
  const loteId = nuevoId();
  await marcarEnviando(ids);

  try {
    await transporte.enviar(JSON.stringify(crearHello(identidad.dispositivoId, identidad.observadorId)) + '\n');
    const lote = crearLote(loteId, identidad.dispositivoId, pendientes.map((e) => e.observacion) as Observacion[]);
    await transporte.enviar(JSON.stringify(lote) + '\n');
    const ack = await esperarAck(loteId);
    await aplicarAck(ack.recibidas, ack.duplicadas);
    for (const rechazado of ack.rechazadas) await marcarError(rechazado.id, rechazado.motivo);
    return ack;
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    for (const id of ids) await marcarError(id, mensaje);
    return null;
  }
}
