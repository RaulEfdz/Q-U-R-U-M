// audit.ts — cadena de hash de auditoría. Único store que pep.ts necesita
// para desbloquear Fase 4; observations.ts y drafts.ts siguen siendo de la
// Fase 6 de otro agente (no tocar).
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { nuevoId } from '../core/ids.ts';
import type { AuditRecord } from '../core/contracts.ts';

const DIR = 'data';
const RUTA = `${DIR}/audit.jsonl`;
const HASH_GENESIS = '0'.repeat(64);

/**
 * Cola de escritura. Serializa los `registrarAuditoria` de ESTE proceso: dos
 * en paralelo leerían el mismo `hashPrev` y encadenarían los dos registros al
 * mismo predecesor, bifurcando la cadena por una carrera propia.
 */
let cola: Promise<unknown> = Promise.resolve();

/** Guarda de forma (no un schema Zod — `AuditRecord` es un tipo interno, no
 *  input de usuario, pero sí se lee de un archivo que un auditor puede haber
 *  editado a mano, que es justo lo que `verificarCadena` debe detectar). */
function esAuditRecord(x: unknown): x is AuditRecord {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return typeof r['id'] === 'string' && typeof r['at'] === 'string'
    && typeof r['traceId'] === 'string' && typeof r['accion'] === 'string'
    && typeof r['detalle'] === 'object' && r['detalle'] !== null
    && typeof r['hashPrev'] === 'string' && typeof r['hash'] === 'string';
}

/**
 * Carga TOLERANTE, solo para saber desde qué `hash` seguir encadenando al
 * arrancar. Corrección #9 de ../../CLAUDE.md (redactada para
 * `observations.ts`, mismo criterio acá): una línea corrupta se descarta,
 * NO se vacía el archivo entero ni se pierde la cadena. Esto NO es una
 * verificación — ver `verificarCadena()` para eso, que es estricta a
 * propósito y no comparte esta tolerancia.
 */
async function ultimoHash(): Promise<string> {
  // Corrección de ../../CLAUDE.md §menores: sin este mkdir, abrir "Auditoría"
  // antes del primer registro tira 500 (RUTA no existe, ni tampoco el dir).
  await mkdir(DIR, { recursive: true });
  try {
    const lineas = (await readFile(RUTA, 'utf8')).trim().split('\n').filter(Boolean);
    let ultimaValida: AuditRecord | undefined;
    for (const linea of lineas) {
      try {
        const parsed: unknown = JSON.parse(linea);
        if (esAuditRecord(parsed)) ultimaValida = parsed;
      } catch { /* línea corrupta: se descarta al cargar, no rompe el arranque */ }
    }
    return ultimaValida ? ultimaValida.hash : HASH_GENESIS;
  } catch {
    return HASH_GENESIS;   // primer arranque: RUTA todavía no existe
  }
}

/**
 * ★ El `hashPrev` se relee DEL ARCHIVO en cada escritura, no se cachea en
 * memoria.
 *
 * Antes se guardaba en una variable de módulo que solo se actualizaba con las
 * escrituras de este proceso. Con dos escritores sobre el mismo `data/` — un
 * script del propio proyecto corriendo mientras el server está vivo, o un
 * segundo server — este proceso quedaba desincronizado y encadenaba su
 * siguiente registro a un hash que ya no era el último. Resultado: la cadena
 * se bifurcaba SIN QUE NADIE ALTERARA NADA, `verificarCadena()` la reportaba
 * rota, y la pantalla de Auditoría — la que existe para demostrar integridad —
 * mostraba un fallo inventado. Reproducido: corriendo un script del proyecto
 * con el server levantado, la línea 13 quedó encadenada al hash de la 5.
 *
 * Cuesta una lectura del archivo por registro. Es auditoría: la cadena tiene
 * que ser correcta antes que rápida, y el archivo es chico. Si algún día
 * crece, la optimización es leer solo la cola, no volver a cachear.
 */
export async function registrarAuditoria(e: {
  traceId: string; accion: string; detalle: Record<string, unknown>;
}): Promise<AuditRecord> {
  const anterior = cola;
  let liberar: () => void = () => {};
  cola = new Promise<void>((r) => { liberar = r; });
  try {
    await anterior;
  } catch { /* un fallo previo en la cola no debe bloquear este registro */ }

  try {
    const hashPrev = await ultimoHash();
    const cuerpo = { id: nuevoId(), at: new Date().toISOString(), ...e, hashPrev };
    const hash = createHash('sha256').update(hashPrev + JSON.stringify(cuerpo)).digest('hex');
    const rec: AuditRecord = { ...cuerpo, hash };
    await appendFile(RUTA, JSON.stringify(rec) + '\n', 'utf8');
    return rec;
  } finally {
    liberar();
  }
}

/**
 * Verificación ESTRICTA para el auditor (botón en la UI: un jurado puede
 * editar el JSONL a mano y ver que el sistema lo detecta).
 *
 * A propósito NO comparte la tolerancia de `ultimoHash()`: acá una línea
 * corrupta o que no matchea la forma de `AuditRecord` NO se descarta y se
 * sigue de largo — se reporta como el punto exacto donde la cadena se
 * rompe. Cargar tolerante (para que el proceso arranque) y verificar
 * estricto (para que el auditor confíe) son dos cosas distintas; reparar la
 * cadena en silencio acá sería el mismo tipo de falla silenciosa que este
 * proyecto declara que no tolera.
 */
export async function verificarCadena(): Promise<{ ok: boolean; roto?: string }> {
  let contenido: string;
  try {
    contenido = await readFile(RUTA, 'utf8');
  } catch {
    // Corrección de ../../CLAUDE.md §menores: sin este catch, verificar antes
    // del primer registro (RUTA no existe) tira 500 en vez de "nada que
    // auditar todavía".
    return { ok: true };
  }

  const lineas = contenido.trim().split('\n').filter(Boolean);
  let prev = '0'.repeat(64);
  for (const [i, linea] of lineas.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(linea);
    } catch {
      return { ok: false, roto: `linea:${i + 1}` };
    }
    if (!esAuditRecord(parsed)) return { ok: false, roto: `linea:${i + 1}` };

    const { hash, ...cuerpo } = parsed;
    if (cuerpo.hashPrev !== prev) return { ok: false, roto: parsed.id };
    if (createHash('sha256').update(prev + JSON.stringify(cuerpo)).digest('hex') !== hash) {
      return { ok: false, roto: parsed.id };
    }
    prev = hash;
  }
  return { ok: true };
}
