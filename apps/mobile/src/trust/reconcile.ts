import type {
  Observacion, GrupoEquipo, CampoResuelto, CohorteResuelta,
  EstadoCampo, Nivel, Modalidad, RangoEdad,
} from '../core/contracts.ts';
import { claveGrupo } from './entity.ts';
import { normalizarMarca } from './normalize.ts';
import { puntuar } from './score.ts';

const DIAS_FRESCURA = 180;
const TOLERANCIA_EDAD = 2;
const EDAD_RENOVACION = 10;

/* ═══ Voto: la posición de UN observador sobre UN campo ═══ */

interface Voto<T> {
  observadorId: string; valor: T;
  hedging: boolean; puedeDarQuorum: boolean;   // RD-7
  visitadoEn: string;
}

/** RD-3 · un observador cuenta UNA vez: su testimonio más reciente.
 *  Sin esta regla el sistema se auto-corrobora y se auto-engaña. */
function votos<T>(obs: Observacion[], pick: (o: Observacion) => T | undefined): Voto<T>[] {
  const porObs = new Map<string, Voto<T>>();
  for (const o of [...obs].sort((a, b) => a.visitadoEn.localeCompare(b.visitadoEn))) {
    const v = pick(o);
    if (v === undefined) continue;
    porObs.set(o.observadorId, {
      observadorId: o.observadorId, valor: v, hedging: o.hedging,
      puedeDarQuorum: o.naturaleza === 'Directo' && !o.hedging,
      visitadoEn: o.visitadoEn,
    });
  }
  return [...porObs.values()];
}

/* ═══ Compatibilidad ═══ */

const rango = (x: RangoEdad): [number, number] => (Array.isArray(x) ? x : [x, x]);

function edadCompatible(a: RangoEdad, b: RangoEdad): boolean {
  const [a1, a2] = rango(a), [b1, b2] = rango(b);
  return a1 - TOLERANCIA_EDAD <= b2 && b1 - TOLERANCIA_EDAD <= a2;
}

function clusterizar<T>(vs: Voto<T>[], compat: (a: T, b: T) => boolean): Voto<T>[][] {
  const cl: Voto<T>[][] = [];
  for (const v of vs) {
    const c = cl.find((g) => g.every((x) => compat(x.valor, v.valor)));
    if (c) c.push(v); else cl.push([v]);
  }
  return cl.sort((a, b) => b.length - a.length);
}

/* ═══ ★ Resolución de UN campo — aquí viven las reglas duras ═══ */

function resolverCampo<T>(
  vs: Voto<T>[], compat: (a: T, b: T) => boolean, ahora: Date,
): CampoResuelto<T> {

  if (vs.length === 0) {
    return { estado: 'Sin datos', observadores: [], ultimaVisita: 'nunca', fresco: false };
  }

  const ultimaVisita = vs.reduce((m, v) => (v.visitadoEn > m ? v.visitadoEn : m), vs[0]!.visitadoEn);
  const dias = (ahora.getTime() - new Date(ultimaVisita).getTime()) / 86_400_000;
  const meta = {
    observadores: vs.map((v) => v.observadorId),
    ultimaVisita, fresco: dias <= DIAS_FRESCURA,
  };

  if (vs.length === 1) {
    const v = vs[0]!;
    return { estado: v.hedging ? 'Estimado' : 'Reportado', valor: v.valor, ...meta };
  }

  const clusters = clusterizar(vs, compat);

  if (clusters.length > 1) {
    return {
      estado: 'Sin quórum', ...meta,
      clusters: clusters.map((c) => ({
        valor: c[0]!.valor, observadores: c.map((x) => x.observadorId),
      })),
    };
  }

  const c = clusters[0]!;
  const directos = c.filter((x) => x.puedeDarQuorum).length;
  const nivel: Nivel = directos >= 2 ? 'Quórum' : 'Reportado';

  const nums = c.map((x) => x.valor).filter((x): x is T & number => typeof x === 'number');
  const r: [number, number] | undefined =
    nums.length > 1 && Math.min(...nums) !== Math.max(...nums)
      ? [Math.min(...nums), Math.max(...nums)] : undefined;

  return { estado: nivel, valor: c[0]!.valor, ...(r ? { rango: r } : {}), ...meta };
}

/* ═══ ★ H-02 · Cohortes de edad ═══ */

function resolverTotal(obs: Observacion[], ahora: Date): CampoResuelto<number> {
  const porObs = new Map<string, { total: number; o: Observacion }>();
  for (const o of [...obs].sort((a, b) => a.visitadoEn.localeCompare(b.visitadoEn))) {
    if (o.lote.cantidad === undefined) continue;
    const prev = porObs.get(o.observadorId);
    if (prev && prev.o.sesionId === o.sesionId) prev.total += o.lote.cantidad;
    else porObs.set(o.observadorId, { total: o.lote.cantidad, o });
  }
  const vs: Voto<number>[] = [...porObs.values()].map(({ total, o }) => ({
    observadorId: o.observadorId, valor: total, hedging: o.hedging,
    puedeDarQuorum: o.naturaleza === 'Directo' && !o.hedging,
    visitadoEn: o.visitadoEn,
  }));
  return resolverCampo(vs, (a, b) => a === b, ahora);
}

