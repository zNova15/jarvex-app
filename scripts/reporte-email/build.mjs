// ═══════════════════════════════════════════════════════════════════
// JARVEX — Corrida horaria de los reportes por email (GitHub Actions).
//
// Lee reportes_email_config (una fila por tipo: diario/semanal/mensual),
// decide qué reportes tocan AHORA (hora Lima + día configurado + catch-up),
// construye el HTML (builder.mjs) y lo deja en reportes_email_outbox.
// n8n toma lo 'pendiente' y lo envía por Gmail; acá NO se envía nada.
//
// Env: VITE_SUPABASE_URL (o SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
// FORCE_TIPO=diario|semanal|mensual fuerza un tipo (para probar a mano).
// ═══════════════════════════════════════════════════════════════════
import { partesLima, debeEnviarse } from '../../src/lib/reporte-email-programacion.js';
import { clientePg, buildReporte } from './builder.mjs';

const URL_SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !KEY) { console.error('Faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const pg = clientePg(URL_SB, KEY);
const ahora = partesLima(new Date());
const force = (process.env.FORCE_TIPO || '').trim().toLowerCase();

const main = async () => {
  const cfgs = await pg.all('reportes_email_config?select=*');
  console.log(`[reporte-email] ${ahora.fecha} ${String(ahora.hora).padStart(2, '0')}:xx Lima · ${cfgs.length} config(s)${force ? ` · FORCE_TIPO=${force}` : ''}`);
  let generados = 0;
  for (const cfg of cfgs) {
    const tipo = cfg.tipo || 'diario';
    const due = force ? tipo === force : debeEnviarse(cfg, ahora);
    if (!due) { console.log(`  · ${tipo}: no toca (activo=${cfg.activo}, hora=${cfg.hora_envio}, ultimo=${cfg.ultimo_envio ?? '—'})`); continue; }
    try {
      console.log(`  · ${tipo}: construyendo…`);
      const { subject, html } = await buildReporte({ pg, tipo, hoy: ahora.fecha });
      await pg.post('reportes_email_outbox', {
        tipo, subject, html,
        destinatarios: cfg.destinatarios || [],
      });
      // Marca de envío del día (aunque n8n tarde unos minutos en despachar):
      // evita duplicados si la Action corre de nuevo dentro del mismo día.
      if (!force) await pg.patch(`reportes_email_config?id=eq.${cfg.id}`, { ultimo_envio: ahora.fecha, updated_at: new Date().toISOString() });
      console.log(`  · ${tipo}: ✔ en outbox (${(cfg.destinatarios || []).length} destinatario(s), ${Math.round(html.length / 1024)} KB)`);
      generados++;
    } catch (e) {
      console.error(`  · ${tipo}: ✖ ${e.message || e}`);
      process.exitCode = 1;
    }
  }
  console.log(`[reporte-email] listo: ${generados} reporte(s) generado(s).`);
};

main().catch((e) => { console.error('[reporte-email] fatal:', e.message || e); process.exit(1); });
