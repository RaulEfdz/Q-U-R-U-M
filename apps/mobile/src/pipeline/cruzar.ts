import type { Observacion } from '../core/contracts.ts';
import { precheck } from './precheck.ts';
import { portero } from './portero.ts';
import { extraer, type ContextoExtraccion } from './extractor.ts';
import { verificarEvidencia } from './verificar.ts';
import { obtener, MODELOS } from '../qvac/pool.ts';

export type Resultado =
  | 'ACUERDO' | 'ACUERDO_VACIO'
  | 'POSIBLE_OMISION_PORTERO' | 'POSIBLE_OMISION_EXTRACTOR'
  | 'EVIDENCIA_FABRICADA';

/* ═══════════════════════════════════════════════════════════════════════
 * Progreso observable.
 *
 * `procesarNota` emite un evento por cada etapa: uno al empezarla
 * (`estado: 'corriendo'`) y otro al terminarla (`estado: 'ok'` con `ms`).
 * Sirve para dos cosas a la vez:
 *   - la pantalla de captura muestra EN VIVO en qué punto va y cuánto
 *     tardó cada modelo (CapturarScreen.tsx);
 *   - cada evento se escribe además a la consola con el prefijo
 *     `[QUÓRUM·pipeline]`, para poder seguirlo desde `adb logcat` / Metro
 *     cuando una nota tarda de más y hay que ver dónde se traba.
 *
 * La CARGA del modelo y la INFERENCIA se cronometran POR SEPARADO. En un
 * teléfono, cargar el extractor (~1 GB) a memoria puede tardar más que
 * responder; medirlos juntos escondía cuál de los dos era el lento. El
 * pool (`qvac/pool.ts`) cachea el modelo, así que el `obtener()` que se
 * llama acá para cronometrar la carga es el mismo que después usa
 * `portero()` / `extraer()` — no se carga dos veces.
 * ═══════════════════════════════════════════════════════════════════════ */

export interface EventoPipeline {
  /** Clave estable de la etapa — la UI la usa para actualizar la fila en su lugar. */
  etapa:
    | 'precheck'
    | 'portero:carga' | 'portero:inferencia'
    | 'atajo'
    | 'extractor:carga' | 'extractor:inferencia'
    | 'verificador'
    | 'fin';
  /** Texto legible de la etapa — se muestra en pantalla y en el log. */
  etiqueta: string;
  /** `'error'` no lo emite el pipeline (solo `'corriendo'`/`'ok'`); lo usa
   *  la UI para marcar la etapa donde se cortó si `procesarNota` lanza. */
  estado: 'corriendo' | 'ok' | 'error';
  /** ms que tardó la etapa — presente solo cuando `estado === 'ok'`. */
  ms?: number;
  /** Una línea con el resultado de la etapa ("sí — menciona dos MR", …). */
  detalle?: string;
}

export type OnEvento = (e: EventoPipeline) => void;

