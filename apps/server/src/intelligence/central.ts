/**
 * central.ts — Intelligence Layer del servidor.
 *
 * Los testimonios son evidencia inmutable. Esta capa NO los reescribe ni
 * persiste conclusiones: construye proyecciones recalculables para priorizar
 * trabajo humano. Si llega evidencia nueva, el siguiente cálculo reemplaza la
 * oportunidad, la alerta de calidad y el panorama anteriores.
 */
import type { GrupoEquipo, Observacion } from '../core/contracts.ts';

export type TipoOportunidad =
  | 'potential_refresh'
  | 'requires_verification'
  | 'conflicting_installed_base'
  | 'missing_critical_information';

export type Prioridad = 'alta' | 'media' | 'baja';

export interface DesgloseOportunidad {
  edad: number;
  calidad: number;
  evidencia: number;
  frescura: number;
  relevanciaNegocio: number;
  total: number;
}

export interface Oportunidad {
  id: string;
  tipo: TipoOportunidad;
  prioridad: Prioridad;
  cliente: string;
  ciudad?: string;
  pais?: string;
  grupoClave: string;
  equipo: string;
  razon: string[];
  evidenciaIds: string[];
  observadores: string[];
  estado: GrupoEquipo['estadoGeneral'];
  confianza: 'alta' | 'media' | 'baja';
  frescura: 'vigente' | 'requiere verificación';
  puntaje: DesgloseOportunidad;
  proximaAccion: string;
}

export interface CalidadDatos {
  conflictos: number;
  desactualizados: number;
  faltantesCriticos: number;
  sitiosNoReconciliados: number;
}

export interface NodoGeografico {
  pais: string;
  ciudades: Array<{
    ciudad: string;
    clientes: Array<{
      cliente: string;
      grupos: Array<{
        clave: string;
        modalidad: string;
        marca?: string;
        unidades?: number;
        enDisputa: boolean;
        sitiosObservados: string[];
      }>;
    }>;
  }>;
}

export interface InteligenciaCentral {
  oportunidades: Oportunidad[];
  calidad: CalidadDatos;
  geografia: NodoGeografico[];
  resumen: {
    clientes: number;
    sitiosObservados: number;
    equiposConCantidadConocida: number;
  };
}

function edadMaxima(g: GrupoEquipo): number | undefined {
  const edades = g.cohortes.map((c) => Array.isArray(c.edad) ? c.edad[1] : c.edad);
  return edades.length ? Math.max(...edades) : undefined;
}

function etiquetaEquipo(g: GrupoEquipo): string {
  const modalidad = g.campos.modalidad.valor ?? 'Equipo';
  const marca = g.campos.marca.valor;
  return marca ? `${modalidad} · ${marca}` : String(modalidad);
}

function confianza(g: GrupoEquipo): Oportunidad['confianza'] {
  if (g.puntaje.total >= 75) return 'alta';
  if (g.puntaje.total >= 45) return 'media';
  return 'baja';
}

function esFresco(g: GrupoEquipo): boolean {
  // `totalUnidades` representa la afirmación principal del grupo. Si falta o
  // está en disputa, edad conserva una última visita útil para no tratar como
  // "vigente" algo cuyo total no está resuelto.
  return g.campos.totalUnidades.fresco || g.campos.edad.fresco;
}

function evidencia(g: GrupoEquipo): string[] {
  return [...new Set(g.observacionesIds)].sort();
}

function observadores(g: GrupoEquipo): string[] {
  return [...new Set([
    ...g.campos.totalUnidades.observadores,
    ...g.campos.edad.observadores,
  ])].sort();
}

/**
 * El puntaje no pretende predecir una compra. Prioriza qué vale la pena
 * revisar con evidencia disponible. La relevancia comercial queda en cero
 * hasta que una persona cargue una política de negocio explícita: inventarla
 * sería presentar una preferencia como inteligencia.
 */
