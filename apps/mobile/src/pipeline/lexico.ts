import { MARCAS_DUMMY } from '../core/contracts.ts';
import { jaroWinkler } from '../trust/similarity.ts';

/**
 * Corrección léxica post-ASR — determinista, sin modelo.
 *
 * Whisper tiny/base transcriben bien el castellano corriente y mal justo las
 * palabras que a este producto le importan: las siglas de modalidad y los
 * nombres de marca. Son vocabulario cerrado y fuera de distribución para un
 * modelo chico — «CT» sale «ce te», «BluePeak» sale «Blue Pick», «Zenith
 * MedTech» sale «Senit Medtec». El resto de la frase está bien; se rompe
 * exactamente el token del que después depende la extracción.
 *
 * Subirle tamaño al modelo ayuda con el promedio pero no cierra esto: ni base
 * ni small vieron nunca «BluePeak Medical». La corrección va acá, en CÓDIGO,
 * sobre un vocabulario cerrado — es el principio rector aplicado al ASR: el
 * modelo entiende el audio, el código decide cómo se escribe lo que ya sabemos
 * que existe.
 *
 * ★ Por qué DOS mecanismos y no uno difuso para todo:
 *
 *   1. `ALIAS` — coincidencia EXACTA sobre formas deletreadas. Las siglas son
 *      de dos letras; con similitud difusa, «me» pasaría por «MR». Riesgo
 *      cero: o la ventana normalizada es igual al alias, o no se toca.
 *   2. Marcas — similitud difusa (`jaroWinkler`), porque el modo de falla es
 *      fonético y no se puede enumerar. Acotada por tres guardas: solo contra
 *      las 6 marcas del vocabulario, largo mínimo, y largos comparables.
 *
 * ★ Qué NO hace: no corrige nada fuera de estas dos listas. La nota es de la
 * persona y la va a confirmar como propia — reescribirle palabras comunes por
 * parecido sería inventarle testimonio. Por eso `corregirLexico` además
 * DEVUELVE qué cambió, para que la UI lo pueda mostrar.
 */

/* ── Prompt de whisper ───────────────────────────────────────────────────
 *
 * Fuente única: lo usa `qvac/pool.ts` como `initial_prompt` al cargar el
 * modelo y `pipeline/dictar.ts` como `prompt` por llamada. Los dos tienen que
 * decir lo mismo, y no por prolijidad: el SDK, al recibir `prompt`, recarga el
 * modelo pisando el `initial_prompt` y al terminar lo deja en cadena VACÍA
 * (`node_modules/@qvac/sdk/dist/server/bare/ops/transcribe.js`, `restorePrompt`
 * hace `reload({ ...originalConfig, initial_prompt: '' })`). O sea: el prompt
 * de la carga no sobrevive a la primera nota, y el que manda de ahí en más es
 * el que pasa `dictar.ts`.
 *
 * ★ Está escrito COMO UNA NOTA, no como una descripción de lo que se espera.
 * El `initial_prompt` de whisper no es una instrucción: son tokens que se
 * anteponen al contexto de decodificación, así que el modelo imita su ESTILO y
 * su vocabulario. Un prompt en forma de metadatos («Nota de campo sobre
 * equipos médicos. Marcas: …») condiciona el idioma y poco más; un ejemplo del
 * registro real que se va a dictar —cifras, siglas y marcas en la posición
 * gramatical en la que aparecen— es lo que de verdad sube la probabilidad de
 * «CT» sobre «ce te».
 */
export const PROMPT_ASR =
  'Visita al Hospital Central. Vi dos MR NovaMed de 2019 y un CT Orion Imaging ' +
  'casi nuevo. Hay tres monitores de paciente BluePeak Medical, un ecógrafo ' +
  'HelixCare de unos ocho años y dos equipos de rayos X Zenith MedTech. ' +
  'Me dijeron que Aurelia Health instaló otro tomógrafo el año pasado.';

/* ── Normalización ──────────────────────────────────────────────────────── */

/** Minúsculas, sin acentos, solo alfanumérico. Misma regla que usa
 *  `trust/normalize.ts` para marcas; se replica acá en vez de importarse
 *  porque esto opera sobre VENTANAS de varias palabras, no sobre un campo ya
 *  extraído. */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ── 1 · Alias exactos: siglas deletreadas ──────────────────────────────── */

