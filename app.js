/* Secure Send · Abonnements
   Gestion des clients, abonnements, factures mensuelles et rappels WhatsApp.
   Front statique (GitHub Pages) + Supabase (connexion, base de données, règles d'accès RLS). */
'use strict';

const SB_URL = 'https://xpiklpznggsrfsxmittr.supabase.co';
const SB_KEY = 'sb_publishable_OUJkIiz304t-fcwxRDncnA_QjtW0Dyz';
const sb = window.__MOCK_SB__ || window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

/* ---------- constantes ---------- */
const DEFAULTS = {
  business: 'Secure Send Group', prefix: 'SSG', currency: 'HTG',
  payment: 'Paiement par MonCash ou NatCash au numéro : (à compléter)',
  tpl_invoice: 'Bonjour {client} 👋\nVoici votre facture {numero} pour {service} ({periode}).\nMontant : {montant}\nÀ régler avant le {echeance}.\n\n{paiement}\n\nMerci de votre confiance !\n— {entreprise}',
  tpl_reminder: 'Bonjour {client},\nPetit rappel : la facture {numero} pour {service} ({periode}) de {montant} était à régler le {echeance}.\nMerci de faire le paiement dès que possible pour garder votre accès.\n\n{paiement}\n\n— {entreprise}'
};
const SERVICES = ['Netflix', 'Free Fire (diamants)', 'eFootball (coins)', 'Carte cadeau', 'Spotify', 'YouTube Premium', 'Prime Video'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const VIEWS = ['tableau', 'clients', 'abonnements', 'factures', 'reglages'];

/* ---------- état ---------- */
const S = {
  user: null, isAdmin: false, booted: false, loaded: false, loadError: '', recovery: false,
  clients: [], subs: [], invoices: [], settings: { ...DEFAULTS },
  view: 'tableau',
  f: { invMonth: null, invStatus: 'all', subStatus: 'active', clientQ: '' }
};
const $ = (id) => document.getElementById(id);

/* ---------- utilitaires ---------- */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoOf(new Date());
const currentPeriod = () => today().slice(0, 7);
const periodLabel = (p) => p ? `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}` : '';
const addMonths = (p, n) => { let y = Number(p.slice(0, 4)); let m = Number(p.slice(5, 7)) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return `${y}-${pad(m + 1)}`; };
const daysInMonth = (p) => new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0).getDate();
const fmtDate = (s) => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—';
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
function money(a, cur) {
  const n = Number(a) || 0;
  if (cur === 'USD') return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' ') + ' ' + (cur || 'HTG');
}
function sumByCur(list, field, inline) {
  const out = {};
  list.forEach((x) => { const c = x.currency || 'HTG'; out[c] = (out[c] || 0) + (Number(x[field]) || 0); });
  const keys = Object.keys(out);
  if (!keys.length) return money(0, S.settings.currency);
  const parts = keys.map((k) => money(out[k], k));
  return inline ? parts.join(' + ') : parts[0] + (parts[1] ? `<small>+ ${parts.slice(1).join(' + ')}</small>` : '');
}
const digits = (p) => String(p || '').replace(/\D/g, '');
const intlPhone = (p) => { const d = digits(p); return d.length === 8 ? '509' + d : d; };
const fmtPhone = (p) => { const d = digits(p); return d.length === 8 ? `+509 ${d.slice(0, 4)}-${d.slice(4)}` : (p || ''); };
const waLink = (phone, msg) => `https://wa.me/${intlPhone(phone)}?text=${encodeURIComponent(msg)}`;
const clientById = (id) => S.clients.find((c) => c.id === id) || null;
const subById = (id) => S.subs.find((s) => s.id === id) || null;
const invById = (id) => S.invoices.find((i) => i.id === id) || null;
const clientName = (id, fb) => { const c = clientById(id); return c ? c.name : (fb || 'Client supprimé'); };
const isLate = (inv) => inv.status !== 'paid' && inv.due_date && inv.due_date < today();
const byDue = (a, b) => (a.due_date || '') < (b.due_date || '') ? -1 : 1;
const plural = (n, s, p) => `${n} ${n > 1 ? (p || s + 's') : s}`;

function invBadge(inv) {
  if (inv.status === 'paid') return '<span class="badge b-paid">Payée</span>';
  if (isLate(inv)) return '<span class="badge b-late">En retard</span>';
  return '<span class="badge b-unpaid">À payer</span>';
}
function subBadge(s) {
  const m = { active: ['b-active', 'Actif'], paused: ['b-paused', 'En pause'], cancelled: ['b-cancelled', 'Arrêté'] }[s.status] || ['b-active', 'Actif'];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}
function fillTpl(tpl, inv) {
  const st = S.settings;
  const vals = {
    client: clientName(inv.client_id, inv.client_name), service: inv.service, periode: periodLabel(inv.period),
    montant: money(inv.amount, inv.currency), echeance: fmtDate(inv.due_date), numero: inv.number,
    paiement: st.payment || '', entreprise: st.business || ''
  };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}
const messageFor = (inv) => fillTpl(isLate(inv) ? S.settings.tpl_reminder : S.settings.tpl_invoice, inv);

let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function errText(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/fetch|network|Failed to/i.test(m)) return 'Pas de connexion internet. Réessaie.';
  if (/JWT|expired|session/i.test(m)) return 'Session expirée : reconnecte-toi.';
  if (/row-level security|permission/i.test(m)) return "Ce compte n'a pas le droit de faire ça.";
  return m || 'Une erreur est survenue.';
}

