import { z } from 'zod';
import { completar } from './gateway.ts';
import type { Tool } from '@qvac/sdk';
import {
  MODALIDADES, MARCAS_DUMMY, zObservacion,
  type Observacion, type Borrador,
} from '../core/contracts.ts';
import { normalizarModalidad, detectarHedging, inferirNaturaleza } from '../trust/normalize.ts';
import { nuevoId } from '../core/ids.ts';
import { ValidationError } from '../core/errors.ts';
import { createHash } from 'node:crypto';

/**
 * Una sola tool. La guía de QVAC advierte que los modelos pequeños se ahogan
 * con toolsets grandes; con una tool y un esquema apretado, un Qwen3 1.7B
 * (extractor, ver ../../../mobile/CLAUDE.md) es fiable.
 *
 * El modelo solo puede producir ESTA forma. H-02: `lotes`, no `equipos`.
 * `.max(60)` en `edadAnios` alinea con `zRangoEdad` de contracts.ts
 * (corrección #13 de ../../CLAUDE.md): sin este tope, un "7.5 años" o una
 * edad fuera de rango pasa la extracción y revienta después en
 * `zObservacion.parse()` sin capturar — se pierde el LOTE completo en vez de
 * degradarlo. Acá se degrada por lote más abajo (ver `parsearLote`), nunca se
 * pierde la observación entera por un solo campo fuera de rango.
 */
const zLoteExtraido = z.object({
  modalidad: z.string().describe(`Tipo de equipo. Uno de: ${MODALIDADES.join(', ')}`),
  cantidad: z.number().int().min(1).max(500).optional(),
  marca: z.string().optional().describe(`Fabricante. Ej: ${MARCAS_DUMMY.join(', ')}`),
  modelo: z.string().optional(),
  edadAnios: z.number().int().min(0).max(60).optional().describe('Antigüedad aproximada en años'),
  edadMin: z.number().int().min(0).optional().describe('Si el usuario dio un rango'),
  edadMax: z.number().int().max(60).optional(),
  /**
   * Cita LITERAL de `texto` que justifica este lote — mapea directo a
   * `Observacion.evidencia` en contracts.ts (campo requerido agregado por el
   * lead: Anexo D / TRAZABILIDAD.md lo declaran requerido aunque el doc
   * maestro §II.3 no lo modelaba). `.max(500)` se relaja acá a `.max(2000)`
   * (el tope real de 500 se aplica truncando ANTES de este parse — ver
   * `truncarEvidencia` — para no descartar un lote entero por una cita de
   * 501 caracteres cuando 500 igual alcanzan para verificarla).
   */
  evidencia: z.string().min(1).max(2000)
    .describe('Fragmento copiado literalmente del texto del colaborador que justifica este lote'),
});

const zExtraccion = z.object({
  cliente: z.string().describe('Nombre del hospital, clínica o centro médico'),
  ciudad: z.string().optional(),
  pais: z.string().optional(),
  sitio: z.string().optional().describe('Área, piso o sala, si se menciona'),
  notas: z.string().optional().describe('Cualquier detalle adicional relevante'),
  lotes: z.array(zLoteExtraido).describe(
    'UN LOTE POR CADA GRUPO DE EQUIPOS QUE COMPARTE EDAD. ' +
    'Si el usuario dice "tres MR, dos viejos y uno nuevo", produce DOS lotes ' +
    'de la misma modalidad: uno de cantidad 2 y otro de cantidad 1.'),
  // Sin `.min(1)`: un lote vacío es una observación válida ("visité y no vi
  // equipo"), la misma razón por la que mobile/CLAUDE.md corrección #2 quita
  // el `.min(1)` equivalente. Acá se descarta más abajo si tras normalizar
  // ningún lote sobrevive, no antes.
});