/**
 * Formas con que whisper escribe una sigla cuando no la reconoce como tal. La
 * llave ya viene normalizada (sin espacios, acentos ni puntos), así que una
 * sola entrada cubre «C.T.», «Cete» y «c t».
 *
 * `palabras` es cuántos tokens del texto ocupa la forma hablada: «ce te» son
 * dos, y la ventana tiene que abarcar los dos para reemplazarlos por «CT».
 *
 * No es solo cosmética. `pipeline/precheck.ts` busca `\bmr\b` y `\bct\b`: sobre
 * «M.R.» ese `\b` de cierre no matchea, así que sin normalizar, una nota con
 * modalidad bien transcrita igual se va sin indicios y toma el atajo.
 */
interface Alias { forma: string; palabras: number; canonico: string; }

const ALIAS: readonly Alias[] = [
  // MR — «eme erre» es la lectura literal de las dos letras en castellano.
  { forma: 'mr', palabras: 1, canonico: 'MR' },
  { forma: 'mri', palabras: 1, canonico: 'MR' },
  { forma: 'rm', palabras: 1, canonico: 'MR' },
  { forma: 'emeerre', palabras: 2, canonico: 'MR' },
  { forma: 'emeere', palabras: 2, canonico: 'MR' },
  { forma: 'erreeme', palabras: 2, canonico: 'MR' },
  // CT
  { forma: 'ct', palabras: 1, canonico: 'CT' },
  { forma: 'cete', palabras: 1, canonico: 'CT' },
  { forma: 'cete', palabras: 2, canonico: 'CT' },
  { forma: 'sete', palabras: 2, canonico: 'CT' },
  { forma: 'seti', palabras: 2, canonico: 'CT' },
  // Rayos X — «rayos equis» es la forma hablada más común.
  { forma: 'rayosequis', palabras: 2, canonico: 'rayos X' },
  { forma: 'rayosx', palabras: 2, canonico: 'rayos X' },
  { forma: 'xray', palabras: 1, canonico: 'rayos X' },
  // IGT
  { forma: 'igt', palabras: 1, canonico: 'IGT' },
  { forma: 'igete', palabras: 3, canonico: 'IGT' },
];

/** El alias más largo en palabras — techo del barrido de ventanas. */
const MAX_PALABRAS_ALIAS = Math.max(...ALIAS.map((a) => a.palabras));

/* ── 2 · Marcas: similitud difusa acotada ───────────────────────────────── */

interface Marca { canonico: string; normalizado: string; }

const MARCAS: readonly Marca[] = MARCAS_DUMMY.map((m) => ({
  canonico: m,
  normalizado: normalizar(m),
}));

/**
 * Una marca de dos palabras puede venir partida en tres («Zenith Med Tech») o
 * pegada en una («Novamed»), así que el barrido prueba ventanas de 1 a 3
 * tokens contra CADA marca, sin exigir que coincida el conteo de palabras.
 */
const MAX_PALABRAS_MARCA = 3;

/**
 * Umbral de similitud para aceptar un reemplazo de marca. MEDIDO, no elegido a
 * ojo — el costo de los dos errores no es simétrico y valía la pena mirarlo:
 * una marca que no se corrige la arregla la persona al confirmar; una palabra
 * común convertida en marca le mete en la boca algo que no dijo.
 *
 * Barriendo todas las ventanas de 1 a 3 palabras sobre ~200 palabras de prosa
 * de nota de campo (las frases que de verdad aparecen: «nueva medida de
 * seguridad en el área médica», «hablé con la enfermera jefa», «compramos tres
 * el año pasado»), ninguna llegó a 0.80 contra ninguna de las 6 marcas. Del
 * otro lado, la transcripción fonética más castigada que probamos —«Senit
 * Medtec» por «Zenith MedTech», sin prefijo común, que es el peor caso para
 * Jaro-Winkler— da 0.893.
 *
 * O sea que entre «no es una marca» y «es una marca mal oída» hay un hueco de
 * 0.80 a 0.89 sin nada adentro. 0.88 cae ahí, pegado al lado seguro.
 */
const UMBRAL_MARCA = 0.88;

/** Largo normalizado mínimo de una ventana candidata a marca. Debajo de esto
 *  `jaroWinkler` premia demasiado el prefijo común y cualquier palabra corta
 *  empieza a parecerse a todo. */
const LARGO_MINIMO_MARCA = 5;

/**
 * Los largos tienen que ser comparables: sin esta guarda, «nova» (4) contra
 * «novamed» (7) da más de 0.94 por puro prefijo. Una transcripción fonética
 * errada tiene aproximadamente el mismo largo que la palabra real; una palabra
 * distinta que comparte prefijo, no.
 */
