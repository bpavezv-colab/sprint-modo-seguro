// Servidor local de Sprint: sirve dist/index.html y agrega tres integraciones OPCIONALES.
//   POST /api/alerta      correo a la casilla única de demostración (ALERTA_PARA), solo IDs y conteos
//   POST /api/chat        asistente con IA (API de Claude); sin clave o si falla, responde con reglas
//   POST /api/sugerencia  la IA solo redacta el reparto ya calculado en código y validado aquí
//   GET  /api/estado      qué está activo (IA / correo), sin revelar claves
// Todo se configura en .env (ver .env.example). Sin .env la app funciona completa en modo simulado.
// Uso: npm start  →  http://localhost:3000
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCSV } from './src/csv.js';
import { crearStore } from './src/store.js';
import { evaluarHito, avanceColaborador, NOMBRE_HITO } from './src/rules.js';
import { responder } from './src/asistente.js';
import { contextoPara, SISTEMA_ASISTENTE } from './src/contexto_ia.js';
import { validarPropuestas, textoReparto, SISTEMA_REPARTO, PESO_APOYO } from './src/reparto.js';

const RAIZ = new URL('./', import.meta.url);
const ID_CUENTA = /^(COL|JEF|PER|TI|ADM)-\d{3}$/;
const ID_COL = /^COL-\d{3}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 8000;

export function configDesdeEnv(env = process.env) {
  const puerto = Number.parseInt(env.PORT, 10);
  return {
    port: Number.isInteger(puerto) && puerto > 0 && puerto < 65536 ? puerto : 3000,
    apiKey: (env.ANTHROPIC_API_KEY || '').trim(),
    modelo: (env.IA_MODELO || '').trim() || 'claude-haiku-5-5',
    smtpUser: (env.SMTP_USER || '').trim(),
    smtpPass: (env.SMTP_PASS || '').replace(/\s+/g, ''), // Google muestra la contraseña de aplicación con espacios
    alertaPara: (env.ALERTA_PARA || '').trim(),
  };
}

export function cargarBase(raiz = RAIZ) {
  const leer = p => parseCSV(readFileSync(new URL(p, raiz), 'utf8'));
  return { colaboradores: leer('data/colaboradores.csv'), hitos: leer('data/hitos_onboarding.csv'), usuarios: leer('data/usuarios_roles.csv'), catalogo: leer('data/catalogo_hitos.csv') };
}

// Oculta la casilla al informar el estado a la página: d***@gmail.com
export const enmascarar = correo => { const [u, d] = String(correo).split('@'); return d ? `${u.slice(0, 1)}***@${d}` : '***'; };

async function crearClientes(cfg) {
  let anthropic = null; let mailer = null;
  if (cfg.apiKey) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); anthropic = new Anthropic({ apiKey: cfg.apiKey, timeout: 20000, maxRetries: 1 }); }
  if (cfg.smtpUser && cfg.smtpPass && cfg.alertaPara) {
    const { default: nodemailer } = await import('nodemailer');
    mailer = nodemailer.createTransport({ service: 'gmail', auth: { user: cfg.smtpUser, pass: cfg.smtpPass } });
  }
  return { anthropic, mailer };
}

