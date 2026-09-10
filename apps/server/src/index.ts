/**
 * index.ts — servidor HTTP local de QUÓRUM (Fase 8, doc maestro §II.19).
 *
 * ══════════════════ Invariantes que este archivo hace cumplir ══════════════════
 *
 * 1. Escucha SOLO en 127.0.0.1. Nunca 0.0.0.0. La app es de escritorio local:
 *    ligar a todas las interfaces expone `/api/exportar` (la cartera entera de
 *    clientes en CSV) a cualquiera en la misma red WiFi del evento.
 * 2. Cero inferencia en la nube. La única puerta al modelo es `qvac/gateway.ts`
 *    y corre on-device (o delegada a un peer por QVAC, nunca a un proveedor
 *    SaaS). Este archivo no hace un solo `fetch` de salida.
 * 3. Nada se persiste sin confirmación humana (H-03). `/api/observar` produce
 *    un BORRADOR en memoria (`store/drafts.ts`, sin escritura a disco);
 *    `/api/confirmar` es el ÚNICO endpoint que llama `agregar()`.
 * 4. Todo argumento de origen modelo entra al PEP con `origenArgumentos:
 *    'modelo'`; los del humano con `'usuario'`. Esa distinción es la que
 *    detiene la inyección indirecta (`policy/engine.ts`, regla
 *    `intencion-originada-en-modelo`). No colapsarla nunca en un solo valor.
 * 5. Texto no confiable (notas dictadas, contenido de peers) jamás va crudo a
 *    un prompt: pasa por `context/spotlight.ts`.
 *
 * ══════════════════ Correcciones de ../CLAUDE.md aplicadas acá ══════════════════
 *
 * #1  `evaluar()` / export siempre 403 → ya resuelto en `policy/engine.ts`
 *     (excepción quirúrgica `export-local-por-humano`). Acá se respeta el
 *     contrato que esa excepción exige y que el doc maestro NO cumplía:
 *     `agenteId: 'ui-humano'`, `origenArgumentos: 'usuario'`, `destino: 'local'`.
 *     Cualquier otro valor en esos tres campos vuelve el export inalcanzable —
 *     a propósito.
 * #5  El `ZodError` antes del PEP → `tools/exportar.ts` ya invierte el orden
 *     (envuelve sin validar, parsea dentro del callback). Acá se completa la
 *     otra mitad: se captura `ZodError` en el dispatcher de tool calls para
 *     que un argumento malformado del modelo dé una respuesta explicada, no
 *     un 500 crudo sin evento `policy-denied`.
 * #9  `/api/confirmar` persistía sin validar → acá cada observación se valida
 *     con `zObservacion.safeParse` ANTES de llegar a `agregar()`.
 * #10 El filtro nunca pasaba por el PEP → se usa `filtrar()` (que enruta por
 *     `aplicar()`), NUNCA `ejecutarFiltro()` a secas.
 * #13 Un lote fuera de contrato tiraba la observación entera → `/api/confirmar`
 *     degrada por observación y reporta `descartadas`, no pierde el lote entero.
 * #14 La UI no permitía corregir → `/api/confirmar` acepta `correcciones` por
 *     id de observación y `seguimiento` (H-09).
 * #15 `cargarLLMDelegado` sin caché → ya cacheado en `qvac/gateway.ts`; acá
 *     simplemente se lo llama por request sin construir instancias propias.
 * #6  `iniciarSync()` sin allowlist → acá la allowlist es explícita y sale de
 *     `QUORUM_PEERS`. Vacía = rechaza a todos (fail-closed en el transporte).
 * §menores `/api/transcribir` dejaba `data/tmp/*.webm` sin borrar → se borra
 *     en `finally`.
 * §menores `verificarCadena()` sin catch → ya resuelto en `store/audit.ts`;
 *     `/api/auditoria` además reporta las líneas descartadas de observaciones
 *     (corrección #9: la pérdida no puede ser invisible).
 *
 * ══════════════════ Bug no listado, corregido acá ══════════════════
 *
 * El servidor de estáticos del doc maestro hace `readFile(join('ui', p))` con
 * `p` derivado directo de la URL: un `GET /../../../../etc/passwd` (o su
 * variante percent-encoded) lee cualquier archivo del disco del usuario. Se
 * resuelve con normalización + verificación de que la ruta final siga dentro
 * de `ui/`, y sirviendo solo extensiones de una allowlist.
 *
 * ══════════════════ Hallazgos de auditoría corregidos acá ══════════════════
 *
 * A-1 DNS rebinding. El invariante 1 (escuchar solo en 127.0.0.1) protege
 *     contra la red local, pero NO contra un navegador: cualquier página web
 *     puede hacer que SU dominio resuelva a 127.0.0.1 y, desde ese momento,
 *     para el navegador esta app es mismo-origen — lee `/api/base-instalada`
 *     y dispara `/api/exportar`. La única defensa posible es no atender
 *     requests cuyo `Host` no sea un nombre de loopback: `guardaDeHost()`,
 *     primera línea de `enrutar()`.
 * A-2 Sin CSP ni protección de framing. La defensa contra XSS de esta app es
 *     que `ui/dom.js` nunca asigna marcado crudo — correcta, pero sin red de
 *     contención. `CSP_UI` la agrega, y es además la expresión declarativa de
 *     lo que la app promete: ningún recurso sale de este equipo.
 * A-3 Respuestas de API sin `cache-control`. Ver `NO_STORE`.
 * A-4 Unidades en disputa contadas como cero en Panorama. Ver `proyeccion()`.
 * A-5 `estadoRevision` del borrador se calculaba y se tiraba. Ver
 *     `/api/confirmar` — mitigado en la auditoría, no resuelto (el contrato
 *     `Observacion` está congelado; queda como decisión pendiente).
 * A-6 La respuesta de seguimiento se duplicaba en todos los lotes. Ver
 *     `/api/confirmar`.
 * A-7 El prompt de `/api/consultar` no tenía tope y desbordaba el `ctx_size`
 *     del modelo. Ver `armarPaqueteConsulta()`.
 * A-8 `QUORUM_PUERTO=abc` daba `NaN` y Node abría un puerto aleatorio. Ver
 *     `puertoDeEnv()`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z, ZodError } from 'zod';

import { cargar, agregar, lineasDescartadas, verificarArchivo } from './store/observations.ts';
import { guardarBorrador, obtenerBorrador, descartarBorrador } from './store/drafts.ts';
import { agregarPendiente, contarPendientes } from './store/pendientes.ts';
import { reconciliar } from './trust/reconcile.ts';
import { candidatosFusion } from './trust/entity.ts';
import { verificarCadena, registrarAuditoria } from './store/audit.ts';
import * as qvacSdk from '@qvac/sdk';
import { cargarLLMLocal, cargarLLMDelegado, completar, transcribirLocal } from './qvac/gateway.ts';
import { extraerBorrador } from './qvac/extract.ts';
import { decidirRuta, asegurarRuta } from './qvac/delegation.ts';
import { empaquetarUntrusted } from './context/spotlight.ts';
import { TOOL_FILTRAR, filtrar, zFiltro } from './tools/filtrar.ts';
import { TOOL_EXPORTAR } from './tools/exportar.ts';
import { exportarDataset } from './tools/exportar.ts';
import { aplicar } from './policy/pep.ts';
import { PolicyDenied, QuorumError } from './core/errors.ts';
import { nuevoId } from './core/ids.ts';
import { iniciarSync, type SyncHandle } from './sync/peer.ts';
import {
  MODALIDADES, zRangoEdad, zObservacion,
  type ActionRequest, type EstadoRevision, type GrupoEquipo, type Observacion,
  type SecurityContext,
} from './core/contracts.ts';

/* ═══════════════════════════ Configuración ═══════════════════════════ */

