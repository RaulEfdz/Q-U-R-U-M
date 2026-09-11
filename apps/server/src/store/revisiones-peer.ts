// revisiones-peer.ts — inbox persistente de testimonios recibidos por P2P.
//
// Un peer autorizado puede TRANSPORTAR datos, pero no convertirlos en
// evidencia local: solo una confirmación humana puede llamar a agregar().
import type { Observacion } from '../core/contracts.ts';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';

const RUTA = 'data/revisiones-peer.jsonl';

export interface RevisionPeer {
  id: string;
  clavePeer: string;
  observaciones: Observacion[];
  recibidoEn: string;
}

const pendientes = new Map<string, RevisionPeer>();
const temporizadores = new Map<string, NodeJS.Timeout>();
const TTL_MS = 30 * 60_000;
let cargada = false;

function cargarDesdeDisco(): void {
  if (cargada) return;
  cargada = true;
  try {
    const lineas = readFileSync(RUTA, 'utf8').split('\n').filter(Boolean);
    for (const linea of lineas) {
      try {
        const evento = JSON.parse(linea) as { op?: string; revision?: RevisionPeer; id?: string };
        if (evento.op === 'encolar' && evento.revision) pendientes.set(evento.revision.id, evento.revision);
        if ((evento.op === 'retirar') && evento.id) pendientes.delete(evento.id);
      } catch { /* una línea dañada no oculta las demás */ }
    }
    for (const r of pendientes.values()) activarTTL(r);
  } catch { /* primer arranque: todavía no existe la inbox */ }
}

function registrar(evento: { op: 'encolar' | 'retirar'; revision?: RevisionPeer; id?: string }): void {
  mkdirSync('data', { recursive: true });
  appendFileSync(RUTA, JSON.stringify(evento) + '\n', 'utf8');
}

function activarTTL(r: RevisionPeer): void {
  const restante = Math.max(0, TTL_MS - (Date.now() - Date.parse(r.recibidoEn)));
  const t = setTimeout(() => {
    pendientes.delete(r.id);
    temporizadores.delete(r.id);
    registrar({ op: 'retirar', id: r.id });
  }, restante);
  t.unref();
  temporizadores.set(r.id, t);
}

export function encolarRevisionPeer(r: RevisionPeer): void {
  cargarDesdeDisco();
  if (pendientes.has(r.id)) return;
  pendientes.set(r.id, r);
  registrar({ op: 'encolar', revision: r });
  activarTTL(r);
}

export function listarRevisionesPeer(): RevisionPeer[] {
  cargarDesdeDisco();
  return [...pendientes.values()].sort((a, b) => a.recibidoEn.localeCompare(b.recibidoEn));
}

/** IDs ya recibidos y todavía pendientes de decisión humana. El transporte
 * los usa para responder un reenvío como duplicado sin crear otra revisión. */
export function idsObservacionesPendientes(): Set<string> {
  cargarDesdeDisco();
  return new Set([...pendientes.values()].flatMap((r) => r.observaciones.map((o) => o.id)));
}

export function obtenerRevisionPeer(id: string): RevisionPeer | undefined {
  cargarDesdeDisco();
  return pendientes.get(id);
}

/** Quita un ítem recién confirmado o descartado: no se procesa dos veces. */
export function descartarRevisionPeer(id: string): RevisionPeer | undefined {
  cargarDesdeDisco();
  const t = temporizadores.get(id);
  if (t) clearTimeout(t);
  temporizadores.delete(id);
  const r = pendientes.get(id);
  pendientes.delete(id);
  if (r) registrar({ op: 'retirar', id });
  return r;
}
