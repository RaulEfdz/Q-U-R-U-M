import { z } from 'zod';

/* ═══════ Vocabulario controlado — del workbook dummy de Philips ═══════ */

export const MODALIDADES = [
  'MR', 'CT', 'Ultrasound', 'XRay', 'PatientMonitoring', 'ImageGuidedTherapy',
] as const;
export type Modalidad = (typeof MODALIDADES)[number];

export const MARCAS_DUMMY = [
  'NovaMed', 'Aurelia Health', 'BluePeak Medical',
  'Orion Imaging', 'HelixCare', 'Zenith MedTech',
] as const;

/* ═══════ EJE 1 · Naturaleza del testimonio (= Status de Philips) ═══════ */

export const NATURALEZAS = ['Directo', 'Referido', 'Estimado', 'Desconocido'] as const;
export type Naturaleza = (typeof NATURALEZAS)[number];

/** Mapeo al vocabulario exacto de Philips para el export. */
export const A_STATUS_PHILIPS: Record<Naturaleza, string> = {
  Directo: 'Confirmed', Referido: 'Reported',
  Estimado: 'Estimated', Desconocido: 'Unknown',
};

/* ═══════ EJE 2 · Quórum (por campo de la proyección) ═══════ */

export const NIVELES = ['Sin datos', 'Estimado', 'Reportado', 'Quórum'] as const;
export type Nivel = (typeof NIVELES)[number];
export type EstadoCampo = Nivel | 'Sin quórum';
export const rank = (n: Nivel): number => NIVELES.indexOf(n);

/* ═══════ Estado de revisión — mobile CLAUDE.md §Tabla de decisión ═══════ */
/**
 * Máximo 1 pregunta por nota (regla dura). Si el usuario no responde,
 * la nota se guarda como 'pendiente-de-revision' — nunca se descarta
 * (evita DoS por fricción). El doc maestro declara la regla y no la
 * modela: este campo es la corrección obligatoria de apps/mobile/CLAUDE.md.
 */
export const ESTADOS_REVISION = ['confirmada', 'pendiente-de-revision'] as const;
export type EstadoRevision = (typeof ESTADOS_REVISION)[number];

/* ═══════ Testimonio — inmutable ═══════ */

export const zRangoEdad = z.union([
  z.number().int().min(0).max(60),
  z.tuple([z.number().int().min(0), z.number().int().max(60)]),
]);
export type RangoEdad = z.infer<typeof zRangoEdad>;

/**
 * GPS del DISPOSITIVO al momento de capturar la nota — distinto de
 * `cliente.ciudad`/`cliente.pais` (lo que el testimonio DICE sobre el
 * sitio) y sirve para corroborarlo o detectar un desvío. Opcional a
 * propósito: sin permiso, sin señal (adentro de un hospital) o en el
 * desktop de `apps/server` (sin GPS de dispositivo) la nota se sigue
 * guardando igual — nunca bloquea ni descarta la captura.
 */
export const zUbicacionCaptura = z.object({
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  precisionMetros: z.number().nonnegative().optional(),
});
export type UbicacionCaptura = z.infer<typeof zUbicacionCaptura>;