/* ---------- données ---------- */
async function loadAll() {
  const [c, a, f, p] = await Promise.all([
    sb.from('ss_clients').select('*'),
    sb.from('ss_abonnements').select('*'),
    sb.from('ss_factures').select('*'),
    sb.from('ss_parametres').select('*').eq('id', 1).maybeSingle()
  ]);
  const err = c.error || a.error || f.error || p.error;
  if (err) { S.loadError = errText(err); return false; }
  S.clients = c.data || []; S.subs = a.data || []; S.invoices = f.data || [];
  S.settings = { ...DEFAULTS, ...(p.data || {}) };
  S.loaded = true; S.loadError = '';
  return true;
}
async function run(fn, okMsg) {
  try {
    const res = await fn();
    if (res && res.error) throw res.error;
    await loadAll(); render();
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(res) : okMsg);
    return true;
  } catch (e) { toast(errText(e)); return false; }
}
const T = (name) => sb.from(name);

const saveClient = (d, id) => {
  const body = { name: d.name.trim(), phone: d.phone.trim(), note: (d.note || '').trim() };
  return run(() => id ? T('ss_clients').update(body).eq('id', id) : T('ss_clients').insert(body), 'Client enregistré.');
};
const deleteClient = (id) => run(() => T('ss_clients').delete().eq('id', id), 'Client supprimé.');
const saveSub = (d, id) => {
  const body = {
    client_id: d.client_id, service: d.service.trim(), price: Number(d.price) || 0, currency: d.currency || 'HTG',
    billing_day: Math.min(31, Math.max(1, Number(d.billing_day) || 1)), start_date: d.start_date || today(),
    status: d.status || 'active', note: (d.note || '').trim()
  };
  return run(() => id ? T('ss_abonnements').update(body).eq('id', id) : T('ss_abonnements').insert(body), 'Abonnement enregistré.');
};
const deleteSub = (id) => run(() => T('ss_abonnements').delete().eq('id', id), 'Abonnement supprimé.');
const setPaid = (id, paid) => run(() => T('ss_factures').update(paid ? { status: 'paid', paid_date: today() } : { status: 'unpaid', paid_date: null }).eq('id', id), paid ? 'Facture marquée payée.' : 'Paiement annulé.');
const deleteInvoice = (id) => run(() => T('ss_factures').delete().eq('id', id), 'Facture supprimée.');
const generate = (p) => run(() => sb.rpc('ss_generer_factures', { p_period: p }), (res) => {
  const n = Number(res && res.data) || 0;
  return n ? `${plural(n, 'facture créée', 'factures créées')} pour ${periodLabel(p)}.` : `Toutes les factures de ${periodLabel(p)} existent déjà.`;
});
const saveSettings = (d) => run(() => T('ss_parametres').update({
  business: d.business.trim() || DEFAULTS.business, prefix: (d.prefix || 'SSG').trim(), currency: d.currency,
  payment: d.payment, tpl_invoice: d.tpl_invoice, tpl_reminder: d.tpl_reminder, updated_at: new Date().toISOString()
}).eq('id', 1), 'Réglages enregistrés.');

function missingFor(p) {
  const last = `${p}-${pad(daysInMonth(p))}`;
  return S.subs.filter((s) => s.status === 'active' && (!s.start_date || s.start_date <= last) && !S.invoices.some((i) => i.abonnement_id === s.id && i.period === p));
}

