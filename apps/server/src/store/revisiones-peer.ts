// revisiones-peer.ts — inbox efímero de testimonios recibidos por P2P.
//
// Un peer autorizado puede TRANSPORTAR datos, pero no convertirlos en
// evidencia local: solo una confirmación humana puede llamar a agregar().
import type { Observacion } from '../core/contracts.ts';

export interface RevisionPeer {
  id: string;
  clavePeer: string;
  observaciones: Observacion[];
  recibidoEn: string;
}

const pendientes = new Map<string, RevisionPeer>();
const temporizadores = new Map<string, NodeJS.Timeout>();
const TTL_MS = 30 * 60_000;

export function encolarRevisionPeer(r: RevisionPeer): void {
  pendientes.set(r.id, r);
  const t = setTimeout(() => {
    pendientes.delete(r.id);
    temporizadores.delete(r.id);
  }, TTL_MS);
  t.unref();
  temporizadores.set(r.id, t);
}

export function listarRevisionesPeer(): RevisionPeer[] {
  return [...pendientes.values()].sort((a, b) => a.recibidoEn.localeCompare(b.recibidoEn));
}

export function obtenerRevisionPeer(id: string): RevisionPeer | undefined {
  return pendientes.get(id);
}

/** Quita un ítem recién confirmado o descartado: no se procesa dos veces. */
export function descartarRevisionPeer(id: string): RevisionPeer | undefined {
  const t = temporizadores.get(id);
  if (t) clearTimeout(t);
  temporizadores.delete(id);
  const r = pendientes.get(id);
  pendientes.delete(id);
  return r;
}
