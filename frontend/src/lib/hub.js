// Athlete Hub helpers: colours, formatting and authenticated document viewing.
import axios from 'axios';

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const TONE = {
  green: { pill: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', bar: 'bg-emerald-500', text: 'text-emerald-400' },
  yellow: { pill: 'bg-amber-400/15 text-amber-300 border-amber-400/40', bar: 'bg-amber-400', text: 'text-amber-300' },
  red: { pill: 'bg-red-500/15 text-red-300 border-red-500/40', bar: 'bg-red-500', text: 'text-red-400' },
  blue: { pill: 'bg-sky-500/15 text-sky-300 border-sky-500/40', bar: 'bg-sky-500', text: 'text-sky-400' },
  gray: { pill: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40', bar: 'bg-zinc-500', text: 'text-zinc-400' },
};
export const toneOf = (t) => TONE[t] || TONE.gray;

export const optionOf = (field, value) => (field?.options || []).find((o) => o.value === value);

export function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '';
  if (field?.type === 'date') {
    const [y, m, d] = String(value).split('-');
    return y && m && d ? `${d}/${m}/${y}` : value;
  }
  if (field?.type === 'select') return optionOf(field, value)?.label || value;
  return String(value);
}

export function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

export const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Open a protected document in a new tab (fetched with the login token). */
export async function openDocument(doc, getAuthHeaders, download = false) {
  const win = download ? null : window.open('', '_blank');
  try {
    const r = await axios.get(`${API}/hub/documents/${doc.id}/file`, { ...getAuthHeaders(), responseType: 'blob', skipGroupFilter: true });
    const url = URL.createObjectURL(r.data);
    if (download) {
      const a = document.createElement('a');
      a.href = url; a.download = doc.filename || 'document'; document.body.appendChild(a); a.click(); a.remove();
    } else if (win) {
      win.location.href = url;
    } else {
      window.location.href = url;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

/** Fetch a document as an object URL (for inline previews / passport reading). */
export async function documentBlobUrl(doc, getAuthHeaders) {
  const r = await axios.get(`${API}/hub/documents/${doc.id}/file`, { ...getAuthHeaders(), responseType: 'blob', skipGroupFilter: true });
  return URL.createObjectURL(r.data);
}

export const SECTION_ORDER = ['Personal', 'Contact', 'Documents', 'Admin & Dues', 'Certifications', 'Other',
  'Emergency & Insurance', 'Medical history', 'Consents', 'Body', 'Nutrition & Diet', 'Medical notes'];
export const MEDICAL_SECTIONS = new Set(['Body', 'Emergency & Insurance', 'Medical history', 'Consents', 'Nutrition & Diet', 'Medical notes']);
export const isMedicalField = (f) => MEDICAL_SECTIONS.has(f?.section);
export const MEDICAL_DOC_KEYS = new Set(['insurance_card', 'medical_clearance_doc', 'medical_report']);
export const isMedicalDoc = (d, fieldsByKey = {}) => MEDICAL_DOC_KEYS.has(d.key) || (d.field && isMedicalField(fieldsByKey[d.field]));

/** "Allergies (orange); Asthma (red); All clear (normal)" -> [{label, tone}] */
export function parseAlerts(text) {
  return String(text || '').split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/\(([^)]+)\)\s*$/);
    const c = (m ? m[1] : '').toLowerCase();
    const tone = /red|vermelh/.test(c) ? 'red' : /orange|laranja|yellow|amarel/.test(c) ? 'yellow' : /normal|green|verde/.test(c) ? 'green' : 'gray';
    return { label: m ? x.slice(0, m.index).trim() : x, tone };
  });
}

export function groupBySection(fields) {
  const out = {};
  fields.forEach((f) => { (out[f.section || 'Other'] = out[f.section || 'Other'] || []).push(f); });
  return SECTION_ORDER.filter((s) => out[s]).map((s) => [s, out[s]]);
}