function puntaje(g: GrupoEquipo, edad: number | undefined, ahora: Date): DesgloseOportunidad {
  const calidad = Math.round(g.puntaje.total * 0.25);
  const testigos = observadores(g).length;
  const soporte = testigos >= 3 ? 20 : testigos === 2 ? 12 : testigos === 1 ? 6 : 0;
  const fecha = g.campos.totalUnidades.ultimaVisita === 'nunca'
    ? g.campos.edad.ultimaVisita
    : g.campos.totalUnidades.ultimaVisita;
  const dias = fecha === 'nunca' ? Infinity : Math.max(0, (ahora.getTime() - new Date(fecha).getTime()) / 86_400_000);
  const frescura = dias <= 180 ? 10 : dias <= 365 ? 5 : 0;
  const senalEdad = edad === undefined ? 0 : edad >= 10 ? 30 : edad >= 8 ? 22 : edad >= 7 ? 15 : 0;
  const relevanciaNegocio = 0;
  return {
    edad: senalEdad, calidad, evidencia: soporte, frescura, relevanciaNegocio,
    total: senalEdad + calidad + soporte + frescura + relevanciaNegocio,
  };
}

function oportunidad(g: GrupoEquipo, tipo: TipoOportunidad, ahora: Date): Oportunidad {
  const edad = edadMaxima(g);
  const fresco = esFresco(g);
  const base = {
    id: `${tipo}:${g.clave}`,
    tipo,
    cliente: g.cliente.nombre,
    ...(g.cliente.ciudad ? { ciudad: g.cliente.ciudad } : {}),
    ...(g.cliente.pais ? { pais: g.cliente.pais } : {}),
    grupoClave: g.clave,
    equipo: etiquetaEquipo(g),
    evidenciaIds: evidencia(g),
    observadores: observadores(g),
    estado: g.estadoGeneral,
    confianza: confianza(g),
    frescura: fresco ? 'vigente' as const : 'requiere verificación' as const,
    puntaje: puntaje(g, edad, ahora),
  };

  if (tipo === 'potential_refresh') {
    return {
      ...base, prioridad: fresco ? 'alta' : 'media',
      razon: [
        `${edad} años estimados en al menos una cohorte.`,
        `${base.observadores.length} observador(es) sostienen la evidencia.`,
        fresco ? 'La evidencia sigue dentro de la ventana de frescura.' : 'La evidencia requiere verificación por antigüedad de la visita.',
      ],
      proximaAccion: fresco
        ? 'Verificar el estado actual del equipo antes de iniciar un contacto comercial.'
        : 'Programar una verificación de estado antes de considerar un contacto comercial.',
    };
  }
  if (tipo === 'conflicting_installed_base') {
    const campos = Object.entries(g.campos)
      .filter(([, campo]) => campo.estado === 'Sin quórum')
      .map(([nombre]) => ({ totalUnidades: 'cantidad', edad: 'edad', marca: 'marca', modelo: 'modelo', modalidad: 'modalidad' }[nombre] ?? nombre));
    return {
      ...base, prioridad: 'alta',
      razon: [
        `Hay versiones incompatibles para ${campos.join(', ') || 'la base instalada'}.`,
        'El sistema conserva todas las versiones y no selecciona un valor por su cuenta.',
      ],
      proximaAccion: 'Solicitar una observación independiente que valide el campo en disputa.',
    };
  }
  if (tipo === 'missing_critical_information') {
    const faltan = [
      g.campos.totalUnidades.estado === 'Sin datos' ? 'cantidad' : null,
      g.campos.edad.estado === 'Sin datos' ? 'edad' : null,
      g.campos.marca.estado === 'Sin datos' ? 'fabricante' : null,
    ].filter(Boolean).join(', ');
    return {
      ...base, prioridad: 'media',
      razon: [`Falta información crítica: ${faltan}.`, 'El sistema declara lo desconocido y no lo completa con una suposición.'],
      proximaAccion: 'Pedir ese dato en la próxima visita o mediante una pregunta de seguimiento.',
    };
  }
  return {
    ...base, prioridad: 'media',
    razon: ['La última observación quedó fuera de la ventana de frescura.', 'El dato se conserva, pero necesita una verificación actual.'],
    proximaAccion: 'Programar una visita o validación remota para actualizar la evidencia.',
  };
}

