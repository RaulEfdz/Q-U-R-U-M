/**
 * Siembra la base local del teléfono con un escenario de demo, para poder
 * ver Cliente 360 con datos sin depender del pipeline de modelos.
 *
 * ¿Por qué existe? Cliente 360 muestra la reconciliación de VARIOS
 * observadores, y capturando notas desde la app todas llevan el mismo
 * `observadorId` (no hay login todavía, ver `src/app/identidad.ts`): nunca
 * se llegaría a `Quórum` ni a `Sin quórum`, que es justo lo que la pantalla
 * tiene que demostrar.
 *
 * ★ Esto NO es una vía para saltarse la confirmación humana. Es una
 * herramienta de desarrollo que escribe el archivo del store por fuera de
 * la app; el código de la app sigue teniendo un único punto de escritura
 * (`store/expo-store.ts`, vía `confirmarParaGuardar()` desde la pantalla de
 * confirmación). No usar para cargar datos reales de campo.
 *
 * Uso:
 *   node --experimental-strip-types dev/sembrar-demo.ts /tmp/obs.jsonl
 *   adb push /tmp/obs.jsonl /data/local/tmp/obs.jsonl
 *   adb shell "run-as io.qurum.mobile sh -c \'cat /data/local/tmp/obs.jsonl > files/observaciones.jsonl\'"
 *   adb shell am force-stop io.qurum.mobile && adb shell am start -n io.qurum.mobile/.MainActivity
 *
 * `VOS` tiene que ser el `observadorId` de ESTE dispositivo para que la UI
 * lo etiquete como "Vos" en vez de como un testigo más. Se lee con:
 *   adb shell run-as io.qurum.mobile cat files/identidad.json
 *
 * Escenarios que cubre, uno por cada cosa que la pantalla promete mostrar:
 *   1. `Quórum`     — dos testimonios directos que coinciden.
 *   2. `Sin quórum` — discrepancia real de cantidad (3 vs 6).
 *   3. Cohortes     — dos tandas de edad que NO son una contradicción.
 *   4. `Estimado`   — testimonio referido, con hedging y ya sin frescura.
 */
import { writeFileSync } from 'node:fs';
import { zObservacion, type Observacion } from '../src/core/contracts.ts';
import { hashTexto } from '../src/pipeline/extractor.ts';

const VOS = '01M25YQQD84CBE93P7FQ';   // observadorId del Pixel de desarrollo — cambiar por el del dispositivo en uso
const ANA = '01M25YQQD84CBE93P7FA';
const BETO = '01M25YQQD84CBE93P7FB';

let n = 0;
const id = () => `SEED000000${String(++n).padStart(10, '0')}`;

function ob(
  observadorId: string, sesionId: string, visitadoEn: string,
  cliente: Observacion['cliente'], lote: Observacion['lote'],
  evidencia: string, textoOriginal: string,
  naturaleza: Observacion['naturaleza'] = 'Directo', hedging = false,
): Observacion {
  // Tipar explícito ANTES de parsear: `zObservacion.parse()` acepta
  // `unknown`, así que sin la anotación el compilador no valida el literal
  // (trampa #3 de CONTINUAR.md).
  const o: Observacion = {
    id: id(), sesionId, observadorId,
    dispositivoId: `dispositivo-${observadorId.slice(-4)}`,
    visitadoEn, capturadaEn: visitadoEn,
    fuente: 'texto', naturaleza, origen: 'local',
    cliente, lote, evidencia, hedging, seguimiento: [], textoOriginal,
    provenance: { hash: hashTexto(textoOriginal), delegado: false },
  };
  return zObservacion.parse(o);
}

const PACIFIC = { nombre: 'Hospital DemoCare Pacific', ciudad: 'Panama City', pais: 'Panamá' };
const ANDES = { nombre: 'Clínica Cerro Verde', ciudad: 'David', pais: 'Panamá' };

