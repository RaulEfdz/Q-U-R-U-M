// servidor.test.ts — hallazgos de auditoría del servidor HTTP local.
//
// Cubre lo que se puede probar SIN modelo: la guarda de `Host` (DNS
// rebinding), los headers de seguridad de la UI, el `cache-control` de las
// APIs, el contrato de salida de `proyeccion()` y el recorte del paquete de
// contexto de `/api/consultar`.
//
// ★ Puerto EFÍMERO (`listen(0)`), nunca el 3000: el usuario tiene su servidor
//   corriendo ahí y un test no le tumba la demo.
// ★ Solo se leen endpoints de LECTURA. Nada acá escribe en `data/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  crearServidor, proyeccion, armarPaqueteConsulta, resumirResultados,
  MAX_BLOQUES_CONSULTA, MAX_CHARS_PAQUETE,
} from '../src/index.ts';
import type { CampoResuelto, EstadoCampo, GrupoEquipo, Modalidad } from '../src/core/contracts.ts';

/* ═══════════════════════════ Andamiaje ═══════════════════════════ */

interface Respuesta {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  cuerpo: string;
}

/**
 * Se usa `node:http` crudo y no `fetch`: `Host` es un header prohibido para
 * `fetch`, que lo descarta en silencio — o sea que con `fetch` el test del
 * rebinding pasaría siempre, midiendo nada.
 */
function pedir(
  puerto: number,
  opts: { ruta: string; metodo?: string; host?: string; origen?: string; contentType?: string; cuerpo?: string },
): Promise<Respuesta> {
  return new Promise((cumplir, fallar) => {
    const req = request({
      host: '127.0.0.1',
      port: puerto,
      path: opts.ruta,
      method: opts.metodo ?? 'GET',
      headers: {
        ...(opts.host ? { host: opts.host } : {}),
        ...(opts.origen ? { origin: opts.origen } : {}),
        ...(opts.contentType ? { 'content-type': opts.contentType } : {}),
      },
    }, (res) => {
      let cuerpo = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { cuerpo += c; });
      res.on('end', () => cumplir({ status: res.statusCode ?? 0, headers: res.headers, cuerpo }));
    });
    req.on('error', fallar);
    req.end(opts.cuerpo);
  });
}

async function levantar(): Promise<{ puerto: number; cerrar: () => Promise<void> }> {
  const server = crearServidor();
  await new Promise<void>((r) => { server.listen(0, '127.0.0.1', () => r()); });
  const puerto = (server.address() as AddressInfo).port;
  return { puerto, cerrar: () => new Promise<void>((r) => { server.close(() => r()); }) };
}

/* ═══════════════ Hallazgo A-1 · guarda de Host (DNS rebinding) ═══════════════ */

test('servidor.test: A-1 un Host ajeno se rechaza con 421, en API y en estáticos', async () => {
  const s = await levantar();
  try {
    // Este es el ataque literal: una página en `evil.example.com` cuyo dominio
    // resuelve a 127.0.0.1. Para el navegador es mismo-origen; el `Host` es lo
    // único que lo delata.
    for (const ruta of ['/api/base-instalada', '/', '/app.js', '/api/exportar']) {
      const r = await pedir(s.puerto, { ruta, host: 'evil.example.com' });
      assert.strictEqual(r.status, 421, `${ruta} con Host ajeno tiene que dar 421`);
    }
  } finally {
    await s.cerrar();
  }
});

test('servidor.test: A-1 la guarda corre ANTES de todo — ni sirve archivos ni filtra por método', async () => {
  const s = await levantar();
  try {
    // POST a un endpoint que solo acepta GET: si la respuesta fuera 405, la
    // guarda estaría corriendo después del enrutado.
    const r = await pedir(s.puerto, { ruta: '/api/base-instalada', metodo: 'POST', host: 'evil.example.com' });
    assert.strictEqual(r.status, 421);

    // Y no se filtra contenido en el cuerpo del rechazo.
    assert(!r.cuerpo.includes('{'), 'el rechazo no devuelve JSON de datos');
  } finally {
    await s.cerrar();
  }
});

