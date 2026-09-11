import type { ObservacionConfirmada } from '../store/expo-store.ts';

export type EstadoSync = 'pendiente-local' | 'enviando' | 'recibida-pendiente-de-revision' | 'error-visible';

export interface EntradaSync {
  observacion: ObservacionConfirmada;
  estado: EstadoSync;
  intentos: number;
  actualizadaEn: string;
  ultimoError?: string;
}

export type EventoCola =
  | { op: 'upsert'; entrada: EntradaSync }
  | { op: 'retirar'; id: string };

export function aplicarEvento(evento: EventoCola, mapa: Map<string, EntradaSync>): void {
  if (evento.op === 'upsert') mapa.set(evento.entrada.observacion.id, evento.entrada);
  else mapa.delete(evento.id);
}

export function reconstruirCola(lineas: string[]): { mapa: Map<string, EntradaSync>; corruptas: number } {
  const mapa = new Map<string, EntradaSync>();
  let corruptas = 0;
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    try { aplicarEvento(JSON.parse(linea) as EventoCola, mapa); }
    catch { corruptas++; }
  }
  return { mapa, corruptas };
}

export function ordenarPendientes(mapa: Map<string, EntradaSync>): EntradaSync[] {
  return [...mapa.values()]
    .filter((e) => e.estado !== 'recibida-pendiente-de-revision')
    .sort((a, b) => a.actualizadaEn.localeCompare(b.actualizadaEn));
}
