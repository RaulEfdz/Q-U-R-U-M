import { File, Paths } from 'expo-file-system';
import type { ObservacionConfirmada } from '../store/expo-store.ts';

const ARCHIVO = new File(Paths.document, 'sync-queue.jsonl');

export type EstadoSync = 'pendiente-local' | 'enviando' | 'recibida-pendiente-de-revision' | 'error-visible';

export interface EntradaSync {
  observacion: ObservacionConfirmada;
  estado: EstadoSync;
  intentos: number;
  actualizadaEn: string;
  ultimoError?: string;
}

type Evento =
  | { op: 'upsert'; entrada: EntradaSync }
  | { op: 'retirar'; id: string };

let cache: Map<string, EntradaSync> | null = null;

function aplicar(evento: Evento, mapa: Map<string, EntradaSync>): void {
  if (evento.op === 'upsert') mapa.set(evento.entrada.observacion.id, evento.entrada);
  else mapa.delete(evento.id);
}

async function cargarMapa(): Promise<Map<string, EntradaSync>> {
  if (cache) return cache;
  const mapa = new Map<string, EntradaSync>();
  try {
    if (ARCHIVO.exists) {
      for (const linea of (await ARCHIVO.text()).split('\n').filter(Boolean)) {
        try { aplicar(JSON.parse(linea) as Evento, mapa); } catch { /* conserva eventos sanos */ }
      }
    }
  } catch { /* la cola vacía no oculta observaciones del store principal */ }
  cache = mapa;
  return mapa;
}

async function registrar(evento: Evento): Promise<void> {
  if (!ARCHIVO.exists) ARCHIVO.create({ intermediates: true });
  ARCHIVO.write(JSON.stringify(evento) + '\n', { append: true });
}

export async function encolar(observaciones: ObservacionConfirmada[]): Promise<number> {
  const mapa = await cargarMapa();
  let nuevas = 0;
  for (const observacion of observaciones) {
    if (mapa.has(observacion.id)) continue;
    const entrada: EntradaSync = {
      observacion, estado: 'pendiente-local', intentos: 0,
      actualizadaEn: new Date().toISOString(),
    };
    mapa.set(observacion.id, entrada);
    await registrar({ op: 'upsert', entrada });
    nuevas++;
  }
  return nuevas;
}

export async function listarPendientes(): Promise<EntradaSync[]> {
  return [...(await cargarMapa()).values()]
    .filter((e) => e.estado !== 'recibida-pendiente-de-revision')
    .sort((a, b) => a.actualizadaEn.localeCompare(b.actualizadaEn));
}

export async function marcarEnviando(ids: string[]): Promise<void> {
  const mapa = await cargarMapa();
  for (const id of ids) {
    const entrada = mapa.get(id);
    if (!entrada) continue;
    const actualizada: EntradaSync = { ...entrada, estado: 'enviando', intentos: entrada.intentos + 1, actualizadaEn: new Date().toISOString() };
    mapa.set(id, actualizada);
    await registrar({ op: 'upsert', entrada: actualizada });
  }
}

export async function aplicarAck(idsRecibidos: string[], idsDuplicados: string[]): Promise<void> {
  const mapa = await cargarMapa();
  for (const id of [...idsRecibidos, ...idsDuplicados]) {
    if (!mapa.has(id)) continue;
    await registrar({ op: 'retirar', id });
    mapa.delete(id);
  }
}

export async function marcarError(id: string, mensaje: string): Promise<void> {
  const mapa = await cargarMapa();
  const entrada = mapa.get(id);
  if (!entrada) return;
  const actualizada: EntradaSync = { ...entrada, estado: 'error-visible', ultimoError: mensaje, actualizadaEn: new Date().toISOString() };
  mapa.set(id, actualizada);
  await registrar({ op: 'upsert', entrada: actualizada });
}