/**
 * ★ Las constantes de modelo del SDK son OBJETOS descriptores (`src`,
 * `modelId`, `sha256Checksum`, `expectedSize`…), NO strings. Pasarle a
 * `loadModel` el NOMBRE de la constante lo hace buscar un `modelId` que no
 * existe, y falla en runtime con:
 *
 *   Failed to load model: Model with ID "QWEN3_1_7B_INST_Q4".
 *   Available models: acestep-....gguf, ...
 *
 * (el `modelId` real del extractor es `Qwen3-1.7B-Q4_0.gguf`). El typecheck
 * NO lo detecta: `ModeloSrc` en `qvac/gateway.ts` es
 * `string | Record<string, unknown>`, así que el string compila igual.
 * Está avisado en `apps/mobile/CLAUDE.md` §Modelos.
 *
 * Se resuelve contra el SDK al arrancar, no en la primera request: si el
 * nombre no existe conviene enterarse en el `listen`, no cuando el usuario
 * dicta su primera nota.
 */
function modeloDelSdk(nombre: string): Record<string, unknown> {
  const m = (qvacSdk as Record<string, unknown>)[nombre];
  if (m === undefined || typeof m !== 'object' || m === null) {
    throw new Error(
      `Modelo desconocido en @qvac/sdk: "${nombre}". Las constantes del SDK son ` +
      `objetos descriptores, no strings — revisá el nombre contra los exports del paquete.`);
  }
  return m as Record<string, unknown>;
}

const MODELO   = modeloDelSdk(process.env['QUORUM_MODELO'] ?? 'QWEN3_1_7B_INST_Q4');
const ASR      = modeloDelSdk(process.env['QUORUM_ASR'] ?? 'WHISPER_TINY');
const OBSERV   = process.env['QUORUM_OBSERVADOR'] ?? 'Field User 01';
const DISPOSIT = process.env['QUORUM_DISPOSITIVO'] ?? 'dispositivo-a';
const PEER     = process.env['QUORUM_PEER_PUBKEY'];

/**
 * `Number('abc')` es `NaN`, y `server.listen(NaN, …)` no falla: Node lo trata
 * como "cualquier puerto libre", abre uno aleatorio, y el log imprime
 * `http://127.0.0.1:NaN`. El usuario queda con un servidor corriendo en un
 * puerto que no sabe cuál es y una URL que no funciona — el peor modo de
 * fallo posible, porque no parece un fallo. Fail-closed al arrancar, con el
 * valor ofensor en el mensaje.
 */
function puertoDeEnv(v: string | undefined): number {
  if (v === undefined || v.trim() === '') return 3000;
  const n = Number(v.trim());
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(
      `QUORUM_PUERTO inválido: "${v}". Tiene que ser un entero entre 1 y 65535 ` +
      `(sin él, Node abriría un puerto aleatorio y la URL del log sería inservible).`);
  }
  return n;
}

const PUERTO = puertoDeEnv(process.env['QUORUM_PUERTO']);

/** ★ NUNCA '0.0.0.0'. No se lee de env a propósito: un env var es exactamente
 *  la forma en que este invariante se pierde sin que nadie lo note. */
const HOST = '127.0.0.1';

/**
 * Nombres de host aceptados en el header `Host` (hallazgo A-1).
 *
 * Ligar a 127.0.0.1 impide que un vecino de la WiFi del evento llegue al
 * puerto, pero no impide que un NAVEGADOR llegue: el ataque es DNS rebinding.
 * Una página en `evil.example.com` hace que su propio dominio resuelva a
 * 127.0.0.1; el navegador entonces considera `http://evil.example.com:3000`
 * MISMO ORIGEN que este servidor y le deja leer `/api/base-instalada` (la
 * cartera entera) y hacer POST a `/api/exportar` (el CSV de 19 columnas).
 * Nada en la capa de red distingue esa request de una legítima: la única
 * diferencia observable es el `Host`, que el navegador rellena con el dominio
 * que el usuario escribió y que un atacante no puede falsificar desde una
 * página.
 *
 * Por eso la lista va por NOMBRE y no por puerto: el atacante usa nuestro
 * mismo puerto, así que verificar el puerto no agrega defensa — y sí rompería
 * los tests, que levantan `crearServidor()` en un puerto efímero.
 */
const HOSTS_ACEPTADOS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Claves públicas hex de peers autorizados. Vacía = rechaza a todos
 *  (corrección #6: deny-by-default en el transporte). */
const PEERS_AUTORIZADOS = (process.env['QUORUM_PEERS'] ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const RAIZ_UI = resolve('ui');
const DIR_TMP = 'data/tmp';

/** Tope de cuerpo: 1 MB para JSON, 25 MB para audio. Sin esto, un POST
 *  infinito a `/api/observar` come toda la RAM del proceso. */
const MAX_JSON = 1_000_000;
const MAX_AUDIO = 25_000_000;

/* ═══════════════════════════ SSE ═══════════════════════════ */

const clientesSSE = new Set<ServerResponse>();

function emitir(evento: string, datos: unknown): void {
  const p = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
  for (const c of clientesSSE) {
    try { c.write(p); } catch { clientesSSE.delete(c); }
  }
}

/* ═══════════════════════════ Helpers HTTP ═══════════════════════════ */

/** Solo extensiones conocidas: lo que no está acá no se sirve (404), en vez de
 *  mandarlo como `text/plain` como hacía el doc maestro. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * Hallazgo A-3: las respuestas de API no llevaban `cache-control`, así que la
 * heurística del navegador (y cualquier proxy que alguien meta en el medio)
 * podía guardar copias de `/api/base-instalada` y del CSV. Son datos de
 * clientes: no se cachean en ningún lado. `no-store` y no `no-cache`, que
 * permite guardar y solo obliga a revalidar.
 *
 * Va SOLO en las APIs. Los estáticos de `ui/` sí conviene que el navegador
 * los cachee: son el mismo HTML, JS y CSS en cada recarga.
 */
const NO_STORE = 'no-store';

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    // La UI es local y no usa recursos externos: sin esto un XSS en la UI
    // (corrección #7) tiene salida a la red; con esto, no.
    'x-content-type-options': 'nosniff',
    'cache-control': NO_STORE,
  });
  res.end(JSON.stringify(body));
}

/** Lee el cuerpo crudo con tope duro. Aborta la conexión si se pasa. */
async function cuerpoCrudo(req: IncomingMessage, max: number): Promise<Buffer> {
  const trozos: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const b = c as Buffer;
    total += b.length;
    if (total > max) throw new QuorumError('CUERPO_DEMASIADO_GRANDE', `Cuerpo mayor a ${max} bytes`);
    trozos.push(b);
  }
  return Buffer.concat(trozos);
}

/** Cuerpo JSON validado por esquema. El JSON de una request es INPUT HOSTIL
 *  (la UI puede estar comprometida por XSS con datos de peer, corrección #7):
 *  se valida con Zod o se rechaza, nunca se lee `as any` como en el doc. */
async function cuerpoJSON<T>(req: IncomingMessage, esquema: z.ZodType<T>): Promise<T> {
  const texto = (await cuerpoCrudo(req, MAX_JSON)).toString('utf8').trim();
  let crudo: unknown;
  try {
    crudo = texto ? JSON.parse(texto) : {};
  } catch {
    throw new QuorumError('JSON_INVALIDO', 'El cuerpo no es JSON válido');
  }
  return esquema.parse(crudo);
}

const ctx = (agenteId: string, tipo: 'humano' | 'agente'): SecurityContext => ({
  principal: { id: OBSERV, tipo, roles: ['campo'] },
  agenteId, traceId: nuevoId(),
});

/* ═══════════════════════════ Esquemas de entrada ═══════════════════════════ */

/** `<input type="date">` manda `YYYY-MM-DD`; `zObservacion.visitadoEn` exige
 *  ISO datetime. Se normaliza acá y no en el contrato (congelado). */
const zFechaVisita = z.string().min(1).transform((s, c) => {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    c.addIssue({ code: z.ZodIssueCode.custom, message: 'Fecha de visita inválida' });
    return z.NEVER;
  }
  return d.toISOString();
});

