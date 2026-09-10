import { createHash } from 'node:crypto';
import { z } from 'zod';
import { File, Paths } from 'expo-file-system';
import { nuevoId } from '../core/ids.ts';
import { hashTexto } from '../pipeline/extractor.ts';
import type { Resultado } from '../pipeline/cruzar.ts';

/**
 * Auditoría de ejecución — TRAZABILIDAD.md §2. Extensión nuestra: ni el doc
 * maestro ni el Anexo D la contemplan. Un `RegistroPipeline` inmutable por
 * nota procesada, encadenado por hash (mismo patrón que `AuditRecord` en
 * `core/contracts.ts` y que `store/audit.ts` del server), para poder
 * reconstruir "qué dijo cada modelo, cuándo, y por qué la nota terminó
 * donde terminó" sin re-ejecutar nada.
 */

export type RespuestaUsuario = 'confirmo' | 'corrigio' | 'descarto' | 'ignoro';

export interface RegistroPipeline {
  id: string;
  at: string;
  observadorId: string;
  dispositivoId: string;
  /** sha256 del texto original — NUNCA el texto crudo (evita que el log de
   *  auditoría se vuelva una segunda copia de datos sensibles del cliente). */
  notaHash: string;
  hayIndicios: boolean;
  porteroDijo: boolean;
  porteroMotivo: string;
  msPortero: number;
  atajo: boolean;
  lotesPropuestos: number;
  lotesValidos: number;
  /** Razón sí, contenido de la fila no — mismo motivo que `notaHash`: no duplicar PII en el log. */
  descartados: Array<{ razon: string }>;
  resultado: Resultado;
  msExtractor: number;
  preguntaMostrada: string | null;
  respuestaUsuario: RespuestaUsuario | null;
  hashPrev: string;
  hash: string;
}

const zRegistroPipeline = z.object({
  id: z.string().min(10),
  at: z.string().datetime(),
  observadorId: z.string().min(1),
  dispositivoId: z.string().min(1),
  notaHash: z.string().min(1),
  hayIndicios: z.boolean(),
  porteroDijo: z.boolean(),
  porteroMotivo: z.string(),
  msPortero: z.number(),
  atajo: z.boolean(),
  lotesPropuestos: z.number(),
  lotesValidos: z.number(),
  descartados: z.array(z.object({ razon: z.string() })),
  resultado: z.enum([
    'ACUERDO', 'ACUERDO_VACIO', 'POSIBLE_OMISION_PORTERO',
    'POSIBLE_OMISION_EXTRACTOR', 'EVIDENCIA_FABRICADA',
  ]),
  msExtractor: z.number(),
  preguntaMostrada: z.string().nullable(),
  respuestaUsuario: z.enum(['confirmo', 'corrigio', 'descarto', 'ignoro']).nullable(),
  hashPrev: z.string(),
  hash: z.string(),
});

/** Marcador de génesis: mismo largo que un hash sha256 hex, para que la
 *  cadena tenga una forma uniforme desde el primer registro. */
const GENESIS_HASH = '0'.repeat(64);

const ARCHIVO = new File(Paths.document, 'audit-pipeline.jsonl');
/** Igual criterio que `expo-store.ts`: una línea corrupta al CARGAR se
 *  filtra pero no desaparece sin dejar rastro. */
const ARCHIVO_CORRUPTAS = new File(Paths.document, 'audit-pipeline.corruptas.jsonl');

let memoria: RegistroPipeline[] | null = null;
let cargando: Promise<RegistroPipeline[]> | null = null;

export interface DiagnosticoCarga {
  validos: number;
  corruptos: number;
}
let ultimoDiagnostico: DiagnosticoCarga = { validos: 0, corruptos: 0 };
export function diagnosticoUltimaCarga(): DiagnosticoCarga {
  return ultimoDiagnostico;
}

