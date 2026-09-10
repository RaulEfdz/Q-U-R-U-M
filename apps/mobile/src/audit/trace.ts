import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
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

/**
 * Registro de la DECISIÓN del pipeline para una nota. `respuestaUsuario`
 * queda SIEMPRE `null` acá — nunca se completa mutando este registro (el
 * log es de solo-anexo). Qué hizo el usuario después es un evento
 * SEPARADO: `RegistroRespuestaUsuario`, más abajo.
 */
export interface RegistroPipeline {
  tipo: 'decision';
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
  hashPrev: string;
  hash: string;
}

/**
 * Evento SEPARADO — NO un `RegistroPipeline` mutado. Referencia al
 * registro original por `refId` (el `id` del `RegistroPipeline`), NUNCA
 * por `notaHash`: dos notas con el mismo TEXTO (dos visitas distintas, el
 * mismo colaborador repitiendo la misma frase) producen el mismo
 * `notaHash`, y correlacionar por ahí pega la respuesta al evento
 * equivocado — silencioso, e irreversible en un log inmutable. `refId` no
 * tiene esa ambigüedad: quien llama esta función ya tiene el registro
 * concreto en la mano (`cruzar.ts` lo acaba de generar, o la pantalla de
 * confirmación lo está mostrando).
 *
 * No duplica los campos de decisión del original (resultado, lotes,
 * tiempos, etc.) — si un bug futuro los hiciera divergir, un auditor
 * vería dos registros de la misma nota con datos distintos y no habría
 * forma de saber cuál vale. Este evento lleva SOLO la respuesta.
 */
export interface RegistroRespuestaUsuario {
  tipo: 'respuesta-usuario';
  id: string;
  at: string;
  /** `id` del `RegistroPipeline` al que responde. */
  refId: string;
  /** Heredado del original, solo para agrupar/enlazar con `provenance.hash` — nunca la clave de correlación. */
  notaHash: string;
  respuestaUsuario: RespuestaUsuario;
  hashPrev: string;
  hash: string;
}

export type EventoAuditoria = RegistroPipeline | RegistroRespuestaUsuario;

const zRegistroPipeline = z.object({
  tipo: z.literal('decision'),
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
  hashPrev: z.string(),
  hash: z.string(),
});

const zRegistroRespuestaUsuario = z.object({
  tipo: z.literal('respuesta-usuario'),
  id: z.string().min(10),
  at: z.string().datetime(),
  refId: z.string().min(10),
  notaHash: z.string().min(1),
  respuestaUsuario: z.enum(['confirmo', 'corrigio', 'descarto', 'ignoro']),
  hashPrev: z.string(),
  hash: z.string(),
});

const zEventoAuditoria = z.discriminatedUnion('tipo', [
  zRegistroPipeline, zRegistroRespuestaUsuario,
]);

/** Marcador de génesis: mismo largo que un hash sha256 hex, para que la
 *  cadena tenga una forma uniforme desde el primer registro. */
const GENESIS_HASH = '0'.repeat(64);

const ARCHIVO = new File(Paths.document, 'audit-pipeline.jsonl');
/** Igual criterio que `expo-store.ts`: una línea corrupta al CARGAR se
 *  filtra pero no desaparece sin dejar rastro. */
const ARCHIVO_CORRUPTAS = new File(Paths.document, 'audit-pipeline.corruptas.jsonl');

let memoria: EventoAuditoria[] | null = null;
let cargando: Promise<EventoAuditoria[]> | null = null;

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
export async function cargar(): Promise<EventoAuditoria[]> {
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

    const validos: EventoAuditoria[] = [];
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
      const chk = zEventoAuditoria.safeParse(json);
      if (chk.success) {
        validos.push(chk.data);
      } else {
        corruptos++;
        await registrarLineaCorrupta(linea, `no cumple EventoAuditoria: ${chk.error.message}`);
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

function calcularHash(campos: Record<string, unknown>): string {
  // Mismo cambio y mismo motivo que `hashTexto` en `pipeline/extractor.ts`:
  // `node:crypto` no existe en React Native. SHA-256 idéntico, así que la
  // cadena de hashes ya escrita en disco sigue verificando — que es
  // exactamente lo que el botón "Verificar integridad" promete.
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(campos))));
}

