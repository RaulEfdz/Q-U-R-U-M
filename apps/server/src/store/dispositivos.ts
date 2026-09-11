// dispositivos.ts — registro de dispositivos que se conectaron por P2P.
//
// Pendiente #4 de SYNC_P2P_MOBILE_CONTRACT.md ("registro/revocación de
// dispositivos"). `sync/peer.ts` ya sabía CUÁNTOS peers están conectados
// (`pares()`), pero no CUÁLES: sin este store, un chip de conteo es lo único
// visible en la UI y no hay nada que auditar por dispositivo.
//
// Igual que `revisiones-peer.ts`: append-only en disco, reconstruido en
// memoria al arrancar. `dispositivoId`/`observadorId` llegan recién con la
// primera observación del peer (hoy no hay mensaje `hello`, ver el propio
// documento de contrato) — hasta entonces, el registro solo tiene la clave.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';

const RUTA = 'data/dispositivos.jsonl';

export interface Dispositivo {
  /** Clave pública Hyperswarm, RECORTADA — mismo criterio que el resto de
   *  la auditoría (`clave.slice(0, 16)`): identifica el transporte sin
   *  guardar la clave completa donde no hace falta. */
  clave: string;
  /** `dispositivoId`/`observadorId` del contrato de observación — legibles,
   *  NO la clave criptográfica (ver core/contracts.ts, comentario de
   *  `dispositivoId`). `undefined` hasta que llega la primera observación
   *  válida de este peer. */
  dispositivoId?: string;
  observadorId?: string;
  conectado: boolean;
  primerContactoEn: string;
  ultimoContactoEn: string;
}

const dispositivos = new Map<string, Dispositivo>();
let cargada = false;

function cargarDesdeDisco(): void {
  if (cargada) return;
  cargada = true;
  try {
    const lineas = readFileSync(RUTA, 'utf8').split('\n').filter(Boolean);
    for (const linea of lineas) {
      try {
        const d = JSON.parse(linea) as Dispositivo;
        if (d.clave) dispositivos.set(d.clave, d);
      } catch { /* una línea dañada no oculta las demás */ }
    }
    // Un reinicio del servidor cierra todas las conexiones P2P que hubiera:
    // ninguna de las que quedaron marcadas "conectado" en disco sigue viva.
    for (const d of dispositivos.values()) d.conectado = false;
  } catch { /* primer arranque: todavía no existe el registro */ }
}

function persistir(d: Dispositivo): void {
  mkdirSync('data', { recursive: true });
  appendFileSync(RUTA, JSON.stringify(d) + '\n', 'utf8');
}

/** Un peer de la allowlist se conectó ahora. */
export function registrarConexion(clave: string): void {
  cargarDesdeDisco();
  const ahora = new Date().toISOString();
  const previo = dispositivos.get(clave);
  const d: Dispositivo = previo
    ? { ...previo, conectado: true, ultimoContactoEn: ahora }
    : { clave, conectado: true, primerContactoEn: ahora, ultimoContactoEn: ahora };
  dispositivos.set(clave, d);
  persistir(d);
}

/** Se cerró la conexión (fin normal o corte) — no se borra el registro,
 *  solo se marca como no conectado; el historial del dispositivo se
 *  conserva. */
export function registrarDesconexion(clave: string): void {
  cargarDesdeDisco();
  const previo = dispositivos.get(clave);
  if (!previo) return; // nunca se registró conexión (no debería pasar)
  const d: Dispositivo = { ...previo, conectado: false, ultimoContactoEn: new Date().toISOString() };
  dispositivos.set(clave, d);
  persistir(d);
}

/**
 * Enriquece el registro con la identidad legible del dispositivo, en cuanto
 * llega su primera observación válida. `dispositivoId`/`observadorId` del
 * PAYLOAD son datos de un peer y por lo tanto untrusted — se guardan para
 * mostrarlos en la UI, nunca para decidir confianza ni quórum (eso sigue
 * siendo trabajo exclusivo de `trust/reconcile.ts`, por `observadorId`
 * dentro de cada `Observacion` ya persistida, no de este registro).
 */
export function registrarActividad(
  clave: string, datos: { dispositivoId?: string; observadorId?: string },
): void {
  cargarDesdeDisco();
  const previo = dispositivos.get(clave);
  if (!previo) return; // sin conexión activa registrada, no hay dónde adjuntar esto
  const d: Dispositivo = {
    ...previo,
    dispositivoId: datos.dispositivoId ?? previo.dispositivoId,
    observadorId: datos.observadorId ?? previo.observadorId,
    ultimoContactoEn: new Date().toISOString(),
  };
  dispositivos.set(clave, d);
  persistir(d);
}

export function listarDispositivos(): Dispositivo[] {
  cargarDesdeDisco();
  return [...dispositivos.values()].sort((a, b) => b.ultimoContactoEn.localeCompare(a.ultimoContactoEn));
}