export const zObservacion = z.object({
  id: z.string().min(10),
  sesionId: z.string().min(10),            // H-02: agrupa los lotes de una misma captura
  observadorId: z.string().min(1),
  dispositivoId: z.string().min(1),        // clave pública del peer
  visitadoEn: z.string().datetime(),       // H-05: fecha de la VISITA — requerido, no opcional (corrección #14)
  capturadaEn: z.string().datetime(),      // cuándo se dictó
  ubicacionCaptura: zUbicacionCaptura.optional(), // dónde estaba el dispositivo al dictar/escribir, si hubo GPS
  fuente: z.enum(['voz', 'texto', 'foto']),// H-04
  naturaleza: z.enum(NATURALEZAS),         // H-01
  origen: z.enum(['local', 'peer']),       // determina si es untrusted
  cliente: z.object({
    nombre: z.string().min(2),
    ciudad: z.string().optional(),
    pais: z.string().optional(),
    sitio: z.string().optional(),          // H-08: área, piso
  }),
  /** Un LOTE: `cantidad` unidades que comparten edad. H-02. */
  lote: z.object({
    modalidad: z.enum(MODALIDADES),
    marca: z.string().optional(),
    modelo: z.string().optional(),
    cantidad: z.number().int().min(1).max(500).optional(),
    edadAnios: zRangoEdad.optional(),
  }),
  /**
   * Cita LITERAL de `textoOriginal` que justifica este lote. Requerida.
   *
   * Es la pieza central del diseño anti-alucinación (Anexo D §1.4): un
   * verificador determinista (`pipeline/verificar.ts`) comprueba que esta
   * cita aparece de verdad en la nota antes de que el lote llegue al
   * borrador. Se persiste, no se descarta tras verificar: sin ella, un
   * auditor puede ver la nota entera (`textoOriginal`) pero no QUÉ
   * fragmento justificó ESTE lote — que es justo lo que `TRAZABILIDAD.md`
   * promete responder.
   *
   * El doc maestro §II.3 no la modelaba; el Anexo D y `TRAZABILIDAD.md`
   * la declaran requerida. Se resuelve a favor de estos últimos.
   */
  evidencia: z.string().min(1).max(500),
  hedging: z.boolean(),
  notas: z.string().max(2000).optional(),  // H-08 · superficie de inyección
  seguimiento: z.array(z.object({          // H-09
    pregunta: z.string(), respuesta: z.string(),
  })).default([]),
  textoOriginal: z.string().max(4000),     // untrusted, jamás al P-LLM crudo
  provenance: z.object({
    hash: z.string(),
    modeloSha256: z.string().optional(),
    delegado: z.boolean(),
  }),
});
export type Observacion = z.infer<typeof zObservacion>;

/** Borrador: extraído pero NO persistido. H-03. */
export interface Borrador {
  id: string;
  sesionId: string;
  observaciones: Observacion[];
  resumen: string;                          // el "I captured: …" del paso 12
  siguientePregunta: string | null;
  creadoEn: string;
  /**
   * Máximo 1 pregunta por nota (regla dura, mobile CLAUDE.md §Tabla de decisión).
   * Si el usuario no responde, el borrador se guarda como 'pendiente-de-revision'
   * — nunca se descarta (evita DoS por fricción). Vive acá, no en Observacion:
   * esta última es inmutable y ya pasó confirmación humana; un borrador con
   * pregunta sin responder todavía no llegó a esa etapa.
   */
  estadoRevision: EstadoRevision;
}

/* ═══════ Proyección ═══════ */

export interface CampoResuelto<T> {
  estado: EstadoCampo;
  valor?: T;
  rango?: [number, number];
  observadores: string[];
  clusters?: Array<{ valor: unknown; observadores: string[] }>;
  ultimaVisita: string;
  fresco: boolean;
}

/** Cohorte: unidades del mismo grupo que comparten edad. H-02. */
export interface CohorteResuelta {
  edad: number | [number, number];
  anioInstalacion?: number;                 // H-06, derivado
  cantidad: CampoResuelto<number>;
  estado: EstadoCampo;
  observadores: string[];
}

export interface DesglosePuntaje {
  total: number;
  completitud: number; frescura: number; corroboracion: number;
}

export interface GrupoEquipo {
  clave: string;
  cliente: { nombre: string; ciudad?: string; pais?: string };
  campos: {
    modalidad: CampoResuelto<Modalidad>;
    marca: CampoResuelto<string>;
    modelo: CampoResuelto<string>;
    totalUnidades: CampoResuelto<number>;   // H-02
    edad: CampoResuelto<RangoEdad>;         // corrección #12 server/CLAUDE.md: la edad resuelve como campo, no solo cohortes
  };
  cohortes: CohorteResuelta[];              // H-02
  estadoGeneral: EstadoCampo;
  puntaje: DesglosePuntaje;                 // H-07
  observacionesIds: string[];
  oportunidadRenovacion: boolean;
}

/* ═══════ Plano de control ═══════ */

export interface SecurityContext {
  principal: { id: string; tipo: 'humano' | 'agente'; roles: string[] };
  agenteId: string;
  traceId: string;
}

export interface ActionRequest {
  tool: string;
  args: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  origenArgumentos: 'usuario' | 'modelo';   // ← la línea que detiene la inyección
}

export interface PolicyDecision {
  decision: 'allow' | 'deny' | 'require-approval';
  reason: string; policyId: string; version: string;
}

export interface AuditRecord {
  id: string; at: string; traceId: string;
  accion: string; detalle: Record<string, unknown>;
  hashPrev: string; hash: string;
}