/**
 * Corrección #4 de ../../CLAUDE.md: la `Tool` se declara en el formato
 * JSON-Schema-like que espera `@qvac/sdk` (tipo `Tool`, ver gateway.ts),
 * a mano — no pasando `zExtraccion` crudo como `parameters`. Dos razones:
 *
 * 1. zod 3.25 no trae `z.toJSONSchema`, así que no hay conversión automática
 *    disponible en esta versión.
 * 2. El SDK sí acepta un Zod schema envuelto en `ToolInput` y lo convierte
 *    con `convertToolInput()`, pero esa conversión es superficial: solo lee
 *    las keys de primer nivel del shape y no soporta `items` de array ni
 *    propiedades anidadas de objeto (ver `@qvac/sdk/dist/utils/tool-helpers.js`).
 *    `lotes` es un array de objetos — con la conversión automática el modelo
 *    vería `{ type: 'array' }` sin ninguna pista de la forma interna más allá
 *    de la `description` del array. Declarando el `Tool` a mano ponemos esa
 *    forma interna, explícita, en la descripción del campo (única vía que el
 *    schema plano del SDK deja disponible), en vez de depender de que el
 *    conversor automático la preserve por accidente.
 *
 * El Zod schema (`zExtraccion`/`zLoteExtraido`) se conserva como el único
 * validador en runtime de lo que el modelo efectivamente devuelve — la salida
 * del modelo es INPUT HOSTIL, se valida o se rechaza (ver `extraerBorrador`).
 */
const TOOL_EXTRAER: Tool = {
  type: 'function',
  name: 'registrar_observacion',
  description: 'Registra la observación de equipos médicos que el colaborador acaba de describir.',
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nombre del hospital, clínica o centro médico' },
      ciudad: { type: 'string' },
      pais: { type: 'string' },
      sitio: { type: 'string', description: 'Área, piso o sala, si se menciona' },
      notas: { type: 'string', description: 'Cualquier detalle adicional relevante' },
      lotes: {
        type: 'array',
        description:
          'UN LOTE POR CADA GRUPO DE EQUIPOS QUE COMPARTE EDAD. Si el usuario dice ' +
          '"tres MR, dos viejos y uno nuevo", producí DOS lotes de la misma modalidad: ' +
          'uno de cantidad 2 y otro de cantidad 1. ' +
          'Cada elemento del array es un objeto con estos campos: ' +
          `modalidad (string, uno de: ${MODALIDADES.join(', ')}), ` +
          'cantidad (entero, opcional), ' +
          `marca (string, opcional, ej: ${MARCAS_DUMMY.join(', ')}), ` +
          'modelo (string, opcional), ' +
          'edadAnios (entero 0-60, opcional, antigüedad aproximada), ' +
          'edadMin y edadMax (enteros 0-60, opcionales, si el usuario dio un rango en vez de un número), ' +
          'evidencia (string, OBLIGATORIO: fragmento copiado LITERALMENTE del mensaje del colaborador ' +
          'que justifica este lote específico — no un resumen, no una paráfrasis. ' +
          'Si no podés copiar un fragmento literal que lo justifique, NO generes ese lote).',
      },
    },
    required: ['cliente', 'lotes'],
  },
};

const SISTEMA = `Eres un extractor de datos. Tu ÚNICA función es llamar a la herramienta
registrar_observacion con la información presente en el mensaje del colaborador.

Reglas estrictas:
- No inventes datos. Si un campo no se menciona, OMÍTELO.
- No adivines marcas ni modelos.
- Un lote por cada tipo de equipo. Y un lote SEPARADO por cada grupo de edad
  distinta dentro del mismo tipo.
- Cada lote necesita "evidencia": un fragmento copiado LITERALMENTE del
  mensaje del colaborador, no un resumen. Si no podés copiar un fragmento
  literal que lo justifique, NO generes ese lote.
- No respondas con texto. Solo llama a la herramienta.`;

/** Trunca `evidencia` a 500 chars ANTES de validar — el tope real que exige
 *  `Observacion.evidencia` (contracts.ts). Igual que la corrección #13 con
 *  `edadAnios`: una cita de 501 caracteres no debe tirar el lote entero por
 *  un solo campo largo, se acorta y se sigue validando. */
function truncarEvidencia(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('evidencia' in raw)) return raw;
  const r = raw as Record<string, unknown>;
  if (typeof r['evidencia'] === 'string' && r['evidencia'].length > 500) {
    return { ...r, evidencia: r['evidencia'].slice(0, 500) };
  }
  return raw;
}

