import type {
  CampoResuelto, CohorteResuelta, DesglosePuntaje, Observacion,
} from '../core/contracts.ts';

const PESOS = { completitud: 45, frescura: 25, corroboracion: 30 };

/** Los tres factores que pide el brief:
 *  "completitud, antigüedad y confirmaciones independientes". */
export function puntuar(
  campos: { modalidad: CampoResuelto<unknown>; marca: CampoResuelto<unknown>;
            modelo: CampoResuelto<unknown>; totalUnidades: CampoResuelto<unknown> },
  cohortes: CohorteResuelta[],
  obs: Observacion[],
  ahora: Date,
): DesglosePuntaje {

  // 1 · Completitud ponderada: modalidad y cantidad valen doble, modelo medio
  const items: Array<[boolean, number]> = [
    [campos.modalidad.estado !== 'Sin datos', 2],
    [campos.totalUnidades.estado !== 'Sin datos', 2],
    [campos.marca.estado !== 'Sin datos', 1],
    [cohortes.length > 0, 1],
    [campos.modelo.estado !== 'Sin datos', 0.5],
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
  const observadoresClusterMayoritario =
    campos.modalidad.clusters && campos.modalidad.clusters.length > 0
      ? campos.modalidad.clusters[0]!.observadores
      : campos.modalidad.observadores;
  const idsClusterMayoritario = new Set(observadoresClusterMayoritario);

  const habilitados = new Set(
    obs
      .filter((o) => idsClusterMayoritario.has(o.observadorId))
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