const zObservarBody = z.object({
  texto: z.string().min(1).max(4000),
  visitadoEn: zFechaVisita.optional(),
  fuente: z.enum(['voz', 'texto', 'foto']).optional(),
});

/** Corrección #14: la UI corrige campos del lote antes de guardar. Solo el
 *  `lote` es corregible — cliente, evidencia y provenance no se editan a mano
 *  (romperían la trazabilidad de la cita literal). */
const zCorreccionLote = z.object({
  modalidad: z.enum(MODALIDADES).optional(),
  marca: z.string().min(1).max(120).optional(),
  modelo: z.string().min(1).max(120).optional(),
  cantidad: z.number().int().min(1).max(500).optional(),
  edadAnios: zRangoEdad.optional(),
}).strict();

const zConfirmarBody = z.object({
  borradorId: z.string().min(1),
  correcciones: z.record(z.string(), zCorreccionLote).optional(),
  seguimiento: z.array(z.object({
    pregunta: z.string().max(500),
    respuesta: z.string().max(2000),
  })).max(10).optional(),
});

const zDescartarBody = z.object({ borradorId: z.string().min(1) });
const zConsultarBody = z.object({ pregunta: z.string().min(1).max(1000) });

/* ═══════════════════════════ Estáticos (con guarda de traversal) ═══════════════════════════ */

/**
 * CSP de la UI (hallazgo A-2).
 *
 * No es "buenas prácticas": es la misma promesa de `ui/index.html` («ningún
 * recurso sale de este equipo») escrita de forma que el navegador la haga
 * cumplir. Hoy la defensa contra XSS es que `ui/dom.js` nunca asigna marcado
 * crudo — correcta, pero es UNA línea de defensa: alcanza con que un futuro
 * `innerHTML` se cuele para perderla entera. Con esto, un XSS igual no tiene
 * de dónde cargar código ni a dónde exfiltrar.
 *
 * Cada directiva y por qué:
 *  · `default-src 'self'`  — cierre por defecto para todo lo no listado.
 *  · `script-src 'self'`   — la UI carga `<script type="module" src="/app.js">`
 *                            y nada inline; no hace falta `unsafe-inline`, y
 *                            agregarlo anularía la mitad de la CSP.
 *  · `style-src 'self'`    — `style.css` es archivo aparte.
 *  · `img-src 'self' data:`— el favicon de `ui/index.html` es un data URI SVG
 *                            (inline a propósito: cero peticiones de red).
 *  · `connect-src 'self'`  — hace falta para los `fetch` de la UI y para el
 *                            `EventSource` de `/api/stream`.
 *  · `frame-ancestors 'none'` — nadie mete esta UI en un iframe. Es el par de
 *                            la guarda de `Host`: sin esto, una página remota
 *                            no puede LEER la respuesta pero sí enmarcarla y
 *                            hacer clickjacking sobre el botón de exportar.
 *  · `base-uri 'none'`     — impide que una inyección de `<base>` redirija
 *                            todas las rutas relativas a otro origen.
 *  · `form-action 'none'`  — la UI no tiene un solo `<form>`; cualquier envío
 *                            de formulario es, por definición, inyectado.
 */
const CSP_UI = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

async function servirEstatico(res: ServerResponse, pathname: string): Promise<void> {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const destino = resolve(join(RAIZ_UI, p === '/' ? '/index.html' : p));

  // ★ La guarda que el doc maestro no tiene: sin esto, `GET /../../etc/passwd`
  // (o `%2e%2e%2f`) lee cualquier archivo del disco.
  if (destino !== RAIZ_UI && !destino.startsWith(RAIZ_UI + sep)) {
    res.writeHead(403).end();
    return;
  }

  const mime = MIME[extname(destino).toLowerCase()];
  if (!mime) { res.writeHead(404).end(); return; }

  let contenido: Buffer;
  try {
    contenido = await readFile(destino);
  } catch {
    res.writeHead(404).end();
    return;
  }
  // La CSP y el anti-framing van en el DOCUMENTO, no en cada recurso: es el
  // documento el que define el contexto de ejecución que se está acotando.
  // `x-frame-options` es redundante con `frame-ancestors` en cualquier
  // navegador de 2026, y se manda igual porque el costo es un header y el
  // beneficio es que un navegador viejo en la máquina de la demo no sea el
  // único agujero que queda.
  const esDocumento = mime.startsWith('text/html');
  res.writeHead(200, {
    'content-type': mime,
    'x-content-type-options': 'nosniff',
    ...(esDocumento
      ? { 'content-security-policy': CSP_UI, 'x-frame-options': 'DENY' }
      : {}),
  });
  res.end(contenido);
}

/* ═══════════════════════════ Proyección ═══════════════════════════ */

/**
 * Entrada de `porPais` / `porModalidad`.
 *
 * ★ CONTRATO DE SALIDA — lo consume `ui/panorama.js` (`barras()`).
 *
 *   [ clave: string, total: number, enDisputa: number ]
 *
 * · `clave`      — el país o la modalidad.
 * · `total`      — unidades EFECTIVAMENTE sumadas. Sigue siendo el segundo
 *                  elemento del par y sigue siendo un número, así que el
 *                  `const [k, v] = fila` que ya está escrito en `barras()`
 *                  no se rompe: el cambio es aditivo.
 * · `enDisputa`  — cuántos grupos de esa clave NO entraron en `total` porque
 *                  su `totalUnidades` quedó en `Sin quórum`.
 *
 * Ordenado por `total` descendente, igual que antes.
 *
 * Y en `totales`:
 *   `gruposConUnidadesEnDisputa: number` — el mismo conteo, global.
 */
type EntradaSuma = [string, number, number];

/**
 * Hallazgo A-4: `(g.campos.totalUnidades.valor ?? 0)` hacía que un grupo con
 * `totalUnidades.estado === 'Sin quórum'` aportara CERO unidades, sin ninguna
 * señal. El motor deja `valor` en `undefined` a propósito (RD-2: ante
 * discrepancia no elige ni promedia), así que los KPIs de Panorama
 * subestimaban en silencio exactamente los grupos que este producto dice
 * tratar mejor que una planilla.
 *
 * El criterio de producto tiene dos mitades y las dos importan:
 *  · No se puede INVENTAR un número para un campo en disputa — sería elegir
 *    un testimonio sobre otro, que es lo único que el motor se niega a hacer.
 *  · Tampoco se puede fingir que son cero unidades — eso es inventar el
 *    número más bajo posible.
 * La salida honesta es un total más un conteo de lo que quedó afuera, para
 * que la UI pueda decir «142 unidades · 3 grupos en disputa» en vez de dar
 * 142 como si fuera el universo.
 *
 * Los grupos en `Sin datos` también aportan 0 y NO cuentan como disputa: ahí
 * no hay conflicto que resolver, simplemente nadie reportó unidades todavía
 * (RD-0, el dato ausente no se rellena). Son dos ausencias distintas y la UI
 * las tiene que poder distinguir.
 */
/** Exportada para poder testear el contrato de salida sin levantar el
 *  servidor ni cargar un modelo. No la consume nadie más del lado de src/. */
