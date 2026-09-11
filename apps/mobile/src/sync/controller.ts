import { obtenerIdentidad } from '../app/identidad.ts';
import { sincronizar } from './manager.ts';
import { listarPendientes } from './queue.ts';
import { crearHello } from './protocol.ts';
import { TransporteP2P, type EstadoTransporte } from './transport-p2p.ts';

export interface EstadoSyncGlobal {
  transporte: EstadoTransporte;
  pendientes: number;
  publicKey: string | null;
  ultimoSyncEn: string | null;
  error: string | null;
  verificando: boolean;
  ultimaVerificacionEn: string | null;
  latenciaMs: number | null;
}

let estado: EstadoSyncGlobal = {
  transporte: 'desconectado', pendientes: 0, publicKey: null,
  ultimoSyncEn: null, error: null, verificando: false,
  ultimaVerificacionEn: null, latenciaMs: null,
};
let transporte: TransporteP2P | null = null;
let iniciada = false;
let sincronizando = false;
const listeners = new Set<(estado: EstadoSyncGlobal) => void>();

function publicar(patch: Partial<EstadoSyncGlobal>): void {
  estado = { ...estado, ...patch };
  for (const listener of listeners) listener(estado);
}

async function contar(): Promise<void> {
  publicar({ pendientes: (await listarPendientes()).length });
}

export function suscribirSync(listener: (estado: EstadoSyncGlobal) => void): () => void {
  listeners.add(listener);
  listener(estado);
  return () => listeners.delete(listener);
}

export async function iniciarSyncMovil(): Promise<void> {
  if (iniciada) return;
  iniciada = true;
  await contar();
  const identidad = await obtenerIdentidad();
  transporte = new TransporteP2P((s, detalle) => {
    publicar({ transporte: s, publicKey: transporte?.publicKey ?? estado.publicKey, error: s === 'error' ? detalle ?? 'ERROR_P2P' : null });
    if (s === 'conectado') void sincronizarAhora();
  });
  transporte.iniciar(identidad.peerSeedHex);
}

export async function sincronizarAhora(): Promise<void> {
  if (!transporte || sincronizando || estado.transporte !== 'conectado') return;
  sincronizando = true;
  try {
    const identidad = await obtenerIdentidad();
    const ack = await sincronizar(identidad, transporte, (loteId) => transporte!.esperarAck(loteId));
    await contar();
    if (ack) publicar({ ultimoSyncEn: new Date().toISOString(), error: null });
  } finally {
    sincronizando = false;
  }
}

export async function refrescarEstadoSync(): Promise<void> {
  await contar();
}

export async function verificarConexion(): Promise<boolean> {
  if (!transporte || estado.transporte !== 'conectado' || estado.verificando) return false;
  publicar({ verificando: true, error: null });
  const inicio = Date.now();
  try {
    const identidad = await obtenerIdentidad();
    const respuesta = transporte.esperarHelloAck();
    await transporte.enviar(JSON.stringify(crearHello(identidad.dispositivoId, identidad.observadorId)) + '\n');
    await respuesta;
    publicar({ verificando: false, ultimaVerificacionEn: new Date().toISOString(), latenciaMs: Date.now() - inicio, error: null });
    return true;
  } catch (e) {
    publicar({ verificando: false, error: e instanceof Error ? e.message : String(e), latenciaMs: null });
    return false;
  }
}