/* ---------- sauvegarde CSV ---------- */
function csv(rows, cols) {
  const cell = (v) => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.map((c) => c[0]).join(';')].concat(rows.map((r) => cols.map((c) => cell(c[1](r))).join(';'))).join('\r\n');
}
function downloadBlob(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const download = (name, text) => downloadBlob(name, new Blob([text], { type: 'text/csv;charset=utf-8' }));

/* ---------- facture en image et en PDF ---------- */
const BRAND = '#ff8800', INK = '#111111', MUTED = '#6b6b6b', LINE = '#e7e5e4';
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
/* PDF A4 d'une page contenant l'image de la facture (JPEG), sans librairie externe. */
function makePdf(jpeg, iw, ih) {
  const enc = new TextEncoder();
  const PW = 595.28, PH = 841.89, m = 28;
  let w = PW - 2 * m, h = (ih / iw) * w;
  if (h > PH - 2 * m) { h = PH - 2 * m; w = (iw / ih) * h; }
  const x0 = (PW - w) / 2, y0 = PH - m - h;
  const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x0.toFixed(2)} ${y0.toFixed(2)} cm /Im0 Do Q`;
  const parts = [], offsets = [];
  let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (n, body, stream) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  obj(5, `<< /Length ${enc.encode(content).length} >>`, content);
  const xref = len;
  let x = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
function wrapText(ctx, text, maxW) {
  const out = [];
  String(text || '').split('\n').forEach((para) => {
    let line = '';
    para.split(/\s+/).forEach((w) => {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    });
    out.push(line);
  });
  return out;
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
async function invoiceCanvas(inv) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* police par défaut */ }
  const st = S.settings, c = clientById(inv.client_id);
  const W = 1080, P = 72, F = 'Inter, Arial, sans-serif';
  const probe = document.createElement('canvas').getContext('2d'); probe.font = `400 27px ${F}`;
  const paid = inv.status === 'paid';
  const payLines = paid ? [] : wrapText(probe, st.payment || '', W - 2 * P - 48);
  const H = 1010 + payLines.length * 40;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  x.fillStyle = BRAND; x.fillRect(0, 0, W, 14);
  let logoH = 0;
  try { const img = await loadImg('logo.png'); logoH = 118; x.drawImage(img, P - 8, P - 6, (img.width / img.height) * logoH, logoH); } catch (e) { x.fillStyle = INK; x.font = `800 48px ${F}`; x.fillText(st.business || 'Secure Send Group', P, P + 60); logoH = 80; }
  x.textAlign = 'right'; x.fillStyle = INK; x.font = `800 56px ${F}`; x.fillText('FACTURE', W - P, P + 46);
  x.font = `600 27px ${F}`; x.fillText(`N° ${inv.number}`, W - P, P + 90);
  x.fillStyle = MUTED; x.font = `400 24px ${F}`;
  x.fillText(`Émise le ${fmtDate(inv.issue_date)}`, W - P, P + 128); x.fillText(`Échéance ${fmtDate(inv.due_date)}`, W - P, P + 160);
  let y = P + 200;
  x.fillStyle = INK; x.fillRect(P, y, W - 2 * P, 4); y += 62;
  x.textAlign = 'left'; x.fillStyle = MUTED; x.font = `600 22px ${F}`; x.fillText('FACTURÉ À', P, y); y += 46;
  x.fillStyle = INK; x.font = `700 38px ${F}`; x.fillText(clientName(inv.client_id, inv.client_name), P, y); y += 40;
  if (c) { x.fillStyle = MUTED; x.font = `400 26px ${F}`; x.fillText(fmtPhone(c.phone), P, y); }
  const label = paid ? 'PAYÉE' : isLate(inv) ? 'EN RETARD' : 'À PAYER';
  const col = paid ? '#15803d' : isLate(inv) ? '#b42318' : BRAND;
  x.font = `800 30px ${F}`; const sw = x.measureText(label).width + 48;
  rrect(x, W - P - sw, y - 66, sw, 62, 12); x.lineWidth = 4; x.strokeStyle = col; x.stroke();
  x.fillStyle = col; x.textAlign = 'center'; x.fillText(label, W - P - sw / 2, y - 24);
  y += 60;
  x.fillStyle = INK; x.fillRect(P, y, W - 2 * P, 66);
  x.fillStyle = '#ffffff'; x.font = `700 25px ${F}`; x.textAlign = 'left'; x.fillText('Description', P + 24, y + 42);
  x.textAlign = 'right'; x.fillText('Montant', W - P - 24, y + 42); y += 66;
  x.fillStyle = INK; x.font = `400 29px ${F}`; x.textAlign = 'left';
  x.fillText(`${inv.service} · ${periodLabel(inv.period)}`, P + 24, y + 58);
  x.textAlign = 'right'; x.fillText(money(inv.amount, inv.currency), W - P - 24, y + 58); y += 92;
  x.fillStyle = LINE; x.fillRect(P, y, W - 2 * P, 2); y += 22;
  x.fillStyle = '#fff1e0'; x.fillRect(P, y, W - 2 * P, 92); x.fillStyle = BRAND; x.fillRect(P, y, 10, 92);
  x.fillStyle = INK; x.textAlign = 'left'; x.font = `800 34px ${F}`; x.fillText('TOTAL', P + 34, y + 58);
  x.textAlign = 'right'; x.font = `800 44px ${F}`; x.fillText(money(inv.amount, inv.currency), W - P - 24, y + 62); y += 140;
  x.textAlign = 'left';
  if (paid) {
    x.fillStyle = '#15803d'; x.font = `700 30px ${F}`; x.fillText(`Payée le ${fmtDate(inv.paid_date)}. Merci !`, P, y);
  } else {
    x.fillStyle = MUTED; x.font = `600 22px ${F}`; x.fillText('COMMENT PAYER', P, y); y += 44;
    x.fillStyle = INK; x.font = `400 27px ${F}`; payLines.forEach((l) => { x.fillText(l, P, y); y += 40; });
  }
  x.fillStyle = LINE; x.fillRect(P, H - 120, W - 2 * P, 2);
  x.fillStyle = MUTED; x.font = `400 23px ${F}`; x.textAlign = 'center';
  x.fillText(`${st.business || 'Secure Send Group'} · Merci de votre confiance`, W / 2, H - 68);
  x.fillStyle = BRAND; x.fillRect(0, H - 14, W, 14);
  return cv;
}
const canvasBlob = (cv) => new Promise((res) => cv.toBlob(res, 'image/png'));
let prepared = null;
function prepareInvoice(inv) {
  prepared = { id: inv.id, png: invoiceCanvas(inv).then(async (cv) => ({ cv, blob: await canvasBlob(cv) })) };
}
async function shareOrDownload(blob, name, inv) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `Facture ${inv.number}` }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  downloadBlob(name, blob);
  toast('Fichier téléchargé : joins-le dans WhatsApp.');
}
async function invoiceFile(inv, kind) {
  if (!prepared || prepared.id !== inv.id) prepareInvoice(inv);
  const { cv, blob } = await prepared.png;
  const base = `Facture-${inv.number}`;
  if (kind === 'png') return shareOrDownload(blob, base + '.png', inv);
  try {
    const jpg = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92));
    const bytes = new Uint8Array(await jpg.arrayBuffer());
    return shareOrDownload(makePdf(bytes, cv.width, cv.height), base + '.pdf', inv);
  } catch (e) { toast("Impossible de créer le PDF. Utilise l'image."); }
}
function exportData(kind) {
  const d = today();
  if (kind === 'clients') download(`securesend-clients-${d}.csv`, csv(S.clients, [['Nom', (r) => r.name], ['WhatsApp', (r) => fmtPhone(r.phone)], ['Note', (r) => r.note]]));
  if (kind === 'abonnements') download(`securesend-abonnements-${d}.csv`, csv(S.subs, [['Client', (r) => clientName(r.client_id)], ['Service', (r) => r.service], ['Prix', (r) => r.price], ['Devise', (r) => r.currency], ['Jour de paiement', (r) => r.billing_day], ['Début', (r) => r.start_date], ['Statut', (r) => r.status], ['Détail', (r) => r.note]]));
  if (kind === 'factures') download(`securesend-factures-${d}.csv`, csv(S.invoices.slice().sort((a, b) => (a.period < b.period ? 1 : -1)), [['Numéro', (r) => r.number], ['Client', (r) => clientName(r.client_id, r.client_name)], ['Service', (r) => r.service], ['Mois', (r) => r.period], ['Montant', (r) => r.amount], ['Devise', (r) => r.currency], ['Échéance', (r) => r.due_date], ['Statut', (r) => (r.status === 'paid' ? 'Payée' : isLate(r) ? 'En retard' : 'À payer')], ['Payée le', (r) => r.paid_date]]));
  toast('Fichier téléchargé.');
}

/* ---------- écrans ---------- */
const NAV_ICONS = {
  tableau: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  clients: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7"/><path d="M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5.5-4.5-6.5"/></svg>',
  abonnements: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/></svg>',
  factures: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h7"/></svg>',
  reglages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>'
};
const NAV_LABELS = { tableau: 'Tableau', clients: 'Clients', abonnements: 'Abonnements', factures: 'Factures', reglages: 'Réglages' };

function shell(inner) {
  const showFab = S.view === 'clients' || S.view === 'abonnements' || S.view === 'tableau';
  return `<header><div class="brand">${esc(S.settings.business || DEFAULTS.business)}<small>Gestion des abonnements</small></div>
    <button class="hbtn" data-a="refresh" aria-label="Actualiser">Actualiser</button></header>
    <main>${S.loadError ? `<div class="banner err">${esc(S.loadError)}</div>` : ''}${inner}</main>
    ${showFab ? '<button class="fab" data-a="fab" aria-label="Ajouter">+</button>' : ''}
    <nav>${VIEWS.map((v) => `<a href="#${v}" class="${S.view === v ? 'on' : ''}">${NAV_ICONS[v]}${NAV_LABELS[v]}</a>`).join('')}</nav>`;
}

function invoiceItem(inv) {
  const c = clientById(inv.client_id);
  const phone = c ? c.phone : '';
  return `<div class="item">
    <div class="row"><div><div class="t">${esc(clientName(inv.client_id, inv.client_name))}</div>
      <div class="s">${esc(inv.service)} · ${esc(periodLabel(inv.period))} · échéance ${fmtDate(inv.due_date)}</div></div>
      <div style="text-align:right"><div class="amt">${esc(money(inv.amount, inv.currency))}</div>${invBadge(inv)}</div></div>
    <div class="acts">
      ${phone && inv.status !== 'paid' ? `<a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(phone, messageFor(inv)))}">${isLate(inv) ? 'Relancer' : 'Envoyer'} sur WhatsApp</a>` : ''}
      ${inv.status !== 'paid' ? `<button class="btn" data-a="paid" data-id="${esc(inv.id)}">Marquer payée</button>` : `<button class="btn" data-a="unpaid" data-id="${esc(inv.id)}">Annuler le paiement</button>`}
      <button class="btn" data-a="inv-open" data-id="${esc(inv.id)}">Facture</button>
    </div></div>`;
}

function viewTableau() {
  const p = currentPeriod();
  const active = S.subs.filter((s) => s.status === 'active');
  const paid = S.invoices.filter((i) => i.period === p && i.status === 'paid');
  const unpaid = S.invoices.filter((i) => i.status !== 'paid');
  const late = unpaid.filter(isLate).sort(byDue);
  const soon = unpaid.filter((i) => !isLate(i) && i.due_date <= inDays(7)).sort(byDue);
  const missing = missingFor(p);
  const next = addMonths(p, 1), missingNext = missingFor(next);
  let h = `<h1>Tableau de bord · ${esc(periodLabel(p))}</h1>
    <div class="kpis">
      <div class="kpi"><div class="l">Abonnements actifs</div><div class="v">${active.length}<small>${plural(S.clients.length, 'client')}</small></div></div>
      <div class="kpi"><div class="l">Revenu mensuel prévu</div><div class="v">${sumByCur(active, 'price')}</div></div>
      <div class="kpi"><div class="l">Encaissé ce mois</div><div class="v">${sumByCur(paid, 'amount')}</div></div>
      <div class="kpi warn"><div class="l">Reste à encaisser (tout)</div><div class="v">${sumByCur(unpaid, 'amount')}</div></div>
    </div>
    <h2>Facturation</h2><div class="card">`;
  h += missing.length
    ? `<p style="margin:0 0 10px">${missing.length} abonnement${missing.length > 1 ? "s n'ont" : " n'a"} pas encore de facture pour ${esc(periodLabel(p))}.</p>
       <button class="btn primary big" data-a="gen" data-p="${p}">Générer les factures de ${esc(periodLabel(p))}</button>`
    : `<p style="margin:0" class="muted">Toutes les factures de ${esc(periodLabel(p))} sont créées.</p>`;
  if (missingNext.length) h += `<div class="sep"></div><button class="btn big" data-a="gen" data-p="${next}">Préparer ${esc(periodLabel(next))} (${missingNext.length})</button>`;
  h += '</div>';
  h += `<h2>En retard (${late.length})</h2>` + (late.length ? late.map(invoiceItem).join('') : '<div class="empty">Aucun retard. 👍</div>');
  h += `<h2>À échéance dans 7 jours (${soon.length})</h2>` + (soon.length ? soon.map(invoiceItem).join('') : "<div class=\"empty\">Rien d'urgent cette semaine.</div>");
  if (S.loaded && !S.clients.length) {
    h += `<div class="card" style="margin-top:18px"><b>Pour commencer :</b><ol style="margin:8px 0 0;padding-left:20px;line-height:1.6">
      <li>Complète tes infos de paiement dans Réglages.</li><li>Ajoute tes clients.</li>
      <li>Crée leurs abonnements (service, prix, jour de paiement, vraie date de début).</li>
      <li>Chaque mois, génère les factures et envoie-les sur WhatsApp.</li></ol></div>`;
  }
  return h;
}

function clientListHtml() {
  const q = S.f.clientQ.toLowerCase();
  const list = S.clients.filter((c) => !q || `${c.name} ${c.phone}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (!list.length) return `<div class="empty">${S.clients.length ? 'Aucun client ne correspond.' : "Aucun client pour l'instant. Appuie sur + pour en ajouter un."}</div>`;
  return list.map((c) => {
    const subs = S.subs.filter((s) => s.client_id === c.id && s.status === 'active');
    const due = S.invoices.filter((i) => i.client_id === c.id && i.status !== 'paid');
    const late = due.filter(isLate).length;
    return `<div class="item click" data-a="client-open" data-id="${esc(c.id)}"><div class="row"><div><div class="t">${esc(c.name)}</div>
      <div class="s">${esc(fmtPhone(c.phone))} · ${plural(subs.length, 'abonnement actif', 'abonnements actifs')}</div></div>
      <div style="text-align:right">${due.length ? `<div class="amt">${sumByCur(due, 'amount', true)}</div>${late ? `<span class="badge b-late">${late} en retard</span>` : '<span class="badge b-unpaid">À payer</span>'}` : '<span class="badge b-paid">À jour</span>'}</div></div></div>`;
  }).join('');
}
const viewClients = () => `<h1>Clients</h1><div class="toolbar"><input type="search" id="clientSearch" placeholder="Rechercher un nom ou un numéro" value="${esc(S.f.clientQ)}"></div><div id="clientList">${clientListHtml()}</div>`;

