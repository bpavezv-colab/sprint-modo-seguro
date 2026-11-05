// Servidor local opcional (server.mjs): correo, asistente con IA y "Sugerir reparto".
// Se inyectan clientes falsos de correo e IA: los tests nunca usan red ni claves reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { crearServidor, configDesdeEnv, cargarBase, enmascarar } from '../server.mjs';
import { crearStore } from '../src/store.js';
import { contextoPara } from '../src/contexto_ia.js';
import { calcularReparto, validarPropuestas, textoReparto } from '../src/reparto.js';

const base = cargarBase();
const nuevoStore = id => { const st = crearStore(base); assert.equal(st.login(id, 'test').ok, true); return st; };

async function levantar(opts = {}) {
  const cfg = { ...configDesdeEnv({}), ...opts.cfg };
  const errores = [];
  const srv = crearServidor({ cfg, base, anthropic: opts.anthropic || null, mailer: opts.mailer || null, log: { error: (...a) => errores.push(a.join(' ')) } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  cfg.port = port; // el servidor valida el Host contra este puerto
  const srv2 = crearServidor({ cfg, base, anthropic: opts.anthropic || null, mailer: opts.mailer || null, log: { error: (...a) => errores.push(a.join(' ')) } });
  await new Promise(r => srv.close(r));
  await new Promise(r => srv2.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${port}`;
  const post = (ruta, body, headers = {}) => fetch(url + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  return { url, post, errores, cerrar: () => new Promise(r => { srv2.close(r); srv2.closeAllConnections(); }) };
}

const falsoMailer = () => { const enviados = []; return { enviados, sendMail: async m => { enviados.push(m); return { messageId: 'x' }; } }; };
const falsaIA = (texto = 'Respuesta IA', { falla = false } = {}) => {
  const llamadas = [];
  return { llamadas, messages: { create: async p => { llamadas.push(p); if (falla) { const e = new Error('saldo'); e.status = 400; throw e; } return { content: [{ type: 'text', text: texto }] }; } } };
};

test('config: valores por defecto sin .env y la clave nunca se expone en /api/estado', async () => {
  const c = configDesdeEnv({});
  assert.equal(c.port, 3000); assert.equal(c.modelo, 'claude-haiku-5-5'); assert.equal(c.apiKey, '');
  assert.equal(configDesdeEnv({ PORT: 'abc' }).port, 3000);
  assert.equal(configDesdeEnv({ SMTP_PASS: 'abcd efgh ijkl mnop' }).smtpPass, 'abcdefghijklmnop');
  assert.equal(enmascarar('demo.casilla@gmail.com'), 'd***@gmail.com');
  const s = await levantar({ cfg: { apiKey: 'sk-ant-SECRETO', smtpUser: 'a@gmail.com', smtpPass: 'x', alertaPara: 'demo@gmail.com' }, anthropic: falsaIA(), mailer: falsoMailer() });
  const r = await fetch(s.url + '/api/estado'); const txt = await r.text();
  assert.equal(JSON.parse(txt).ia, 'activa'); assert.equal(JSON.parse(txt).correo, 'real');
  assert.ok(!txt.includes('SECRETO') && !txt.includes('demo@gmail.com'), 'ni la clave ni la casilla completa llegan al navegador');
  await s.cerrar();
});

test('seguridad: rechaza Host ajeno, Origin ajeno, cuerpo no JSON y cuerpos grandes', async () => {
  const s = await levantar();
  try {
  // fetch no permite cambiar Host: se usa http.request para simular un nombre de dominio ajeno (DNS rebinding).
  const host = await new Promise((ok, mal) => http.get(s.url + '/api/estado', { headers: { Host: 'evil.example' } }, r => { r.resume(); ok(r.statusCode); }).on('error', mal));
  assert.equal(host, 421);
  assert.equal((await s.post('/api/chat', { usuario_id: 'COL-002', pregunta: 'hola' }, { Origin: 'http://evil.example' })).status, 403);
  const noJson = await fetch(s.url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(noJson.status, 415);
  assert.equal((await s.post('/api/chat', { usuario_id: 'COL-002', pregunta: 'x'.repeat(9000) })).status, 413);
  assert.equal((await fetch(s.url + '/api/chat')).status, 405);
  } finally { await s.cerrar(); }
});

test('correo: sin .env se simula; con SMTP va solo a ALERTA_PARA y solo con IDs y conteos', async () => {
  const sim = await levantar();
  const r0 = await sim.post('/api/alerta', { usuario_id: 'PER-001', colaborador_id: 'COL-002' });
  assert.equal(r0.status, 200); assert.equal(r0.body.simulado, true); assert.match(r0.body.asunto, /COL-002: 4 hitos atrasados/);
  await sim.cerrar();

  const mailer = falsoMailer();
  const s = await levantar({ cfg: { smtpUser: 'envia@gmail.com', smtpPass: 'x', alertaPara: 'demo@gmail.com' }, mailer });
  const r = await s.post('/api/alerta', { usuario_id: 'PER-001', colaborador_id: 'COL-002', para: 'otro@ejemplo.com', accion: 'texto libre' });
  assert.equal(r.status, 200); assert.equal(r.body.simulado, false);
  assert.equal(mailer.enviados.length, 1);
  const m = mailer.enviados[0];
  assert.equal(m.to, 'demo@gmail.com', 'la página no elige destinatario');
  const st = nuevoStore('PER-001'); const nombre = st.state.auth.users.get('COL-002').nombre_ficticio; const canal = st.state.idx.colab.get('COL-002').canal_contacto;
  assert.ok(!m.text.includes(nombre) && !m.subject.includes(nombre), 'sin nombres');
  if (canal) assert.ok(!m.text.includes(canal), 'sin canal de contacto');
  assert.ok(!m.text.includes('texto libre'), 'no copia texto libre de la página');
  assert.match(m.text, /HITO-\d{3}/);
  await s.cerrar();
});

test('correo: solo Personas/Administrador y solo colaboradores válidos', async () => {
  const mailer = falsoMailer();
  const s = await levantar({ cfg: { smtpUser: 'a@gmail.com', smtpPass: 'x', alertaPara: 'demo@gmail.com' }, mailer });
  for (const id of ['COL-002', 'JEF-002', 'TI-004', 'XXX-001', '']) assert.equal((await s.post('/api/alerta', { usuario_id: id, colaborador_id: 'COL-002' })).status, 403, id);
  assert.equal((await s.post('/api/alerta', { usuario_id: 'PER-001', colaborador_id: 'COL-999' })).status, 400);
  assert.equal((await s.post('/api/alerta', { usuario_id: 'PER-001', colaborador_id: 'HITO-001' })).status, 400);
  assert.equal(mailer.enviados.length, 0);
  await s.cerrar();
});

test('correo: si Gmail falla responde un error claro sin datos sensibles', async () => {
  const mailer = { sendMail: async () => { const e = new Error('Invalid login: 535 clave'); e.code = 'EAUTH'; throw e; } };
  const s = await levantar({ cfg: { smtpUser: 'a@gmail.com', smtpPass: 'x', alertaPara: 'demo@gmail.com' }, mailer });
  const r = await s.post('/api/alerta', { usuario_id: 'PER-001', colaborador_id: 'COL-002' });
  assert.equal(r.status, 502); assert.match(r.body.motivo, /contraseña de aplicación/);
  assert.ok(s.errores.every(e => !e.includes('clave')), 'el log no copia el mensaje del proveedor');
  await s.cerrar();
});

test('chat: sin clave responde con reglas; con clave usa la IA con el contexto del rol', async () => {
  const sim = await levantar();
  const r0 = await sim.post('/api/chat', { usuario_id: 'COL-002', pregunta: '¿Qué me falta?' });
  assert.equal(r0.body.fuente, 'reglas'); assert.match(r0.body.texto, /Firma de contrato/);
  await sim.cerrar();

  const ia = falsaIA('Te faltan 4 hitos.');
  const s = await levantar({ cfg: { apiKey: 'k', modelo: 'claude-haiku-5-5' }, anthropic: ia });
  const r = await s.post('/api/chat', { usuario_id: 'COL-002', pregunta: '¿Qué me falta?' });
  assert.equal(r.body.fuente, 'ia'); assert.equal(r.body.texto, 'Te faltan 4 hitos.');
  const p = ia.llamadas[0];
  assert.equal(p.model, 'claude-haiku-5-5');
  const contenido = p.messages[0].content;
  assert.match(contenido, /COL-002/);
  assert.ok(!/COL-001"/.test(contenido) && !contenido.includes('"persona":"COL-003"'), 'un colaborador no recibe datos de otras personas');
  await s.cerrar();
});

test('chat: si la IA falla (sin saldo, error) se responde con reglas', async () => {
  const s = await levantar({ cfg: { apiKey: 'k' }, anthropic: falsaIA('', { falla: true }) });
  const r = await s.post('/api/chat', { usuario_id: 'TI-004', pregunta: '¿Qué casos están vencidos?' });
  assert.equal(r.status, 200); assert.equal(r.body.fuente, 'reglas'); assert.match(r.body.texto, /vencidos/); assert.ok(r.body.aviso);
  await s.cerrar();
});

test('contexto IA: filtrado por permisos y minimizado', () => {
  const ti = contextoPara(nuevoStore('TI-004')); const txt = JSON.stringify(ti);
  assert.ok(!/Contrato|Reunión|Plan de/.test(txt.replace(/"nota":"[^"]*"/, '')), 'TI solo ve Equipo y Acceso');
  const st = nuevoStore('PER-001');
  const nombres = st.state.data.usuarios.map(u => u.nombre_ficticio).filter(Boolean);
  for (const id of ['TI-004', 'JEF-002', 'PER-001']) {
    const c = JSON.stringify(contextoPara(nuevoStore(id)));
    assert.ok(!nombres.some(n => n.length > 3 && c.includes(n)), `${id}: sin nombres en el contexto`);
    assert.ok(!c.includes('canal_contacto') && !c.includes('dispositivo'), `${id}: sin canal ni dispositivo`);
  }
  const sj = nuevoStore('JEF-002'); const jef = contextoPara(sj); const equipo = sj.state.auth.scope(sj.state.user);
  assert.ok(jef.equipo.every(e => equipo.has(e.persona)), 'jefatura: solo su equipo');
  const col = contextoPara(nuevoStore('COL-002'));
  assert.ok(col.mis_hitos.every(h => h.persona === 'COL-002'));
  assert.equal(contextoPara(crearStore(base)), null, 'sin sesión no hay contexto');
});

test('reparto: cálculo en código, solo del equipo y nunca la misma persona', () => {
  const st = nuevoStore('JEF-002'); const equipo = st.state.auth.scope(st.state.user);
  const r = calcularReparto(st);
  assert.ok(r.cargas.length > 0 && r.cargas.every(c => equipo.has(c.persona)));
  assert.ok(r.propuestas.length > 0, 'hay fichas sin compañero/a de apoyo');
  for (const p of r.propuestas) { assert.ok(equipo.has(p.colaborador_id) && equipo.has(p.companero_id)); assert.notEqual(p.colaborador_id, p.companero_id); }
  assert.match(textoReparto(r), /acompaña a/);
  assert.equal(calcularReparto(nuevoStore('PER-001')), null, 'solo jefatura');
  assert.equal(validarPropuestas(st, [{ colaborador_id: r.propuestas[0].colaborador_id, companero_id: 'COL-999' }]).ok, false);
});

test('sugerencia: el servidor valida el equipo, la IA solo redacta y sin clave muestra el cálculo', async () => {
  const st = nuevoStore('JEF-002'); const { propuestas } = calcularReparto(st);
  const otro = st.state.data.colaboradores.find(c => !st.state.auth.enAlcance(st.state.user, c.colaborador_id)).colaborador_id;
  const sim = await levantar();
  const r0 = await sim.post('/api/sugerencia', { usuario_id: 'JEF-002', propuestas });
  assert.equal(r0.body.fuente, 'calculo'); assert.deepEqual(r0.body.propuestas.map(p => p.companero_id), propuestas.map(p => p.companero_id));
  assert.equal((await sim.post('/api/sugerencia', { usuario_id: 'JEF-002', propuestas: [{ colaborador_id: propuestas[0].colaborador_id, companero_id: otro }] })).status, 400, 'persona fuera del equipo');
  assert.equal((await sim.post('/api/sugerencia', { usuario_id: 'JEF-002', propuestas: [{ colaborador_id: propuestas[0].colaborador_id, companero_id: propuestas[0].colaborador_id }] })).status, 400);
  assert.equal((await sim.post('/api/sugerencia', { usuario_id: 'PER-001', propuestas })).status, 403);
  await sim.cerrar();

  const ia = falsaIA('Conviene repartir así.');
  const s = await levantar({ cfg: { apiKey: 'k' }, anthropic: ia });
  const r = await s.post('/api/sugerencia', { usuario_id: 'JEF-002', propuestas });
  assert.equal(r.body.fuente, 'ia'); assert.equal(r.body.texto, 'Conviene repartir así.');
  assert.ok(!/nombre|canal/.test(ia.llamadas[0].messages[0].content), 'la IA recibe solo IDs y números');
  await s.cerrar();
});

test('aplicar reparto: exige confirmación y queda en la bitácora', () => {
  const st = nuevoStore('JEF-002'); const { propuestas } = calcularReparto(st);
  assert.equal(st.aplicarReparto(propuestas).ok, false);
  const r = st.aplicarReparto(propuestas, { confirmado: true });
  assert.equal(r.ok, true); assert.equal(r.aplicadas, propuestas.length);
  assert.equal(st.state.fichas[propuestas[0].colaborador_id].companero_id, propuestas[0].companero_id);
  assert.ok(st.state.bitacora.some(e => e.accion === 'aplicar_sugerencia' && e.resultado === 'ok'));
  assert.equal(calcularReparto(st).propuestas.length, 0, 'tras aplicar no quedan pendientes');
  const per = nuevoStore('PER-001'); assert.equal(per.aplicarReparto(propuestas, { confirmado: true }).ok, false);
});

test('ninguna clave ni correo real en el código ni en dist/', () => {
  const archivos = ['server.mjs', ...readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `src/${f}`),
    ...['dist/index.html', 'dist/artifact.html'].filter(f => existsSync(new URL(`../${f}`, import.meta.url)))];
  for (const f of archivos) {
    const t = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/sk-ant-[A-Za-z0-9_-]{10,}/.test(t), `${f}: sin claves de API`);
    assert.ok(!/[A-Za-z0-9._%+-]+@gmail\.com/.test(t), `${f}: sin casillas de Gmail escritas en el código`);
    if (f.startsWith('dist/')) assert.ok(!/ANTHROPIC_API_KEY|SMTP_PASS|process\.env/.test(t), `${f}: el navegador no recibe configuración del servidor`);
  }
  assert.ok(readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split(/\r?\n/).includes('.env')); // \r?\n: en Windows git deja CRLF
});