/**
 * Escribe un evento al log de auditoría. A DIFERENCIA de
 * `registrarLineaCorrupta` de arriba (canal secundario, best-effort), esto
 * NO es opcional: si `ARCHIVO.write` falla, la excepción se propaga. Un
 * registro de auditoría que no se pudo escribir es un problema real —
 * "la auditoría tiene huecos justo donde más importa" (TRAZABILIDAD.md) —
 * no algo que un `catch` vacío se trague.
 */
async function escribir<T extends EventoAuditoria>(evento: T): Promise<T> {
  const chk = zEventoAuditoria.safeParse(evento);
  if (!chk.success) {
    throw new Error(`Evento de auditoria invalido, no se escribe: ${chk.error.message}`);
  }
  if (!ARCHIVO.exists) ARCHIVO.create({ intermediates: true });
  // Append real, igual que expo-store.ts (corrección #10 aplicada por
  // simetría): un corte a mitad de escritura pierde, como mucho, ESTE
  // evento — nunca el log de auditoría completo.
  ARCHIVO.write(JSON.stringify(chk.data) + '\n', { append: true });

  const actual = memoria ?? await cargar();
  memoria = [...actual, chk.data];
  ultimoDiagnostico = { ...ultimoDiagnostico, validos: memoria.length };
  return evento;
}

/** Último hash de la cadena (o `GENESIS_HASH` si todavía no hay eventos). */
async function ultimoHash(): Promise<string> {
  const actual = await cargar();
  return actual.length > 0 ? actual[actual.length - 1]!.hash : GENESIS_HASH;
}

export type DatosPipeline = Omit<
  RegistroPipeline, 'tipo' | 'id' | 'at' | 'notaHash' | 'hashPrev' | 'hash'
>;

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
    tipo: 'decision' as const,
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
 * `registroId` es el `id` del `RegistroPipeline` original, NO su
 * `notaHash` — dos notas con el mismo TEXTO (dos visitas, o el mismo
 * colaborador repitiendo la misma frase) producen el mismo `notaHash`, y
 * correlacionar por ahí pega la respuesta al evento equivocado de forma
 * silenciosa e irreversible. Quien llama esta función ya tiene el
 * registro concreto en la mano (`cruzar.ts` lo generó, o la pantalla de
 * confirmación lo está mostrando) — pásalo por su `id`.
 *
 * Diseño: el log es de solo-anexo e inmutable, así que esto NO reescribe
 * el registro original. Anexa un `RegistroRespuestaUsuario` NUEVO —un
 * evento de otro tipo, que referencia al original por `refId` y lleva
 * SOLO la respuesta, sin duplicar los campos de decisión (si un bug
 * futuro los hiciera divergir, no habría forma de saber cuál registro
 * vale) — encadenado igual que cualquier otro evento.
 */
export async function registrarRespuestaUsuario(
  registroId: string, respuesta: RespuestaUsuario,
): Promise<RegistroRespuestaUsuario> {
  const actual = await cargar();
  const previo = actual.find(
    (e): e is RegistroPipeline => e.tipo === 'decision' && e.id === registroId,
  );
  if (!previo) {
    throw new Error(
      `No hay RegistroPipeline con id=${registroId}; no se puede registrar la respuesta del usuario sin la traza original.`,
    );
  }

  const hashPrev = await ultimoHash();
  const base = {
    tipo: 'respuesta-usuario' as const,
    id: nuevoId(),
    at: new Date().toISOString(),
    refId: previo.id,
    notaHash: previo.notaHash,
    respuestaUsuario: respuesta,
    hashPrev,
  };
  const evento: RegistroRespuestaUsuario = { ...base, hash: calcularHash(base) };
  return escribir(evento);
}

export interface ResultadoVerificacionCadena {
  intacta: boolean;
  /** `id` del primer evento donde la cadena no cierra, si la hay. */
  rotoEn?: string;
}

/**
 * "Cualquier alteración retroactiva del log rompe la cadena y es
 * detectable" (TRAZABILIDAD.md) — esta función es el medio para
 * detectarla: recalcula el hash de cada evento cargado y confirma que
 * coincide con el `hash` guardado y que `hashPrev` enlaza con el anterior.
 */
export async function verificarCadena(): Promise<ResultadoVerificacionCadena> {
  const eventos = await cargar();
  let esperado = GENESIS_HASH;
  for (const e of eventos) {
    const { hash, ...resto } = e;
    if (resto.hashPrev !== esperado || calcularHash(resto) !== hash) {
      return { intacta: false, rotoEn: e.id };
    }
    esperado = hash;
  }
  return { intacta: true };
}