export function proyeccion(obs: Observacion[], grupos: GrupoEquipo[]): Record<string, unknown> {
  const enDisputa = (g: GrupoEquipo): boolean => g.campos.totalUnidades.estado === 'Sin quórum';

  const sumarPor = (clave: (g: GrupoEquipo) => string): EntradaSuma[] => {
    const acc = new Map<string, { total: number; enDisputa: number }>();
    for (const g of grupos) {
      const k = clave(g);
      const celda = acc.get(k) ?? { total: 0, enDisputa: 0 };
      if (enDisputa(g)) celda.enDisputa += 1;
      else celda.total += g.campos.totalUnidades.valor ?? 0;
      acc.set(k, celda);
    }
    return [...acc.entries()]
      .map(([k, v]): EntradaSuma => [k, v.total, v.enDisputa])
      .sort((a, b) => b[1] - a[1]);
  };

  return {
    grupos,
    candidatosFusion: candidatosFusion(new Map(grupos.map((g) => [g.clave, { cliente: g.cliente }]))),
    totales: {
      testimonios: obs.length,
      grupos: grupos.length,
      conQuorum: grupos.filter((g) => g.estadoGeneral === 'Quórum').length,
      sinQuorum: grupos.filter((g) => g.estadoGeneral === 'Sin quórum').length,
      oportunidades: grupos.filter((g) => g.oportunidadRenovacion).length,
      desactualizados: grupos.filter((g) => !g.campos.modalidad.fresco).length,
      /**
       * Cuenta GRUPOS, no unidades — y el nombre lo dice a propósito. Cuántas
       * unidades hay en un grupo cuyo `totalUnidades` está en disputa es
       * justamente lo que no se sabe; poner un número ahí sería reintroducir
       * la invención que RD-2 prohíbe, ahora disfrazada de métrica de calidad.
       */
      gruposConUnidadesEnDisputa: grupos.filter(enDisputa).length,
    },
    porPais: sumarPor((g) => g.cliente.pais ?? 'Sin país'),
    porModalidad: sumarPor((g) => String(g.campos.modalidad.valor ?? '?')),
  };
}

/* ═══════════════════════════ Tool calls del modelo ═══════════════════════════ */

interface ResultadoToolCall {
  atendida: boolean;
  filtro?: unknown;
  resultados?: GrupoEquipo[];
  bloqueado?: { tool: string; policyId: string; reason: string };
  invalido?: { tool: string; motivo: string };
}

/**
 * ★ Dispatcher de tool calls. TODO lo que sale del modelo entra por acá con
 * `origenArgumentos: 'modelo'` — incluida la tool que el modelo NO tenía
 * permitida, que es justo el caso del video de la demo.
 *
 * El doc maestro tenía dos bugs acá y los dos se corrigen:
 *  · #10: llamaba `ejecutarFiltro()` directo. Acá se usa `filtrar()`, que
 *    enruta por `aplicar()` y por lo tanto queda auditado.
 *  · #5: cualquier `ZodError` (argumentos inventados por el modelo) subía sin
 *    capturar y daba 500 sin evento `policy-denied`. Acá se captura y se
 *    reporta como tool call inválida.
 *
 * Una tool desconocida NO se ejecuta ni se ignora en silencio: se somete al
 * PEP igual, con `riskLevel: 'high'`, para que quede el registro
 * `policy:deny` en la cadena de auditoría (deny-by-default auditado).
 */
/**
 * Compone la frase de respuesta de `/api/consultar` a partir de los
 * resultados REALES del filtro.
 *
 * Por qué en código y no pidiéndosela al modelo: la pantalla le promete al
 * usuario que «el modelo local traduce la pregunta a un filtro; no cuenta ni
 * estima: el filtro lo ejecuta el código». Si la frase la escribiera el
 * modelo, estaría contando — y un 1.7B contando equipos médicos inventa
 * cifras. Es el principio rector del proyecto aplicado a una línea de texto:
 * el LLM entiende la pregunta, el código produce el número.
 *
 * Además resuelve un defecto real: `texto` viene VACÍO cuando el modelo emite
 * un tool call (comportamiento normal del tool calling), así que la pantalla
 * mostraba resultados sin ninguna frase que los explicara.
 */
function resumirResultados(grupos: GrupoEquipo[], filtro: unknown): string {
  if (!grupos.length) {
    return 'Ningún grupo de equipo coincide con ese filtro. Puede que el dato todavía no esté capturado: `Sin datos` es una respuesta válida acá.';
  }

  const unidades = grupos.reduce((suma, g) => suma + (Number(g.campos.totalUnidades.valor) || 0), 0);
  const clientes = new Set(grupos.map((g) => g.cliente.nombre)).size;
  const conQuorum = grupos.filter((g) => g.estadoGeneral === 'Quórum').length;
  const sinQuorum = grupos.filter((g) => g.estadoGeneral === 'Sin quórum').length;

  const partes = [
    `${grupos.length} ${grupos.length === 1 ? 'grupo de equipo' : 'grupos de equipo'}`,
    `en ${clientes} ${clientes === 1 ? 'cliente' : 'clientes'}`,
  ];
  if (unidades > 0) partes.push(`· ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`);

  // La confianza va en la MISMA frase que la cifra, no como un adorno aparte:
  // un total sin su nivel de corroboración es exactamente lo que este producto
  // existe para no dar.
  const confianza: string[] = [];
  if (conQuorum) confianza.push(`${conQuorum} con quórum`);
  if (sinQuorum) confianza.push(`${sinQuorum} en disputa`);
  const cola = confianza.length ? ` — ${confianza.join(', ')}.` : '.';

  // `filtro` llega como `unknown` desde el despachador: se normaliza acá en
  // vez de castear en el llamador.
  const filtroObj: Record<string, unknown> =
    typeof filtro === 'object' && filtro !== null ? filtro as Record<string, unknown> : {};
  const claves = Object.entries(filtroObj)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
    .map(([k, v]) => `${k}: ${String(v)}`);
  const filtroTexto = claves.length ? ` Filtro aplicado — ${claves.join(', ')}.` : '';

  return `${partes.join(' ')}${cola}${filtroTexto}`;
}

/* ═══════════════ Paquete de contexto de /api/consultar (tope) ═══════════════ */

/**
 * ★ Hallazgo A-7: el prompt de `/api/consultar` no tenía tope.
 *
 * Se armaba UN bloque por grupo, cada uno con hasta 2000 caracteres de texto
 * de peer (el tope que aplica `sanear()` en `context/spotlight.ts`), contra un
 * modelo cargado con `ctx_size: 4096` y `parallel: 2` — o sea ~2048 tokens de
 * ventana REAL por request. Con los 16 grupos del seed ya estaba al límite;
 * con 30 el prompt desborda, el modelo deja de emitir el tool call, y la falla
 * se ve como «el modelo no produjo ningún filtro»: un mensaje que apunta al
 * modelo cuando la causa es de contexto. Ese diagnóstico equivocado es peor
 * que el bug.
 *
 * El presupuesto, en tokens de la ventana de 2048:
 *   300  respuesta (`maxTokens`)
 *  ~250  esquemas de las dos tools
 *  ~140  system prompt + preámbulo de spotlighting
 *  ~300  la pregunta del usuario (hasta 1000 chars por `zConsultarBody`)
 *  ─────
 *  ~1050 tokens ≈ 3000 caracteres de español para el paquete de datos.
 *
 * De ahí salen los tres topes. El recorte va DE ESTE LADO y no en
 * `context/spotlight.ts`: ese módulo es núcleo compartido con `apps/mobile` y
 * su trabajo es la frontera de confianza, no el presupuesto de ventana del
 * llamador — que es distinto en cada app y en cada modelo.
 */
export const MAX_BLOQUES_CONSULTA = 10;
export const MAX_CHARS_PAQUETE = 3000;
/** Tope por bloque, para que un solo grupo con notas largas de peer no se
 *  coma el paquete entero y deje a los otros 15 afuera. */
export const MAX_CHARS_BLOQUE = 400;

/**
 * Qué grupo entra primero cuando no entran todos.
 *
 * Informativo = le dice algo al modelo sobre cómo traducir la pregunta a un
 * filtro. Los `Sin quórum` van primero porque son el caso que este producto
 * existe para mostrar; los `Quórum` después, porque son la verdad corroborada.
 * Los `Sin datos` no entran nunca: un grupo del que no se sabe nada no aporta
 * una sola señal al filtro, solo gasta ventana (RD-0).
 */
function prioridadConsulta(estado: string): number {
  switch (estado) {
    case 'Sin quórum': return 0;
    case 'Quórum':     return 1;
    case 'Reportado':  return 2;
    case 'Estimado':   return 3;
    default:           return 9;   // 'Sin datos' — se filtra antes de llegar acá
  }
}

