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

/**
 * ¿Hay algún indicio de equipo en la nota? Determinista, sin modelo.
 *
 * Sirve para distinguir dos fracasos que se veían iguales y no lo son:
 *
 *  · «Hola» — no hay NADA que extraer. Culpar al modelo es mentirle al
 *    usuario, y pedirle que reintente lo manda a repetir algo que va a fallar
 *    igual. Es el caso de «visité y no vi equipo» llevado al extremo, y se
 *    trata como tal: borrador vacío, que se puede guardar como pendiente.
 *  · «dos MR de NovaMed» sin tool call — acá SÍ había qué extraer y el modelo
 *    falló. Reintentar tiene sentido: con `temp 0` sigue sin ser determinista
 *    en la primera carga, y el segundo intento suele salir.
 *
 * Mismo criterio que el portero de la app móvil (`pipeline/precheck.ts`), pero
 * sin importar de la otra app: `src/` de cada superficie no cruza esa
 * frontera. Se apoya en lo que ya existe acá — el vocabulario controlado y la
 * tabla de sinónimos de `trust/normalize.ts`.
 *
 * Comparación por PALABRA COMPLETA, nunca por subcadena: fue el bug #11 del
 * pipeline móvil, donde «eco» matcheaba «economía» y «monitor» matcheaba
 * «monitorear». Un falso positivo acá no es cosmético — manda al usuario a
 * reintentar una extracción que nunca va a producir nada.
 */
const NUMEROS_EN_LETRAS = [
  'un', 'una', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
  'ocho', 'nueve', 'diez', 'once', 'doce', 'quince', 'veinte', 'varios',
  'varias',
];

export function hayIndiciosDeEquipo(texto: string): boolean {
  const limpio = texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/\d/.test(limpio)) return true;                    // cualquier cifra

  const palabras = limpio.split(/[^a-z0-9]+/).filter(Boolean);
  if (palabras.some((w) => NUMEROS_EN_LETRAS.includes(w))) return true;

  /*
   * Modalidad por sinónimo (MR, resonador, tomografo, eco…).
   *
   * Se prueban también los PARES y TRÍOS de palabras contiguas pegados, porque
   * la tabla de sinónimos de `trust/normalize.ts` indexa sin espacios: «rayos
   * x» vive ahí como `rayosx`, «resonancia magnetica» como
   * `resonanciamagnetica`, «patient monitoring» como `patientmonitoring`.
   * Comparando solo palabra por palabra, «sala de rayos x» no daba indicios —
   * lo encontró el test, no la lectura.
   *
   * Sigue sin ser comparación por subcadena: los grupos se forman con palabras
   * COMPLETAS y contiguas, así que «economia» nunca se convierte en «eco».
   */
  for (let i = 0; i < palabras.length; i++) {
    for (let n = 1; n <= 3 && i + n <= palabras.length; n++) {
      if (normalizarModalidad(palabras.slice(i, i + n).join('')) !== undefined) return true;
    }
  }

  // Marca del vocabulario ficticio, que puede ser de varias palabras.
  const marcas = MARCAS_DUMMY.map((m) =>
    m.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  return marcas.some((m) => new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(limpio));
}

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

/**
 * Países que aparecen en el dominio del proyecto. No es una lista de todos los
 * países del mundo: alcanza con distinguir un país de una CIUDAD, que es el
 * error concreto que comete el modelo.
 */
const PAISES_CONOCIDOS = new Set([
  'panama', 'panamá', 'colombia', 'chile', 'portugal', 'brazil', 'brasil',
  'united states', 'estados unidos', 'usa', 'eeuu', 'mexico', 'méxico',
  'argentina', 'peru', 'perú', 'ecuador', 'uruguay', 'paraguay', 'bolivia',
  'costa rica', 'guatemala', 'honduras', 'nicaragua', 'el salvador',
  'republica dominicana', 'república dominicana', 'venezuela', 'espana', 'españa',
]);

const norm = (s: string): string =>
  s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Corrige dos errores que el extractor comete de forma sistemática con el
 * cliente, y que se ven en la pantalla principal:
 *
 *   1. **El país pegado al nombre.** Devuelve
 *      `"Clinica DemoCare Norte de Bogota, Colombia"` como NOMBRE. Eso rompe
 *      `claveGrupo` — dos observaciones del mismo cliente escritas distinto
 *      caen en grupos separados y nunca llegan a quórum.
 *   2. **La ciudad en el campo `pais`.** Devuelve `pais: "Santiago"` sin
 *      ciudad. Contamina el `porPais` de Panorama y la columna `Country` del
 *      CSV de 19 columnas, que es lo que el cliente final importa.
 *
 * Se arregla en CÓDIGO y no pidiéndoselo mejor al modelo: es determinista,
 * verificable y no cuesta tokens. El principio del proyecto aplicado —
 * el LLM entiende, el código decide.
 *
 * Conservador a propósito: solo mueve un valor cuando está razonablemente
 * seguro. Ante la duda deja lo que dijo el modelo, porque un dato mal movido
 * es peor que uno mal puesto: el segundo se ve y se corrige en la pantalla de
 * confirmación.
 */
