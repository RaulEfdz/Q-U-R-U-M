import { MARCAS_DUMMY } from '../core/contracts.ts';

const PALABRAS_MODALIDAD = [
  'mr','mri','resonancia','resonador','resonadores','rm',
  'ct','tac','tomografo','tomografos','tomografia','scanner','escaner',
  'ecografo','ecografos','ecografia','eco','ultrasonido','ultrasound',
  'rayos','xray','monitor','monitores','monitoreo','igt',
];

export interface Indicios {
  hayIndicios: boolean;
  modalidades: string[];
  hayNumeros: boolean;
  hayMarca: boolean;
}

/** Señal barata e INDEPENDIENTE de cualquier modelo.
 *  Nunca decide sola: solo acompaña al portero para permitir el atajo.
 *
 *  `modalidades` devuelve las PALABRAS CRUDAS de PALABRAS_MODALIDAD que
 *  aparecen en el texto, no `Modalidad` canónicas de contracts.ts. Se
 *  descartó unificar con `normalizarModalidad` (trust/normalize.ts) a
 *  propósito: mapear acá a canónica acoplaría esta señal barata al
 *  vocabulario de contratos y cambiaría el contrato de `Indicios` sin
 *  necesidad — precheck solo tiene que decidir "¿hay indicio?", no
 *  clasificar. Por eso tampoco se importa `MODALIDADES` de contracts.ts:
 *  no se usa para nada acá, y dejarlo importado sin uso no compila con
 *  `noUnusedLocals`.
 */
export function precheck(texto: string): Indicios {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // \b al inicio Y al final: sin el cierre, "eco" matchea "economía" y
  // "monitor" matchea "monitorear" (bug de la fuente). La lista ya trae
  // singulares y plurales como entradas separadas ('ecografo' Y
  // 'ecografos'), así que anclar los dos lados no pierde derivados
  // legítimos — cada forma que debe matchear ya está listada explícita.
  const modalidades = PALABRAS_MODALIDAD.filter((p) => new RegExp(`\\b${p}\\b`).test(t));
  const hayNumeros = /\b(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/.test(t);
  const hayMarca = MARCAS_DUMMY.some((m) =>
    t.includes(m.toLowerCase().split(' ')[0]!));
  return {
    modalidades, hayNumeros, hayMarca,
    // hayNumeros incluido: sin esto, "compramos tres el año pasado" no
    // tiene indicios y el pipeline toma el atajo, perdiendo la observación.
    hayIndicios: modalidades.length > 0 || hayMarca || hayNumeros,
  };
}