test('servidor.test: A-1 los hosts de loopback legítimos siguen entrando, con y sin puerto', async () => {
  const s = await levantar();
  try {
    // Las formas reales que manda un navegador según cómo se escribió la URL.
    const legitimos = [
      `127.0.0.1:${s.puerto}`,
      `localhost:${s.puerto}`,
      `[::1]:${s.puerto}`,
      '127.0.0.1',
      'localhost',
      '[::1]',
      'LOCALHOST',            // el header no es sensible a mayúsculas
      `  localhost:${s.puerto}  `,
    ];
    for (const host of legitimos) {
      const r = await pedir(s.puerto, { ruta: '/api/base-instalada', host });
      assert.notStrictEqual(r.status, 421, `Host legítimo rechazado: "${host}"`);
      assert.strictEqual(r.status, 200, `Host legítimo debería servir: "${host}"`);
    }
  } finally {
    await s.cerrar();
  }
});

test('servidor.test: A-1 un host que apenas se parece a loopback NO pasa', async () => {
  const s = await levantar();
  try {
    const impostores = [
      'localhost.evil.com',        // sufijo
      'evil.localhost',            // subdominio de localhost
      'notlocalhost',
      '127.0.0.1.evil.com',
      '127.0.0.2',                 // loopback pero no el nuestro
      '0.0.0.0',
      '[::1].evil.com',
      'localhost:3000@evil.com',
    ];
    for (const host of impostores) {
      const r = await pedir(s.puerto, { ruta: '/api/base-instalada', host });
      assert.strictEqual(r.status, 421, `debería rechazar "${host}"`);
    }
  } finally {
    await s.cerrar();
  }
});

/* ═══════════════ Hallazgo A-2 · CSP y anti-framing ═══════════════ */

test('servidor.test: A-2 el documento HTML trae CSP restrictiva y anti-framing', async () => {
  const s = await levantar();
  try {
    const r = await pedir(s.puerto, { ruta: '/', host: `127.0.0.1:${s.puerto}` });
    assert.strictEqual(r.status, 200);
    assert.match(String(r.headers['content-type']), /text\/html/);

    const csp = String(r.headers['content-security-policy'] ?? '');
    for (const directiva of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",     // el favicon de index.html es un data URI
      "connect-src 'self'",       // fetch + EventSource de /api/stream
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ]) {
      assert(csp.includes(directiva), `falta la directiva: ${directiva}`);
    }

    // ★ La CSP no vale nada si se afloja: la app carga módulos ES y estilos en
    // archivo aparte, así que 'self' alcanza. Si alguien agrega
    // 'unsafe-inline' o 'unsafe-eval' para tapar un problema de la UI, este
    // test tiene que ponerse rojo.
    assert(!csp.includes('unsafe-inline'), 'la CSP no debe llevar unsafe-inline');
    assert(!csp.includes('unsafe-eval'), 'la CSP no debe llevar unsafe-eval');
    assert(!csp.includes('*'), 'la CSP no debe llevar comodines');

    assert.strictEqual(r.headers['x-frame-options'], 'DENY');
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  } finally {
    await s.cerrar();
  }
});

test('servidor.test: A-2 los estáticos que no son documento siguen siendo cacheables', async () => {
  const s = await levantar();
  try {
    const r = await pedir(s.puerto, { ruta: '/style.css', host: `127.0.0.1:${s.puerto}` });
    assert.strictEqual(r.status, 200);
    // La CSP acota el CONTEXTO DE EJECUCIÓN, y eso lo define el documento; en
    // una hoja de estilos es ruido.
    assert.strictEqual(r.headers['content-security-policy'], undefined);
    // Y el `no-store` de las APIs no debe haberse derramado a los estáticos:
    // son el mismo CSS en cada recarga.
    assert.strictEqual(r.headers['cache-control'], undefined);
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  } finally {
    await s.cerrar();
  }
});

