import { Buffer } from 'buffer';
import { Worklet } from 'react-native-bare-kit';
import { zHelloAck, type Ack, type HelloAck } from './protocol.ts';
import type { SyncTransport } from './manager.ts';

// Generado por `npm run build:sync-worker`. Es un string de Bare Bundle.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const workerSource = require('./worker.bundle.js') as string;

type EventoWorker =
  | { type: 'identity'; publicKey: string }
  | { type: 'ready' | 'connected' | 'disconnected' }
  | { type: 'line'; line: string }
  | { type: 'error'; message: string };

export type EstadoTransporte = 'iniciando' | 'buscando-peer' | 'conectado' | 'desconectado' | 'error';

export class TransporteP2P implements SyncTransport {
  private readonly worklet = new Worklet({ memoryLimit: 128 * 1024 * 1024 });
  private readonly esperas = new Map<string, { resolve: (ack: Ack) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private esperaHello: { resolve: (ack: HelloAck) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private buffer = '';
  private conectado = false;
  private terminado = false;
  public publicKey: string | null = null;

  constructor(private readonly onEstado: (estado: EstadoTransporte, detalle?: string) => void) {
    this.worklet.IPC.on('data', (chunk: unknown) => {
      if (chunk instanceof Uint8Array) this.alRecibir(Buffer.from(chunk).toString('utf8'));
    });
    this.worklet.on('terminate', () => {
      this.conectado = false;
      this.terminado = true;
      this.onEstado('desconectado');
      this.rechazarEsperas('TRANSPORTE_TERMINADO');
    });
  }

  iniciar(seedHex: string, bootstrap?: Array<{ host: string; port: number }>): void {
    this.onEstado('iniciando');
    this.worklet.start('/qurum-sync.bundle', workerSource);
    this.comando({ type: 'start', seedHex, ...(bootstrap?.length ? { bootstrap } : {}) });
  }

  private comando(command: object): void {
    if (this.terminado) throw new Error('TRANSPORTE_TERMINADO');
    this.worklet.IPC.write(Buffer.from(JSON.stringify(command)));
  }

  private alRecibir(chunk: string): void {
    this.buffer += chunk;
    const lineas = this.buffer.split('\n');
    this.buffer = lineas.pop() ?? '';
    for (const linea of lineas) {
      if (!linea.trim()) continue;
      let evento: EventoWorker;
      try { evento = JSON.parse(linea) as EventoWorker; } catch { continue; }
      if (evento.type === 'identity') {
        this.publicKey = evento.publicKey;
        this.onEstado('buscando-peer', evento.publicKey);
      } else if (evento.type === 'connected') {
        this.conectado = true;
        this.onEstado('conectado');
      } else if (evento.type === 'disconnected') {
        this.conectado = false;
        this.onEstado('desconectado');
        this.rechazarEsperas('PEER_DESCONECTADO');
      } else if (evento.type === 'error') {
        this.onEstado('error', evento.message);
      } else if (evento.type === 'line') {
        this.procesarLineaServidor(evento.line);
      }
    }
  }

  private procesarLineaServidor(linea: string): void {
    let mensaje: unknown;
    try { mensaje = JSON.parse(linea); } catch { return; }
    const hello = zHelloAck.safeParse(mensaje);
    if (hello.success && this.esperaHello) {
      clearTimeout(this.esperaHello.timer);
      const espera = this.esperaHello;
      this.esperaHello = null;
      espera.resolve(hello.data);
      return;
    }
    if (!mensaje || typeof mensaje !== 'object' || !('tipo' in mensaje) || mensaje.tipo !== 'ack' || !('loteId' in mensaje) || typeof mensaje.loteId !== 'string') return;
    const espera = this.esperas.get(mensaje.loteId);
    if (!espera) return;
    clearTimeout(espera.timer);
    this.esperas.delete(mensaje.loteId);
    espera.resolve(mensaje as Ack);
  }

  async enviar(linea: string): Promise<void> {
    if (!this.conectado) throw new Error('PEER_NO_CONECTADO');
    this.comando({ type: 'send', line: linea.endsWith('\n') ? linea : `${linea}\n` });
  }

  esperarAck(loteId: string, timeoutMs = 15_000): Promise<Ack> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.esperas.delete(loteId);
        reject(new Error('ACK_TIMEOUT'));
      }, timeoutMs);
      this.esperas.set(loteId, { resolve, reject, timer });
    });
  }

  esperarHelloAck(timeoutMs = 8_000): Promise<HelloAck> {
    if (this.esperaHello) {
      clearTimeout(this.esperaHello.timer);
      this.esperaHello.reject(new Error('VERIFICACION_REEMPLAZADA'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.esperaHello = null;
        reject(new Error('HELLO_ACK_TIMEOUT'));
      }, timeoutMs);
      this.esperaHello = { resolve, reject, timer };
    });
  }

  private rechazarEsperas(motivo: string): void {
    for (const espera of this.esperas.values()) {
      clearTimeout(espera.timer);
      espera.reject(new Error(motivo));
    }
    this.esperas.clear();
    if (this.esperaHello) {
      clearTimeout(this.esperaHello.timer);
      this.esperaHello.reject(new Error(motivo));
      this.esperaHello = null;
    }
  }

  async cerrar(): Promise<void> {
    if (!this.terminado) this.comando({ type: 'stop' });
    this.rechazarEsperas('TRANSPORTE_CERRADO');
  }
}