async function registrarLineaCorrupta(linea: string, motivo: string): Promise<void> {
  const registro = JSON.stringify({ en: new Date().toISOString(), motivo, linea }) + '\n';
  try {
    if (!ARCHIVO_CORRUPTAS.exists) ARCHIVO_CORRUPTAS.create({ intermediates: true });
    ARCHIVO_CORRUPTAS.write(registro, { append: true });
  } catch {
    // Canal secundario de diagnóstico (igual que en expo-store.ts): si ni
    // esto se puede escribir, `ultimoDiagnostico.corruptos` sigue siendo
    // la señal mínima visible en memoria para esta sesión. El archivo de
    // auditoría PRINCIPAL (`ARCHIVO`) nunca depende de que esto funcione.
  }
}

/**
 * Carga tolerante, verificar estricto (mismo criterio que `expo-store.ts`
 * y `store/audit.ts` del server): una línea corrupta se filtra y se dejа
 * constancia en `ARCHIVO_CORRUPTAS`, nunca se vacía el archivo completo
 * por un byte roto en una sola línea.
 */
export async function cargar(): Promise<RegistroPipeline[]> {
  if (memoria) return memoria;
  if (cargando) return cargando;

  cargando = (async () => {
    let lineas: string[] = [];
    try {
      if (ARCHIVO.exists) {
        const txt = await ARCHIVO.text();
        lineas = txt.split('\n').filter((l) => l.trim().length > 0);
      }
    } catch {
      lineas = []; // archivo existe pero no se pudo leer como texto — no hay líneas que filtrar
    }

    const validos: RegistroPipeline[] = [];
    let corruptos = 0;
    for (const linea of lineas) {
      let json: unknown;
      try {
        json = JSON.parse(linea);
      } catch (e) {
        corruptos++;
        await registrarLineaCorrupta(linea, `JSON invalido: ${(e as Error).message}`);
        continue;
      }
      const chk = zRegistroPipeline.safeParse(json);
      if (chk.success) {
        validos.push(chk.data);
      } else {
        corruptos++;
        await registrarLineaCorrupta(linea, `no cumple RegistroPipeline: ${chk.error.message}`);
      }
    }

    ultimoDiagnostico = { validos: validos.length, corruptos };
    memoria = validos;
    return validos;
  })();

  try {
    return await cargando;
  } finally {
    cargando = null;
  }
}

function calcularHash(campos: Omit<RegistroPipeline, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(campos), 'utf8').digest('hex');
}

/**
 * Escribe un registro al log de auditoría. A DIFERENCIA de
 * `registrarLineaCorrupta` de arriba (canal secundario, best-effort), esto
 * NO es opcional: si `ARCHIVO.write` falla, la excepción se propaga. Un
 * registro de auditoría que no se pudo escribir es un problema real —
 * "la auditoría tiene huecos justo donde más importa" (TRAZABILIDAD.md) —
 * no algo que un `catch` vacío se trague.
 */
async function escribir(registro: RegistroPipeline): Promise<RegistroPipeline> {
  const chk = zRegistroPipeline.safeParse(registro);
  if (!chk.success) {
    throw new Error(`RegistroPipeline invalido, no se escribe: ${chk.error.message}`);
  }
  if (!ARCHIVO.exists) ARCHIVO.create({ intermediates: true });
  // Append real, igual que expo-store.ts (corrección #10 aplicada por
  // simetría): un corte a mitad de escritura pierde, como mucho, ESTE
  // registro — nunca el log de auditoría completo.
  ARCHIVO.write(JSON.stringify(chk.data) + '\n', { append: true });

  const actual = memoria ?? await cargar();
  memoria = [...actual, chk.data];
  ultimoDiagnostico = { ...ultimoDiagnostico, validos: memoria.length };
  return chk.data;
}

/** Último hash de la cadena (o `GENESIS_HASH` si todavía no hay registros). */
async function ultimoHash(): Promise<string> {
  const actual = await cargar();
  return actual.length > 0 ? actual[actual.length - 1]!.hash : GENESIS_HASH;
}

export type DatosPipeline = Omit<
  RegistroPipeline, 'id' | 'at' | 'notaHash' | 'hashPrev' | 'hash' | 'respuestaUsuario'
> & { respuestaUsuario?: RespuestaUsuario | null };

/**
 * Registra la decisión del pipeline para UNA nota. Se llama siempre —
 * incluso en el atajo (`ACUERDO_VACIO`) — nunca solo cuando hay pregunta:
 * "sin excepción, o la auditoría tiene huecos justo donde más importa".
 *
 * Recibe `nota` (texto original) solo para hashearla acá adentro con
 * `hashTexto()` — el texto crudo nunca se guarda en el registro ni sale de
 * esta función.
 */