/**
 * Arma el paquete de contexto no confiable de `/api/consultar`, acotado.
 *
 * Devuelve además cuántos grupos entraron y cuántos quedaron fuera: ese
 * número tiene que llegar al prompt. Un modelo que ve 10 de 30 grupos y no
 * sabe que son 10 de 30 cree que está viendo el universo, y desde ahí puede
 * responder de memoria en vez de emitir el filtro — que es exactamente lo que
 * la pantalla le promete al usuario que NO pasa.
 */
export function armarPaqueteConsulta(
  grupos: GrupoEquipo[],
  obs: Observacion[],
): { paquete: string; incluidos: number; omitidos: number } {
  // ★ Todo lo de origen peer entra con spotlighting: delimitador aleatorio
  //   por request, `fuente` y texto saneados (bug #8) en spotlight.ts.
  const idsPeer = new Set(obs.filter((o) => o.origen === 'peer').map((o) => o.id));

  // El índice original se lleva a mano para que el orden sea ESTABLE entre
  // grupos de la misma prioridad: dos requests con los mismos datos tienen que
  // mandarle al modelo exactamente el mismo paquete, o los reportes de
  // "a veces contesta y a veces no" son imposibles de reproducir.
  const candidatos = grupos
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.estadoGeneral !== 'Sin datos')
    .sort((a, b) =>
      prioridadConsulta(a.g.estadoGeneral) - prioridadConsulta(b.g.estadoGeneral) || a.i - b.i);

  const bloques: Array<{ fuente: string; texto: string }> = [];
  let chars = 0;

  for (const { g } of candidatos) {
    if (bloques.length >= MAX_BLOQUES_CONSULTA) break;

    const estructura = [
      g.cliente.nombre,
      g.cliente.pais ?? '?',
      String(g.campos.modalidad.valor ?? '?'),
      `total=${g.campos.totalUnidades.valor ?? '?'}`,
      `edades=${g.cohortes.map((x) => x.edad).join('/')}`,
      `estado=${g.estadoGeneral}`,
    ].join(' | ');

    const notasPeer = obs
      .filter((o) => idsPeer.has(o.id) && g.observacionesIds.includes(o.id))
      .map((o) => o.notas ?? '').filter(Boolean).join(' ');

    // La parte estructurada NUNCA se recorta (es la que el filtro necesita);
    // lo que se recorta es la prosa de peer, y se marca con '…' para que el
    // modelo sepa que está viendo un fragmento y no el texto completo.
    const sobra = Math.max(0, MAX_CHARS_BLOQUE - estructura.length - 1);
    const notasCortadas = notasPeer.length > sobra ? notasPeer.slice(0, sobra) + '…' : notasPeer;
    const texto = notasCortadas ? `${estructura} ${notasCortadas}` : estructura;

    const bloque = {
      fuente: g.campos.modalidad.observadores.join(','),
      texto,
    };
    const costo = bloque.fuente.length + bloque.texto.length;
    // Se corta acá y no se sigue buscando uno más chico: la lista está
    // ordenada por informatividad, así que "seguir" sería meter datos menos
    // útiles a costa de los que se acaban de dejar afuera.
    if (chars + costo > MAX_CHARS_PAQUETE) break;

    chars += costo;
    bloques.push(bloque);
  }

  return {
    paquete: empaquetarUntrusted(bloques),
    incluidos: bloques.length,
    omitidos: grupos.length - bloques.length,
  };
}

async function despacharToolCall(
  llamada: { name: string; arguments: unknown },
  c: SecurityContext,
  grupos: GrupoEquipo[],
  obs: Observacion[],
): Promise<ResultadoToolCall> {
  try {
    switch (llamada.name) {
      case 'filtrar_base_instalada': {
        const resultados = await filtrar(llamada.arguments, c, 'modelo', grupos);
        // Se devuelve el filtro YA VALIDADO, no los `arguments` crudos del
        // modelo: la UI rotula esa línea como "filtro determinista ejecutado
        // por el código", y mostrar claves inventadas que el ejecutor
        // descartó sería mentirle al usuario sobre qué corrió de verdad.
        const parseado = zFiltro.safeParse(llamada.arguments);
        return { atendida: true, filtro: parseado.success ? parseado.data : {}, resultados };
      }
      case 'exportar_dataset': {
        // El ataque aterriza acá: el modelo pide exfiltrar. `origen: 'modelo'`
        // + riskLevel crítico ⇒ `intencion-originada-en-modelo` deniega.
        await exportarDataset(llamada.arguments, c, 'modelo', obs);
        return { atendida: true };
      }
      default: {
        const a: ActionRequest = {
          tool: llamada.name,
          args: typeof llamada.arguments === 'object' && llamada.arguments !== null
            ? (llamada.arguments as Record<string, unknown>)
            : { valor: llamada.arguments },
          riskLevel: 'high',
          origenArgumentos: 'modelo',
        };
        await aplicar(a, c, async () => undefined);
        // Inalcanzable con las políticas actuales (deny-by-default), pero si
        // alguien agrega una regla `allow` para una tool sin implementación,
        // esto lo hace visible en vez de fallar en silencio.
        return { atendida: false, invalido: { tool: llamada.name, motivo: 'TOOL_SIN_IMPLEMENTACION' } };
      }
    }
  } catch (e) {
    if (e instanceof PolicyDenied) {
      emitir('policy-denied', {
        tool: llamada.name, policyId: e.policyId, version: e.version,
        reason: e.message, traceId: c.traceId,
      });
      return {
        atendida: true,
        bloqueado: { tool: llamada.name, policyId: e.policyId, reason: e.message },
      };
    }
    if (e instanceof ZodError) {
      // Corrección #5: argumentos malformados del modelo no son un 500.
      await registrarAuditoria({
        traceId: c.traceId, accion: 'tool:argumentos-invalidos',
        detalle: { tool: llamada.name, issues: e.issues.length },
      });
      return { atendida: false, invalido: { tool: llamada.name, motivo: 'ARGUMENTOS_INVALIDOS' } };
    }
    throw e;
  }
}

/* ═══════════════════════════ Rutas ═══════════════════════════ */

/**
 * ★ Guarda de `Host` — hallazgo A-1, primera cosa que corre en cada request.
 *
 * Acepta el nombre con o sin puerto, porque el navegador manda las dos formas
 * según cómo se escribió la URL: `http://127.0.0.1:3000/` → `127.0.0.1:3000`,
 * `http://localhost:3000/` → `localhost:3000`, y un `http://localhost/` en
 * puerto 80 → `localhost` a secas. El puerto no se verifica (ver
 * `HOSTS_ACEPTADOS`).
 *
 * IPv6 llega entre corchetes (`[::1]:3000`), que es lo que obliga a partir por
 * el ÚLTIMO `:` y no por el primero.
 */
function hostAceptado(host: string | undefined): boolean {
  // HTTP/1.1 exige `Host`. Sin él la request no es de un navegador legítimo,
  // y adivinar cuál quiso decir es exactamente el hueco que se está cerrando.
  if (!host) return false;

  const v = host.trim().toLowerCase();
  const corte = v.lastIndexOf(':');

  // Solo se recorta el puerto si el `:` está DESPUÉS del `]` de un literal
  // IPv6; en `[::1]` sin puerto el último `:` cae adentro de la dirección.
  if (corte > v.lastIndexOf(']')) {
    // ★ Lo que sigue al `:` tiene que ser SOLO dígitos. Sin esta verificación
    // `localhost:3000@evil.com` pasa la guarda: el último `:` está en el
    // índice 9, así que el "nombre" queda en `localhost` y el resto se
    // descarta como si fuera el puerto. El valor del puerto no importa (ver
    // `HOSTS_ACEPTADOS`), pero su FORMA sí: es lo que garantiza que lo que
    // quedó a la izquierda sea el host completo y no un prefijo.
    if (!/^\d+$/.test(v.slice(corte + 1))) return false;
    return HOSTS_ACEPTADOS.has(v.slice(0, corte));
  }

  return HOSTS_ACEPTADOS.has(v);
}