function viewAbonnements() {
  const f = S.f.subStatus;
  const list = S.subs.filter((s) => f === 'all' || s.status === f).sort((a, b) => clientName(a.client_id).localeCompare(clientName(b.client_id), 'fr'));
  const chips = [['active', 'Actifs'], ['paused', 'En pause'], ['cancelled', 'Arrêtés'], ['all', 'Tous']]
    .map(([k, l]) => `<button class="chip${f === k ? ' on' : ''}" data-a="sub-filter" data-f="${k}">${l}</button>`).join('');
  let h = `<h1>Abonnements</h1><div class="toolbar">${chips}</div>`;
  if (!S.clients.length) return h + "<div class=\"empty\">Ajoute d'abord un client, puis crée son abonnement.</div>";
  return h + (list.length ? list.map((s) => `<div class="item click" data-a="sub-edit" data-id="${esc(s.id)}"><div class="row"><div><div class="t">${esc(clientName(s.client_id))}</div>
    <div class="s">${esc(s.service)}${s.note ? ' · ' + esc(s.note) : ''} · paie le ${esc(s.billing_day)} du mois</div></div>
    <div style="text-align:right"><div class="amt">${esc(money(s.price, s.currency))}</div>${subBadge(s)}</div></div></div>`).join('') : '<div class="empty">Aucun abonnement dans cette catégorie.</div>');
}