export async function registrarPipeline(
  nota: string, datos: DatosPipeline,
): Promise<RegistroPipeline> {
  const hashPrev = await ultimoHash();
  const base = {
    id: nuevoId(),
    at: new Date().toISOString(),
    observadorId: datos.observadorId,
    dispositivoId: datos.dispositivoId,
    notaHash: hashTexto(nota),
    hayIndicios: datos.hayIndicios,
    porteroDijo: datos.porteroDijo,
    porteroMotivo: datos.porteroMotivo,
    msPortero: datos.msPortero,
    atajo: datos.atajo,
    lotesPropuestos: datos.lotesPropuestos,
    lotesValidos: datos.lotesValidos,
    descartados: datos.descartados,
    resultado: datos.resultado,
    msExtractor: datos.msExtractor,
    preguntaMostrada: datos.preguntaMostrada,
    respuestaUsuario: datos.respuestaUsuario ?? null,
    hashPrev,
  };
  const registro: RegistroPipeline = { ...base, hash: calcularHash(base) };
  return escribir(registro);
}

/**
 * Registra qué hizo el usuario con la pregunta de una nota ya procesada
 * (`confirmo`/`corrigio`/`descarto`/`ignoro`) — incluyendo el caso
 * `ignoro`, que TRAZABILIDAD.md exige no perder nunca.
 *
 * Diseño: el log es de solo-anexo e inmutable (no se reescribe el
 * registro original). Esta función busca el ÚLTIMO registro con ese
 * `notaHash` y anexa un registro NUEVO, idéntico en todos los campos de
 * decisión del pipeline, con `respuestaUsuario` completado — encadenado
 * igual que cualquier otro. Correlacionar por `notaHash` reconstruye la
 * historia completa de una nota sin mutar nada.
 */
export async function registrarRespuestaUsuario(
  notaHash: string, respuesta: RespuestaUsuario,
): Promise<RegistroPipeline> {
  const actual = await cargar();
  const previo = [...actual].reverse().find((r) => r.notaHash === notaHash);
  if (!previo) {
    throw new Error(
      `No hay registro de pipeline para notaHash=${notaHash}; no se puede registrar la respuesta del usuario sin la traza original.`,
    );
  }

  const hashPrev = await ultimoHash();
  const base = {
    id: nuevoId(),
    at: new Date().toISOString(),
    observadorId: previo.observadorId,
    dispositivoId: previo.dispositivoId,
    notaHash: previo.notaHash,
    hayIndicios: previo.hayIndicios,
    porteroDijo: previo.porteroDijo,
    porteroMotivo: previo.porteroMotivo,
    msPortero: previo.msPortero,
    atajo: previo.atajo,
    lotesPropuestos: previo.lotesPropuestos,
    lotesValidos: previo.lotesValidos,
    descartados: previo.descartados,
    resultado: previo.resultado,
    msExtractor: previo.msExtractor,
    preguntaMostrada: previo.preguntaMostrada,
    respuestaUsuario: respuesta,
    hashPrev,
  };
  const registro: RegistroPipeline = { ...base, hash: calcularHash(base) };
  return escribir(registro);
}

export interface ResultadoVerificacionCadena {
  intacta: boolean;
  /** `id` del primer registro donde la cadena no cierra, si la hay. */
  rotoEn?: string;
}

/**
 * "Cualquier alteración retroactiva del log rompe la cadena y es
 * detectable" (TRAZABILIDAD.md) — esta función es el medio para
 * detectarla: recalcula el hash de cada registro cargado y confirma que
 * coincide con el `hash` guardado y que `hashPrev` enlaza con el anterior.
 */
export async function verificarCadena(): Promise<ResultadoVerificacionCadena> {
  const registros = await cargar();
  let esperado = GENESIS_HASH;
  for (const r of registros) {
    const { hash, ...resto } = r;
    if (resto.hashPrev !== esperado || calcularHash(resto) !== hash) {
      return { intacta: false, rotoEn: r.id };
    }
    esperado = hash;
  }
  return { intacta: true };
}
