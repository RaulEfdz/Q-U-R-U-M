import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { armarObservacion } from './helpers.ts';

const cwdOriginal = process.cwd();

before(async () => { process.chdir(await mkdtemp(join(tmpdir(), 'quorum-stores-'))); });
after(() => { process.chdir(cwdOriginal); });

test('observaciones: carga tolerante conserva válidas, expone corruptas y append es idempotente', async () => {
  const { cargar, agregar, lineasDescartadas, verificarArchivo } = await import('../src/store/observations.ts');
  const buena = armarObservacion({ id: 'store-observacion-001', sesionId: 'store-sesion-001' });
  await (await import('node:fs/promises')).mkdir('data');
  await writeFile('data/observaciones.jsonl', `${JSON.stringify(buena)}\n{rota\n`);

  assert.deepEqual((await cargar()).map((o) => o.id), [buena.id]);
  assert.deepEqual(lineasDescartadas().lineas, [2]);
  assert.equal(await agregar([buena]), 0, 'el mismo id no duplica un testimonio');
  assert.deepEqual(await verificarArchivo(), { ok: false, total: 2, corruptas: [2] });
});

test('auditoría: cadena válida detecta una alteración posterior', async () => {
  const { registrarAuditoria, verificarCadena } = await import('../src/store/audit.ts');
  await registrarAuditoria({ traceId: 'trace-a', accion: 'prueba:a', detalle: {} });
  await registrarAuditoria({ traceId: 'trace-b', accion: 'prueba:b', detalle: {} });
  assert.deepEqual(await verificarCadena(), { ok: true });

  const ruta = 'data/audit.jsonl';
  const contenido = await readFile(ruta, 'utf8');
  await writeFile(ruta, contenido.replace('"prueba:b"', '"alterado"'));
  assert.equal((await verificarCadena()).ok, false);
});

test('borradores: permanecen solo en memoria y se pueden descartar', async () => {
  const { guardarBorrador, obtenerBorrador, descartarBorrador } = await import('../src/store/drafts.ts');
  const b = { id: 'borrador-memoria', sesionId: 'sesion-memoria', observaciones: [], resumen: '', siguientePregunta: null,
    creadoEn: new Date().toISOString(), estadoRevision: 'confirmada' as const };
  guardarBorrador(b);
  assert.equal(obtenerBorrador(b.id)?.id, b.id);
  assert.equal(descartarBorrador(b.id), true);
  assert.equal(obtenerBorrador(b.id), undefined);
  await assert.rejects(readFile('data/borradores.jsonl', 'utf8'));
});
