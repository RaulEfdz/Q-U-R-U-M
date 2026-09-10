import { createHash } from 'node:crypto';
import { z } from 'zod';
import { completion, type CompletionFinal, type Tool } from '@qvac/sdk';
import { obtener, MODELOS } from '../qvac/pool.ts';
import { nuevoId } from '../core/ids.ts';
import { zObservacion, zRangoEdad, type Observacion } from '../core/contracts.ts';
import { normalizarModalidad, detectarHedging, inferirNaturaleza } from '../trust/normalize.ts';

/* ═══════════════════════════════════════════════════════════════════════
 * Forma que devuelve el MODELO (validada con zExtraccion, nuestro zod).
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Corrección #2 (apps/mobile/CLAUDE.md): `lotes` SIN `.min(1)`. Con `.min(1)`
 * son inalcanzables 2 de los 5 resultados de la tabla de decisión:
 * `ACUERDO_VACIO` por la rama no-atajo (portero dice que no hay equipo, el
 * extractor corrobora con 0 lotes) y `POSIBLE_OMISION_EXTRACTOR` (portero
 * dice que SÍ hay equipo pero el extractor no logra estructurar nada — 0
 * lotes es justamente la señal que dispara esa fila).
 *
 * Corrección #13 (server/CLAUDE.md, aplica igual acá): `edadAnios` es un
 * `z.number()` SIN `.int()` ni rango — a propósito. `zRangoEdad` de
 * contracts.ts exige entero 0-60; si validáramos ACÁ con ese mismo tope,
 * un "7.5 años" tira este `safeParse` con TODOS los lotes de la extracción
 * (porque es un solo objeto, no un arreglo de resultados independientes) y
 * se pierde la nota ENTERA. La corrección real pasa en `aObservaciones()`
 * más abajo: se valida y degrada CADA LOTE por separado — un `edadAnios`
 * fuera de rango descarta solo ese campo, nunca el lote ni la extracción.
 */
const zExtraccion = z.object({
  cliente: z.string().min(1),
  ciudad: z.string().optional(),
  pais: z.string().optional(),
  sitio: z.string().optional(),
  notas: z.string().optional(),
  lotes: z.array(z.object({
    modalidad: z.string(),
    cantidad: z.number().optional(),
    marca: z.string().optional(),
    modelo: z.string().optional(),
    edadAnios: z.number().optional(),
    // ★ obligatorio y verificable por código (verificar.ts, fuera de este archivo)
    evidencia: z.string(),
  })),
});
type Extraccion = z.infer<typeof zExtraccion>;

/* ═══════════════════════════════════════════════════════════════════════
 * Tool declarado como JSON-schema plano, NO como ToolInput con objeto Zod.
 * Mismo choque de versiones documentado en portero.ts: el SDK valida
 * `ToolInput.parameters` contra SU propia copia interna de zod v4
 * (`@qvac/sdk/node_modules/zod`), y el proyecto ancla zod 3.25.76 arriba
 * (contracts.ts congelado la usa). Un `z.ZodObject` de nuestro zod no es
 * asignable a ese tipo.
 *
 * Además: `toolSchema` real (schemas/tools.d.ts) solo admite, por
 * propiedad, `{ type, description, enum }` — no hay `items` para arrays
 * ni `properties` anidadas para objetos. No se puede declarar la forma
 * interna de cada lote como JSON-schema real. La salida es la misma que
 * usa el resto del pipeline (server): describir la forma del lote EN LA
 * `description` del parámetro `lotes`, en texto, y dejar que `zExtraccion`
 * (arriba) sea la validación real de lo que el modelo devuelva.
 */
