/* Verifica el fix: reasoning_budget 0 apaga el modo thinking de Qwen3. */
import * as qvacSdk from '@qvac/sdk';
import { cargarLLMLocal } from './src/qvac/gateway.ts';
const { completion } = qvacSdk as unknown as { completion: (o: unknown) => Promise<unknown> };

const MODELO = (qvacSdk as Record<string, unknown>)['QWEN3_1_7B_INST_Q4'] as Record<string, unknown>;
const ruta = await cargarLLMLocal(MODELO);
console.log('modelo cargado');

const TOOL = { type: 'function', name: 'extraer',
  description: 'Extrae el cliente y los lotes de equipos medicos de la nota.',
  parameters: { type: 'object', properties: {
    cliente: { type: 'string', description: 'Nombre del cliente.' },
    lotes: { type: 'array', description: 'Un objeto por lote con claves: modalidad, cantidad, marca, edadAnios, evidencia (cita literal).' },
  }, required: ['cliente', 'lotes'] } };

const NOTA = 'Estoy en Hospital DemoCare Pacific en Panama. Tienen dos MR NovaMed de siete anios y un CT HelixCare nuevo.';

const r = await completion({
  modelId: ruta.modelId,
  history: [
    { role: 'system', content: 'Extraes equipos medicos de notas de campo. Usa la herramienta. Cada lote necesita evidencia: el fragmento literal de la nota.' },
    { role: 'user', content: NOTA },
  ],
  tools: [TOOL],
  // ★ reasoning_budget 0 apaga el <think> de Qwen3.
  generationParams: { temp: 0, seed: 42, predict: 512, reasoning_budget: 0 },
}) as { toolCalls?: unknown[]; texto?: string };

console.log('\ntoolCalls:', JSON.stringify(r.toolCalls, null, 1));
console.log('\ntexto:', String(r.texto ?? '').slice(0, 300));