async function enrutar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  /* ── ★ Guarda de `Host`: antes de los estáticos y antes de cualquier API ──
   *  Va acá arriba y no dentro de cada handler porque una guarda que hay que
   *  acordarse de repetir es una guarda que se pierde en el próximo endpoint.
   *
   *  421 (Misdirected Request) y no 403: el significado literal del código es
   *  «esta request llegó a un servidor que no atiende esa autoridad», que es
   *  exactamente el caso. Sin cuerpo con detalle — a una página atacante no se
   *  le explica nada. */
  if (!hostAceptado(req.headers.host)) {
    res.writeHead(421, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': NO_STORE });
    res.end('Host no autorizado. QUÓRUM solo atiende 127.0.0.1 / localhost.\n');
    return;
  }

  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const metodo = req.method ?? 'GET';
  const ruta = url.pathname;

  /* ── Hallazgo A-3 · `no-store` para TODA respuesta de API ──
   *  Se fija acá con `setHeader` en vez de repetirlo en cada `writeHead`
   *  porque la mitad de las respuestas de API son `writeHead(405).end()` y
   *  `writeHead(404).end()` a secas: un 405 también revela que el endpoint
   *  existe, y de todos modos un header de caché que hay que acordarse de
   *  poner en 15 lugares se olvida en el dieciseisavo. `writeHead(code, {…})`
   *  respeta lo ya seteado y le gana en caso de conflicto, así que el
   *  `cache-control` explícito de `json()` y del CSV sigue mandando. */
  if (ruta.startsWith('/api')) res.setHeader('cache-control', NO_STORE);

  /* ── UI estática ── */
  if ((metodo === 'GET' || metodo === 'HEAD') && !ruta.startsWith('/api')) {
    await servirEstatico(res, ruta);
    return;
  }

  /* ── SSE: eventos en vivo (cambio de datos, policy-denied) ── */
  if (ruta === '/api/stream') {
    if (metodo !== 'GET') { res.writeHead(405).end(); return; }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      // Hallazgo A-3: `no-store` y no `no-cache` — el segundo permite guardar
      // y solo obliga a revalidar, y acá viajan cambios sobre datos de cliente.
      'cache-control': NO_STORE,
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(':ok\n\n');
    clientesSSE.add(res);
    req.on('close', () => { clientesSSE.delete(res); });
    return;
  }

  /* ── Proyección de la base instalada (reconciliación determinista) ── */
  if (ruta === '/api/base-instalada') {
    if (metodo !== 'GET') { res.writeHead(405).end(); return; }
    const obs = await cargar();
    json(res, 200, proyeccion(obs, reconciliar(obs)));
    return;
  }

  /* ── H-04 · Transcripción LOCAL (whisper.cpp on-device) ──
   *  Nunca la Web Speech API del navegador: manda el audio al servidor del
   *  proveedor, y eso es inferencia en la nube. */
  if (ruta === '/api/transcribir') {
    if (metodo !== 'POST') { res.writeHead(405).end(); return; }
    const audio = await cuerpoCrudo(req, MAX_AUDIO);
    if (!audio.length) { json(res, 400, { error: 'AUDIO_VACIO', mensaje: 'No llegó audio para transcribir.' }); return; }
    await mkdir(DIR_TMP, { recursive: true });
    const rutaTmp = `${DIR_TMP}/${nuevoId()}.webm`;
    await writeFile(rutaTmp, audio);
    try {
      json(res, 200, { texto: await transcribirLocal(rutaTmp, ASR) });
    } finally {
      // Corrección §menores: el doc maestro deja `data/tmp/*.webm` acumulando
      // audio de visitas a clientes en disco, indefinidamente.
      await unlink(rutaTmp).catch(() => undefined);
    }
    return;
  }

  /* ── H-03 · Captura → BORRADOR. NO PERSISTE NADA. ── */
  if (ruta === '/api/observar') {
    if (metodo !== 'POST') { res.writeHead(405).end(); return; }
    const { texto, visitadoEn, fuente } = await cuerpoJSON(req, zObservarBody);

    // 1) Decisión de ruta ANTES de tocar el modelo: si el texto identifica a
    //    un cliente, la inferencia es local obligatoria (el peer delegado
    //    vería el prompt en claro).
    const decision = decidirRuta(texto);
    const rutaInf = decision.ruta === 'delegable' && PEER
      ? await cargarLLMDelegado(MODELO, PEER).catch(() => cargarLLMLocal(MODELO))
      : await cargarLLMLocal(MODELO);

    // 2) Aserción del plano de control: se le pregunta al SDK dónde corre de
    //    verdad, no se confía en lo que pedimos (fail-closed en gateway.ts).
    await asegurarRuta(rutaInf.modelId, decision);

    // 3) Extracción → borrador en memoria
    const b = await extraerBorrador({
      modelId: rutaInf.modelId,
      texto,
      observadorId: OBSERV,
      dispositivoId: DISPOSIT,
      fuente: fuente ?? 'texto',
      ...(visitadoEn ? { visitadoEn } : {}),
      delegado: rutaInf.delegado,
      ...(rutaInf.modeloSha256 ? { modeloSha256: rutaInf.modeloSha256 } : {}),
    });
    guardarBorrador(b);

    await registrarAuditoria({
      traceId: b.id, accion: 'captura:borrador',
      detalle: {
        lotes: b.observaciones.length, delegado: rutaInf.delegado,
        politica: decision.policyId, estadoRevision: b.estadoRevision,
      },
    });

    json(res, 200, {
      borrador: b,
      inferencia: { delegado: rutaInf.delegado, politica: decision },
    });
    return;
  }

  /* ── ★ H-03 · Confirmación humana: lo ÚNICO que escribe evidencia ── */
  if (ruta === '/api/confirmar') {
    if (metodo !== 'POST') { res.writeHead(405).end(); return; }
    const { borradorId, correcciones, seguimiento } = await cuerpoJSON(req, zConfirmarBody);
    const b = obtenerBorrador(borradorId);
    if (!b) {
      json(res, 404, {
        error: 'BORRADOR_EXPIRADO',
        mensaje: 'El borrador ya no existe (expiró o se descartó). Volvé a interpretar la nota.',
      });
      return;
    }

    // Corrección #14: el humano puede CORREGIR, no solo aceptar o descartar.
    // Corrección #9 + #13: se valida cada observación contra el contrato antes
    // de escribir, y una que no pase degrada SOLO a sí misma — no tira el
    // lote entero ni deja pasar una línea corrupta al JSONL.
    const validas: Observacion[] = [];
    const descartadas: Array<{ id: string; issues: number }> = [];

    /**
     * ★ Hallazgo A-6: a quién le corresponde el `seguimiento`.
     *
     * `qvac/extract.ts` genera la pregunta con `siguientePregunta(out[0]!)` —
     * o sea que la pregunta es SOBRE la primera observación del borrador, y la
     * respuesta del usuario es evidencia de esa observación y de ninguna otra.
     * Antes se copiaba en TODAS, y el resultado salía en el CSV de 19 columnas
     * —el entregable que el cliente importa— como la misma pregunta y la misma
     * respuesta repetidas en N filas de equipos distintos: evidencia
     * fabricada, que es el pecado exacto que este producto existe para no
     * cometer.
     *
     * El índice 0 se nombra explícitamente en vez de dejarlo implícito en el
     * orden del `for`: el acoplamiento con `extract.ts` es real y tiene que
     * ser legible: si allá cambia de cuál lote se pregunta, acá hay que
     * cambiarlo también, y este comentario es el único aviso.
     */
    const IDX_DE_LA_PREGUNTA = 0;
    const idDeLaPregunta = b.observaciones[IDX_DE_LA_PREGUNTA]?.id;

    b.observaciones.forEach((o, i) => {
      const correccion = correcciones?.[o.id];
      const candidato = {
        ...o,
        ...(correccion ? { lote: { ...o.lote, ...correccion } } : {}),
        // H-09 — solo en el lote sobre el que se preguntó.
        ...(seguimiento && i === IDX_DE_LA_PREGUNTA ? { seguimiento } : {}),
      };
      const r = zObservacion.safeParse(candidato);
      if (r.success) validas.push(r.data);
      else descartadas.push({ id: o.id, issues: r.error.issues.length });
    });

    const n = validas.length ? await agregar(validas) : 0;
    descartarBorrador(borradorId);

    /**
     * ★ Hallazgo A-5 — la nota que queda con una pregunta sin responder.
     *
     * Regla dura: máximo UNA pregunta de seguimiento por nota, y responderla
     * es OPCIONAL — si el usuario no contesta, la nota se guarda igual y queda
     * `pendiente-de-revision`. Nunca se descarta (descartarla sería un DoS por
     * fricción: castigar al colaborador por no saber un dato).
     *
     * `/api/observar` ya calculaba ese estado y `/api/confirmar` lo tiraba:
     * `Observacion` —el contrato congelado, idéntico byte a byte con
     * `apps/mobile`— no tiene campo para él, así que al persistir la
     * distinción se perdía. Los lotes de equipo sobrevivían; la pregunta
     * abierta, no. La interfaz se lo promete al usuario por escrito.
     *
     * No se resuelve agregando el campo al contrato (se toca solo si cambia el
     * doc maestro, y habría que replicarlo en las dos apps). Se resuelve como
     * ya lo resolvió la app móvil: un store aparte con el borrador entero
     * (`store/pendientes.ts`, contraparte de
     * `apps/mobile/src/app/pendientes-store.ts`). Que el servidor no tuviera
     * nada equivalente era drift real: la misma regla dura cumplida en el
     * teléfono e incumplida en el escritorio.
     *
     * El estado se recalcula ACÁ y no se reusa `b.estadoRevision`: ese lo fijó
     * la extracción, cuando todavía no se sabía si el usuario iba a contestar.
     * Si contestó, la nota ya no está pendiente de nada. Mismo criterio que
     * `ConfirmacionBorrador.tsx` en móvil.
     */
    const respondio = (seguimiento?.length ?? 0) > 0;
    const preguntaSinResponder = b.siguientePregunta !== null && !respondio;
    const estadoAlConfirmar: EstadoRevision =
      preguntaSinResponder ? 'pendiente-de-revision' : 'confirmada';

    // Se encola el borrador con las observaciones YA VALIDADAS y corregidas
    // por el humano, no las crudas del modelo: si mañana alguien retoma este
    // pendiente, tiene que ver lo que el usuario confirmó, no lo que el
    // modelo había propuesto.
    let pendienteEncolado: boolean | undefined;
    if (preguntaSinResponder) {
      pendienteEncolado = await agregarPendiente({
        ...b,
        observaciones: validas,
        estadoRevision: estadoAlConfirmar,
      });
    }

    await registrarAuditoria({
      traceId: b.id, accion: 'captura:confirmada',
      detalle: {
        persistidas: n, descartadas: descartadas.length,
        corregidas: correcciones ? Object.keys(correcciones).length : 0,
        confirmadoPor: OBSERV,
        // Los dos estados, no uno: el que fijó la extracción y el que quedó
        // al confirmar. Difieren justo cuando el usuario SÍ respondió la
        // pregunta, y esa transición es la que explica por qué la nota no
        // terminó en la cola de pendientes.
        estadoRevision: estadoAlConfirmar,
        estadoAlExtraer: b.estadoRevision,
        // Si hubo pregunta y si el usuario la respondió. Las dos cosas, porque
        // «pendiente y respondida» y «pendiente y nunca respondida» son
        // situaciones distintas.
        huboPregunta: b.siguientePregunta !== null,
        respondioSeguimiento: respondio,
        preguntaSinResponder,
        // Si la nota quedó pendiente, si se pudo encolar de verdad.
        // `agregarPendiente` es mejor esfuerzo (no hace fallar una
        // confirmación ya ocurrida por un fallo de disco), así que un `false`
        // acá es la ÚNICA huella de que ese pendiente se perdió — y la cadena
        // de auditoría es append-only y encadenada por hash.
        ...(pendienteEncolado === undefined ? {} : { pendienteEncolado }),
        // El lote al que se le atribuyó la respuesta (hallazgo A-6): sin esto,
        // el CSV muestra el seguimiento en una fila y no hay forma de verificar
        // que sea la fila correcta.
        ...(seguimiento?.length && idDeLaPregunta ? { seguimientoEn: idDeLaPregunta } : {}),
      },
    });
    if (n > 0) emitir('cambio', { nuevas: n });
    // `estadoRevision` y `pendiente` viajan en la respuesta para que la
    // pantalla pueda decirle al usuario lo que la regla dura promete: la nota
    // se guardó, la pregunta quedó abierta, y no se descartó nada. Campos
    // agregados, no reemplazados: la UI que solo lee `persistidas` sigue
    // funcionando igual.
    json(res, 200, {
      persistidas: n, descartadas,
      estadoRevision: estadoAlConfirmar,
      ...(preguntaSinResponder
        ? { pendiente: { pregunta: b.siguientePregunta, encolado: pendienteEncolado === true } }
        : {}),
    });
    return;
  }

  if (ruta === '/api/descartar') {
    if (metodo !== 'POST') { res.writeHead(405).end(); return; }
    const { borradorId } = await cuerpoJSON(req, zDescartarBody);
    const descartado = descartarBorrador(borradorId);
    await registrarAuditoria({
      traceId: borradorId, accion: 'captura:descartada', detalle: { descartado },
    });
    json(res, 200, { descartado });
    return;
  }

  /* ── Consulta NL: el agente con la tool peligrosa a mano ── */
  if (ruta === '/api/consultar') {
    if (metodo !== 'POST') { res.writeHead(405).end(); return; }
    const { pregunta } = await cuerpoJSON(req, zConsultarBody);
    const c = ctx('agente-consulta', 'agente');
    const obs = await cargar();
    const grupos = reconciliar(obs);

    // Hallazgo A-7: el contexto va ACOTADO y el prompt dice cuánto quedó
    // fuera. Ver `armarPaqueteConsulta()`.
    const { paquete, incluidos, omitidos } = armarPaqueteConsulta(grupos, obs);

    // El aviso de vista parcial va en NUESTRO texto, fuera del paquete
    // `<dato>`: es una afirmación del sistema sobre el sistema. Meterla
    // adentro la volvería contenido no confiable —indistinguible de algo que
    // un peer haya escrito— y perdería toda su autoridad.
    const alcance = omitidos > 0
      ? `Vista PARCIAL: ${incluidos} de ${grupos.length} grupos de equipo (primero los ` +
        `que están en disputa y los que tienen quórum). ${omitidos} quedaron fuera por ` +
        `límite de contexto. No supongas que ves el universo completo y no intentes ` +
        `contar: el filtro lo ejecuta el código sobre los ${grupos.length} grupos.\n\n`
      : '';

    const rutaInf = await cargarLLMLocal(MODELO);
    const { texto, toolCalls } = await completar({
      modelId: rutaInf.modelId,
      history: [
        { role: 'system', content:
          'Traduce la pregunta del usuario a un filtro llamando a filtrar_base_instalada. ' +
          'No cuentes ni inventes cifras: el sistema ejecuta el filtro.' },
        { role: 'user', content: `${alcance}${paquete}\n\nPregunta: ${pregunta}` },
      ],
      /*
       * ★ Se le ofrecen LAS DOS tools, y `exportar_dataset` a proposito.
       *
       * Antes iba solo `TOOL_FILTRAR`, y con tool calling nativo un modelo no
       * puede nombrar una tool que no se le ofrecio. Consecuencia: la
       * inyeccion que viene en el texto de un peer no tenia forma de
       * intentar el export, el `case 'exportar_dataset'` de
       * `despacharToolCall` era codigo inalcanzable en vivo, y el momento que
       * el proyecto quiere mostrarle al jurado — el modelo lo intenta, el
       * CODIGO lo detiene — no se podia reproducir.
       *
       * Ofrecerla no abre un agujero: es lo que prueba que la defensa existe.
       * El PEP recibe la llamada con `origenArgumentos: 'modelo'` y
       * `riskLevel: 'critical'`, la deniega, y eso queda en la auditoria y
       * viaja por SSE hasta la banda roja de la UI. La unica via de export que
       * pasa es la del humano, con sus tres campos explicitos (correccion #1).
       */
      tools: [TOOL_FILTRAR, TOOL_EXPORTAR], maxTokens: 300,
    });

    const invalidas: Array<{ tool: string; motivo: string }> = [];
    for (const t of toolCalls) {
      const r = await despacharToolCall(t, c, grupos, obs);
      if (r.invalido) invalidas.push(r.invalido);
      if (!r.atendida) continue;
      if (r.bloqueado) { json(res, 200, { respuesta: texto, bloqueado: r.bloqueado }); return; }
      if (r.resultados) {
        // `texto` viene vacío cuando el modelo emitió un tool call — es el
        // comportamiento normal del tool calling, no un fallo. La respuesta se
        // COMPONE con código sobre los resultados reales del filtro, que es
        // además lo que la pantalla promete al usuario: «el modelo local
        // traduce la pregunta a un filtro. No cuenta ni estima: el filtro lo
        // ejecuta el código». Pedirle la frase al modelo seria dejarlo contar.
        json(res, 200, {
          filtro: r.filtro,
          resultados: r.resultados,
          respuesta: resumirResultados(r.resultados, r.filtro),
        });
        return;
      }
    }
    json(res, 200, { respuesta: texto, ...(invalidas.length ? { invalidas } : {}) });
    return;
  }

  /* ── H-11 · Export humano ──
   *  Los tres campos que la excepción `export-local-por-humano` exige, y que
   *  el doc maestro no cumplía (corrección #1): agente `ui-humano`, origen
   *  `usuario`, destino `local`. `exportarDataset` valida DESPUÉS del PEP. */
  if (ruta === '/api/exportar') {
    if (metodo !== 'POST') { res.writeHead(405).end(); return; }
    const obs = await cargar();
    const r = await exportarDataset({ destino: 'local' }, ctx('ui-humano', 'humano'), 'usuario', obs);
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="quorum-base-instalada.csv"',
      'x-content-type-options': 'nosniff',
      // Hallazgo A-3, y acá es lo que más importa de los tres: este cuerpo es
      // la cartera entera de clientes en CSV. No queda copia en ningún caché.
      'cache-control': NO_STORE,
    });
    res.end(r.csv);
    return;
  }

  /* ── Auditoría: cadena de hash + integridad del store ── */
  if (ruta === '/api/auditoria') {
    if (metodo !== 'GET') { res.writeHead(405).end(); return; }
    const registros = (await readFile('data/audit.jsonl', 'utf8').catch(() => ''))
      .trim().split('\n').filter(Boolean).slice(-50)
      .map((l) => { try { return JSON.parse(l) as unknown; } catch { return { corrupta: l.slice(0, 200) }; } });
    // El orden importa y por eso va en dos líneas y no dentro del literal:
    // `verificarArchivo()` relee el archivo de disco y refresca la medición
    // que `lineasDescartadas()` reporta. Al revés, la respuesta traería una
    // verificación del instante al lado de un conteo del arranque —los dos
    // presentados como si fueran lo mismo—, que era el bug.
    const observaciones = await verificarArchivo();
    // Corrección #9: la pérdida por líneas corruptas no puede ser invisible.
    // Ahora viaja con `medidoEn`/`origen`, para que se sepa qué se está viendo.
    const descartadas = lineasDescartadas();

    json(res, 200, {
      integridad: await verificarCadena(),
      observaciones,
      lineasDescartadas: descartadas,
      // Notas guardadas con una pregunta de seguimiento sin responder
      // (`store/pendientes.ts`). Es trabajo pendiente, no una falla: la regla
      // dura dice que esas notas se guardan igual y no se descartan. Va acá
      // porque es el otro dato de integridad del store — lo que el sistema
      // sabe que le falta preguntar.
      pendientesDeRevision: await contarPendientes(),
      registros,
    });
    return;
  }

  res.writeHead(404).end();
}