/* ═══════════════ Hallazgo A-3 · cache-control en las APIs ═══════════════ */

test('servidor.test: A-3 las respuestas de API van con cache-control: no-store', async () => {
  const s = await levantar();
  try {
    const host = `127.0.0.1:${s.puerto}`;
    // Un 200 con datos, un 404 de ruta inexistente y un 421 de la guarda.
    const casos = [
      await pedir(s.puerto, { ruta: '/api/base-instalada', host }),
      await pedir(s.puerto, { ruta: '/api/no-existe', host }),
      await pedir(s.puerto, { ruta: '/api/base-instalada', host: 'evil.example.com' }),
    ];
    for (const r of casos) {
      assert.strictEqual(r.headers['cache-control'], 'no-store',
        `respuesta ${r.status} sin no-store`);
    }
  } finally {
    await s.cerrar();
  }
});

test('servidor.test: mutaciones rechazan Origin externo y cuerpos no JSON', async () => {
  const s = await levantar();
  try {
    const comun = {
      ruta: '/api/descartar', metodo: 'POST', host: `127.0.0.1:${s.puerto}`,
      cuerpo: JSON.stringify({ borradorId: 'borrador-inexistente' }),
    };
    const externo = await pedir(s.puerto, {
      ...comun, origen: 'https://atacante.example', contentType: 'text/plain',
    });
    assert.strictEqual(externo.status, 403, 'un navegador externo no puede disparar una mutación local');

    const sinOrigen = await pedir(s.puerto, { ...comun, contentType: 'application/json' });
    assert.strictEqual(sinOrigen.status, 403, 'la ausencia de Origin tampoco autoriza una mutación');

    const tipoIncorrecto = await pedir(s.puerto, {
      ...comun, origen: `http://127.0.0.1:${s.puerto}`, contentType: 'text/plain',
    });
    assert.strictEqual(tipoIncorrecto.status, 415, 'text/plain no se interpreta como JSON de una acción');

    const local = await pedir(s.puerto, {
      ...comun, origen: `http://127.0.0.1:${s.puerto}`, contentType: 'application/json',
    });
    assert.strictEqual(local.status, 200, 'la interfaz local sigue pudiendo descartar');
  } finally {
    await s.cerrar();
  }
});

/* ═══════════════ Hallazgo A-4 · unidades en disputa en Panorama ═══════════════ */

function campo<T>(estado: EstadoCampo, valor?: T): CampoResuelto<T> {
  return {
    estado,
    ...(valor !== undefined ? { valor } : {}),
    observadores: ['obs-1'],
    ultimaVisita: new Date().toISOString(),
    fresco: true,
  };
}

function grupo(over: {
  clave: string; pais?: string; modalidad?: Modalidad;
  unidades?: number; estadoUnidades: EstadoCampo;
}): GrupoEquipo {
  return {
    clave: over.clave,
    cliente: { nombre: `Hospital ${over.clave}`, ciudad: 'Panamá', ...(over.pais ? { pais: over.pais } : {}) },
    campos: {
      modalidad: campo<Modalidad>('Quórum', over.modalidad ?? 'MR'),
      marca: campo<string>('Quórum', 'NovaMed'),
      modelo: campo<string>('Reportado', 'Model-X'),
      totalUnidades: campo<number>(over.estadoUnidades, over.unidades),
      edad: campo<number>('Reportado', 5),
    },
    cohortes: [],
    estadoGeneral: over.estadoUnidades,
    puntaje: { total: 20, completitud: 8, frescura: 6, corroboracion: 6 },
    observacionesIds: [],
    oportunidadRenovacion: false,
  };
}

