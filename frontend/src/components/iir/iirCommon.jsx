import { createContext, useContext } from 'react';
import { Badge } from '../ui/badge';

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const IirContext = createContext(null);
export const useIir = () => useContext(IirContext);

/** Option helpers ---------------------------------------------------------- */
export function optLabel(tax, key, code) {
  if (!tax || code == null || code === '') return '';
  const o = (tax.options[key] || []).find((x) => x.code === code);
  return o ? o.label : code;
}

export function optLabels(tax, key, codes) {
  return (codes || []).map((c) => optLabel(tax, key, c)).join(', ');
}

export const eventDateKey = (kind) => (kind === 'injury' ? 'date_of_injury' : 'date_of_onset');

export function apiError(err, fallback = 'Something went wrong') {
  const d = err?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x.message || x.msg || JSON.stringify(x)).join(' · ');
  if (typeof d === 'string') return d;
  return fallback;
}

/** Visual tokens ----------------------------------------------------------- */
export const participationStyle = {
  full: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  modified: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  unavailable: 'text-red-300 border-red-500/40 bg-red-500/10',
  unknown: 'text-muted-foreground border-white/15 bg-white/5',
};

export const statusStyle = {
  draft: 'text-slate-300 border-slate-500/40 bg-slate-500/10',
  open: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
  closed: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  lost_to_follow_up: 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10',
};

export function ParticipationBadge({ tax, value }) {
  const v = value || 'unknown';
  return (
    <Badge variant="outline" className={`text-[10px] ${participationStyle[v] || participationStyle.unknown}`}>
      {optLabel(tax, 'participation', v) || v}
    </Badge>
  );
}

export function StatusBadge({ tax, value }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${statusStyle[value] || ''}`}>
      {optLabel(tax, 'status', value) || value}
    </Badge>
  );
}

/** Effective time-loss display: final / zero / provisional / unknown / N/A / not filled */
export function TimeLossDays({ tl, compact = false }) {
  if (!tl) return <span className="text-muted-foreground">—</span>;
  const map = {
    final: { txt: `${tl.value} d`, cls: 'text-foreground' },
    zero: { txt: '0 d (same day)', cls: 'text-foreground' },
    provisional: { txt: `${tl.value} d · provisional`, cls: 'text-amber-300' },
    unknown: { txt: 'unknown', cls: 'text-muted-foreground' },
    not_applicable: { txt: 'N/A (medical attention)', cls: 'text-muted-foreground' },
    not_filled: { txt: 'not filled', cls: 'text-muted-foreground italic' },
    not_started: { txt: 'not started', cls: 'text-muted-foreground' },
    invalid: { txt: 'invalid dates', cls: 'text-red-400' },
  };
  const m = map[tl.state] || { txt: '—', cls: 'text-muted-foreground' };
  const txt = compact && tl.state === 'provisional' ? `${tl.value} d*` : m.txt;
  return (
    <span className={`font-mono text-xs ${m.cls}`} title={tl.start_imputed ? 'Start = date of injury/onset (unavailability start not recorded)' : ''}>
      {txt}{tl.start_imputed ? ' †' : ''}
    </span>
  );
}

export const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');