/* ═══════════════════════════ Servidor ═══════════════════════════ */

export function crearServidor(): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void enrutar(req, res).catch(async (e: unknown) => {
      if (res.headersSent) { res.end(); return; }

      if (e instanceof PolicyDenied) {
        // Un `deny` que llega hasta acá (no a través del dispatcher de tool
        // calls) igual se hace visible en la UI.
        emitir('policy-denied', {
          tool: 'desconocida', policyId: e.policyId, version: e.version, reason: e.message,
        });
        json(res, 403, { error: e.code, mensaje: e.message, policyId: e.policyId });
        return;
      }
      if (e instanceof ZodError) {
        json(res, 400, { error: 'VALIDATION_ERROR', issues: e.issues });
        return;
      }
      if (e instanceof QuorumError) {
        const codigo = e.code === 'CUERPO_DEMASIADO_GRANDE' ? 413
          : e.code === 'VALIDATION_ERROR' || e.code === 'JSON_INVALIDO' ? 400
          : e.code === 'DELEGATION_VIOLATION' ? 409 : 500;
        json(res, codigo, { error: e.code, mensaje: e.message, detalle: e.detalle });
        return;
      }
      const err = e as Error;
      // Se registra completo en la auditoría local; al cliente va el mensaje,
      // nunca el stack.
      await registrarAuditoria({
        traceId: nuevoId(), accion: 'error:no-manejado',
        detalle: { mensaje: err?.message ?? String(e) },
      }).catch(() => undefined);
      json(res, 500, { error: 'ERROR', mensaje: err?.message ?? 'Error interno' });
    });
  });
}

