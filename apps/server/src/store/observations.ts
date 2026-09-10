// observations.ts — append-only. Fuente de verdad de la base instalada.
//
// Corrección #9 de ../../CLAUDE.md: el doc maestro hace `catch { memoria = [] }`
// en `cargar()` — una sola línea corrupta (escritura a medias, disco lleno en
// mitad de un append) vacía TODA la base instalada en el siguiente arranque,
// sin aviso. Y como `agregar()` reconstruye `vistos` desde ese array vacío,
// también reinserta como "nuevas" observaciones que ya estaban, duplicando
// testimonios. Mismo criterio que `store/audit.ts`: cargar TOLERANTE para que
// el proceso arranque, verificar ESTRICTO aparte para que nadie confíe en
// silencio en un archivo dañado.
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { zObservacion, type Observacion } from '../core/contracts.ts';

const DIR = 'data';
const RUTA = `${DIR}/observaciones.jsonl`;
let memoria: Observacion[] | null = null;

/**
 * Última MEDICIÓN de líneas corruptas, con su procedencia.
 *
 * Por qué no es solo un array: `cargar()` cachea en `memoria` y solo parsea el
 * archivo la primera vez —eso es deliberado, es lo que evita releer el JSONL
 * en cada request—, mientras `verificarArchivo()` sí relee del disco. El
 * endpoint `/api/auditoria` devuelve las dos cosas juntas, así que devolvía un
 * conteo del arranque al lado de una verificación del instante, y se
 * contradecían sin que nada dijera por qué.
 *
 * Un número de auditoría sin su momento de medición no es un dato, es una
 * trampa. Así que la medición viaja con `medidoEn` y `origen`, y
 * `verificarArchivo()` —que de verdad relee el archivo— la refresca. La
 * semántica de caché de `cargar()` no se toca.
 */
let medicion: {
  lineas: number[];
  medidoEn: string | null;
  origen: 'cargar' | 'verificarArchivo' | null;
} = { lineas: [], medidoEn: null, origen: null };

/**
 * Carga TOLERANTE. Filtra línea por línea: la que no parsea o no matchea
 * `zObservacion` se descarta, las válidas sobreviven — nunca se vacía el
 * archivo entero por una sola línea rota. El resultado se cachea en
 * `memoria`; `agregar()` opera siempre sobre esta lista ya filtrada, así el
 * set de dedup (`vistos`) nunca parte de `[]` cuando en realidad hay datos
 * buenos en disco.
 */
export async function cargar(): Promise<Observacion[]> {
  if (memoria) return memoria;
  await mkdir(DIR, { recursive: true });
  const validas: Observacion[] = [];
  const descartadas: number[] = [];
  try {
    const lineas = (await readFile(RUTA, 'utf8')).trim().split('\n').filter(Boolean);
    lineas.forEach((linea, i) => {
      try {
        validas.push(zObservacion.parse(JSON.parse(linea)));
      } catch {
        descartadas.push(i + 1); // 1-index: línea humana, no índice de array
      }
    });
  } catch {
    /* primer arranque: RUTA todavía no existe */
  }
  memoria = validas;
  medicion = { lineas: descartadas, medidoEn: new Date().toISOString(), origen: 'cargar' };
  return memoria;
}

/**
 * Líneas (1-index) que se descartaron por no matchear `zObservacion`, TAL
 * COMO SE MIDIERON la última vez que alguien leyó el archivo de disco — sea
 * `cargar()` en el arranque o `verificarArchivo()` recién.
 *
 * Existe para que un endpoint/UI de auditoría pueda avisar "se descartaron N
 * líneas dañadas": la corrección #9 exige que la pérdida no sea invisible, no
 * solo que no sea total. `medidoEn`/`origen` son parte de la respuesta y no un
 * detalle: quien lee esto tiene que poder saber si está viendo el estado de
 * ahora o el del arranque, porque `cargar()` cachea a propósito y entre las
 * dos cosas puede haber horas de diferencia.
 *
 * `medidoEn: null` significa que nadie leyó el archivo todavía en este
 * proceso — que NO es lo mismo que "no hay líneas corruptas".
 */
export function lineasDescartadas(): {
  lineas: readonly number[];
  medidoEn: string | null;
  origen: 'cargar' | 'verificarArchivo' | null;
} {
  return { lineas: medicion.lineas, medidoEn: medicion.medidoEn, origen: medicion.origen };
}

/**
 * Append idempotente por id, VALIDANDO AL ESCRIBIR (la otra mitad de la
 * corrección #9: el doc maestro persiste desde `/api/confirmar` sin pasar
 * por `zObservacion`, así que una observación corrupta puede colarse ANTES
 * de que `cargar()` tenga la chance de filtrarla). Los testimonios nunca se
 * editan ni se borran, solo se agregan.
 *
 * `zObservacion.parse` tira `ZodError` si algo no matchea el contrato — el
 * llamador (server/index.ts) decide si eso degrada el lote entero o la
 * observación puntual (corrección #13); acá no se traga el error en
 * silencio, fail-closed.
 */
export async function agregar(obs: Observacion[]): Promise<number> {
  const actual = await cargar(); // ya filtrada: dedup real, no sobre [] vacío
  const vistos = new Set(actual.map((o) => o.id));
  const nuevas: Observacion[] = [];
  for (const o of obs) {
    const validada = zObservacion.parse(o);
    if (vistos.has(validada.id)) continue;
    vistos.add(validada.id);
    nuevas.push(validada);
  }
  if (!nuevas.length) return 0;
  await appendFile(RUTA, nuevas.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8');
  actual.push(...nuevas);
  return nuevas.length;
}

/**
 * Verificación ESTRICTA, análoga a `verificarCadena()` de `store/audit.ts`:
 * relee el archivo de disco (no la `memoria` cacheada) y reporta CADA línea
 * que no matchea `zObservacion`, sin descartar nada en silencio. Pensada
 * para un botón de auditoría/diagnóstico, no para el arranque — `cargar()`
 * ya resuelve eso de forma tolerante.
 *
 * Además REFRESCA la medición que devuelve `lineasDescartadas()`: es el único
 * punto del módulo que relee el archivo después del arranque, así que es el
 * único que puede hacerlo. Sin esto, `/api/auditoria` —que llama a las dos—
 * devolvía una verificación del instante junto a un conteo del arranque, y se
 * contradecían. No toca `memoria`: la caché de `cargar()` sigue siendo la
 * misma, esto solo actualiza el dato de auditoría.
 */
export async function verificarArchivo(): Promise<{ ok: boolean; total: number; corruptas: number[] }> {
  let contenido: string;
  try {
    contenido = await readFile(RUTA, 'utf8');
  } catch {
    // Archivo inexistente (primer arranque) es un resultado VÁLIDO y medido:
    // cero líneas, cero corruptas. Se registra como tal.
    medicion = { lineas: [], medidoEn: new Date().toISOString(), origen: 'verificarArchivo' };
    return { ok: true, total: 0, corruptas: [] };
  }
  const lineas = contenido.trim().split('\n').filter(Boolean);
  const corruptas: number[] = [];
  lineas.forEach((linea, i) => {
    try {
      zObservacion.parse(JSON.parse(linea));
    } catch {
      corruptas.push(i + 1);
    }
  });
  medicion = {
    lineas: [...corruptas], medidoEn: new Date().toISOString(), origen: 'verificarArchivo',
  };
  return { ok: corruptas.length === 0, total: lineas.length, corruptas };
}
