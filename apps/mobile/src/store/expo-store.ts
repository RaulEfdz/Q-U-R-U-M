import { File, Paths } from 'expo-file-system';
import { zObservacion, type Observacion } from '../core/contracts.ts';

/**
 * Corrección #4 (apps/mobile/CLAUDE.md): `expo-av` no existe acá — nunca se
 * usó, el store no graba audio. Lo que SÍ pedía la corrección es no usar
 * `expo-file-system/legacy`: se usa la API nueva `File`/`Paths`
 * (`expo-file-system@57.0.6`, verificada contra la versión instalada —
 * expo 57.0.21 — antes de anclarla; trae ambas, `legacy` y la nueva,
 * ver `build/index.d.ts` / `build/legacy/index.d.ts` del paquete).
 */
const ARCHIVO = new File(Paths.document, 'observaciones.jsonl');

/**
 * Corrección #9, segunda mitad: la pérdida de una línea corrupta NO puede
 * ser silenciosa (un `console.warn` no lo es lo bastante — nadie lo lee en
 * producción). Cada línea descartada se anexa acá con motivo y timestamp,
 * para que un auditor pueda ver qué se perdió y por qué, sin depender de
 * que la app siga corriendo en ese momento.
 */
const ARCHIVO_CORRUPTAS = new File(Paths.document, 'observaciones.corruptas.jsonl');

let memoria: Observacion[] | null = null;

/**
 * Mismo criterio que `enVuelo` en `qvac/pool.ts`: dos `cargar()`
 * concurrentes antes de que el primero termine no deben disparar dos
 * lecturas/parseos completos del archivo en paralelo.
 */
let cargando: Promise<Observacion[]> | null = null;

export interface DiagnosticoCarga {
  validas: number;
  corruptas: number;
}
let ultimoDiagnostico: DiagnosticoCarga = { validas: 0, corruptas: 0 };

/** Para UI/auditoría: cuántas observaciones cargaron bien y cuántas líneas
 *  se descartaron en el último `cargar()`. */
export function diagnosticoUltimaCarga(): DiagnosticoCarga {
  return ultimoDiagnostico;
}

async function registrarCorrupta(linea: string, motivo: string): Promise<void> {
  const registro = JSON.stringify({ en: new Date().toISOString(), motivo, linea }) + '\n';
  try {
    if (!ARCHIVO_CORRUPTAS.exists) ARCHIVO_CORRUPTAS.create({ intermediates: true });
    ARCHIVO_CORRUPTAS.write(registro, { append: true });
  } catch {
    // Si ni siquiera se puede dejar constancia (disco lleno, sin permiso),
    // no hay más nada seguro que hacer acá sin arriesgar la carga
    // completa. `ultimoDiagnostico.corruptas` sigue siendo la señal mínima
    // visible en memoria para esta sesión.
  }
}

/**
 * Corrección #9: `cargar()` filtra la línea corrupta, NO descarta el
 * archivo entero. Un `catch { memoria = [] }` sobre el archivo completo
 * vacía TODA la base instalada la próxima vez que una sola línea se
 * corrompe (corte de escritura, byte flippeado, etc.) — acá cada línea se
 * parsea y valida por separado; solo esa línea se pierde, y queda
 * registrada en `ARCHIVO_CORRUPTAS` (nunca silenciosa).
 *
 * Con esto arreglado, el segundo efecto de #9 desaparece solo:
 * `agregar()` reconstruye `vistos` a partir de lo que `cargar()` devuelve,
 * y como `cargar()` ya no vacía la base por una línea rota, `vistos`
 * contiene los ids reales previamente guardados — no reinserta duplicados.
 */
export async function cargar(): Promise<Observacion[]> {
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
      // El archivo existe pero no se pudo leer como texto (permiso, o
      // corrupción a nivel de archivo, no de línea) — distinto del caso
      // "una línea individual rota" de abajo. Arranca vacío; no hay
      // líneas que filtrar si no se pudo ni abrir el archivo.
      lineas = [];
    }

    const validas: Observacion[] = [];
    let corruptas = 0;
    for (const linea of lineas) {
      let json: unknown;
      try {
        json = JSON.parse(linea);
      } catch (e) {
        corruptas++;
        await registrarCorrupta(linea, `JSON invalido: ${(e as Error).message}`);
        continue;
      }
      const chk = zObservacion.safeParse(json);
      if (chk.success) {
        validas.push(chk.data);
      } else {
        corruptas++;
        await registrarCorrupta(linea, `no cumple zObservacion: ${chk.error.message}`);
      }
    }

    ultimoDiagnostico = { validas: validas.length, corruptas };
    memoria = validas;
    return validas;
  })();

  try {
    return await cargando;
  } finally {
    cargando = null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * "Nada se persiste sin confirmación humana" — este es el archivo que
 * escribe a disco, así que es donde esa regla se cumple o se rompe.
 * `agregar()` NO acepta `Observacion[]` crudo: acepta `ObservacionConfirmada[]`,
 * un tipo con marca nominal que solo se obtiene llamando
 * `confirmarParaGuardar()`. TypeScript no impide que alguien en runtime
 * mienta, pero si `cruzar.ts` (el pipeline) intenta pasarle su
 * `SalidaPipeline.lotes` directo a `agregar()`, NO COMPILA — tiene que
 * pasar antes por la función que documenta, en su nombre, que ahí es
 * donde vive la confirmación humana. La pantalla de confirmación es la
 * única que debe llamar `confirmarParaGuardar()`.
 * ═══════════════════════════════════════════════════════════════════════ */
declare const CONFIRMADA: unique symbol;
export type ObservacionConfirmada = Observacion & { readonly [CONFIRMADA]: true };

/**
 * Llamar SOLO desde la pantalla de confirmación humana, después de que el
 * usuario aprobó explícitamente el borrador — nunca desde el pipeline
 * (`cruzar.ts`/`extractor.ts`) directo. Revalida con `zObservacion` por si
 * el usuario editó algo en la pantalla de confirmación antes de guardar.
 */
export function confirmarParaGuardar(obs: Observacion[]): ObservacionConfirmada[] {
  return obs.map((o) => {
    const chk = zObservacion.safeParse(o);
    if (!chk.success) {
      throw new Error(`Observacion invalida al confirmar: ${chk.error.message}`);
    }
    return chk.data as ObservacionConfirmada;
  });
}

/**
 * Corrección #10: APPEND real. La fuente reescribía el archivo entero en
 * cada llamada (`writeAsStringAsync(RUTA, previo + nuevas...)`): un corte
 * de energía o de proceso a mitad de esa escritura pierde TODAS las
 * observaciones ya guardadas, no solo las nuevas. Acá se agrega solo el
 * bloque nuevo con `write(..., { append: true })` — si el corte pasa a
 * mitad de este `write`, lo que se pierde es, como mucho, este bloque.
 */
export async function agregar(obs: ObservacionConfirmada[]): Promise<number> {
  const actual = await cargar();
  const vistos = new Set(actual.map((o) => o.id));
  const nuevas = obs.filter((o) => !vistos.has(o.id));
  if (!nuevas.length) return 0;

  const bloque = nuevas.map((o) => JSON.stringify(o)).join('\n') + '\n';
  if (!ARCHIVO.exists) ARCHIVO.create({ intermediates: true });
  ARCHIVO.write(bloque, { append: true });

  memoria = [...actual, ...nuevas];
  ultimoDiagnostico = { ...ultimoDiagnostico, validas: memoria.length };
  return nuevas.length;
}
