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
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z, ZodError } from 'zod';

import { cargar, agregar, lineasDescartadas, verificarArchivo } from './store/observations.ts';
import { guardarBorrador, obtenerBorrador, descartarBorrador } from './store/drafts.ts';
import { reconciliar } from './trust/reconcile.ts';
import { candidatosFusion } from './trust/entity.ts';
import { verificarCadena, registrarAuditoria } from './store/audit.ts';
import * as qvacSdk from '@qvac/sdk';
import { cargarLLMLocal, cargarLLMDelegado, completar, transcribirLocal } from './qvac/gateway.ts';
import { extraerBorrador } from './qvac/extract.ts';
import { decidirRuta, asegurarRuta } from './qvac/delegation.ts';
import { empaquetarUntrusted } from './context/spotlight.ts';
import { TOOL_FILTRAR, filtrar, zFiltro } from './tools/filtrar.ts';
import { exportarDataset } from './tools/exportar.ts';
import { aplicar } from './policy/pep.ts';
import { PolicyDenied, QuorumError } from './core/errors.ts';
import { nuevoId } from './core/ids.ts';
import { iniciarSync, type SyncHandle } from './sync/peer.ts';
import {
  MODALIDADES, zRangoEdad, zObservacion,
  type ActionRequest, type GrupoEquipo, type Observacion, type SecurityContext,
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
const PUERTO   = Number(process.env['QUORUM_PUERTO'] ?? 3000);

/** ★ NUNCA '0.0.0.0'. No se lee de env a propósito: un env var es exactamente
 *  la forma en que este invariante se pierde sin que nadie lo note. */
const HOST = '127.0.0.1';

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

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    // La UI es local y no usa recursos externos: sin esto un XSS en la UI
    // (corrección #7) tiene salida a la red; con esto, no.
    'x-content-type-options': 'nosniff',
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
  res.writeHead(200, { 'content-type': mime, 'x-content-type-options': 'nosniff' });
  res.end(contenido);
}

/* ═══════════════════════════ Proyección ═══════════════════════════ */

function proyeccion(obs: Observacion[], grupos: GrupoEquipo[]): Record<string, unknown> {
  const sumarPor = (clave: (g: GrupoEquipo) => string): Array<[string, number]> =>
    Object.entries(grupos.reduce<Record<string, number>>((acc, g) => {
      const k = clave(g);
      acc[k] = (acc[k] ?? 0) + (g.campos.totalUnidades.valor ?? 0);
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]);

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

async function enrutar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const metodo = req.method ?? 'GET';
  const ruta = url.pathname;

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
      'cache-control': 'no-cache',
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

    for (const o of b.observaciones) {
      const correccion = correcciones?.[o.id];
      const candidato = {
        ...o,
        ...(correccion ? { lote: { ...o.lote, ...correccion } } : {}),
        ...(seguimiento ? { seguimiento } : {}),          // H-09
      };
      const r = zObservacion.safeParse(candidato);
      if (r.success) validas.push(r.data);
      else descartadas.push({ id: o.id, issues: r.error.issues.length });
    }

    const n = validas.length ? await agregar(validas) : 0;
    descartarBorrador(borradorId);

    await registrarAuditoria({
      traceId: b.id, accion: 'captura:confirmada',
      detalle: {
        persistidas: n, descartadas: descartadas.length,
        corregidas: correcciones ? Object.keys(correcciones).length : 0,
        confirmadoPor: OBSERV,
      },
    });
    if (n > 0) emitir('cambio', { nuevas: n });
    json(res, 200, { persistidas: n, descartadas });
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

    // ★ Todo lo de origen peer entra con spotlighting: delimitador aleatorio
    //   por request, `fuente` y texto saneados (bug #8) en spotlight.ts.
    const idsPeer = new Set(obs.filter((o) => o.origen === 'peer').map((o) => o.id));
    const bloques = grupos.map((g) => ({
      fuente: g.campos.modalidad.observadores.join(','),
      texto: [
        g.cliente.nombre,
        g.cliente.pais ?? '?',
        String(g.campos.modalidad.valor ?? '?'),
        `total=${g.campos.totalUnidades.valor ?? '?'}`,
        `edades=${g.cohortes.map((x) => x.edad).join('/')}`,
        `estado=${g.estadoGeneral}`,
      ].join(' | ') + ' ' + obs
        .filter((o) => idsPeer.has(o.id) && g.observacionesIds.includes(o.id))
        .map((o) => o.notas ?? '').filter(Boolean).join(' '),
    }));

    const rutaInf = await cargarLLMLocal(MODELO);
    const { texto, toolCalls } = await completar({
      modelId: rutaInf.modelId,
      history: [
        { role: 'system', content:
          'Traduce la pregunta del usuario a un filtro llamando a filtrar_base_instalada. ' +
          'No cuentes ni inventes cifras: el sistema ejecuta el filtro.' },
        { role: 'user', content: `${empaquetarUntrusted(bloques)}\n\nPregunta: ${pregunta}` },
      ],
      tools: [TOOL_FILTRAR], maxTokens: 300,
    });

    const invalidas: Array<{ tool: string; motivo: string }> = [];
    for (const t of toolCalls) {
      const r = await despacharToolCall(t, c, grupos, obs);
      if (r.invalido) invalidas.push(r.invalido);
      if (!r.atendida) continue;
      if (r.bloqueado) { json(res, 200, { respuesta: texto, bloqueado: r.bloqueado }); return; }
      if (r.resultados) {
        json(res, 200, { filtro: r.filtro, resultados: r.resultados, respuesta: texto });
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
    json(res, 200, {
      integridad: await verificarCadena(),
      observaciones: await verificarArchivo(),
      // Corrección #9: la pérdida por líneas corruptas no puede ser invisible.
      lineasDescartadas: lineasDescartadas(),
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
