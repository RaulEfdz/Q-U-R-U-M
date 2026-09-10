import type { Modalidad, Naturaleza } from '../core/contracts.ts';

const STOPWORDS_CLIENTE = [
  'hospital', 'clinica', 'centro', 'medico', 'diagnostico',
  'instituto', 'sa', 'sas', 'srl', 'ltda', 'de', 'la', 'el', 'del',
];

export function normalizarCliente(raw: string): string {
  const base = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const sin = base.filter((t) => !STOPWORDS_CLIENTE.includes(t));
  return (sin.length ? sin : base).join(' ');
}

export function normalizarMarca(raw?: string): string {
  if (!raw) return 'desconocida';
  return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Sinónimos: tabla explícita, no criterio del modelo.
 *  Cubre el paso 3 de su lógica: "MRI -> MR, scanner -> CT". */
const SINONIMOS: Record<string, Modalidad> = {
  mr: 'MR', mri: 'MR', rm: 'MR', resonancia: 'MR', resonador: 'MR',
  resonanciamagnetica: 'MR', resonadores: 'MR',
  ct: 'CT', tac: 'CT', tomografo: 'CT', tomografos: 'CT',
  tomografia: 'CT', scanner: 'CT', escaner: 'CT',
  ultrasound: 'Ultrasound', ultrasonido: 'Ultrasound', eco: 'Ultrasound',
  ecografo: 'Ultrasound', ecografos: 'Ultrasound', ecografia: 'Ultrasound',
  xray: 'XRay', rayosx: 'XRay',
  monitoreo: 'PatientMonitoring', monitores: 'PatientMonitoring',
  patientmonitoring: 'PatientMonitoring',
  igt: 'ImageGuidedTherapy', imageguidedtherapy: 'ImageGuidedTherapy',
};

export function normalizarModalidad(raw: string): Modalidad | undefined {
  const k = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  return SINONIMOS[k];
}

/** Marcadores de incertidumbre. Los detecta CÓDIGO sobre el texto original.
 *  Si le preguntáramos al modelo "¿estaba seguro?", habríamos puesto una
 *  decisión de confianza dentro del LLM y roto nuestro propio principio. */
const HEDGES = [
  'creo', 'parece', 'pareceria', 'quiza', 'quizas', 'tal vez', 'talvez',
  'unos', 'unas', 'alrededor', 'aproximadamente', 'mas o menos', 'como',
  'no estoy seguro', 'diria', 'estimo', 'calculo', 'posiblemente', 'seria',
];
export function detectarHedging(texto: string): boolean {
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return HEDGES.some((h) => t.includes(h));
}

/** Naturaleza inferida del lenguaje. Paso 10 de su lógica de preguntas. */
const REFERIDO = ['me dijeron', 'me comentaron', 'segun', 'escuche', 'me contaron', 'dicen que'];
export function inferirNaturaleza(texto: string, hedging: boolean): Naturaleza {
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (REFERIDO.some((r) => t.includes(r))) return 'Referido';
  if (hedging) return 'Estimado';
  return 'Directo';
}
