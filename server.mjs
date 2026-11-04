// Servidor local de la demo: sirve dist/index.html y envía alertas por correo (SMTP de Gmail).
// Credenciales solo en .env (no se suben al repo). Sin .env, el envío queda simulado y se informa.
// Uso: npm start  →  http://localhost:3000
import http from 'node:http';
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

const PORT = Number(process.env.PORT || 3000);
const { SMTP_USER, SMTP_PASS, ALERTA_PARA } = process.env;
const transporte = SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: SMTP_USER, pass: SMTP_PASS } })
  : null;
const ID = /^(COL|HITO|JEF|PER|TI|ADM)-\d{3}$/;

function json(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(new URL('./dist/index.html', import.meta.url)));
    }
    if (req.method === 'POST' && req.url === '/api/alerta') {
      let raw = ''; for await (const ch of req) { raw += ch; if (raw.length > 4000) return json(res, 413, { ok: false, motivo: 'Mensaje demasiado largo' }); }
      const a = JSON.parse(raw || '{}');
      // Minimización: solo IDs, conteos y acción. El destinatario lo fija el servidor, no la página.
      if (!ID.test(a.colaborador_id || '') || !ID.test(a.enviado_por || '')) return json(res, 400, { ok: false, motivo: 'Datos de alerta inválidos' });
      const asunto = `[Onboarding] Alerta ${a.colaborador_id}: ${Number(a.atrasados) || 0} hitos atrasados`;
      const texto = [
        `Colaborador: ${a.colaborador_id}`,
        `Hitos atrasados: ${Number(a.atrasados) || 0} (críticos: ${Number(a.criticos) || 0})`,
        `Responsables: ${String(a.responsables || 'Sin dato').slice(0, 200)}`,
        `Acción requerida: ${String(a.accion || 'Revisar y resolver los hitos atrasados').slice(0, 200)}`,
        `Enviado por: ${a.enviado_por} desde la demo (datos sintéticos).`,
      ].join('\n');
      if (!transporte || !ALERTA_PARA) return json(res, 200, { ok: true, simulado: true, asunto, motivo: 'Sin SMTP configurado: el correo no se envió (simulado).' });
      await transporte.sendMail({ from: SMTP_USER, to: ALERTA_PARA, subject: asunto, text: texto });
      return json(res, 200, { ok: true, simulado: false, asunto, para: ALERTA_PARA });
    }
    json(res, 404, { ok: false, motivo: 'No encontrado' });
  } catch (err) {
    console.error('Error:', err.message);
    json(res, 500, { ok: false, motivo: 'No se pudo enviar el correo. Revisa la configuración SMTP.' });
  }
}).listen(PORT, () => console.log(`Demo en http://localhost:${PORT} · correo ${transporte && ALERTA_PARA ? `real a ${ALERTA_PARA}` : 'simulado (falta .env)'}`));
