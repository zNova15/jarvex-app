// ═══════════════════════════════════════════════════════════════════
// JARVEX — Despacho del outbox de reportes por email (GitHub Actions).
//
// Toma lo 'pendiente' de reportes_email_outbox y lo envía por Gmail SMTP
// (smtp.mjs) — SIN n8n. Reglas:
//   · Sin GMAIL_USER/GMAIL_APP_PASSWORD configurados: no hace nada (sale 0)
//     — otro canal (p. ej. n8n) puede seguir consumiendo el outbox.
//   · Un pendiente con más de 24h se marca 'error' (vencido): nadie quiere
//     recibir hoy el reporte "diario" de antier.
//   · Si el envío falla, el registro QUEDA pendiente y se reintenta en la
//     corrida siguiente (hasta vencer a las 24h). El run sale con error
//     para que se vea en rojo en Actions.
//
// Env: VITE_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
//      GMAIL_USER + GMAIL_APP_PASSWORD (contraseña de aplicación).
// ═══════════════════════════════════════════════════════════════════
import { clientePg } from './builder.mjs';
import { enviarGmail } from './smtp.mjs';

const URL_SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GUSER = (process.env.GMAIL_USER || '').trim();
const GPASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); // Gmail la muestra con espacios

if (!URL_SB || !KEY) { console.error('[send] Faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!GUSER || !GPASS) {
  console.log('[send] GMAIL_USER / GMAIL_APP_PASSWORD no configurados — envío omitido (el outbox queda para n8n u otro canal).');
  process.exit(0);
}

const pg = clientePg(URL_SB, KEY);
const MAX_EDAD_H = 24;

const main = async () => {
  const pendientes = await pg.all('reportes_email_outbox?estado=eq.pendiente&select=id,tipo,subject,destinatarios,html,created_at&order=created_at.asc');
  console.log(`[send] ${pendientes.length} correo(s) pendiente(s) en el outbox.`);
  for (const p of pendientes) {
    const edadH = (Date.now() - Date.parse(p.created_at)) / 3.6e6;
    if (edadH > MAX_EDAD_H) {
      await pg.patch(`reportes_email_outbox?id=eq.${p.id}`, { estado: 'error', error: `vencido: ${Math.round(edadH)}h sin enviarse (límite ${MAX_EDAD_H}h)` });
      console.log(`  · ${p.tipo} (${p.created_at}): vencido (${Math.round(edadH)}h) — marcado como error.`);
      continue;
    }
    if (!Array.isArray(p.destinatarios) || p.destinatarios.length === 0) {
      await pg.patch(`reportes_email_outbox?id=eq.${p.id}`, { estado: 'error', error: 'sin destinatarios' });
      console.log(`  · ${p.tipo}: sin destinatarios — marcado como error.`);
      continue;
    }
    try {
      await enviarGmail({ user: GUSER, pass: GPASS, to: p.destinatarios, subject: p.subject, html: p.html });
      await pg.patch(`reportes_email_outbox?id=eq.${p.id}`, { estado: 'enviado', sent_at: new Date().toISOString() });
      console.log(`  · ${p.tipo}: ✔ enviado a ${p.destinatarios.join(', ')} (${Math.round((p.html || '').length / 1024)} KB)`);
    } catch (e) {
      // Queda 'pendiente': reintenta en la próxima corrida horaria (vence a las 24h).
      console.error(`  · ${p.tipo}: ✖ ${e.message || e} — queda pendiente para reintentar.`);
      process.exitCode = 1;
    }
  }
  console.log('[send] listo.');
};

main().catch((e) => { console.error('[send] fatal:', e.message || e); process.exit(1); });