const TOOL_EXTRACTOR: Tool = {
  type: 'function',
  name: 'extraer',
  description:
    'Extrae el cliente y los lotes de equipos medicos instalados descritos en la nota.',
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nombre del cliente, hospital o clinica mencionado en la nota.' },
      ciudad: { type: 'string', description: 'Ciudad del sitio, si se menciona.' },
      pais: { type: 'string', description: 'Pais del sitio, si se menciona.' },
      sitio: { type: 'string', description: 'Area o piso dentro del cliente, si se menciona.' },
      notas: { type: 'string', description: 'Cualquier observacion adicional que no encaje en un lote.' },
      lotes: {
        type: 'array',
        description:
          'Un elemento por LOTE. Un lote = N unidades de la MISMA modalidad que ' +
          'COMPARTEN EDAD. Cada elemento es un objeto JSON con estas claves: ' +
          'modalidad (string: MR, CT, Ultrasound, XRay, PatientMonitoring o ' +
          'ImageGuidedTherapy, o el termino tal cual lo dijo quien habla), ' +
          'cantidad (numero entero de unidades de ESTE lote), ' +
          'marca (string, opcional), modelo (string, opcional), ' +
          'edadAnios (numero, opcional), ' +
          'evidencia (string, OBLIGATORIO: el fragmento LITERAL y EXACTO de la ' +
          'nota que respalda este lote, copiado palabra por palabra, sin ' +
          'resumir, sin reescribir, sin traducir). ' +
          'Si no podes copiar un fragmento literal que lo justifique, NO ' +
          'generes ese lote. ' +
          'Ejemplo de division en lotes: la nota "tres resonadores, dos viejos ' +
          'y uno nuevo" produce DOS lotes de modalidad MR (uno con cantidad 2, ' +
          'otro con cantidad 1) — nunca un solo lote con cantidad 3, porque no ' +
          'comparten edad.',
      },
    },
    required: ['cliente', 'lotes'],
  },
};

const SISTEMA = `Extraes equipos medicos instalados que se mencionan en una nota de campo.

Reglas:
- Un LOTE agrupa unidades que comparten modalidad Y EDAD. Si hay unidades de
  la misma modalidad con edades distintas, son lotes SEPARADOS. Ejemplo:
  "tres resonadores, dos viejos y uno nuevo" -> DOS lotes de MR (cantidad 2
  y cantidad 1), NUNCA un lote de cantidad 3.
- Cada lote necesita "evidencia": el fragmento literal de la nota que lo
  justifica, copiado palabra por palabra. Si no podes copiar un fragmento
  literal que lo justifique, NO generes ese lote.
- No inventes marcas, modelos ni cantidades que la nota no menciona.
- Si la nota no describe ningun equipo, devolve "lotes" como arreglo vacio.
- Responde solo con la herramienta "extraer".`;

/* ═══════════════════════════════════════════════════════════════════════
 * Conversión: Extraccion (1 objeto cliente+lotes[]) -> Observacion[]
 * (una por lote, con `evidencia` ya como campo del contrato). Corrección #3.
 *
 * `contracts.ts` cambió tras el hallazgo de esta misma fase: `evidencia`
 * pasó a ser campo REQUERIDO de `Observacion` (el Anexo D y
 * TRAZABILIDAD.md la declaran así — no es dato de tránsito, es el registro
 * de auditoría de qué fragmento justificó el lote). Ya no hace falta
 * ningún wrapper: `aObservaciones()` devuelve `Observacion[]` tal cual.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Tope de `evidencia` en el contrato: `z.string().min(1).max(500)`. Igual
 *  criterio que `motivo` en portero.ts (corrección #8): truncar ANTES de
 *  parsear, nunca dejar que la longitud tire el `safeParse` del lote. */
const EVIDENCIA_MAX = 500;
function truncarEvidencia(e: string): string {
  return e.length > EVIDENCIA_MAX ? e.slice(0, EVIDENCIA_MAX) : e;
}

export interface ContextoExtraccion {
  observadorId: string;
  dispositivoId: string;
  /** Corrección #14: requerido, no opcional — RD-6 mide frescura desde acá. */
  visitadoEn: string;
  fuente: 'voz' | 'texto' | 'foto';
}

/**
 * Exportado (no solo interno) para que `audit/trace.ts` calcule el mismo
 * `notaHash` con el MISMO algoritmo sobre el MISMO texto — es la clave que
 * enlaza `RegistroPipeline.notaHash` con `Observacion.provenance.hash`
 * (TRAZABILIDAD.md §3). Si cada módulo hasheara por su cuenta, un cambio
 * de uno solo (ej. normalización distinta) rompería el enlace en silencio.
 */
