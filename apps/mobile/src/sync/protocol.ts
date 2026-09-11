import { z } from 'zod';
import type { Observacion } from '../core/contracts.ts';

export const VERSION_PROTOCOLO = 1;

export const zHello = z.object({
  tipo: z.literal('hello'),
  versionProtocolo: z.literal(VERSION_PROTOCOLO),
  dispositivoId: z.string().min(1),
  observadorId: z.string().min(1),
  cursorServidor: z.string().optional(),
});

export const zLote = z.object({
  tipo: z.literal('observaciones'),
  versionProtocolo: z.literal(VERSION_PROTOCOLO),
  loteId: z.string().min(1),
  dispositivoId: z.string().min(1),
  datos: z.array(z.unknown()).min(1),
});

export const zAck = z.object({
  tipo: z.literal('ack'),
  versionProtocolo: z.literal(VERSION_PROTOCOLO),
  loteId: z.string().min(1),
  recibidas: z.array(z.string()),
  duplicadas: z.array(z.string()),
  rechazadas: z.array(z.object({ id: z.string(), motivo: z.string() })),
  revisionId: z.string().optional(),
});

export const zHelloAck = z.object({
  tipo: z.literal('hello_ack'),
  versionProtocolo: z.literal(VERSION_PROTOCOLO),
  servidorId: z.string().min(1),
  sesionId: z.string().min(1),
});

export type Hello = z.infer<typeof zHello>;
export type LoteObservaciones = z.infer<typeof zLote>;
export type Ack = z.infer<typeof zAck>;
export type HelloAck = z.infer<typeof zHelloAck>;

export function crearHello(dispositivoId: string, observadorId: string, cursorServidor?: string): Hello {
  return zHello.parse({ tipo: 'hello', versionProtocolo: VERSION_PROTOCOLO, dispositivoId, observadorId, ...(cursorServidor ? { cursorServidor } : {}) });
}

export function crearLote(loteId: string, dispositivoId: string, observaciones: Observacion[]): LoteObservaciones {
  return zLote.parse({ tipo: 'observaciones', versionProtocolo: VERSION_PROTOCOLO, loteId, dispositivoId, datos: observaciones });
}

export function codificarMensaje(mensaje: Hello | LoteObservaciones): string {
  return JSON.stringify(mensaje) + '\n';
}

export function decodificarAck(linea: string): Ack {
  return zAck.parse(JSON.parse(linea));
}