function largoComparable(a: string, b: string): boolean {
  return Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.7;
}

/* ── Barrido ────────────────────────────────────────────────────────────── */

/** Un reemplazo que se hizo, para poder mostrárselo a la persona. */
export interface CorreccionLexica {
  /** Lo que whisper había escrito, tal cual. */
  desde: string;
  /** Lo que quedó en la nota. */
  hasta: string;
}

export interface TextoCorregido {
  texto: string;
  correcciones: CorreccionLexica[];
}

/** Token con su espaciado original, para reconstruir el texto sin alterar
 *  nada que no se haya corregido. */
interface Token { texto: string; separador: string; }

function tokenizar(texto: string): { prefijo: string; tokens: Token[] } {
  const tokens: Token[] = [];
  const re = /(\S+)(\s*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    tokens.push({ texto: m[1]!, separador: m[2]! });
  }
  // Lo que haya antes del primer token (sangría, salto de línea) no lo captura
  // el barrido; se guarda aparte para devolverlo tal cual.
  const prefijo = tokens.length > 0 ? texto.slice(0, texto.indexOf(tokens[0]!.texto)) : texto;
  return { prefijo, tokens };
}

/**
 * Separa la puntuación de cierre («NovaMed.», «BluePeak,») del núcleo, para
 * compararla sin ella y volver a pegarla al reemplazo — comerse el punto final
 * de la frase sería empeorar la nota mientras se la corrige.
 *
 * El caso torcido es la sigla con puntos: en «el C.T. es nuevo», ese punto
 * final NO cierra la frase, es parte de la abreviatura, y dejarlo produce «el
 * CT. es nuevo». Regla: si el núcleo tiene un punto ADENTRO, es una sigla
 * punteada y los puntos de la cola se absorben.
 *
 * Queda un caso genuinamente ambiguo —«trajeron un M.R.» al final del texto,
 * donde el mismo punto hace las dos cosas— y lo resuelve `corregirLexico`
 * reponiendo un punto si la ventana corregida termina el texto. Mitad de
 * frase con sigla punteada y punto final ortográfico a la vez («Vi un M.R. El
 * eco falla») pierde ese punto: es el precio de no tener análisis de
 * oraciones, y el costo es cosmético — ni el `precheck`, ni el extractor, ni
 * el verificador de evidencia miran la puntuación.
 */
function partirPuntuacion(bruto: string): { nucleo: string; cola: string; siglaPunteada: boolean } {
  const m = /^(.*?)([.,;:!?)\]"']*)$/.exec(bruto);
  const nucleo = m?.[1] ?? bruto;
  let cola = m?.[2] ?? '';
  const siglaPunteada = /[a-z0-9]\.[a-z0-9]/i.test(nucleo);
  if (siglaPunteada) cola = cola.replace(/\./g, '');
  return { nucleo, cola, siglaPunteada };
}

/** Una ventana que se puede reemplazar, con qué tan bien matchea. */
interface Candidato {
  /** Índice del primer token de la ventana. */
  i: number;
  /** Ancho de la ventana en tokens. */
  largo: number;
  canonico: string;
  /** 1 para coincidencia exacta (alias o marca bien escrita), si no el
   *  Jaro-Winkler contra la marca. */
  puntaje: number;
}

const MAX_VENTANA = Math.max(MAX_PALABRAS_ALIAS, MAX_PALABRAS_MARCA);

/** El texto de una ventana, con su espaciado y puntuación internos intactos —
 *  solo el último token queda sin su separador, que es el que va después. */
function brutoDe(tokens: Token[], i: number, largo: number): string {
  return tokens.slice(i, i + largo)
    .map((t, k) => (k === largo - 1 ? t.texto : t.texto + t.separador))
    .join('');
}