function viewFactures() {
  const p = S.f.invMonth || currentPeriod();
  const f = S.f.invStatus;
  const month = S.invoices.filter((i) => i.period === p);
  const list = month.filter((i) => (f === 'paid' ? i.status === 'paid' : f === 'unpaid' ? i.status !== 'paid' : f === 'late' ? isLate(i) : true)).sort(byDue);
  const paid = month.filter((i) => i.status === 'paid');
  const chips = [['all', 'Toutes'], ['unpaid', 'À payer'], ['late', 'En retard'], ['paid', 'Payées']]
    .map(([k, l]) => `<button class="chip${f === k ? ' on' : ''}" data-a="inv-filter" data-f="${k}">${l}</button>`).join('');
  const missing = missingFor(p);
  return `<h1>Factures</h1>
    <div class="toolbar"><input type="month" id="invMonth" value="${p}" style="max-width:200px"></div>
    <div class="toolbar">${chips}</div>
    <div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="l">Facturé · ${esc(periodLabel(p))}</div><div class="v">${sumByCur(month, 'amount')}</div></div>
    <div class="kpi"><div class="l">Encaissé · ${paid.length}/${month.length}</div><div class="v">${sumByCur(paid, 'amount')}</div></div></div>
    ${missing.length ? `<button class="btn primary big" style="margin-bottom:12px" data-a="gen" data-p="${p}">Générer ${plural(missing.length, 'facture manquante', 'factures manquantes')}</button>` : ''}
    ${list.length ? list.map(invoiceItem).join('') : '<div class="empty">Aucune facture pour cette sélection.</div>'}`;
}

function viewReglages() {
  const s = S.settings;
  return `<h1>Réglages</h1><form class="card" data-form="settings">
    <label>Nom de l'entreprise</label><input type="text" name="business" value="${esc(s.business)}" required>
    <div class="grid2"><div><label>Préfixe des factures</label><input type="text" name="prefix" value="${esc(s.prefix)}" maxlength="8"></div>
    <div><label>Devise par défaut</label><select name="currency"><option value="HTG"${s.currency === 'HTG' ? ' selected' : ''}>Gourdes (HTG)</option><option value="USD"${s.currency === 'USD' ? ' selected' : ''}>Dollars (USD)</option></select></div></div>
    <label>Instructions de paiement</label><textarea name="payment">${esc(s.payment)}</textarea><div class="hint">Elles apparaissent sur chaque facture et chaque message.</div>
    <label>Message d'envoi de facture</label><textarea name="tpl_invoice" style="min-height:150px">${esc(s.tpl_invoice)}</textarea>
    <label>Message de relance (facture en retard)</label><textarea name="tpl_reminder" style="min-height:150px">${esc(s.tpl_reminder)}</textarea>
    <div class="hint">Mots remplacés automatiquement : {client} {service} {periode} {montant} {echeance} {numero} {paiement} {entreprise}</div>
    <div class="foot"><button type="button" class="btn" data-a="settings-reset">Messages par défaut</button><button type="submit" class="btn primary">Enregistrer</button></div>
  </form>
  <div class="card"><b>Télécharger une sauvegarde</b><p class="muted" style="margin:6px 0 10px;font-size:13.5px">Fichiers CSV lisibles dans Excel ou Google Sheets. Fais-le une fois par mois.</p>
    <div class="toolbar" style="margin:0"><button class="btn" data-a="export" data-k="clients">Clients</button><button class="btn" data-a="export" data-k="abonnements">Abonnements</button><button class="btn" data-a="export" data-k="factures">Factures</button></div></div>
  <div class="card"><b>Compte</b><p class="muted" style="margin:6px 0 10px;font-size:13.5px">Connecté : ${esc(S.user && S.user.email)}</p><button class="btn danger" data-a="logout">Se déconnecter</button></div>
  <div class="card"><b>Bon à savoir</b><p class="muted" style="margin:6px 0 0;font-size:13.5px;line-height:1.5">N'enregistre jamais de mots de passe de comptes clients ici. Les données ne sont visibles que par les comptes administrateurs de Secure Send.</p></div>`;
}