function normalizarCliente(d: { cliente: string; ciudad?: string; pais?: string }): {
  nombre: string; ciudad?: string; pais?: string;
} {
  let nombre = d.cliente.trim();
  let ciudad = d.ciudad?.trim() || undefined;
  let pais = d.pais?.trim() || undefined;

  // 1 · Partes de ubicación pegadas al nombre, después de una coma.
  if (nombre.includes(',')) {
    const [primera, ...resto] = nombre.split(',').map((x) => x.trim()).filter(Boolean);
    const colas = resto.filter(Boolean);
    if (primera && colas.length) {
      nombre = primera;
      for (const cola of colas) {
        if (PAISES_CONOCIDOS.has(norm(cola))) {
          if (!pais) pais = cola;
        } else if (!ciudad) {
          ciudad = cola;
        }
      }
    }
  }

  // 2 · Una ciudad puesta en `pais`, con `ciudad` vacía.
  if (pais && !ciudad && !PAISES_CONOCIDOS.has(norm(pais))) {
    ciudad = pais;
    pais = undefined;
  }

  // 3 · Al revés: un país declarado como ciudad, con `pais` vacío.
  if (ciudad && !pais && PAISES_CONOCIDOS.has(norm(ciudad))) {
    pais = ciudad;
    ciudad = undefined;
  }

  return {
    nombre,
    ...(ciudad ? { ciudad } : {}),
    ...(pais ? { pais } : {}),
  };
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

  /*
   * Sin tool call. Si la nota no tenía un solo indicio de equipo, el modelo no
   * falló: no había nada que extraer. Se sigue con un borrador vacío —el mismo
   * camino que una nota que dice explícitamente «no había equipo»— y la
   * persona decide si la guarda como pendiente. Con indicios presentes sí es
   * un fallo del modelo y se reporta como tal, porque ahí reintentar sirve.
   */
  const call = toolCalls.find((c) => c.name === 'registrar_observacion');
  if (!call && hayIndiciosDeEquipo(opts.texto)) {
    throw new ValidationError('El modelo no produjo una extracción utilizable');
  }

  // ── La salida del modelo es INPUT HOSTIL. Se valida o se rechaza. ──
  // El objeto exterior (cliente/ciudad/país/sitio/notas/lotes-como-array) se
  // valida con zExtraccion.omit — los lotes individuales se validan y
  // degradan uno por uno más abajo, no acá, por la corrección #13.
  //
  // Sin `call` (nota sin indicios) no hay nada que validar: el sobre queda
  // vacío y el borrador sale sin lotes, con el texto original intacto.
  const zSobre = zExtraccion.omit({ lotes: true }).extend({ lotes: z.array(z.unknown()) });
  type Sobre = z.infer<typeof zSobre>;

  let sobre: Sobre = { cliente: '', lotes: [] };
  if (call) {
    const parsed = zSobre.safeParse(call.arguments);
    if (!parsed.success) {
      throw new ValidationError('Extracción inválida', { issues: parsed.error.issues });
    }
    sobre = parsed.data;
  }

  const hedging = detectarHedging(opts.texto);                 // código, no modelo
  const naturaleza = inferirNaturaleza(opts.texto, hedging);   // H-01
  const capturadaEn = new Date().toISOString();
  const visitadoEn = opts.visitadoEn ?? capturadaEn;
  const sesionId = nuevoId();                                  // H-02
  const out: Observacion[] = [];

  for (const crudo of sobre.lotes) {
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
    const ubic = normalizarCliente(sobre);
    const candidato: Observacion = {
      id: nuevoId(), sesionId,
      observadorId: opts.observadorId, dispositivoId: opts.dispositivoId,
      visitadoEn, capturadaEn, fuente: opts.fuente, naturaleza, origen: 'local',
      cliente: {
        nombre: ubic.nombre,
        ...(ubic.ciudad ? { ciudad: ubic.ciudad } : {}),
        ...(ubic.pais ? { pais: ubic.pais } : {}),
        ...(sobre.sitio ? { sitio: sobre.sitio } : {}),
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
      ...(sobre.notas ? { notas: sobre.notas } : {}),
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

  /**
   * ★ Una nota SIN equipos reconocibles es un borrador válido, no un error.
   *
   * Antes esto lanzaba `ValidationError` y el pipeline moría ahí. La pantalla
   * mostraba «El modelo no pudo estructurar la nota» y agregaba: «La nota NO
   * se perdió: se puede guardar igual y quedar pendiente de revisión» — una
   * promesa que el producto no podía cumplir, porque el borrador nunca se
   * había creado y no existía ningún botón para guardar nada. Peor que un
   * error: un mensaje que miente.
   *
   * Y era drift con la app móvil, que ya trata este caso como dato legítimo
   * (`ConfirmacionBorrador.tsx`, estado `ACUERDO_VACIO`: «Visitaste el sitio y
   * no se observó equipo. Es un dato válido — se guarda así, sin ningún
   * lote»). Tiene sentido de producto: «fui y no vi equipo» es información
   * sobre la base instalada, y descartar la nota de quien se tomó el trabajo
   * de dictarla es fricción que enseña a no volver a dictar.
   *
   * Se devuelve entonces un borrador de CERO observaciones. `/api/confirmar`
   * ya sabe qué hacer con eso sin ningún cambio: no persiste ninguna
   * `Observacion` —no hay ninguna que persistir, y el contrato exige al menos
   * una modalidad por lote— y como queda una pregunta abierta, encola el
   * borrador completo en `store/pendientes.ts`. La nota sobrevive con su
   * texto, su fecha y su pregunta sin responder, que es exactamente lo que la
   * pantalla promete.
   *
   * Lo que este cambio NO hace: inventar un lote vacío para que «algo» entre
   * al store. Un equipo que nadie observó no se registra (RD-0).
   */
  const pregunta = out.length
    ? siguientePregunta(out[0]!)
    : '¿Qué equipos viste? Si no viste ninguno, dejalo así: la nota se guarda igual.';

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
  // Lista vacía: la nota existe y no describe ningún equipo. No es un error —
  // ver el comentario de `extraerBorrador` — y el resumen tiene que decir eso
  // sin sonar a falla, porque es lo primero que la persona lee.
  if (!obs.length) {
    return 'No reconocí ningún equipo en esta nota. Podés guardarla así: queda con la pregunta abierta y nadie pierde lo que dictaste.';
  }

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