function mb(bytes: number): string {
  const m = bytes / (1024 * 1024);
  return m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${Math.round(m)} MB`;
}

export interface SalidaPipeline {
  resultado: Resultado;
  /** Solo los lotes con evidencia válida. */
  lotes: Observacion[];
  /** Se MARCAN, nunca se borran — auditable incluso cuando la evidencia falla. */
  descartados: Array<{ lote: Observacion; razon: string }>;
  /** Máximo UNA por nota (regla dura). `null` si no hace falta preguntar nada. */
  pregunta: string | null;
  traza: {
    hayIndicios: boolean; porteroDijo: boolean; porteroMotivo: string;
    lotesPropuestos: number; lotesValidos: number; atajo: boolean;
    /** Inferencia sola — la carga del modelo va aparte (`msCarga*`). */
    msPortero: number; msExtractor: number;
    /** ms en subir el modelo a memoria; 0 si ya estaba caliente. */
    msCargaPortero: number; msCargaExtractor: number;
  };
}

/**
 * Enrutador de interrupciones. Corre precheck + portero + (si hace falta)
 * extractor + verificador, y resuelve la tabla de 5 resultados de
 * apps/mobile/CLAUDE.md §Tabla de decisión.
 *
 * IMPORTANTE — esto NO persiste nada. Ni el atajo ni ninguna otra rama
 * escriben al store: `SalidaPipeline` es un borrador candidato. El único
 * punto que escribe al store es la pantalla de confirmación humana, más
 * adelante en el flujo (fuera de este módulo). La fuente (Anexo D) dibuja
 * el atajo como una rama terminal que "GUARDA" — eso contradice "nada se
 * persiste sin confirmación humana" y NO se replica acá.
 *
 * @param onEvento callback opcional de progreso (ver `EventoPipeline`).
 */
export async function procesarNota(
  nota: string, ctx: ContextoExtraccion, onEvento?: OnEvento,
): Promise<SalidaPipeline> {
  const emitir = (e: EventoPipeline): void => {
    const t = e.estado === 'ok' && e.ms !== undefined ? ` · ${e.ms} ms` : '';
    const d = e.detalle ? ` — ${e.detalle}` : '';
    const marca = e.estado === 'ok' ? '✓' : e.estado === 'error' ? '✕' : '…';
    // eslint-disable-next-line no-console
    console.log(`[QUÓRUM·pipeline] ${marca} ${e.etiqueta}${t}${d}`);
    onEvento?.(e);
  };

  // ── 1. Precheck — señal barata, determinista, sin modelo.
  emitir({ etapa: 'precheck', etiqueta: 'Señales en el texto', estado: 'corriendo' });
  const tPre = Date.now();
  const ind = precheck(nota);
  const indicios = [
    ...ind.modalidades,
    ind.hayMarca ? 'marca' : null,
    ind.hayNumeros ? 'números' : null,
  ].filter(Boolean);
  emitir({
    etapa: 'precheck', etiqueta: 'Señales en el texto', estado: 'ok',
    ms: Date.now() - tPre,
    detalle: ind.hayIndicios ? `indicios: ${indicios.join(', ')}` : 'sin indicios de equipo',
  });

  // ── 2. Portero — carga del modelo e inferencia, cronometradas aparte.
  const etqCargaP = `Portero · modelo Qwen3.5 0.8B (${mb(MODELOS.portero.expectedSize)})`;
  emitir({ etapa: 'portero:carga', etiqueta: etqCargaP, estado: 'corriendo' });
  const tCargaP = Date.now();
  await obtener('portero');
  const msCargaPortero = Date.now() - tCargaP;
  emitir({
    etapa: 'portero:carga', etiqueta: etqCargaP, estado: 'ok', ms: msCargaPortero,
    detalle: msCargaPortero < 50 ? 'ya estaba en memoria' : 'cargado a memoria',
  });

  emitir({ etapa: 'portero:inferencia', etiqueta: 'Portero · ¿la nota describe equipo?', estado: 'corriendo' });
  const t0 = Date.now();
  const v = await portero(nota);
  const msPortero = Date.now() - t0;
  emitir({
    etapa: 'portero:inferencia', etiqueta: 'Portero · ¿la nota describe equipo?', estado: 'ok',
    ms: msPortero, detalle: `${v.hayEquipo ? 'sí' : 'no'} — ${v.motivo}`,
  });

  const trazaBase = {
    hayIndicios: ind.hayIndicios, porteroDijo: v.hayEquipo,
    porteroMotivo: v.motivo, msPortero, msCargaPortero,
  };

  // ── ATAJO: dos señales independientes (precheck determinista + portero)
  //    coinciden en que no hay nada. Devuelve ACUERDO_VACIO por el MISMO
  //    canal que todo lo demás — "visité y no observé equipo" es un dato
  //    válido, pero NO se persiste desde acá; lo confirma el humano en la
  //    pantalla de confirmación, igual que cualquier otro resultado.
  if (!v.hayEquipo && !ind.hayIndicios) {
    emitir({
      etapa: 'atajo', etiqueta: 'Atajo — ninguna señal ve equipo, no se llama al extractor',
      estado: 'ok', detalle: 'ACUERDO_VACIO',
    });
    emitir({ etapa: 'fin', etiqueta: 'Listo', estado: 'ok', detalle: 'ACUERDO_VACIO' });
    return {
      resultado: 'ACUERDO_VACIO', lotes: [], descartados: [], pregunta: null,
      traza: {
        ...trazaBase, lotesPropuestos: 0, lotesValidos: 0, atajo: true,
        msExtractor: 0, msCargaExtractor: 0,
      },
    };
  }

  // ── 3. Extractor — carga del modelo e inferencia, cronometradas aparte.
  const etqCargaE = `Extractor · modelo Qwen3 1.7B (${mb(MODELOS.extractor.expectedSize)})`;
  emitir({ etapa: 'extractor:carga', etiqueta: etqCargaE, estado: 'corriendo' });
  const tCargaE = Date.now();
  await obtener('extractor');
  const msCargaExtractor = Date.now() - tCargaE;
  emitir({
    etapa: 'extractor:carga', etiqueta: etqCargaE, estado: 'ok', ms: msCargaExtractor,
    detalle: msCargaExtractor < 50 ? 'ya estaba en memoria' : 'cargado a memoria',
  });

  emitir({ etapa: 'extractor:inferencia', etiqueta: 'Extractor · estructurando lotes', estado: 'corriendo' });
  const t1 = Date.now();
  const propuestos = await extraer(nota, ctx);
  const msExtractor = Date.now() - t1;
  emitir({
    etapa: 'extractor:inferencia', etiqueta: 'Extractor · estructurando lotes', estado: 'ok',
    ms: msExtractor, detalle: `${propuestos.length} lote(s) propuesto(s)`,
  });

  // ── 4. Verificación determinista de cada cita (pipeline/verificar.ts, sin tocar).
  emitir({ etapa: 'verificador', etiqueta: 'Verificador de evidencia (sin modelo)', estado: 'corriendo' });
  const tVer = Date.now();
  const validos: Observacion[] = [];
  const descartados: Array<{ lote: Observacion; razon: string }> = [];
  for (const o of propuestos) {
    const chk = verificarEvidencia(nota, o.evidencia);
    if (chk.valida) validos.push(o);
    else descartados.push({ lote: o, razon: chk.razon ?? 'evidencia invalida' });
  }
  emitir({
    etapa: 'verificador', etiqueta: 'Verificador de evidencia (sin modelo)', estado: 'ok',
    ms: Date.now() - tVer,
    detalle: `${validos.length} con cita válida · ${descartados.length} descartada(s)`,
  });

  const traza = {
    ...trazaBase, lotesPropuestos: propuestos.length,
    lotesValidos: validos.length, atajo: false, msExtractor, msCargaExtractor,
  };

  // ── Tabla de decisión (apps/mobile/CLAUDE.md §Tabla de decisión).
  //
  // `EVIDENCIA_FABRICADA` tiene PRECEDENCIA sobre todas las demás filas —
  // se evalúa PRIMERO, antes de mirar qué dijo el portero. La fuente no
  // lo dice explícito y su tabla asigna dos resultados al mismo caso
  // (`validos=0` + portero=sí podría leerse como `POSIBLE_OMISION_EXTRACTOR`
  // O como `EVIDENCIA_FABRICADA` si además hubo descartes); acá el orden
  // de los `if` lo resuelve de forma DOCUMENTADA, no de facto: si hubo
  // aunque sea un lote descartado por evidencia inválida, el resultado es
  // `EVIDENCIA_FABRICADA` sin importar cuántos lotes válidos también haya.
  const salida: SalidaPipeline = decidir();
  emitir({ etapa: 'fin', etiqueta: 'Listo', estado: 'ok', detalle: salida.resultado });
  return salida;

  function decidir(): SalidaPipeline {
    if (descartados.length > 0) {
      return {
        resultado: 'EVIDENCIA_FABRICADA', lotes: validos, descartados,
        pregunta: `Descarté ${descartados.length} fila(s) sin respaldo en tu nota. ` +
                  '¿Querés revisarlas?',
        traza,
      };
    }
    if (v.hayEquipo && validos.length > 0) {
      return { resultado: 'ACUERDO', lotes: validos, descartados: [], pregunta: null, traza };
    }
    if (!v.hayEquipo && validos.length > 0) {
      return {
        resultado: 'POSIBLE_OMISION_PORTERO', lotes: validos, descartados: [],
        pregunta: 'Detecté estos equipos en tu nota. ¿Es correcto?', traza,
      };
    }
    if (v.hayEquipo && validos.length === 0) {
      return {
        resultado: 'POSIBLE_OMISION_EXTRACTOR', lotes: [], descartados: [],
        pregunta: 'Creo que mencionaste equipo pero no logré estructurarlo. ' +
                  '¿Podés decirlo con el tipo y la cantidad?',
        traza,
      };
    }
    // Última fila de la tabla: portero=no, 0 lotes (con o sin indicios de
    // precheck — si no había indicios, el atajo de arriba ya devolvió antes
    // de llegar hasta acá). Ninguna de las dos señales corrobora equipo y no
    // hay evidencia que marcar: ACUERDO_VACIO, sin gastar la única pregunta
    // permitida por nota.
    return { resultado: 'ACUERDO_VACIO', lotes: [], descartados: [], pregunta: null, traza };
  }
}