/** Evalúa UNA ventana. Devuelve `null` si no matchea nada del vocabulario. */
function evaluar(tokens: Token[], i: number, largo: number): Candidato | null {
  const { nucleo } = partirPuntuacion(brutoDe(tokens, i, largo));
  const norma = normalizar(nucleo);
  if (!norma) return null;

  // 1 · Alias exacto (siglas). Solo entradas declaradas para ESTE ancho de
  // ventana: «cete» en una palabra y «ce te» en dos son casos distintos.
  const alias = ALIAS.find((a) => a.palabras === largo && a.forma === norma);
  if (alias) return { i, largo, canonico: alias.canonico, puntaje: 1 };

  // 2 · Marca por similitud.
  if (norma.length < LARGO_MINIMO_MARCA) return null;
  let mejor: Candidato | null = null;
  for (const marca of MARCAS) {
    if (!largoComparable(norma, marca.normalizado)) continue;
    // Exacta en fonética aunque la grafía difiera («novamed» → «NovaMed»).
    const puntaje = norma === marca.normalizado
      ? 1
      : jaroWinkler(norma, marca.normalizado);
    if (puntaje >= UMBRAL_MARCA && (!mejor || puntaje > mejor.puntaje)) {
      mejor = { i, largo, canonico: marca.canonico, puntaje };
    }
  }
  return mejor;
}

/**
 * Corrige siglas y marcas sobre una transcripción de whisper.
 *
 * ★ El barrido es por MEJOR PUNTAJE, no de izquierda a derecha tomando la
 * ventana más larga que matchee. La versión ingenua parece equivalente y no lo
 * es: sobre «un Helix Care», la ventana de tres palabras da 0.939 contra
 * «HelixCare» —la palabra de más casi no mueve el Jaro-Winkler— así que
 * dispara antes de que se pruebe «Helix Care», que da 1.000. Resultado: el
 * corrector se comía el «un». Con todos los candidatos sobre la mesa, el 1.000
 * gana y el «un» queda donde estaba.
 *
 * Entonces: se generan todos los candidatos (cada posición × ancho 1 a 3), se
 * ordenan por puntaje —a igualdad, la ventana más larga, que es lo que hace
 * que «Blue Peak Medical» le gane a «Blue Peak»— y se aceptan de arriba hacia
 * abajo salteando los que pisen tokens ya tomados. Un token no se corrige dos
 * veces.
 *
 * Es idempotente: sobre su propia salida no cambia nada ni suma correcciones,
 * porque una ventana que ya es el canónico matchea con puntaje 1 y se emite
 * sin registrar.
 */
export function corregirLexico(texto: string): TextoCorregido {
  const { prefijo, tokens } = tokenizar(texto);
  if (tokens.length === 0) return { texto, correcciones: [] };

  const candidatos: Candidato[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let n = 1; n <= Math.min(MAX_VENTANA, tokens.length - i); n++) {
      const c = evaluar(tokens, i, n);
      if (c) candidatos.push(c);
    }
  }
  // Puntaje desc; a igualdad la ventana más larga; a igualdad, la de más a la
  // izquierda — el orden queda total, así que la salida es determinista.
  candidatos.sort((a, b) => b.puntaje - a.puntaje || b.largo - a.largo || a.i - b.i);

  /** Candidato aceptado que arranca en cada índice; `null` en los índices que
   *  quedaron tomados por un candidato que arrancó antes. */
  const elegido = new Array<Candidato | null>(tokens.length).fill(null);
  const tomado = new Array<boolean>(tokens.length).fill(false);
  for (const c of candidatos) {
    let libre = true;
    for (let k = c.i; k < c.i + c.largo && libre; k++) libre = !tomado[k];
    if (!libre) continue;
    for (let k = c.i; k < c.i + c.largo; k++) tomado[k] = true;
    elegido[c.i] = c;
  }

  const correcciones: CorreccionLexica[] = [];
  const salida: string[] = [prefijo];

  let i = 0;
  while (i < tokens.length) {
    const c = elegido[i];
    if (!c) {
      const t = tokens[i]!;
      salida.push(t.texto + t.separador);
      i += 1;
      continue;
    }

    const ultimo = tokens[i + c.largo - 1]!;
    const bruto = brutoDe(tokens, i, c.largo);
    const { nucleo, cola, siglaPunteada } = partirPuntuacion(bruto);

    if (nucleo === c.canonico) {
      // Ya estaba bien escrita: se emite tal cual y no cuenta como corrección.
      salida.push(bruto + ultimo.separador);
    } else {
      correcciones.push({ desde: nucleo, hasta: c.canonico });
      // Si se absorbió el punto de una sigla punteada que además cerraba el
      // texto, ese punto sí era el final de la frase: se repone.
      const cierre = siglaPunteada && i + c.largo === tokens.length && /\.$/.test(bruto) ? '.' : '';
      salida.push(c.canonico + cola + cierre + ultimo.separador);
    }
    i += c.largo;
  }

  return { texto: salida.join(''), correcciones };
}
