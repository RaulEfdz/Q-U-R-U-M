import { nuevoId } from '../core/ids.ts';
import { crearHello, crearLote, type Ack } from './protocol.ts';
import type { Observacion } from '../core/contracts.ts';
import type { EntradaSync } from './queue-state.ts';

export interface SyncTransport {
  enviar(linea: string): Promise<void>;
  cerrar(): Promise<void>;
}

export interface SyncIdentidad {
  dispositivoId: string;
  observadorId: string;
}

export interface OperacionesCola {
  listarPendientes(): Promise<EntradaSync[]>;
  marcarEnviando(ids: string[]): Promise<void>;
  aplicarAck(recibidas: string[], duplicadas: string[]): Promise<void>;
  marcarError(id: string, mensaje: string): Promise<void>;
}

export async function ejecutarSincronizacion(
  identidad: SyncIdentidad,
  transporte: SyncTransport,
  esperarAck: (loteId: string) => Promise<Ack>,
  cola: OperacionesCola,
): Promise<Ack | null> {
  const pendientes = await cola.listarPendientes();
  if (!pendientes.length) return null;

  const ids = pendientes.map((e) => e.observacion.id);
  const loteId = nuevoId();
  await cola.marcarEnviando(ids);

  try {
    await transporte.enviar(JSON.stringify(crearHello(identidad.dispositivoId, identidad.observadorId)) + '\n');
    const lote = crearLote(loteId, identidad.dispositivoId, pendientes.map((e) => e.observacion) as Observacion[]);
    await transporte.enviar(JSON.stringify(lote) + '\n');
    const ack = await esperarAck(loteId);
    await cola.aplicarAck(ack.recibidas, ack.duplicadas);
    for (const rechazado of ack.rechazadas) await cola.marcarError(rechazado.id, rechazado.motivo);
    return ack;
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    for (const id of ids) await cola.marcarError(id, mensaje);
    return null;
  }
}
