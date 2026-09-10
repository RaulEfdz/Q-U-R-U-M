import type { Observacion } from '../core/contracts.ts';
import { precheck } from './precheck.ts';
import { portero } from './portero.ts';
import { extraer, type ContextoExtraccion } from './extractor.ts';
import { verificarEvidencia } from './verificar.ts';

export type Resultado =
  | 'ACUERDO' | 'ACUERDO_VACIO'
  | 'POSIBLE_OMISION_PORTERO' | 'POSIBLE_OMISION_EXTRACTOR'
  | 'EVIDENCIA_FABRICADA';

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
    msPortero: number; msExtractor: number;
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
 */
export async function procesarNota(
  nota: string, ctx: ContextoExtraccion,
): Promise<SalidaPipeline> {
  const ind = precheck(nota);

  const t0 = Date.now();
  const v = await portero(nota);
  const msPortero = Date.now() - t0;

  const trazaBase = {
    hayIndicios: ind.hayIndicios, porteroDijo: v.hayEquipo,
    porteroMotivo: v.motivo, msPortero,
  };

  // ── ATAJO: dos señales independientes (precheck determinista + portero)
  //    coinciden en que no hay nada. Devuelve ACUERDO_VACIO por el MISMO
  //    canal que todo lo demás — "visité y no observé equipo" es un dato
  //    válido, pero NO se persiste desde acá; lo confirma el humano en la
  //    pantalla de confirmación, igual que cualquier otro resultado.
  if (!v.hayEquipo && !ind.hayIndicios) {
    return {
      resultado: 'ACUERDO_VACIO', lotes: [], descartados: [], pregunta: null,
      traza: { ...trazaBase, lotesPropuestos: 0, lotesValidos: 0, atajo: true, msExtractor: 0 },
    };
  }

  const t1 = Date.now();
  const propuestos = await extraer(nota, ctx);
  const msExtractor = Date.now() - t1;

  // ── Verificación determinista de cada cita (pipeline/verificar.ts, sin tocar).
  const validos: Observacion[] = [];
  const descartados: Array<{ lote: Observacion; razon: string }> = [];
  for (const o of propuestos) {
    const chk = verificarEvidencia(nota, o.evidencia);
    if (chk.valida) validos.push(o);
    else descartados.push({ lote: o, razon: chk.razon ?? 'evidencia invalida' });
  }

  const traza = {
    ...trazaBase, lotesPropuestos: propuestos.length,
    lotesValidos: validos.length, atajo: false, msExtractor,
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