const obs: Observacion[] = [
  /* ── 1 · QUÓRUM: dos directos, sin hedging, coinciden ── */
  ob(VOS, 'ses-pacific-mr-01', '2026-09-02T14:00:00.000Z', PACIFIC,
    { modalidad: 'MR', marca: 'NovaMed', modelo: 'NM-MR 700', cantidad: 2, edadAnios: 7 },
    'dos MR NovaMed', 'Estuve en DemoCare Pacific: tienen dos MR NovaMed, modelo NM-MR 700, de unos siete años.'),
  ob(ANA, 'ses-pacific-mr-02', '2026-09-05T09:30:00.000Z', PACIFIC,
    { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 8 },
    'dos resonadores NovaMed', 'Visita a DemoCare Pacific, vi dos resonadores NovaMed con ocho años encima.'),

  /* ── 2 · SIN QUÓRUM: discrepancia real de cantidad (3 vs 6) ── */
  ob(VOS, 'ses-pacific-ct-01', '2026-09-02T14:20:00.000Z', PACIFIC,
    { modalidad: 'CT', marca: 'HelixCare', cantidad: 3, edadAnios: 4 },
    'tres CT HelixCare', 'En el mismo piso conté tres CT HelixCare bastante nuevos, cuatro años.'),
  ob(BETO, 'ses-pacific-ct-02', '2026-09-06T11:00:00.000Z', PACIFIC,
    { modalidad: 'CT', marca: 'HelixCare', cantidad: 6, edadAnios: 4 },
    'seis CT de HelixCare', 'DemoCare Pacific tiene seis CT de HelixCare en total, cuatro años.'),

  /* ── 3 · COHORTES: dos tandas de edad, no una contradicción.
     Los dos lotes de UNA captura comparten `sesionId` — así `resolverTotal`
     los suma (H-02) en vez de tomar solo el último y fabricar un conflicto
     falso 2-vs-4. Los dos observadores llegan a 6 por caminos iguales, así
     que el total tiene quórum y las cohortes se muestran por separado. ── */
  ob(VOS, 'ses-andes-us-01', '2026-09-08T10:00:00.000Z', ANDES,
    { modalidad: 'Ultrasound', marca: 'Aurelia Health', cantidad: 4, edadAnios: 3 },
    'cuatro ecógrafos nuevos', 'En Cerro Verde hay cuatro ecógrafos Aurelia nuevos, tres años, y otros dos viejos de trece.'),
  ob(VOS, 'ses-andes-us-01', '2026-09-08T10:00:00.000Z', ANDES,
    { modalidad: 'Ultrasound', marca: 'Aurelia Health', cantidad: 2, edadAnios: 13 },
    'otros dos viejos de trece', 'En Cerro Verde hay cuatro ecógrafos Aurelia nuevos, tres años, y otros dos viejos de trece.'),
  ob(ANA, 'ses-andes-us-03', '2026-09-09T16:00:00.000Z', ANDES,
    { modalidad: 'Ultrasound', marca: 'Aurelia Health', cantidad: 4, edadAnios: 3 },
    'cuatro Aurelia de tres años', 'Confirmo cuatro Aurelia de tres años en Cerro Verde, y dos más antiguos de trece.'),
  ob(ANA, 'ses-andes-us-03', '2026-09-09T16:00:00.000Z', ANDES,
    { modalidad: 'Ultrasound', marca: 'Aurelia Health', cantidad: 2, edadAnios: 13 },
    'dos más antiguos de trece', 'Confirmo cuatro Aurelia de tres años en Cerro Verde, y dos más antiguos de trece.'),

  /* ── 4 · REPORTADO + hedging + testimonio referido, y dato viejo ── */
  ob(BETO, 'ses-andes-xray-01', '2026-01-15T08:00:00.000Z', ANDES,
    { modalidad: 'XRay', marca: 'Orion Imaging', cantidad: 1, edadAnios: 11 },
    'un equipo de rayos Orion', 'Me dijeron que hay un equipo de rayos Orion, creo que de unos once años.',
    'Referido', true),
];

writeFileSync(process.argv[2]!, obs.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(`OK — ${obs.length} observaciones válidas (zObservacion.parse pasó en todas)`);