function sitiosPorGrupo(g: GrupoEquipo, porId: Map<string, Observacion>): string[] {
  return [...new Set(g.observacionesIds
    .map((id) => porId.get(id)?.cliente.sitio)
    .filter((sitio): sitio is string => Boolean(sitio?.trim())))]
    .sort((a, b) => a.localeCompare(b));
}

function geografia(grupos: GrupoEquipo[], obs: Observacion[]): NodoGeografico[] {
  const porId = new Map(obs.map((o) => [o.id, o]));
  const paises = new Map<string, Map<string, Map<string, GrupoEquipo[]>>>();
  for (const g of grupos) {
    const pais = g.cliente.pais ?? 'Sin país';
    const ciudad = g.cliente.ciudad ?? 'Sin ciudad';
    const porCiudad = paises.get(pais) ?? new Map<string, Map<string, GrupoEquipo[]>>();
    const porCliente = porCiudad.get(ciudad) ?? new Map<string, GrupoEquipo[]>();
    const arr = porCliente.get(g.cliente.nombre) ?? [];
    arr.push(g); porCliente.set(g.cliente.nombre, arr); porCiudad.set(ciudad, porCliente); paises.set(pais, porCiudad);
  }
  return [...paises.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([pais, ciudades]) => ({
    pais,
    ciudades: [...ciudades.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ciudad, clientes]) => ({
      ciudad,
      clientes: [...clientes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cliente, gs]) => ({
        cliente,
        grupos: gs.map((g) => ({
          clave: g.clave,
          modalidad: String(g.campos.modalidad.valor ?? 'Sin modalidad'),
          ...(g.campos.marca.valor ? { marca: g.campos.marca.valor } : {}),
          ...(typeof g.campos.totalUnidades.valor === 'number' ? { unidades: g.campos.totalUnidades.valor } : {}),
          enDisputa: g.campos.totalUnidades.estado === 'Sin quórum',
          sitiosObservados: sitiosPorGrupo(g, porId),
        })),
      })),
    })),
  }));
}

export function construirInteligencia(grupos: GrupoEquipo[], obs: Observacion[], ahora = new Date()): InteligenciaCentral {
  const oportunidades: Oportunidad[] = [];
  for (const g of grupos) {
    if (g.oportunidadRenovacion) oportunidades.push(oportunidad(g, 'potential_refresh', ahora));
    if (g.estadoGeneral === 'Sin quórum') oportunidades.push(oportunidad(g, 'conflicting_installed_base', ahora));
    if (g.campos.totalUnidades.estado === 'Sin datos' || g.campos.edad.estado === 'Sin datos' || g.campos.marca.estado === 'Sin datos') {
      oportunidades.push(oportunidad(g, 'missing_critical_information', ahora));
    }
    if (!esFresco(g)) oportunidades.push(oportunidad(g, 'requires_verification', ahora));
  }
  const prioridad = { alta: 0, media: 1, baja: 2 } as const;
  oportunidades.sort((a, b) => prioridad[a.prioridad] - prioridad[b.prioridad] || b.puntaje.total - a.puntaje.total || a.id.localeCompare(b.id));

  const sitios = new Set(obs.map((o) => `${o.cliente.nombre}|${o.cliente.sitio ?? ''}`).filter((k) => !k.endsWith('|')));
  return {
    oportunidades,
    calidad: {
      conflictos: grupos.filter((g) => g.estadoGeneral === 'Sin quórum').length,
      desactualizados: grupos.filter((g) => !esFresco(g)).length,
      faltantesCriticos: grupos.filter((g) => g.campos.totalUnidades.estado === 'Sin datos' || g.campos.edad.estado === 'Sin datos' || g.campos.marca.estado === 'Sin datos').length,
      sitiosNoReconciliados: sitios.size,
    },
    geografia: geografia(grupos, obs),
    resumen: {
      clientes: new Set(grupos.map((g) => `${g.cliente.nombre}|${g.cliente.ciudad ?? ''}|${g.cliente.pais ?? ''}`)).size,
      sitiosObservados: sitios.size,
      equiposConCantidadConocida: grupos.reduce((n, g) => n + (g.campos.totalUnidades.valor ?? 0), 0),
    },
  };
}
