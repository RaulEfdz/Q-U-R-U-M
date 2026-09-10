// Declaración de módulo propia para `hyperswarm@4.14.0` — corrección #16 de
// ../../CLAUDE.md: el paquete no trae tipos y bajo `strict` da TS7016 +
// `any` implícitos en cualquier import. NO instalar `@types/hyperswarm` de
// terceros (no existe en DefinitelyTyped a esta versión) — esta es la
// superficie MÍNIMA que usa `sync/peer.ts`, no una traducción completa del
// paquete. Si otro archivo necesita más superficie, ampliar acá, no
// silenciar con `any`/`@ts-ignore`.
declare module 'hyperswarm' {
  import type { Duplex } from 'node:stream';

  /** Socket de conexión con un peer. Es un duplex de Buffers (noise-encrypted
   *  por debajo, vía hyperdht) — no un socket TCP crudo. */
  export interface PeerSocket extends Duplex {
    destroy(err?: Error): void;
  }

  export interface PeerInfo {
    publicKey: Buffer;
    topics: Buffer[];
  }

  export interface HyperswarmOptions {
    bootstrap?: Array<{ host: string; port: number }>;
    seed?: Buffer;
    maxPeers?: number;
    maxClientConnections?: number;
    maxServerConnections?: number;
    maxParallel?: number;
  }

  export interface JoinOptions {
    server?: boolean;
    client?: boolean;
  }

  export interface PeerDiscovery {
    flushed(): Promise<void>;
    destroy(): Promise<void>;
  }

  export default class Hyperswarm {
    constructor(opts?: HyperswarmOptions);
    readonly connections: Set<PeerSocket>;
    on(event: 'connection', listener: (socket: PeerSocket, info: PeerInfo) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    join(topic: Buffer, opts?: JoinOptions): PeerDiscovery;
    leave(topic: Buffer): Promise<void>;
    flush(): Promise<void>;
    destroy(opts?: { force?: boolean }): Promise<void>;
  }
}