/* ---------- fenêtres ---------- */
function openSheet(html) { $('sheet').innerHTML = html; $('overlay').classList.add('open'); }
function closeSheet() { $('overlay').classList.remove('open'); $('sheet').innerHTML = ''; }

function clientForm(c = {}) {
  openSheet(`<h3>${c.id ? 'Modifier le client' : 'Nouveau client'}</h3><form data-form="client" data-id="${esc(c.id || '')}">
    <label>Nom complet</label><input type="text" name="name" value="${esc(c.name)}" required>
    <label>Numéro WhatsApp</label><input type="tel" name="phone" value="${esc(c.phone)}" placeholder="ex. 3712 3456 ou +1 305…" required>
    <div class="hint">8 chiffres = numéro haïtien (+509 ajouté). Sinon, mets l'indicatif du pays.</div>
    <label>Note (facultatif)</label><input type="text" name="note" value="${esc(c.note)}" placeholder="ex. ami de Jean">
    <div class="foot">${c.id ? `<button type="button" class="btn danger" data-a="client-del" data-id="${esc(c.id)}">Supprimer</button>` : ''}
    <button type="button" class="btn" data-a="close">Annuler</button><button type="submit" class="btn primary">Enregistrer</button></div></form>`);
}
function subForm(s = {}, presetClient) {
  const cid = s.client_id || presetClient || '';
  const opts = S.clients.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((c) => `<option value="${esc(c.id)}"${c.id === cid ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const cur = s.currency || S.settings.currency || 'HTG';
  const st = s.status || 'active';
  openSheet(`<h3>${s.id ? "Modifier l'abonnement" : 'Nouvel abonnement'}</h3><form data-form="sub" data-id="${esc(s.id || '')}">
    <label>Client</label><select name="client_id" required><option value="">Choisir…</option>${opts}</select>
    <label>Service</label><input type="text" name="service" list="svcList" value="${esc(s.service || 'Netflix')}" required>
    <datalist id="svcList">${SERVICES.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="grid2"><div><label>Prix par mois</label><input type="number" name="price" min="0" step="any" value="${esc(s.price ?? '')}" required></div>
    <div><label>Devise</label><select name="currency"><option value="HTG"${cur === 'HTG' ? ' selected' : ''}>HTG</option><option value="USD"${cur === 'USD' ? ' selected' : ''}>USD</option></select></div></div>
    <div class="grid2"><div><label>Jour de paiement</label><input type="number" name="billing_day" min="1" max="31" value="${esc(s.billing_day || new Date().getDate())}" required></div>
    <div><label>Début</label><input type="date" name="start_date" value="${esc(s.start_date || today())}"></div></div>
    <label>Statut</label><select name="status"><option value="active"${st === 'active' ? ' selected' : ''}>Actif</option><option value="paused"${st === 'paused' ? ' selected' : ''}>En pause</option><option value="cancelled"${st === 'cancelled' ? ' selected' : ''}>Arrêté</option></select>
    <label>Détail (facultatif)</label><input type="text" name="note" value="${esc(s.note)}" placeholder="ex. écran 2, forfait 4K">
    <div class="hint">Seuls les abonnements actifs reçoivent une facture chaque mois.</div>
    <div class="foot">${s.id ? `<button type="button" class="btn danger" data-a="sub-del" data-id="${esc(s.id)}">Supprimer</button>` : ''}
    <button type="button" class="btn" data-a="close">Annuler</button><button type="submit" class="btn primary">Enregistrer</button></div></form>`);
}
function clientSheet(id) {
  const c = clientById(id); if (!c) return;
  const subs = S.subs.filter((s) => s.client_id === id);
  const invs = S.invoices.filter((i) => i.client_id === id).sort((a, b) => (a.period < b.period ? 1 : -1));
  const due = invs.filter((i) => i.status !== 'paid');
  openSheet(`<div class="row"><h3>${esc(c.name)}</h3><button class="btn" data-a="client-edit" data-id="${esc(id)}">Modifier</button></div>
    <div class="muted" style="font-size:14px">${esc(fmtPhone(c.phone))}${c.note ? ' · ' + esc(c.note) : ''}</div>
    <div class="kpis" style="margin-top:12px"><div class="kpi"><div class="l">Abonnements actifs</div><div class="v">${subs.filter((s) => s.status === 'active').length}</div></div>
    <div class="kpi${due.length ? ' warn' : ''}"><div class="l">Doit</div><div class="v">${sumByCur(due, 'amount')}</div></div></div>
    <h2>Abonnements</h2>${subs.length ? subs.map((s) => `<div class="item click" data-a="sub-edit" data-id="${esc(s.id)}"><div class="row"><div><div class="t">${esc(s.service)}</div><div class="s">Paie le ${esc(s.billing_day)} du mois${s.note ? ' · ' + esc(s.note) : ''}</div></div><div style="text-align:right"><div class="amt">${esc(money(s.price, s.currency))}</div>${subBadge(s)}</div></div></div>`).join('') : '<div class="empty">Aucun abonnement.</div>'}
    <button class="btn primary big" data-a="sub-new" data-client="${esc(id)}">Ajouter un abonnement</button>
    <h2>Factures</h2>${invs.length ? invs.slice(0, 24).map(invoiceItem).join('') : '<div class="empty">Aucune facture.</div>'}
    <div class="foot"><button class="btn" data-a="close">Fermer</button></div>`);
}
function invoiceSheet(id) {
  const inv = invById(id); if (!inv) return;
  prepareInvoice(inv);
  const st = S.settings, c = clientById(inv.client_id), msg = messageFor(inv);
  openSheet(`<h3>Facture ${esc(inv.number)}</h3>${invBadge(inv)}
    <div class="invoice"><div class="head"><div><img class="inv-logo" src="logo.png" alt="${esc(st.business)}"><div class="tag">Facture n° ${esc(inv.number)}</div></div>
      <div style="text-align:right" class="tag">Émise le ${fmtDate(inv.issue_date)}<br>Échéance ${fmtDate(inv.due_date)}</div></div>
      <div class="tag">Facturé à</div><div style="font-weight:600;margin-bottom:12px">${esc(clientName(inv.client_id, inv.client_name))}${c ? `<div class="tag">${esc(fmtPhone(c.phone))}</div>` : ''}</div>
      <table><tr><td>${esc(inv.service)} · ${esc(periodLabel(inv.period))}</td><td>${esc(money(inv.amount, inv.currency))}</td></tr>
      <tr class="total"><td>Total</td><td>${esc(money(inv.amount, inv.currency))}</td></tr></table>
      ${inv.status === 'paid' ? `<div class="pay" style="color:var(--ok);font-weight:600">Payée le ${fmtDate(inv.paid_date)}</div>` : `<div class="pay">${esc(st.payment)}</div>`}
    </div>
    <label>Message WhatsApp</label><textarea id="msgText" readonly style="min-height:150px">${esc(msg)}</textarea>
    <div class="foot">
      <button class="btn danger" data-a="inv-del" data-id="${esc(id)}">Supprimer</button>
      <button class="btn" data-a="inv-png" data-id="${esc(id)}">Partager l'image</button>
      <button class="btn" data-a="inv-pdf" data-id="${esc(id)}">PDF</button>
      <button class="btn" data-a="copy">Copier le message</button>
      ${c && c.phone ? `<a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(c.phone, msg))}">WhatsApp</a>` : ''}
      ${inv.status !== 'paid' ? `<button class="btn primary" data-a="paid" data-id="${esc(id)}" data-close="1">Marquer payée</button>` : `<button class="btn" data-a="unpaid" data-id="${esc(id)}" data-close="1">Annuler le paiement</button>`}
    </div>`);
}
function confirmSheet(text, action, id) {
  openSheet(`<h3>Confirmer</h3><p>${esc(text)}</p><div class="foot"><button class="btn" data-a="close">Annuler</button><button class="btn danger" data-a="${action}" data-id="${esc(id)}" data-confirmed="1">Supprimer</button></div>`);
}

/* ---------- connexion ---------- */
function viewLogin(msg) {
  return `<div class="login"><img class="login-logo" src="logo.png" alt="Secure Send Group"><p class="muted" style="margin:0 0 18px">Gestion des abonnements</p>
    ${msg ? `<div class="banner err">${esc(msg)}</div>` : ''}
    <form data-form="login">
      <label>Email</label><input type="email" name="email" autocomplete="username" required>
      <label>Mot de passe</label><input type="password" name="password" autocomplete="current-password" required>
      <div class="foot"><button type="button" class="btn" data-a="forgot">Mot de passe oublié</button><button type="submit" class="btn primary">Se connecter</button></div>
    </form></div>`;
}
function viewRecovery() {
  return `<div class="login"><img class="logo" src="icon.svg" alt=""><h1>Nouveau mot de passe</h1>
    <form data-form="newpass"><label>Nouveau mot de passe (8 caractères minimum)</label><input type="password" name="password" minlength="8" autocomplete="new-password" required>
    <div class="foot"><button type="submit" class="btn primary">Enregistrer</button></div></form></div>`;
}
const viewNoAccess = () => `<div class="login"><img class="logo" src="icon.svg" alt=""><h1>Accès refusé</h1>
  <p class="muted">Le compte ${esc(S.user && S.user.email)} n'est pas administrateur de Secure Send.</p>
  <button class="btn" data-a="logout">Changer de compte</button></div>`;

async function afterSignIn(user) {
  S.user = user;
  const { data, error } = await sb.from('ss_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  S.isAdmin = !error && !!data;
  if (S.isAdmin) await loadAll();
  render();
}

/* ---------- rendu ---------- */
function render() {
  const root = $('app');
  if (!S.booted) { root.innerHTML = '<div class="center">Chargement…</div>'; return; }
  if (S.recovery) { root.innerHTML = viewRecovery(); return; }
  if (!S.user) { root.innerHTML = viewLogin(S.loginMsg); return; }
  if (!S.isAdmin) { root.innerHTML = viewNoAccess(); return; }
  const v = S.view;
  const inner = v === 'clients' ? viewClients() : v === 'abonnements' ? viewAbonnements() : v === 'factures' ? viewFactures() : v === 'reglages' ? viewReglages() : viewTableau();
  root.innerHTML = shell(inner);
  document.title = `${S.settings.business || 'Secure Send'} · ${NAV_LABELS[v]}`;
  const search = $('clientSearch');
  if (search) search.addEventListener('input', () => { S.f.clientQ = search.value; $('clientList').innerHTML = clientListHtml(); });
  const month = $('invMonth');
  if (month) month.addEventListener('change', () => { if (month.value) { S.f.invMonth = month.value; render(); } });
}
function route() {
  const h = (location.hash || '').replace('#', '');
  S.view = VIEWS.includes(h) ? h : 'tableau';
  render(); window.scrollTo(0, 0);
}

/* ---------- événements ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) { if (e.target.id === 'overlay') closeSheet(); return; }
  if (el.tagName === 'A') return;
  e.preventDefault();
  const a = el.dataset.a, id = el.dataset.id;
  switch (a) {
    case 'close': closeSheet(); break;
    case 'refresh': el.disabled = true; await loadAll(); render(); toast('Données à jour.'); break;
    case 'fab':
      if (S.view === 'abonnements') { if (!S.clients.length) { toast("Ajoute d'abord un client."); clientForm(); } else subForm(); }
      else clientForm();
      break;
    case 'gen': el.disabled = true; await generate(el.dataset.p); break;
    case 'paid': if (await setPaid(id, true) && el.dataset.close) closeSheet(); break;
    case 'unpaid': if (await setPaid(id, false) && el.dataset.close) closeSheet(); break;
    case 'inv-open': invoiceSheet(id); break;
    case 'inv-png': case 'inv-pdf': {
      const inv = invById(id); if (!inv) break;
      el.disabled = true;
      try { await invoiceFile(inv, a === 'inv-png' ? 'png' : 'pdf'); } finally { el.disabled = false; }
      break;
    }
    case 'inv-del':
      if (!el.dataset.confirmed) return confirmSheet('Supprimer cette facture ? Elle sera recréée si tu relances la génération du mois.', 'inv-del', id);
      if (await deleteInvoice(id)) closeSheet(); break;
    case 'client-open': clientSheet(id); break;
    case 'client-edit': clientForm(clientById(id) || {}); break;
    case 'client-del':
      if (!el.dataset.confirmed) return confirmSheet("Supprimer ce client et tous ses abonnements ? Ses factures restent dans l'historique.", 'client-del', id);
      if (await deleteClient(id)) closeSheet(); break;
    case 'sub-new': subForm({}, el.dataset.client); break;
    case 'sub-edit': subForm(subById(id) || {}); break;
    case 'sub-del':
      if (!el.dataset.confirmed) return confirmSheet("Supprimer cet abonnement ? Pour l'arrêter sans le supprimer, mets son statut sur « Arrêté ».", 'sub-del', id);
      if (await deleteSub(id)) closeSheet(); break;
    case 'sub-filter': S.f.subStatus = el.dataset.f; render(); break;
    case 'inv-filter': S.f.invStatus = el.dataset.f; render(); break;
    case 'export': exportData(el.dataset.k); break;
    case 'settings-reset': { const f = el.closest('form'); f.tpl_invoice.value = DEFAULTS.tpl_invoice; f.tpl_reminder.value = DEFAULTS.tpl_reminder; toast('Messages remis par défaut. Pense à enregistrer.'); break; }
    case 'copy': {
      const ta = $('msgText');
      try { await navigator.clipboard.writeText(ta.value); toast('Message copié.'); }
      catch (err) { ta.removeAttribute('readonly'); ta.select(); toast('Texte sélectionné : copie-le.'); }
      break;
    }
    case 'logout': await sb.auth.signOut(); S.user = null; S.isAdmin = false; S.loaded = false; S.loginMsg = ''; closeSheet(); render(); break;
    case 'forgot': {
      const email = (document.querySelector('form[data-form=login] [name=email]') || {}).value || '';
      if (!email.trim()) { toast("Écris d'abord ton email."); break; }
      const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: location.origin + location.pathname });
      toast(error ? errText(error) : 'Email de réinitialisation envoyé.');
      break;
    }
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target, kind = f.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f).entries());
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (kind === 'login') {
      const { data, error } = await sb.auth.signInWithPassword({ email: d.email.trim().toLowerCase(), password: d.password });
      if (error) { S.loginMsg = /invalid/i.test(error.message) ? 'Email ou mot de passe incorrect.' : errText(error); render(); return; }
      S.loginMsg = ''; await afterSignIn(data.user);
    } else if (kind === 'newpass') {
      const { error } = await sb.auth.updateUser({ password: d.password });
      if (error) { toast(errText(error)); return; }
      S.recovery = false; toast('Mot de passe changé.'); render();
    } else if (kind === 'client') {
      if (intlPhone(d.phone).length < 10) { toast('Numéro WhatsApp invalide.'); return; }
      if (await saveClient(d, f.dataset.id)) closeSheet();
    } else if (kind === 'sub') {
      if (!d.client_id) { toast('Choisis un client.'); return; }
      if (await saveSub(d, f.dataset.id)) closeSheet();
    } else if (kind === 'settings') {
      await saveSettings(d);
    }
  } finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
});
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && S.isAdmin) { await loadAll(); if (!$('overlay').classList.contains('open')) render(); }
});

/* ---------- démarrage ---------- */
(async function boot() {
  route();
  sb.auth.onAuthStateChange((ev) => {
    if (ev === 'PASSWORD_RECOVERY') { S.recovery = true; render(); }
    if (ev === 'SIGNED_OUT') { S.user = null; S.isAdmin = false; S.loaded = false; render(); }
  });
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) await afterSignIn(data.session.user);
  } catch (e) { S.loginMsg = errText(e); }
  S.booted = true;
  render();
})();
