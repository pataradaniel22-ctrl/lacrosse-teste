import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import {
  ArrowLeft, IdCard, Search, Send, Download, Settings2, Loader2, AlertTriangle, Columns3, FileCheck2, X, Users, HeartPulse,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import GroupBadges from '../../components/groups/GroupBadges';
import HubAthleteRecord from '../../components/hub/HubAthleteRecord';
import RequestDialog from '../../components/hub/RequestDialog';
import HubConfigEditor from '../../components/hub/HubConfigEditor';
import { ValuePill } from '../../components/hub/FieldInput';
import { API, toneOf, optionOf, formatValue, isMedicalField, isMedicalDoc } from '../../lib/hub';

const COLS_KEY = 'ams.hub.columns';
const DEFAULT_COLS = {
  admin: ['passport_status', 'passport_expiry', 'dues_2026', 'safeguarding', 'cpf_status', 'country', 'phone'],
  medical: ['medical_alerts', 'has_allergies', 'regular_medication', 'surgery_5y', 'injury_5y', 'medical_clearance', 'emergency_contact', 'emergency_phone'],
};
const readCols = (view) => { try { return JSON.parse(localStorage.getItem(`${COLS_KEY}.${view}`)) || null; } catch { return null; } };

export default function AthleteHub() {
  const { user, getAuthHeaders: gah } = useAuth();
  const auth = useRef(gah); auth.current = gah;
  const getAuthHeaders = useCallback(() => auth.current(), []);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [q, setQ] = useState('');
  const [team, setTeam] = useState(() => { try { return localStorage.getItem('ams.hub.team') || 'all'; } catch { return 'all'; } });
  const [filter, setFilter] = useState(null); // {key, value} | {key:'__missing'} | {key, alert}
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [reqFor, setReqFor] = useState(null);
  const [view, setView] = useState(() => { try { return localStorage.getItem('ams.hub.view') || 'admin'; } catch { return 'admin'; } });
  const [cols, setCols] = useState(() => readCols(view) || DEFAULT_COLS[view]);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/staff/hub/roster`, getAuthHeaders());
      setData(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not load the Athlete Hub'); }
  }, [getAuthHeaders]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { localStorage.setItem(`${COLS_KEY}.${view}`, JSON.stringify(cols)); } catch { /* ignore */ } }, [cols]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchView = (v) => {
    setView(v); setFilter(null); setCols(readCols(v) || DEFAULT_COLS[v]);
    try { localStorage.setItem('ams.hub.view', v); } catch { /* ignore */ }
  };
  useEffect(() => { try { localStorage.setItem('ams.hub.team', team); } catch { /* ignore */ } }, [team]);

  const fields = useMemo(() => (data?.fields || []).filter((f) => !f.hidden && isMedicalField(f) === (view === 'medical')), [data, view]);
  const viewKeys = useMemo(() => new Set([...fields.map((f) => f.key), ...(data?.doc_types || []).filter((d) => isMedicalDoc(d, Object.fromEntries((data?.fields || []).map((f) => [f.key, f]))) === (view === 'medical')).map((d) => d.key)]), [fields, data, view]);
  const fieldBy = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);
  const allRows = data?.rows || [];
  const isWomen = (r) => /women/i.test(r.athlete.team || '');
  const teamCounts = { all: allRows.length, men: allRows.filter((r) => !isWomen(r)).length, women: allRows.filter(isWomen).length };
  const rows = (team === 'all' ? allRows : allRows.filter((r) => (team === 'women' ? isWomen(r) : !isWomen(r))))
    .map((r) => ({ ...r, missing: r.missing.filter((m) => viewKeys.has(m.key)) }));

  // Summary cards: required select fields + date alerts
  const cards = useMemo(() => fields.filter((f) => f.type === 'select' && (f.required || view === 'medical')).map((f) => {
    const counts = {};
    rows.forEach((r) => { const v = r.values[f.key] || '__none'; counts[v] = (counts[v] || 0) + 1; });
    return { field: f, counts };
  }), [fields, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const dateAlerts = useMemo(() => fields.filter((f) => f.type === 'date' && f.alert_days).map((f) => ({
    field: f,
    expired: rows.filter((r) => r.alerts?.[f.key] === 'expired').length,
    soon: rows.filter((r) => r.alerts?.[f.key] === 'soon').length,
  })), [fields, rows]);
  const incomplete = rows.filter((r) => r.missing.length).length;

  const visible = rows.filter((r) => {
    if (q) {
      const hay = `${r.athlete.name} ${r.athlete.email} ${Object.values(r.values).join(' ')}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    if (!filter) return true;
    if (filter.key === '__missing') return r.missing.length > 0;
    if (filter.alert) return r.alerts?.[filter.key] === filter.alert;
    if (filter.value === '__none') return !r.values[filter.key];
    return r.values[filter.key] === filter.value;
  });

  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.athlete.id));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allSelected) visible.forEach((r) => n.delete(r.athlete.id)); else visible.forEach((r) => n.add(r.athlete.id)); return n; });
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const exportCsv = () => {
    const shown = fields;
    const head = ['Name', 'Team', 'Age', ...shown.map((f) => f.label), 'Missing'];
    const lines = [head, ...visible.map((r) => [r.athlete.name, r.athlete.team, r.age ?? '', ...shown.map((f) => formatValue(f, r.values[f.key])), r.missing.map((m) => m.label).join('; ')])];
    const csv = lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `athlete-hub-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  const tableCols = cols.filter((k) => fieldBy[k]);
  const selectedAthletes = rows.filter((r) => selected.has(r.athlete.id)).map((r) => r.athlete);
  const isAdmin = user?.role === 'Admin';

  return (
    <div className="min-h-screen bg-background pb-24" data-testid="athlete-hub-page">
      <header className="sticky top-0 z-40 glass-heavy border-b border-white/10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
          <Link to="/staff"><Button variant="ghost" size="icon" className="h-9 w-9"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <IdCard className="w-6 h-6 text-primary" />
          <div className="min-w-0">
            <h1 className="font-heading font-bold text-lg leading-tight">Athlete Hub</h1>
            <p className="text-xs text-muted-foreground">Profiles, documents & admin status of every athlete</p>
          </div>
          <div className="ml-auto flex gap-1 rounded-lg bg-muted/40 p-1 text-sm">
            <button type="button" onClick={() => setTab('overview')} className={`px-3 py-1 rounded-md ${tab === 'overview' ? 'bg-background shadow' : 'text-muted-foreground'}`} data-testid="hub-tab-overview">Overview</button>
            {isAdmin && <button type="button" onClick={() => setTab('settings')} className={`px-3 py-1 rounded-md flex items-center gap-1 ${tab === 'settings' ? 'bg-background shadow' : 'text-muted-foreground'}`} data-testid="hub-tab-settings"><Settings2 className="w-3.5 h-3.5" />Customize</button>}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 space-y-4">
        {tab === 'settings' && isAdmin ? (
          <HubConfigEditor getAuthHeaders={getAuthHeaders} onSaved={load} />
        ) : !data ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Admin | Medical view */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/40 p-1 max-w-md" data-testid="hub-view-tabs">
              <button type="button" onClick={() => switchView('admin')} data-testid="hub-view-admin"
                className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium ${view === 'admin' ? 'bg-background shadow' : 'text-muted-foreground hover:text-foreground'}`}>
                <IdCard className="w-4 h-4" />Profile & Admin
              </button>
              <button type="button" onClick={() => switchView('medical')} data-testid="hub-view-medical"
                className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium ${view === 'medical' ? 'bg-rose-500/15 text-rose-200 shadow ring-1 ring-rose-500/40' : 'text-muted-foreground hover:text-foreground'}`}>
                <HeartPulse className="w-4 h-4" />Medical
              </button>
            </div>

            {/* Men / Women */}
            <div className="flex items-center gap-2 flex-wrap" data-testid="hub-team-filter">
              {[['all', 'All'], ['men', "Men's"], ['women', "Women's"]].map(([k, label]) => (
                <button key={k} type="button" onClick={() => { setTeam(k); setSelected(new Set()); }}
                  className={`text-sm px-4 py-1.5 rounded-full border transition-colors ${team === k ? 'bg-primary border-primary text-primary-foreground font-semibold' : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/25'}`}
                  data-testid={`hub-team-${k}`}>
                  {label} <span className="opacity-70">{teamCounts[k]}</span>
                </button>
              ))}
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="hub-summary">
              <Card className="glass-light border-white/10">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />Athletes</p>
                  <p className="text-3xl font-bold mt-1">{rows.length}</p>
                  <button type="button" onClick={() => setFilter(filter?.key === '__missing' ? null : { key: '__missing' })}
                    className={`mt-2 text-xs flex items-center gap-1 rounded-full border px-2 py-0.5 ${filter?.key === '__missing' ? 'bg-amber-400 text-black border-amber-400' : 'border-amber-400/40 text-amber-300'}`}
                    data-testid="hub-filter-missing">
                    <AlertTriangle className="w-3 h-3" />{incomplete} with missing info
                  </button>
                </CardContent>
              </Card>
              {dateAlerts.map(({ field, expired, soon }) => (
                <Card key={field.key} className="glass-light border-white/10">
                  <CardContent className="p-4 space-y-1.5">
                    <p className="text-xs text-muted-foreground">{field.label}</p>
                    <div className="flex gap-2 flex-wrap">
                      {[['expired', expired, 'red', 'Expired'], ['soon', soon, 'yellow', `< ${Math.round(field.alert_days / 30)} months`]].map(([alert, n, tone, label]) => (
                        <button key={alert} type="button"
                          onClick={() => setFilter(filter?.key === field.key && filter.alert === alert ? null : { key: field.key, alert })}
                          className={`rounded-lg border px-2.5 py-1.5 text-left ${filter?.key === field.key && filter.alert === alert ? 'ring-2 ring-white/40' : ''} ${toneOf(tone).pill}`}
                          data-testid={`hub-alert-${field.key}-${alert}`}>
                          <p className="text-xl font-bold leading-none">{n}</p><p className="text-[10px] mt-0.5">{label}</p>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {cards.map(({ field, counts }) => {
                const total = rows.length || 1;
                const opts = [...(field.options || []), { value: '__none', label: 'Not filled', tone: 'gray' }].filter((o) => counts[o.value]);
                return (
                  <Card key={field.key} className="glass-light border-white/10" data-testid={`hub-card-${field.key}`}>
                    <CardContent className="p-4 space-y-2">
                      <p className="text-xs text-muted-foreground">{field.label}</p>
                      <div className="flex h-2 rounded-full overflow-hidden bg-white/5">
                        {opts.map((o) => <div key={o.value} className={toneOf(o.tone).bar} style={{ width: `${(counts[o.value] / total) * 100}%`, opacity: o.value === '__none' ? 0.35 : 1 }} />)}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {opts.map((o) => {
                          const on = filter?.key === field.key && filter.value === o.value;
                          return (
                            <button key={o.value} type="button" onClick={() => setFilter(on ? null : { key: field.key, value: o.value })}
                              className={`text-[11px] px-2 py-0.5 rounded-full border ${toneOf(o.tone).pill} ${on ? 'ring-2 ring-white/40' : ''}`}
                              data-testid={`hub-filter-${field.key}-${o.value}`}>
                              {o.label} <b>{counts[o.value]}</b>
                            </button>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, city, anything…" className="h-9 w-60 pl-8 bg-background/50 border-white/10" data-testid="hub-search" />
              </div>
              {filter && (
                <button type="button" onClick={() => setFilter(null)} className="text-xs flex items-center gap-1 rounded-full border border-white/20 px-2.5 py-1" data-testid="hub-clear-filter">
                  Filter: {filter.key === '__missing' ? 'missing info' : `${fieldBy[filter.key]?.label} = ${filter.alert || (filter.value === '__none' ? 'not filled' : (optionOf(fieldBy[filter.key], filter.value)?.label || filter.value))}`}
                  <X className="w-3 h-3" />
                </button>
              )}
              <span className="text-xs text-muted-foreground">{visible.length} shown</span>
              <div className="ml-auto flex gap-2">
                <Popover>
                  <PopoverTrigger asChild><Button size="sm" variant="outline" className="h-9" data-testid="hub-columns-btn"><Columns3 className="w-4 h-4 mr-1" />Columns</Button></PopoverTrigger>
                  <PopoverContent align="end" className="w-60 p-2 max-h-80 overflow-y-auto">
                    {fields.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-white/5 cursor-pointer">
                        <input type="checkbox" checked={cols.includes(f.key)} onChange={() => setCols((c) => (c.includes(f.key) ? c.filter((x) => x !== f.key) : [...c, f.key]))} />
                        {f.label}
                      </label>
                    ))}
                  </PopoverContent>
                </Popover>
                <Button size="sm" variant="outline" className="h-9" onClick={exportCsv} data-testid="hub-export-btn"><Download className="w-4 h-4 mr-1" />CSV</Button>
              </div>
            </div>

            {selected.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap rounded-lg border border-sky-500/30 bg-sky-500/5 p-2 text-xs" data-testid="hub-bulk-bar">
                <b>{selected.size} selected</b>
                {data.can_request && <Button size="sm" className="h-7 text-xs" onClick={() => setReqFor(selectedAthletes)} data-testid="hub-bulk-request"><Send className="w-3.5 h-3.5 mr-1" />Request missing info</Button>}
                <button type="button" className="ml-auto underline text-muted-foreground" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            )}

            {/* Table */}
            <div className="rounded-xl border border-white/10 overflow-x-auto" data-testid="hub-table">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-white/5 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" data-testid="hub-select-all" /></th>
                    <th className="p-2 text-left sticky left-0 bg-muted">Athlete</th>
                    <th className="p-2 text-left">Age</th>
                    {tableCols.map((k) => <th key={k} className="p-2 text-left whitespace-nowrap">{fieldBy[k].label}</th>)}
                    <th className="p-2 text-left">Docs</th>
                    <th className="p-2 text-left">Missing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {visible.map((r) => (
                    <tr key={r.athlete.id} className="hover:bg-white/5 cursor-pointer" onClick={() => setOpen(r.athlete)} data-testid={`hub-row-${r.athlete.id}`}>
                      <td className="p-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.athlete.id)} onChange={() => toggleOne(r.athlete.id)} /></td>
                      <td className="p-2 sticky left-0 bg-background/95">
                        <p className="font-medium leading-tight whitespace-nowrap">{(r.athlete.name || '').trim()}</p>
                        <p className="text-[11px] text-muted-foreground">{(r.athlete.team || '').includes('Women') ? "Women's" : "Men's"}</p>
                        <GroupBadges groups={r.athlete.groups} size="xs" className="mt-0.5" />
                      </td>
                      <td className="p-2 text-muted-foreground">{r.age ?? '—'}</td>
                      {tableCols.map((k) => <td key={k} className="p-2"><ValuePill field={fieldBy[k]} value={r.values[k]} alert={r.alerts?.[k]} /></td>)}
                      <td className="p-2">
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><FileCheck2 className="w-3.5 h-3.5" />{Object.entries(r.doc_counts).filter(([k]) => viewKeys.has(k)).reduce((a, [, b]) => a + b, 0)}</span>
                      </td>
                      <td className="p-2">
                        {r.missing.length ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-400/40 bg-amber-400/10 text-amber-300 whitespace-nowrap" title={r.missing.map((m) => m.label).join(', ')}>
                            {r.missing.length} missing{r.open_requests ? ' · requested' : ''}
                          </span>
                        ) : <span className="text-[11px] text-emerald-400">Complete</span>}
                      </td>
                    </tr>
                  ))}
                  {!visible.length && <tr><td colSpan={tableCols.length + 5} className="p-8 text-center text-muted-foreground text-sm">No athletes match.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto" data-testid="hub-drawer">
          <SheetHeader><SheetTitle>Athlete profile</SheetTitle></SheetHeader>
          {open && (
            <div className="mt-4">
              <HubAthleteRecord athleteId={open.id} getAuthHeaders={getAuthHeaders} onChanged={load} />
              <Link to={`/staff/athlete/${open.id}`} className="block mt-6 text-xs text-primary underline">Open full monitoring page</Link>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {reqFor && (
        <RequestDialog open={!!reqFor} onOpenChange={(v) => !v && setReqFor(null)} athletes={reqFor}
          fields={data?.fields || []} docTypes={data?.doc_types || []} getAuthHeaders={getAuthHeaders}
          onSent={() => { setSelected(new Set()); load(); }} />
      )}
    </div>
  );
}