test('servidor.test: A-4 un grupo en disputa NO aporta cero unidades en silencio', () => {
  const grupos: GrupoEquipo[] = [
    grupo({ clave: 'a', pais: 'PA', unidades: 4, estadoUnidades: 'Quórum' }),
    grupo({ clave: 'b', pais: 'PA', estadoUnidades: 'Sin quórum' }),   // valor undefined (RD-2)
    grupo({ clave: 'c', pais: 'BR', unidades: 7, estadoUnidades: 'Reportado' }),
  ];
  const p = proyeccion([], grupos);
  const porPais = p['porPais'] as Array<[string, number, number]>;

  const pa = porPais.find(([k]) => k === 'PA');
  const br = porPais.find(([k]) => k === 'BR');
  assert(pa && br);

  // El total NO inventa un número para el campo en disputa…
  assert.strictEqual(pa[1], 4, 'solo suma las unidades corroboradas');
  // …y tampoco finge que el grupo en disputa son cero unidades: lo declara.
  assert.strictEqual(pa[2], 1, 'PA tiene un grupo fuera de la suma por disputa');
  assert.strictEqual(br[2], 0, 'BR no tiene disputas');

  const totales = p['totales'] as Record<string, number>;
  assert.strictEqual(totales['gruposConUnidadesEnDisputa'], 1);
});

test('servidor.test: A-4 el par sigue siendo [clave, total] — la UI vieja no se rompe', () => {
  const grupos = [
    grupo({ clave: 'a', pais: 'PA', unidades: 2, estadoUnidades: 'Quórum' }),
    grupo({ clave: 'b', pais: 'BR', unidades: 9, estadoUnidades: 'Quórum' }),
  ];
  const porPais = proyeccion([], grupos)['porPais'] as Array<[string, number, number]>;

  // `barras()` de ui/panorama.js hace `([k, v]) => …` y `Number(v)`: el cambio
  // es aditivo, el segundo elemento sigue siendo el total numérico.
  for (const fila of porPais) {
    assert.strictEqual(typeof fila[0], 'string');
    assert.strictEqual(typeof fila[1], 'number');
    assert.strictEqual(typeof fila[2], 'number');
  }
  // Y sigue ordenado por total descendente.
  assert.deepStrictEqual(porPais.map(([k]) => k), ['BR', 'PA']);
});

test('servidor.test: A-4 `Sin datos` no es lo mismo que `Sin quórum`', () => {
  // RD-0: el dato ausente no se rellena, y tampoco es una disputa. Son dos
  // ausencias distintas y la UI las tiene que poder distinguir.
  const grupos = [grupo({ clave: 'a', pais: 'PA', estadoUnidades: 'Sin datos' })];
  const p = proyeccion([], grupos);
  const pa = (p['porPais'] as Array<[string, number, number]>)[0]!;

  assert.strictEqual(pa[1], 0);
  assert.strictEqual(pa[2], 0, 'sin datos no cuenta como disputa');
  assert.strictEqual((p['totales'] as Record<string, number>)['gruposConUnidadesEnDisputa'], 0);
});

test('servidor.test: consulta declara cantidades no resolubles, no las presenta como cero', () => {
  const salida = resumirResultados([
    grupo({ clave: 'a', unidades: 4, estadoUnidades: 'Quórum' }),
    grupo({ clave: 'b', estadoUnidades: 'Sin quórum' }),
  ], {});
  assert.match(salida, /4 unidades conocidas/);
  assert.match(salida, /1 grupo sin cantidad resoluble/);
  assert.doesNotMatch(salida, /· 4 unidades —/);
});

/* ═══════════════ Hallazgo A-7 · recorte del paquete de /api/consultar ═══════════════ */

function muchosGrupos(n: number, estado: EstadoCampo): GrupoEquipo[] {
  return Array.from({ length: n }, (_, i) =>
    grupo({ clave: `g${i}`, pais: 'PA', unidades: 3, estadoUnidades: estado }));
}