export function crearServidor({ cfg = configDesdeEnv(), base = cargarBase(), anthropic = null, mailer = null, distDir = new URL('dist/', RAIZ), log = console } = {}) {
  const permitidos = new Set([`localhost:${cfg.port}`, `127.0.0.1:${cfg.port}`]);
  const golpes = new Map(); // límite simple por IP y ruta
  const limite = (clave, max) => { const ahora = Date.now(); const l = (golpes.get(clave) || []).filter(t => ahora - t < 60000); l.push(ahora); golpes.set(clave, l); return l.length > max; };

  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
  async function leerJSON(req) {
    let raw = '';
    for await (const ch of req) { raw += ch; if (raw.length > MAX_BODY) { const e = new Error('grande'); e.code = 413; throw e; } }
    try { const o = JSON.parse(raw || '{}'); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch { /* abajo */ }
    const e = new Error('json'); e.code = 400; throw e;
  }
  // Sesión de la demo armada en el servidor con los mismos permisos de la página (no confía en datos del navegador).
  function sesion(body) {
    if (!ID_CUENTA.test(body.usuario_id || '')) return null;
    const store = crearStore(base, { hoy: ISO.test(body.hoy || '') ? body.hoy : undefined });
    const r = store.login(body.usuario_id, 'servidor');
    return r.ok && store.state.auth.cuentaValida(store.state.user) ? store : null;
  }
  async function preguntarIA(sistema, contenido, maxTokens = 500) {
    const r = await anthropic.messages.create({ model: cfg.modelo, max_tokens: maxTokens, system: sistema, messages: [{ role: 'user', content: contenido }] });
    const texto = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!texto) throw new Error('respuesta vacía');
    return texto.slice(0, 3000);
  }
  const estado = () => ({ ok: true, servidor: true, ia: anthropic ? 'activa' : 'reglas', modelo: anthropic ? cfg.modelo : null,
    correo: mailer && cfg.alertaPara ? 'real' : 'simulado', destino: mailer && cfg.alertaPara ? enmascarar(cfg.alertaPara) : null });

  async function alerta(body, res) {
    const store = sesion(body); const s = store?.state;
    if (!store || !s.auth.esPersonas(s.user)) return json(res, 403, { ok: false, motivo: 'Solo el Equipo de Personas envía alertas por correo.' });
    const colId = body.colaborador_id;
    if (!ID_COL.test(colId || '') || !s.idx.colab.has(colId) || !s.auth.enAlcance(s.user, colId)) return json(res, 400, { ok: false, motivo: 'Colaborador no válido o fuera de tu alcance.' });
    // Los conteos los calcula el servidor; el correo lleva solo IDs y números.
    const hitos = (s.idx.hitosPorColab.get(colId) || []).map(h => ({ h, ev: evaluarHito(h, s.idx, s.hoy) }));
    const venc = hitos.filter(x => x.ev.estadoReal === 'Vencido');
    const av = avanceColaborador(colId, s.idx, s.hoy);
    const porTipo = {}; for (const x of venc) { const t = NOMBRE_HITO[x.h.tipo_hito] || x.h.tipo_hito; porTipo[t] = (porTipo[t] || 0) + 1; }
    const asunto = `[Sprint] Alerta ${colId}: ${venc.length} hitos atrasados`;
    const texto = [
      `Colaborador: ${colId}`,
      `Hitos atrasados: ${venc.length} (prioridad alta: ${av.vencidosAltos})`,
      `Por tipo: ${Object.entries(porTipo).map(([t, n]) => `${t} ${n}`).join(', ') || 'ninguno'}`,
      `Hitos: ${venc.map(x => x.h.hito_id).join(', ') || '—'}`,
      `Sin responsable: ${venc.filter(x => !x.h.responsable_id).length}`,
      `Enviado por: ${s.user.usuario_id} · fecha de corte ${s.hoy}`,
      'Demo con datos sintéticos (Talent Tech Hack 2026). Revisa el detalle en la app.',
    ].join('\n');
    if (!mailer) return json(res, 200, { ok: true, simulado: true, asunto, motivo: 'Correo simulado: falta configurar SMTP_USER, SMTP_PASS y ALERTA_PARA en .env.' });
    try {
      await mailer.sendMail({ from: cfg.smtpUser, to: cfg.alertaPara, subject: asunto, text: texto });
      return json(res, 200, { ok: true, simulado: false, asunto, destino: enmascarar(cfg.alertaPara) });
    } catch (err) {
      log.error('Correo: no se pudo enviar (%s)', err?.code || err?.responseCode || 'error');
      return json(res, 502, { ok: false, motivo: 'No se pudo enviar el correo. Revisa SMTP_USER y SMTP_PASS (contraseña de aplicación) en .env.' });
    }
  }

  async function chat(body, res) {
    const store = sesion(body);
    if (!store) return json(res, 403, { ok: false, motivo: 'Ingresa con una cuenta válida para usar el asistente.' });
    const pregunta = String(body.pregunta || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 500);
    if (!pregunta) return json(res, 400, { ok: false, motivo: 'Escribe una pregunta.' });
    const reglas = () => responder(pregunta, store);
    if (!anthropic) return json(res, 200, { ok: true, fuente: 'reglas', texto: reglas() });
    try {
      const ctx = contextoPara(store);
      const texto = await preguntarIA(SISTEMA_ASISTENTE, `<contexto>\n${JSON.stringify(ctx)}\n</contexto>\n<pregunta>\n${pregunta}\n</pregunta>`);
      return json(res, 200, { ok: true, fuente: 'ia', texto });
    } catch (err) {
      log.error('IA: falló la consulta (%s); se respondió con reglas', err?.status || err?.name || 'error');
      return json(res, 200, { ok: true, fuente: 'reglas', aviso: 'La IA no respondió; esta respuesta viene de las reglas.', texto: reglas() });
    }
  }

  async function sugerencia(body, res) {
    const store = sesion(body); const s = store?.state;
    if (!store || s.user.rol !== 'Jefatura') return json(res, 403, { ok: false, motivo: 'Solo una jefatura puede pedir un reparto.' });
    const v = validarPropuestas(store, body.propuestas);
    if (!v.ok) return json(res, 400, v);
    for (const p of v.propuestas) if (!s.auth.companerosValidos(s.user, p.colaborador_id).includes(p.companero_id)) return json(res, 400, { ok: false, motivo: `${p.companero_id} no puede acompañar a ${p.colaborador_id}.` });
    // Hitos abiertos recalculados aquí con los datos oficiales; la IA recibe solo IDs y números.
    const abiertos = id => (s.idx.hitosPorColab.get(id) || []).filter(h => evaluarHito(h, s.idx, s.hoy).estadoReal !== 'Cumplido').length;
    const calculo = { regla: `carga = hitos abiertos + ${PESO_APOYO} por cada persona que ya acompaña`, propuestas: v.propuestas.map(p => ({ ...p, hitos_abiertos_companero: abiertos(p.companero_id) })) };
    const simple = textoReparto({ propuestas: v.propuestas, pesoApoyo: PESO_APOYO });
    if (!anthropic) return json(res, 200, { ok: true, fuente: 'calculo', texto: simple, propuestas: v.propuestas });
    try {
      const texto = await preguntarIA(SISTEMA_REPARTO, `<calculo>\n${JSON.stringify(calculo)}\n</calculo>`, 400);
      return json(res, 200, { ok: true, fuente: 'ia', texto, propuestas: v.propuestas });
    } catch (err) {
      log.error('IA: falló la sugerencia (%s); se mostró el cálculo simple', err?.status || err?.name || 'error');
      return json(res, 200, { ok: true, fuente: 'calculo', aviso: 'La IA no respondió; se muestra el cálculo simple.', texto: simple, propuestas: v.propuestas });
    }
  }

  const RUTAS = { '/api/alerta': [alerta, 10], '/api/chat': [chat, 20], '/api/sugerencia': [sugerencia, 10] };

  return http.createServer(async (req, res) => {
    try {
      // Solo localhost: evita que otra página o un nombre de dominio falso use el servidor.
      if (!permitidos.has(req.headers.host || '')) return json(res, 421, { ok: false, motivo: `Abre la app en http://localhost:${cfg.port}` });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const archivo = new URL('index.html', distDir);
        if (!existsSync(archivo)) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Falta dist/index.html. Corre "npm run build" y luego "npm start".'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
        return res.end(readFileSync(archivo));
      }
      if (req.method === 'GET' && url.pathname === '/api/estado') return json(res, 200, estado());
      const ruta = RUTAS[url.pathname];
      if (!ruta) return json(res, 404, { ok: false, motivo: 'No encontrado' });
      if (req.method !== 'POST') return json(res, 405, { ok: false, motivo: 'Método no permitido' });
      const origen = req.headers.origin;
      if (origen && !permitidos.has(origen.replace(/^https?:\/\//, ''))) return json(res, 403, { ok: false, motivo: 'Origen no permitido' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { ok: false, motivo: 'Se espera JSON' });
      if (limite(`${req.socket.remoteAddress}|${url.pathname}`, ruta[1])) return json(res, 429, { ok: false, motivo: 'Demasiadas solicitudes. Espera un minuto.' });
      return await ruta[0](await leerJSON(req), res);
    } catch (err) {
      if (err?.code === 413) return json(res, 413, { ok: false, motivo: 'Mensaje demasiado largo' });
      if (err?.code === 400) return json(res, 400, { ok: false, motivo: 'Solicitud no válida' });
      log.error('Error inesperado en el servidor');
      if (!res.headersSent) json(res, 500, { ok: false, motivo: 'Error inesperado. Intenta de nuevo.' });
    }
  });
}

// Solo escucha cuando se ejecuta directo (npm start); los tests importan crearServidor.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [mayor] = process.versions.node.split('.').map(Number);
  if (mayor < 22) console.warn(`Aviso: tienes Node ${process.versions.node}. Usa Node 22 o superior (npm start usa --env-file-if-exists).`);
  const cfg = configDesdeEnv();
  const { anthropic, mailer } = await crearClientes(cfg);
  const srv = crearServidor({ cfg, anthropic, mailer });
  srv.on('error', err => { console.error(err.code === 'EADDRINUSE' ? `El puerto ${cfg.port} está ocupado. Cambia PORT en .env o cierra la otra app.` : 'No se pudo iniciar el servidor.'); process.exit(1); });
  srv.listen(cfg.port, '127.0.0.1', () => {
    console.log(`Sprint en http://localhost:${cfg.port}`);
    console.log(`IA: ${anthropic ? `activa (${cfg.modelo})` : 'sin clave (reglas)'}`);
    console.log(`Correo: ${mailer ? `real a ${cfg.alertaPara}` : 'simulado (falta .env)'}`);
    if (!existsSync(new URL('dist/index.html', RAIZ))) console.log('Falta dist/index.html: corre "npm run build".');
  });
}