export function hashTexto(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/**
 * Corrección #13: valida y degrada la edad LOTE POR LOTE. `zRangoEdad`
 * exige entero 0-60 (o tupla de rango); si lo que dijo el modelo no
 * entra ahí (7.5, -3, "un par"->NaN, 900), se DESCARTA solo el campo
 * `edadAnios` de ese lote — el lote se sigue proponiendo, sin edad.
 */
function edadValidaOUndefined(edadAnios: number | undefined): Observacion['lote']['edadAnios'] {
  if (edadAnios === undefined) return undefined;
  const candidato = Math.trunc(edadAnios);
  const chk = zRangoEdad.safeParse(candidato);
  return chk.success ? chk.data : undefined;
}

/**
 * Cantidad del lote: si el modelo no da un entero 1-500 usable, se asume
 * 1 unidad (un lote sin cantidad explícita describe, como mínimo, la
 * unidad que la evidencia menciona) en vez de descartar el lote entero.
 */
function cantidadValidaOUna(cantidad: number | undefined): number {
  if (cantidad === undefined) return 1;
  const candidato = Math.trunc(cantidad);
  return candidato >= 1 && candidato <= 500 ? candidato : 1;
}

function aObservaciones(
  ex: Extraccion, nota: string, ctx: ContextoExtraccion,
): Observacion[] {
  const sesionId = nuevoId();               // H-02: agrupa los lotes de esta captura
  const capturadaEn = new Date().toISOString();
  const hedging = detectarHedging(nota);     // detectado por CÓDIGO, no por el modelo
  const naturaleza = inferirNaturaleza(nota, hedging);
  const hashNota = hashTexto(nota);
  const textoOriginal = nota.slice(0, 4000); // tope de zObservacion.textoOriginal

  const propuestas: Observacion[] = [];

  for (const l of ex.lotes) {
    const modalidad = normalizarModalidad(l.modalidad);
    if (!modalidad) continue; // modalidad no reconocida: no hay dónde clasificar el lote, se descarta SOLO este

    // Tipado explícito como `Observacion`, no `unknown`/objeto libre: así
    // el compilador valida la FORMA del literal contra el contrato en
    // build-time. `safeParse` acepta `unknown` — sin este tipo, un futuro
    // cambio de contrato compila limpio igual mientras todo falla en
    // runtime y se descarta en silencio (exactamente lo que pasó acá con
    // el campo `evidencia` recién agregado).
    const candidato: Observacion = {
      id: nuevoId(),
      sesionId,
      observadorId: ctx.observadorId,
      dispositivoId: ctx.dispositivoId,
      visitadoEn: ctx.visitadoEn,
      capturadaEn,
      fuente: ctx.fuente,
      naturaleza,
      origen: 'local',
      cliente: {
        nombre: ex.cliente,
        ciudad: ex.ciudad,
        pais: ex.pais,
        sitio: ex.sitio,
      },
      lote: {
        modalidad,
        marca: l.marca,
        modelo: l.modelo,
        cantidad: cantidadValidaOUna(l.cantidad),
        edadAnios: edadValidaOUndefined(l.edadAnios),
      },
      evidencia: truncarEvidencia(l.evidencia),
      hedging,
      notas: ex.notas,
      seguimiento: [],
      textoOriginal,
      provenance: {
        hash: hashNota,
        modeloSha256: MODELOS.extractor.sha256Checksum,
        delegado: false,
      },
    };

    // Toda salida de modelo es input hostil: última validación antes de
    // proponer la observación (ej. `cliente.nombre` con menos de 2
    // caracteres, o `evidencia` vacía). Si no cumple `zObservacion`, se
    // descarta SOLO este lote — nunca la extracción completa.
    const chk = zObservacion.safeParse(candidato);
    if (chk.success) propuestas.push(chk.data);
  }

  return propuestas;
}

export async function extraer(
  nota: string, ctx: ContextoExtraccion,
): Promise<Observacion[]> {
  const modelId = await obtener('extractor');

  let final: CompletionFinal;
  try {
    const run = completion({
      modelId,
      history: [
        { role: 'system', content: SISTEMA },
        { role: 'user', content: nota },
      ],
      stream: false,
      tools: [TOOL_EXTRACTOR],
      generationParams: { temp: 0, seed: 42, predict: 80 },
    });
    final = await run.final;
  } catch {
    // Fallo de inferencia: no hay nada que proponer. Si el portero dijo
    // que sí hay equipo, la tabla de decisión de cruzar.ts convierte 0
    // lotes en POSIBLE_OMISION_EXTRACTOR (1 pregunta) — nunca se pierde
    // la nota ni se bloquea el pipeline.
    return [];
  }

  const call = final.toolCalls?.find((c) => c.name === 'extraer');
  const p = zExtraccion.safeParse(call?.arguments);
  if (!p.success) return [];

  return aObservaciones(p.data, nota, ctx);
}