test('servidor.test: A-7 el paquete respeta el tope de bloques y de tamaño', () => {
  // 40 grupos: con el código anterior el prompt desbordaba el ctx_size de 4096
  // (~2048 tokens reales por request con parallel:2) y el modelo dejaba de
  // emitir el tool call.
  const grupos = muchosGrupos(40, 'Quórum');
  const { paquete, incluidos, omitidos } = armarPaqueteConsulta(grupos, []);

  assert(incluidos <= MAX_BLOQUES_CONSULTA, `${incluidos} bloques supera el tope`);
  assert.strictEqual(incluidos + omitidos, grupos.length, 'incluidos + omitidos = universo');
  assert(omitidos > 0, 'con 40 grupos algo tiene que quedar afuera');

  // El paquete lleva además el preámbulo de spotlighting; el tope acota los
  // DATOS, así que se mide con holgura para el preámbulo.
  assert(paquete.length < MAX_CHARS_PAQUETE + 800, `paquete de ${paquete.length} chars`);
});

test('servidor.test: A-7 se priorizan los grupos en disputa y con quórum; `Sin datos` no entra', () => {
  const grupos: GrupoEquipo[] = [
    ...muchosGrupos(20, 'Sin datos').map((g, i) => ({ ...g, clave: `vacio${i}` })),
    grupo({ clave: 'DISPUTADO', pais: 'PA', estadoUnidades: 'Sin quórum' }),
    grupo({ clave: 'CORROBORADO', pais: 'BR', unidades: 5, estadoUnidades: 'Quórum' }),
  ];
  const { paquete, incluidos } = armarPaqueteConsulta(grupos, []);

  assert(paquete.includes('Hospital DISPUTADO'), 'el grupo en disputa entra');
  assert(paquete.includes('Hospital CORROBORADO'), 'el grupo con quórum entra');
  assert(!paquete.includes('Hospital vacio'), '`Sin datos` no aporta señal al filtro');
  assert.strictEqual(incluidos, 2);

  // El de disputa va PRIMERO: es el caso que este producto existe para mostrar.
  assert(paquete.indexOf('Hospital DISPUTADO') < paquete.indexOf('Hospital CORROBORADO'));
});

test('servidor.test: A-7 un solo grupo con notas de peer enormes no se come el paquete', () => {
  // Sin tope por bloque, `sanear()` de spotlight recorta a 2000 chars y un
  // único grupo hablador dejaba a los demás afuera.
  const idPeer = '0000000001';
  const conNotas = {
    ...grupo({ clave: 'HABLADOR', pais: 'PA', unidades: 1, estadoUnidades: 'Quórum' }),
    observacionesIds: [idPeer],
  };
  const obsPeer = [{ id: idPeer, origen: 'peer', notas: 'x'.repeat(5000) }] as never;

  const grupos = [conNotas, ...muchosGrupos(9, 'Quórum')];
  const { paquete, incluidos } = armarPaqueteConsulta(grupos, obsPeer);

  assert.strictEqual(incluidos, 10, 'los diez bloques entran igual');
  assert(paquete.includes('…'), 'la prosa de peer se recorta y se marca como recortada');
  assert(!paquete.includes('x'.repeat(2000)), 'no entran 2000 chars de un solo peer');
});

test('servidor.test: A-7 con pocos grupos no se omite nada', () => {
  const grupos = muchosGrupos(3, 'Quórum');
  const { incluidos, omitidos } = armarPaqueteConsulta(grupos, []);
  assert.strictEqual(incluidos, 3);
  assert.strictEqual(omitidos, 0);
});

test('servidor.test: A-7 el paquete es ESTABLE entre llamadas con los mismos datos', () => {
  // Salvo la marca aleatoria del spotlighting, dos requests con los mismos
  // datos tienen que mandar el mismo paquete: si no, un "a veces contesta y a
  // veces no" es imposible de reproducir.
  const grupos = muchosGrupos(30, 'Quórum');
  const sinMarca = (s: string): string => s.replace(/[0-9a-f]{12}/g, 'MARCA');

  const a = armarPaqueteConsulta(grupos, []);
  const b = armarPaqueteConsulta(grupos, []);
  assert.strictEqual(sinMarca(a.paquete), sinMarca(b.paquete));
  assert.strictEqual(a.incluidos, b.incluidos);
});