export async function iniciar(): Promise<{ cerrar: () => Promise<void> }> {
  const server = crearServidor();

  await new Promise<void>((cumplir, fallar) => {
    server.once('error', fallar);
    // ★ 127.0.0.1, no 0.0.0.0.
    server.listen(PUERTO, HOST, () => { server.off('error', fallar); cumplir(); });
  });
  console.log(`QUÓRUM en http://${HOST}:${PUERTO}`);

  const bootstrap = process.env['BOOTSTRAP']?.split(',').map((s) => {
    const [host, port] = s.trim().split(':');
    return { host: host ?? '127.0.0.1', port: Number(port) };
  });

  // Corrección #6: la allowlist es explícita y va SIEMPRE. Vacía = ningún peer
  // entra. El sync es opcional: si Hyperswarm no arranca (sin red en la sala
  // de demo), el servidor local sigue funcionando.
  let sync: SyncHandle | null = null;
  if (!PEERS_AUTORIZADOS.length) {
    console.warn('sync P2P apagado: QUORUM_PEERS vacío (deny-by-default en el transporte).');
  } else {
    try {
      sync = await iniciarSync({
        allowlist: PEERS_AUTORIZADOS,
        ...(bootstrap ? { bootstrap } : {}),
        onCambio: (n) => emitir('cambio', { nuevas: n }),
      });
      console.log(`sync P2P activo · ${PEERS_AUTORIZADOS.length} peer(s) en allowlist`);
    } catch (e) {
      console.warn(`sync P2P no disponible: ${(e as Error).message}`);
    }
  }

  const cerrar = async (): Promise<void> => {
    for (const c of clientesSSE) c.end();
    clientesSSE.clear();
    await sync?.destruir().catch(() => undefined);
    await new Promise<void>((r) => server.close(() => r()));
  };

  let cerrando = false;
  const apagar = (): void => {
    if (cerrando) return;
    cerrando = true;
    void cerrar().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);

  return { cerrar };
}

/** Solo arranca si este archivo es el entrypoint — así los tests pueden
 *  importar `crearServidor()` sin abrir un puerto. */
const argv1 = process.argv[1];
if (argv1 && pathToFileURL(argv1).href === import.meta.url) {
  await iniciar();
}