// Mismo patrón de normalización que trust/normalize.ts (consistencia con el
// resto del proyecto, no un normalizador nuevo).
const normalizarParaEvidencia = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Verificador determinista de evidencia — sin modelo. Misma garantía
 * anti-alucinación que el pipeline de mobile (Anexo D, "verificador de
 * evidencia"), no un detalle específico del móvil: acá no hay portero+
 * extractor cruzándose, así que esta es la única barrera antes de persistir
 * una cita que el modelo pudo haber inventado.
 *
 * Regla exacta (idéntica a mobile/CLAUDE.md): normalizar ambos lados
 * (minúsculas, sin acentos, espacios colapsados). Válida si la cita aparece
 * como subcadena; si no, exigir que TODAS las palabras estén presentes
 * (comparación por palabra completa, no `string.includes` — ese fue el bug
 * de mobile #11, "dos" matcheando dentro de "todos") y que al menos una
 * secuencia de 3 palabras consecutivas coincida. Citas de 1-2 palabras se
 * consideran válidas con solo el chequeo de palabras (una secuencia de 3 es
 * imposible por definición).
 */
function evidenciaValida(evidencia: string, texto: string): boolean {
  const n = normalizarParaEvidencia(texto);
  const e = normalizarParaEvidencia(evidencia);
  if (!e) return false;
  if (n.includes(e)) return true;

  const palabrasTexto = n.split(' ').filter(Boolean);
  const palabrasCita = e.split(' ').filter(Boolean);
  if (!palabrasCita.length) return false;
  if (!palabrasCita.every((p) => palabrasTexto.includes(p))) return false;
  if (palabrasCita.length < 3) return true;

  for (let i = 0; i <= palabrasCita.length - 3; i++) {
    const secuencia = palabrasCita.slice(i, i + 3).join(' ');
    if (n.includes(secuencia)) return true;
  }
  return false;
}

/**
 * Parsea un lote crudo del modelo con `zLoteExtraido`. Si falla (p. ej. una
 * edad fuera de 0-60 que el modelo ignoró pese al prompt, o falta
 * `evidencia`), el LOTE se descarta y el resto de la observación sigue —
 * corrección #13: se degrada el lote, no toda la observación ni todo el
 * batch. Además de la forma, se exige que la evidencia sea real
 * (`evidenciaValida`) — una cita bien formada pero fabricada se descarta
 * igual que una mal formada.
 */
function parsearLote(raw: unknown, texto: string): z.infer<typeof zLoteExtraido> | null {
  const parsed = zLoteExtraido.safeParse(truncarEvidencia(raw));
  if (!parsed.success) return null;
  if (!evidenciaValida(parsed.data.evidencia, texto)) return null;
  return parsed.data;
}

/** Texto libre → BORRADOR (H-03). No persiste nada. */
export async function extraerBorrador(opts: {
  modelId: string; texto: string;
  observadorId: string; dispositivoId: string;
  visitadoEn?: string;                        // H-05
  fuente: 'voz' | 'texto' | 'foto';           // H-04
  delegado: boolean; modeloSha256?: string;
}): Promise<Borrador> {

  const { toolCalls } = await completar({
    modelId: opts.modelId,
    history: [{ role: 'system', content: SISTEMA }, { role: 'user', content: opts.texto }],
    tools: [TOOL_EXTRAER], maxTokens: 500,
  });

  const call = toolCalls.find((c) => c.name === 'registrar_observacion');
  if (!call) throw new ValidationError('El modelo no produjo una extracción utilizable');

  // ── La salida del modelo es INPUT HOSTIL. Se valida o se rechaza. ──
  // El objeto exterior (cliente/ciudad/país/sitio/notas/lotes-como-array) se
  // valida con zExtraccion.omit — los lotes individuales se validan y
  // degradan uno por uno más abajo, no acá, por la corrección #13.
  const zSobre = zExtraccion.omit({ lotes: true }).extend({ lotes: z.array(z.unknown()) });
  const parsed = zSobre.safeParse(call.arguments);
  if (!parsed.success) {
    throw new ValidationError('Extracción inválida', { issues: parsed.error.issues });
  }

  const hedging = detectarHedging(opts.texto);                 // código, no modelo
  const naturaleza = inferirNaturaleza(opts.texto, hedging);   // H-01
  const capturadaEn = new Date().toISOString();
  const visitadoEn = opts.visitadoEn ?? capturadaEn;
  const sesionId = nuevoId();                                  // H-02
  const out: Observacion[] = [];

  for (const crudo of parsed.data.lotes) {
    const l = parsearLote(crudo, opts.texto);
    if (!l) continue;                                          // lote inválido o evidencia no verificable → se degrada

    const modalidad = normalizarModalidad(l.modalidad);
    if (!modalidad) continue;                                  // fuera del vocabulario → descarte

    const edad = l.edadMin !== undefined && l.edadMax !== undefined
      ? ([l.edadMin, l.edadMax] as [number, number]) : l.edadAnios;

    // Tipado explícito como `Observacion` ANTES de `zObservacion.parse()`:
    // `parse()` acepta `unknown`, así que sin esto el compilador no valida la
    // forma del literal — el próximo cambio de contrato (como `evidencia`
    // recién agregado) compilaría igual y solo explotaría en runtime. Con
    // este tipo, un campo requerido faltante es un error de TypeScript acá
    // mismo, no una sorpresa en producción.
    const candidato: Observacion = {
      id: nuevoId(), sesionId,
      observadorId: opts.observadorId, dispositivoId: opts.dispositivoId,
      visitadoEn, capturadaEn, fuente: opts.fuente, naturaleza, origen: 'local',
      cliente: {
        nombre: parsed.data.cliente,
        ...(parsed.data.ciudad ? { ciudad: parsed.data.ciudad } : {}),
        ...(parsed.data.pais ? { pais: parsed.data.pais } : {}),
        ...(parsed.data.sitio ? { sitio: parsed.data.sitio } : {}),
      },
      lote: {
        modalidad,
        ...(l.marca ? { marca: l.marca } : {}),
        ...(l.modelo ? { modelo: l.modelo } : {}),
        ...(l.cantidad !== undefined ? { cantidad: l.cantidad } : {}),
        ...(edad !== undefined ? { edadAnios: edad } : {}),
      },
      evidencia: l.evidencia,
      hedging,
      ...(parsed.data.notas ? { notas: parsed.data.notas } : {}),
      seguimiento: [],
      textoOriginal: opts.texto,
      provenance: {
        hash: createHash('sha256').update(opts.texto + capturadaEn).digest('hex'),
        ...(opts.modeloSha256 ? { modeloSha256: opts.modeloSha256 } : {}),
        delegado: opts.delegado,
      },
    };
    out.push(zObservacion.parse(candidato));
  }

  if (!out.length) throw new ValidationError('Ningún equipo reconocible en la observación');

  const pregunta = siguientePregunta(out[0]!);

  return {
    id: nuevoId(), sesionId, observaciones: out,
    resumen: resumir(out),                              // H-03, paso 12
    siguientePregunta: pregunta,
    creadoEn: capturadaEn,
    // Regla dura (mobile CLAUDE.md §Tabla de decisión, aplica igual acá):
    // si hay una pregunta de seguimiento pendiente el borrador queda
    // 'pendiente-de-revision' hasta que el usuario responda (o no) — nunca
    // se descarta. Sin pregunta abierta no hay nada que revisar.
    estadoRevision: pregunta === null ? 'confirmada' : 'pendiente-de-revision',
  };
}

/** Paso 12 de su lógica: "I captured: 2 MR, NovaMed, approx. 7 years… Is that correct?" */
export function resumir(obs: Observacion[]): string {
  const partes = obs.map((o) => {
    const p = [`${o.lote.cantidad ?? '?'} ${o.lote.modalidad}`];
    if (o.lote.marca) p.push(o.lote.marca);
    if (o.lote.modelo) p.push(o.lote.modelo);
    if (o.lote.edadAnios !== undefined) {
      const e = o.lote.edadAnios;
      p.push(Array.isArray(e) ? `aprox. ${e[0]}–${e[1]} años` : `aprox. ${e} años`);
    }
    return p.join(', ');
  });
  const c = obs[0]!.cliente;
  return `Registré en ${c.nombre}${c.ciudad ? ` (${c.ciudad})` : ''}: ` +
         `${partes.join('; ')}. ¿Es correcto?`;
}

/** Pregunta por el dato faltante MÁS VALIOSO.
 *  Prioridad determinista, no criterio del modelo:
 *  cantidad sin marca sirve para contar base instalada;
 *  modelo sin cantidad no sirve casi para nada. */
export function siguientePregunta(o: Observacion): string | null {
  if (o.lote.cantidad === undefined) return `¿Cuántos equipos de ${o.lote.modalidad} observaste?`;
  if (!o.cliente.ciudad) return '¿En qué ciudad y país está el cliente?';
  if (!o.lote.marca) return '¿Conoces la marca o fabricante?';
  if (o.lote.edadAnios === undefined) return '¿Aproximadamente qué antigüedad tiene?';
  if (!o.lote.modelo) return '¿Sabes el modelo o familia de producto?';
  return null;
}