/** ★ corrección #12 · edad como CAMPO a nivel de grupo, independiente de las
 *  cohortes. Sin esto 'Sin quórum' por discrepancia de edad nunca puede
 *  empujar estadoGeneral — las cohortes clusterizan por separado y no
 *  producen un EstadoCampo agregado consumible por MIN_ESTADO. */
function resolverEdad(obs: Observacion[], ahora: Date): CampoResuelto<RangoEdad> {
  return resolverCampo(
    votos<RangoEdad>(obs, (o) => o.lote.edadAnios), edadCompatible, ahora);
}

function resolverCohortes(obs: Observacion[], ahora: Date): CohorteResuelta[] {
  const conEdad = obs.filter((o) => o.lote.edadAnios !== undefined);
  if (!conEdad.length) return [];

  const vs: Voto<RangoEdad>[] = conEdad.map((o) => ({
    observadorId: o.observadorId, valor: o.lote.edadAnios!,
    hedging: o.hedging, puedeDarQuorum: o.naturaleza === 'Directo' && !o.hedging,
    visitadoEn: o.visitadoEn,
  }));

  return clusterizar(vs, edadCompatible).map((cluster) => {
    const nums = cluster.flatMap((x) => rango(x.valor));
    const min = Math.min(...nums), max = Math.max(...nums);
    const edad: RangoEdad = min === max ? min : [min, max];

    const lotesCohorte = conEdad.filter((o) =>
      cluster.some((x) => x.observadorId === o.observadorId &&
        edadCompatible(o.lote.edadAnios!, x.valor)));
    const cantidad = resolverCampo(
      votos<number>(lotesCohorte, (o) => o.lote.cantidad), (a, b) => a === b, ahora);

    const observadores = [...new Set(cluster.map((x) => x.observadorId))];
    const directos = cluster.filter((x) => x.puedeDarQuorum).length;
    const estado: EstadoCampo = observadores.length === 1
      ? (cluster[0]!.hedging ? 'Estimado' : 'Reportado')
      : (directos >= 2 ? 'Quórum' : 'Reportado');

    const visita = cluster.reduce((m, x) => (x.visitadoEn > m ? x.visitadoEn : m), cluster[0]!.visitadoEn);
    const anioInstalacion = new Date(visita).getUTCFullYear() - (typeof edad === 'number' ? edad : max);

    return { edad, anioInstalacion, cantidad, estado, observadores };
  });
}

/* ═══ Proyección completa ═══ */

const MIN_ESTADO = (xs: EstadoCampo[]): EstadoCampo => {
  if (xs.includes('Sin quórum')) return 'Sin quórum';
  const orden: Nivel[] = ['Sin datos', 'Estimado', 'Reportado', 'Quórum'];
  return orden.find((n) => xs.includes(n)) ?? 'Sin datos';
};

export function reconciliar(observaciones: Observacion[], ahora = new Date()): GrupoEquipo[] {
  const porGrupo = new Map<string, Observacion[]>();
  for (const o of observaciones) {
    const k = claveGrupo(o);
    const arr = porGrupo.get(k);
    if (arr) arr.push(o); else porGrupo.set(k, [o]);
  }

  const grupos: GrupoEquipo[] = [];

  for (const [clave, obs] of porGrupo) {
    const ref = obs[0]!;

    const campos = {
      modalidad: resolverCampo(
        votos<Modalidad>(obs, (o) => o.lote.modalidad), (a, b) => a === b, ahora),
      marca: resolverCampo(
        votos<string>(obs, (o) => o.lote.marca),
        (a, b) => normalizarMarca(a) === normalizarMarca(b), ahora),
      modelo: resolverCampo(
        votos<string>(obs, (o) => o.lote.modelo),
        (a, b) => a.toLowerCase().replace(/\s/g, '') === b.toLowerCase().replace(/\s/g, ''), ahora),
      totalUnidades: resolverTotal(obs, ahora),
      edad: resolverEdad(obs, ahora),
    };

    const cohortes = resolverCohortes(obs, ahora);

    const estadoGeneral = MIN_ESTADO([
      campos.modalidad.estado, campos.totalUnidades.estado, campos.marca.estado,
      campos.edad.estado,
    ]);

    const edadMax = cohortes.length
      ? Math.max(...cohortes.map((c) => (typeof c.edad === 'number' ? c.edad : c.edad[1])))
      : undefined;
    const oportunidadRenovacion = edadMax !== undefined && edadMax >= EDAD_RENOVACION &&
      cohortes.some((c) => ['Reportado', 'Quórum'].includes(c.estado));

    grupos.push({
      clave, cliente: ref.cliente, campos, cohortes, estadoGeneral,
      puntaje: puntuar(campos, cohortes, obs, ahora),
      observacionesIds: obs.map((o) => o.id),
      oportunidadRenovacion,
    });
  }

  return grupos.sort((a, b) => a.clave.localeCompare(b.clave));
}
