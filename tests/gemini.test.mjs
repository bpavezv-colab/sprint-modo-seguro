// Adaptador de Gemini: arma la petición correcta, no expone la clave y entrega el texto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clienteGemini, configDesdeEnv } from '../server.mjs';

test('Gemini: usa el encabezado x-goog-api-key, el modelo y devuelve el texto', async () => {
  let pedido;
  const fakeFetch = async (url, opt) => { pedido = { url, opt }; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Hola ' }, { text: 'Camila' }] } }] }) }; };
  const c = clienteGemini('CLAVE-DE-PRUEBA', fakeFetch);
  const r = await c.messages.create({ model: 'gemini-3.8-flash', max_tokens: 300, system: 'sé breve', messages: [{ role: 'user', content: '¿a quién le pregunto?' }] });
  assert.equal(r.content[0].text, 'Hola Camila');
  assert.match(pedido.url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(pedido.opt.headers['x-goog-api-key'], 'CLAVE-DE-PRUEBA');
  assert.ok(!pedido.url.includes('CLAVE'));
  const body = JSON.parse(pedido.opt.body);
  assert.equal(body.systemInstruction.parts[0].text, 'sé breve');
  assert.equal(body.generationConfig.maxOutputTokens, 300);
});

test('Gemini: si todos fallan, el error se propaga para que el servidor use reglas', async () => {
  const c = clienteGemini('X', async () => ({ ok: false, status: 429 }));
  await assert.rejects(() => c.messages.create({ model: 'gemini-3.8-flash', messages: [{ content: 'x' }] }), /429/);
});

test('Gemini: con el modelo saturado (503) usa el de respaldo', async () => {
  const urls = [];
  const c = clienteGemini('X', async url => { urls.push(url); return url.includes('3.8') ? { ok: false, status: 503 } : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) }; });
  const r = await c.messages.create({ model: 'gemini-3.8-flash', messages: [{ content: 'x' }] });
  assert.equal(r.content[0].text, 'ok');
  assert.equal(r.modelo_usado, 'gemini-flash-lite-latest');
  assert.equal(urls.length, 2);
});

test('Gemini: una clave inválida (400/403) no reintenta con otros modelos', async () => {
  let n = 0;
  const c = clienteGemini('X', async () => { n++; return { ok: false, status: 403 }; });
  await assert.rejects(() => c.messages.create({ model: 'gemini-3.8-flash', messages: [{ content: 'x' }] }), /403/);
  assert.equal(n, 1);
});

test('Config: con GEMINI_API_KEY el modelo por defecto es Gemini aunque IA_MODELO diga Claude', () => {
  assert.equal(configDesdeEnv({ GEMINI_API_KEY: 'x', IA_MODELO: 'claude-haiku-5-5' }).modelo, 'gemini-3.5-flash-lite');
  assert.equal(configDesdeEnv({ GEMINI_API_KEY: 'x', IA_MODELO: 'gemini-2.0-flash' }).modelo, 'gemini-2.0-flash');
  assert.equal(configDesdeEnv({}).modelo, 'claude-haiku-5-5');
});
