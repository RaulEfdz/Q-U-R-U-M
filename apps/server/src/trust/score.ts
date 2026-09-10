import type {
  CampoResuelto, CohorteResuelta, DesglosePuntaje, Observacion,
} from '../core/contracts.ts';

const PESOS = { completitud: 45, frescura: 25, corroboracion: 30 };

/**
 * ★ Un campo cuenta como dato presente solo si el sistema sabe cuál es su valor.
 *
 * `Sin datos` es obvio: no hay nada. `Sin quórum` NO era obvio y ahí estaba el
 * bug: el campo tiene valores, pero tiene DOS, y el motor no sabe cuál es el
 * bueno (RD-2 — discrepancia nunca promedia). Contarlo como completo
 * significaba que un grupo en disputa puntuaba como un grupo resuelto, y en el
 * dataset real eso llegó a lo absurdo: `Hospital DemoCare Pacific | MR |
 * NovaMed` (edad en disputa, un clúster dice 7 años y otro 12) sacaba el
 * puntaje MÁS ALTO de los 16 grupos, por encima de grupos con quórum pleno.
 * La pantalla que existe para señalar disputa premiaba la disputa.
 *
 * El fix ataca la causa y no el total: el puntaje es "calidad del dato", y un
 * campo en dos versiones no es un dato de alta calidad, es una pregunta
 * abierta. Por eso se corrige `completitud` (el factor que afirmaba "este dato
 * está presente") en vez de ponerle un techo al total — un techo taparía el
 * síntoma y seguiría contando el campo en disputa como presente en el
 * desglose que ve el humano.
 *
 * No se toca `PESOS` ni la firma de `puntuar()`: el campo en disputa
 * simplemente deja de aportar su peso, igual que si no se hubiera observado.
 */
function esDatoConocido(c: { estado: string }): boolean {
  return c.estado !== 'Sin datos' && c.estado !== 'Sin quórum';
}

/** Los tres factores que pide el brief:
 *  "completitud, antigüedad y confirmaciones independientes". */
export function puntuar(
  campos: { modalidad: CampoResuelto<unknown>; marca: CampoResuelto<unknown>;
            modelo: CampoResuelto<unknown>; totalUnidades: CampoResuelto<unknown>;
            edad: CampoResuelto<unknown> },
  cohortes: CohorteResuelta[],
  obs: Observacion[],
  ahora: Date,
): DesglosePuntaje {

  // 1 · Completitud ponderada: modalidad y cantidad valen doble, modelo medio.
  //     Un campo en `Sin quórum` NO cuenta como presente (ver `esDatoConocido`).
  //     La edad entra por sus cohortes, pero la disputa vive en el campo
  //     `edad` (corrección #12: la edad resuelve como campo además de generar
  //     cohortes), así que hay que consultar el campo: las cohortes se generan
  //     igual cuando los testimonios discrepan, y mirar solo `cohortes.length`
  //     dejaba pasar como completa justamente la disputa del grupo Pacific|MR.
  const items: Array<[boolean, number]> = [
    [esDatoConocido(campos.modalidad), 2],
    [esDatoConocido(campos.totalUnidades), 2],
    [esDatoConocido(campos.marca), 1],
    [cohortes.length > 0 && esDatoConocido(campos.edad), 1],
    [esDatoConocido(campos.modelo), 0.5],
  ];
  const pesoTotal = items.reduce((s, [, p]) => s + p, 0);
  const completitud = items.reduce((s, [ok, p]) => s + (ok ? p : 0), 0) / pesoTotal;

  // 2 · Frescura: decaimiento lineal desde la visita más reciente (RD-6)
  const ultima = obs.reduce((m, o) => (o.visitadoEn > m ? o.visitadoEn : m), obs[0]!.visitadoEn);
  const dias = (ahora.getTime() - new Date(ultima).getTime()) / 86_400_000;
  const frescura = Math.max(0, Math.min(1, 1 - dias / 365));

  // 3 · Corroboración: solo cuentan los testigos que PUEDEN dar quórum (RD-7),
  //     y solo dentro del clúster MAYORITARIO de modalidad (RD-2: discrepancia
  //     nunca promedia — un grupo Sin quórum con testigos contradictorios no
  //     puede sacar el máximo de corroboración contando todo `obs` a ciegas).
  // Se evalúan TODOS los campos, no solo `modalidad`. Anclar esto en
  // `modalidad` (como estaba) era un no-op: `claveGrupo` incluye modalidad
  // y marca, así que dentro de un grupo todas las observaciones comparten
  // esos dos valores por construcción — `campos.modalidad` no puede quedar
  // nunca en 'Sin quórum' y su `clusters` siempre viene vacío. La corrección
  // caía siempre al fallback y contaba a todos los testigos igual, que es
  // justo el bug que decía arreglar. La discrepancia real vive en
  // `totalUnidades`, `edad` y `modelo`.
  //
  // Un observador corrobora solo si está en el clúster mayoritario de CADA
  // campo en disputa: si discrepa en cualquiera, deja de sumar. Un campo sin
  // discrepancia no tiene `clusters` y por lo tanto no restringe a nadie.
  const enDisputa = [campos.totalUnidades, campos.edad, campos.modelo,
                     campos.modalidad, campos.marca]
    .filter((c) => c.clusters !== undefined && c.clusters.length > 0);

  let convergentes: Set<string> | undefined;
  for (const campo of enDisputa) {
    const mayoritario = new Set(campo.clusters![0]!.observadores);
    convergentes = convergentes === undefined
      ? mayoritario
      : new Set([...convergentes].filter((id) => mayoritario.has(id)));
  }

  const habilitados = new Set(
    obs
      .filter((o) => convergentes === undefined || convergentes.has(o.observadorId))
      .filter((o) => o.naturaleza === 'Directo' && !o.hedging)
      .map((o) => o.observadorId));
  const corroboracion = habilitados.size >= 3 ? 1 : habilitados.size === 2 ? 0.6 : 0;

  const total = Math.round(
    PESOS.completitud * completitud + PESOS.frescura * frescura +
    PESOS.corroboracion * corroboracion);

  return {
    total,
    completitud: Math.round(completitud * 100) / 100,
    frescura: Math.round(frescura * 100) / 100,
    corroboracion,
  };
}
