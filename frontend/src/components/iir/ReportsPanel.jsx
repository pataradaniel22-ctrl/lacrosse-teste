import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Download, Loader2, Filter, Info } from 'lucide-react';
import { API, useIir, apiError } from './iirCommon';

const selectCls = 'h-9 w-full rounded-md bg-background/50 border border-white/10 px-2 text-sm';
const inp = 'h-9 bg-background/50 border-white/10 text-sm';

const FILTER_SELECTS = [
  ['activity', 'activity', 'Activity'], ['body_location', 'body_location', 'Body region'],
  ['injury_type', 'injury_type', 'Injury type'], ['mechanism', 'mechanism', 'Mechanism'],
  ['organ_system', 'organ_system', 'Organ system'], ['aetiology', 'aetiology', 'Aetiology'],
  ['time_loss', 'time_loss', 'Time-loss'], ['status', 'status', 'Status'], ['category', 'category', 'Category'],
];

export default function ReportsPanel({ compact = false }) {
  const { tax, me, athletes, staff, events, getAuthHeaders } = useIir();
  const [f, setF] = useState({});
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const qs = useCallback((extra = {}) => {
    const p = new URLSearchParams();
    Object.entries({ ...f, ...extra }).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
    return p.toString();
  }, [f]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/iir/reports/summary?${qs()}`, getAuthHeaders());
      setRep(r.data);
    } catch (err) {
      toast.error(apiError(err, 'Could not load report'));
    } finally {
      setLoading(false);
    }
  }, [qs, getAuthHeaders]);

  useEffect(() => { load(); }, [load]);

  if (!rep) return loading ? <div className="py-10 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div> : null;
  const inj = rep.injuries;
  const ill = rep.illnesses;
  const compat = inj.rates.compat_all_per_match_player_hours;

  if (compact) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="iir-report-compact">
        <Metric big={inj.episodes} label="Injuries (saved records)" />
        <Metric big={ill.episodes} label="Illnesses (saved records)" />
        <Metric big={rateTxt(inj.rates.game)} label="Game injuries / 1,000 athlete game h" />
        <Metric big={rateTxt(inj.rates.training)} label="Training injuries / 1,000 athlete training h" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="iir-reports">
      {/* Filters */}
      <Card className="glass-light border-white/5">
        <CardContent className="p-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <Labeled label="From"><Input type="date" className={inp} value={f.from || ''} onChange={(e) => setF({ ...f, from: e.target.value })} /></Labeled>
            <Labeled label="To"><Input type="date" className={inp} value={f.to || ''} onChange={(e) => setF({ ...f, to: e.target.value })} /></Labeled>
            <Labeled label="Cut-off date"><Input type="date" className={inp} value={f.cutoff || ''} onChange={(e) => setF({ ...f, cutoff: e.target.value })} /></Labeled>
            <Labeled label="Event">
              <select className={selectCls} value={f.event_id || ''} onChange={(e) => setF({ ...f, event_id: e.target.value })}>
                <option value="">All</option>{events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </Labeled>
            <Labeled label="Team">
              <select className={selectCls} value={f.team || ''} onChange={(e) => setF({ ...f, team: e.target.value })}>
                <option value="">All</option>{[...new Set(athletes.map((a) => a.team).filter(Boolean))].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Labeled>
            <Button size="sm" variant="outline" onClick={() => setShowFilters((s) => !s)}><Filter className="w-3 h-3 mr-1" />More filters</Button>
          </div>
          {showFilters && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              {me?.can_view_clinical && (
                <Labeled label="Athlete">
                  <select className={selectCls} value={f.athlete_id || ''} onChange={(e) => setF({ ...f, athlete_id: e.target.value })}>
                    <option value="">All</option>{athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Labeled>
              )}
              {FILTER_SELECTS.map(([key, opt, label]) => (
                <Labeled key={key} label={label}>
                  <select className={selectCls} value={f[key] || ''} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
                    <option value="">All</option>{(tax.options[opt] || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                </Labeled>
              ))}
              <Labeled label="Recurrence">
                <select className={selectCls} value={f.classification || ''} onChange={(e) => setF({ ...f, classification: e.target.value })}>
                  <option value="">All</option><option value="new">New</option><option value="recurrent">Recurrent</option><option value="exacerbation">Exacerbation</option><option value="unknown">Unknown</option>
                </select>
              </Labeled>
              {me?.can_view_clinical && (
                <Labeled label="Responsible professional">
                  <select className={selectCls} value={f.report_by || ''} onChange={(e) => setF({ ...f, report_by: e.target.value })}>
                    <option value="">All</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Labeled>
              )}
              <Button size="sm" variant="ghost" onClick={() => setF({})}>Clear filters</Button>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">Cut-off {rep.cutoff} · population: {rep.population} · the same filters apply to cases and exposure · {rep.form_version} / {rep.dictionary_version}</p>
        </CardContent>
      </Card>

      {/* Headline cards — inspired by the Super Sixes infographic, computed from the records */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric big={compat.calculable ? compat.rate_per_1000 : 'n/c'} label="All injuries / 1,000 match-player-hours" note="Compatibility view: game denominator for every activity — not a training-specific incidence" />
        <Metric big={inj.episodes} label={`Injuries · ${inj.athletes_affected} athlete(s)`} note={`${inj.incident_in_period} incident in period · ${inj.preexisting_in_follow_up} pre-existing`} />
        <Metric big={rep.exclusions.teams_excluded.length ? `${rep.exclusions.teams_excluded.length} excl.` : '—'} label="Teams excluded from analysis" note={rep.exclusions.teams_excluded.map((t) => `${t.team}: ${t.reason}`).join(' · ')} />
        <Metric big={(rep.exposure.hours.game || 0).toFixed(1)} label="Match-player-hours (athlete game h)" note={`${(rep.exposure.hours.training || 0).toFixed(1)} athlete training h`} />
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <RateCard title="Game injuries" r={inj.rates.game} />
        <RateCard title="Training injuries" r={inj.rates.training} />
        <RateCard title="Illnesses" r={ill.rates.athlete_days} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <ChartCard title="Mechanism of injury" rows={inj.mechanism} n={inj.episodes} />
        <ChartCard title="Contact source" rows={inj.source} n={inj.episodes} />
        <BreakdownCard title="Activity" rows={inj.activity} n={inj.episodes} extra={(r) => {
          const x = inj.rates.by_activity_per_match_player_hours.find((y) => y.code === r.code);
          return x?.rate_per_1000_mph != null ? `${x.rate_per_1000_mph}/1,000 m-p-h` : '';
        }} footnote="Rates per match-player-hours use the game denominator for all activities." />
        <BreakdownCard title="Severity" rows={inj.time_loss} n={inj.episodes} footnote={`Time-loss days: ${inj.days.final_days} final (${inj.days.final_episodes} ep., ${inj.days.zero_day_episodes} same-day) · ${inj.days.provisional_days} provisional in ${inj.days.open_episodes_provisional} open episode(s) · ${inj.days.unknown} unknown`} />
        <BreakdownCard title="Injury recurrence" rows={inj.classification} n={inj.episodes} />
        <BodyMap rows={inj.body_location} n={inj.episodes} note={inj.multi_select_note} />
        <BreakdownCard title="Injury type *" rows={inj.injury_type} n={inj.episodes} footnote={inj.multi_select_note} />
        <BreakdownCard title="Specific occurrence" rows={inj.occurrence} n={inj.episodes} />
      </div>

      <h3 className="text-sm font-semibold mt-2">Illnesses</h3>
      <div className="grid md:grid-cols-2 gap-3">
        <BreakdownCard title={`Organ system · ${ill.episodes} episode(s), ${ill.athletes_affected} athlete(s)`} rows={ill.organ_system} n={ill.episodes} />
        <BreakdownCard title="Aetiology" rows={ill.aetiology} n={ill.episodes} />
        <BreakdownCard title="Communicable" rows={ill.communicable} n={ill.episodes} />
        <BreakdownCard title="Classification" rows={ill.classification} n={ill.episodes} footnote={`Time-loss days: ${ill.days.final_days} final · ${ill.days.provisional_days} provisional`} />
      </div>

      <Card className="glass-light border-white/5">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Data quality and exclusions</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          <p>Complete injury records: {inj.completeness.complete_records}/{inj.episodes} · with warnings: {inj.completeness.records_with_warnings}</p>
          {inj.completeness.pending_fields.length > 0 && <p className="text-muted-foreground">Most frequent pending fields: {inj.completeness.pending_fields.slice(0, 6).map(([k, n]) => `${k} (${n})`).join(', ')}</p>}
          <p>Unique days of unavailability (injuries + illnesses, overlaps counted once): {rep.unique_unavailable_days.total}{rep.unique_unavailable_days.any_provisional ? ' (includes provisional days)' : ''}</p>
          <p>Non-athlete participants excluded from denominators: {rep.exclusions.non_athlete_participants} · drafts and deleted records: excluded</p>
          {rep.exposure.collective_estimates_used.length > 0 && <p className="text-amber-300">{rep.exposure.collective_estimates_used.length} session(s) use collective exposure estimates: {[...new Set(rep.exposure.collective_estimates_used.map((e) => e.method))].join('; ')}</p>}
        </CardContent>
      </Card>

      <ExportBox qs={qs} me={me} getAuthHeaders={getAuthHeaders} />

      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Indicator definitions</summary>
        <ul className="mt-2 space-y-1 list-disc pl-4">{rep.indicator_definitions.map((d) => <li key={d.key}><b>{d.name}</b>: {d.definition}</li>)}</ul>
        <p className="mt-2">{rep.disclaimer}</p>
      </details>
    </div>
  );
}

const rateTxt = (r) => (r?.calculable ? r.rate_per_1000 : 'n/c');

function Labeled({ label, children }) {
  return <div><p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>{children}</div>;
}

function Metric({ big, label, note }) {
  return (
    <Card className="glass-light border-white/5">
      <CardContent className="p-4">
        <p className="text-2xl font-heading font-bold">{big}</p>
        <p className="text-[11px]">{label}</p>
        {note && <p className="text-[10px] text-muted-foreground mt-1">{note}</p>}
      </CardContent>
    </Card>
  );
}

function RateCard({ title, r }) {
  return (
    <Card className="glass-light border-white/5" data-testid="iir-rate-card">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        {r.calculable ? (
          <p className="text-xl font-bold">{r.rate_per_1000}<span className="text-xs font-normal text-muted-foreground"> / 1,000 {r.unit}</span></p>
        ) : (
          <p className="text-lg font-semibold text-muted-foreground">not calculable</p>
        )}
        <p className="text-[10px] text-muted-foreground">{r.cases} case(s) ÷ {r.exposure ?? 'no exposure'} {r.exposure ? r.unit : ''}</p>
      </CardContent>
    </Card>
  );
}

const COLORS = ['#e11d48', '#f43f5e', '#fb7185', '#fda4af', '#a855f7', '#6366f1', '#0ea5e9', '#64748b'];

function ChartCard({ title, rows, n }) {
  const data = rows.filter((r) => r.code !== '__not_filled__');
  const nf = rows.find((r) => r.code === '__not_filled__');
  return (
    <Card className="glass-light border-white/5">
      <CardHeader className="pb-1"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? <p className="text-xs text-muted-foreground py-6 text-center">No data</p> : (
          <div style={{ height: Math.max(120, data.length * 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis type="category" dataKey="label" width={150} tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }} formatter={(v, _n, p) => [`${v} (${p.payload.pct}%)`, 'Injuries']} />
                <Bar dataKey="count">{data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">Denominator: {n} episode(s){nf ? ` · not filled: ${nf.count}` : ''}</p>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ title, rows, n, extra, footnote }) {
  return (
    <Card className="glass-light border-white/5">
      <CardHeader className="pb-1"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        {rows.length === 0 && <p className="text-xs text-muted-foreground">No data</p>}
        {rows.map((r) => (
          <div key={r.code} className="flex items-center gap-2 text-xs">
            <span className={`flex-1 truncate ${r.code === '__not_filled__' ? 'italic text-muted-foreground' : ''}`}>{r.label}</span>
            <div className="w-24 h-1.5 bg-white/5 rounded"><div className="h-1.5 rounded bg-rose-500/70" style={{ width: `${Math.min(100, r.pct || 0)}%` }} /></div>
            <span className="w-20 text-right font-mono">{r.count} · {r.pct ?? '—'}%</span>
            {extra && <span className="w-28 text-right text-[10px] text-muted-foreground">{extra(r)}</span>}
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground pt-1">Denominator: {n} episode(s){footnote ? ` · ${footnote}` : ''}</p>
      </CardContent>
    </Card>
  );
}

/** Simple body map: regions laid out head-to-toe with intensity by count. */
const BODY_ORDER = [
  ['head', 'facial', 'neck'], ['clavicle', 'shoulder', 'chest', 'ribs'], ['upper_arm', 'elbow', 'mid_back_thoracic', 'abdominals'],
  ['forearm', 'wrist', 'low_back_lumbar', 'pelvis_buttocks'], ['hand_finger_thumb', 'hip_groin'], ['anterior_thigh', 'posterior_thigh'],
  ['knee'], ['calf', 'lower_leg_tib_fib'], ['ankle', 'foot_toes'], ['other_location'],
];

function BodyMap({ rows, n, note }) {
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  const max = Math.max(1, ...rows.filter((r) => r.code !== '__not_filled__').map((r) => r.count));
  return (
    <Card className="glass-light border-white/5" data-testid="iir-body-map">
      <CardHeader className="pb-1"><CardTitle className="text-sm">Body map *</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        {BODY_ORDER.map((line, i) => (
          <div key={i} className="flex justify-center gap-1">
            {line.map((code) => {
              const r = by[code];
              const a = r ? 0.15 + 0.75 * (r.count / max) : 0.04;
              return (
                <div key={code} className="px-2 py-1 rounded text-[10px] text-center min-w-[70px] border border-white/5"
                  style={{ background: `rgba(225,29,72,${a})` }} title={r ? `${r.label}: ${r.count} (${r.pct}%)` : code}>
                  {(r?.label || code.replace(/_/g, ' '))}{r ? ` · ${r.count}` : ''}
                </div>
              );
            })}
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground pt-1 flex gap-1"><Info className="w-3 h-3 shrink-0" />{note} Denominator: {n}.</p>
      </CardContent>
    </Card>
  );
}

function ExportBox({ qs, me, getAuthHeaders }) {
  const [v, setV] = useState({ dataset: 'scientific', mode: me?.can_export_identified ? 'pseudonymized' : 'pseudonymized', fmt: 'xlsx', date_mode: 'exact' });
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const extra = { dataset: v.dataset, mode: v.mode, fmt: v.dataset === 'report' ? 'pdf' : v.fmt, date_mode: v.mode === 'anonymized' ? v.date_mode : 'exact' };
      if (v.include_free_text) { extra.include_free_text = true; extra.free_text_reviewed = !!v.reviewed; }
      const r = await axios.get(`${API}/iir/export?${qs(extra)}`, { ...getAuthHeaders(), responseType: 'blob' });
      const cd = r.headers['content-disposition'] || '';
      const name = (cd.match(/filename="?([^"]+)"?/) || [])[1] || 'injury_illness_export';
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast.success('Export ready', { description: name });
    } catch (err) {
      let msg = 'Export failed';
      try { msg = JSON.parse(await err.response.data.text()).detail; if (Array.isArray(msg)) msg = msg.map((x) => x.message).join(' · '); } catch (e) { /* ignore */ }
      toast.error(msg);
    } finally { setBusy(false); }
  };
  return (
    <Card className="glass-light border-white/5" data-testid="iir-export-box">
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Download className="w-4 h-4" />Export (uses the filters above)</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Labeled label="Dataset">
            <select className={selectCls} value={v.dataset} onChange={(e) => setV({ ...v, dataset: e.target.value })}>
              <option value="scientific">Scientific (episodes, follow-up, exposure, dictionary)</option>
              <option value="compat">Compatibility (Team_Injuries / Team_Illnesses columns)</option>
              <option value="report">Report (PDF)</option>
            </select>
          </Labeled>
          <Labeled label="Identification">
            <select className={selectCls} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
              {me?.can_export_identified && <option value="identified">A · Identified clinical (names)</option>}
              <option value="pseudonymized">B · Research, pseudonymised (stable codes)</option>
              <option value="anonymized">C · Anonymised / aggregated</option>
            </select>
          </Labeled>
          {v.dataset !== 'report' && (
            <Labeled label="Format">
              <select className={selectCls} value={v.fmt} onChange={(e) => setV({ ...v, fmt: e.target.value })}>
                <option value="xlsx">XLSX</option><option value="csv">CSV (zip of related tables)</option>
              </select>
            </Labeled>
          )}
          {v.mode === 'anonymized' && (
            <Labeled label="Dates">
              <select className={selectCls} value={v.date_mode} onChange={(e) => setV({ ...v, date_mode: e.target.value })}>
                <option value="exact">Exact</option><option value="month">Month only</option><option value="relative">Days relative to event start</option>
              </select>
            </Labeled>
          )}
        </div>
        {v.mode !== 'identified' && v.dataset !== 'report' && (
          <div className="text-xs space-y-1">
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!v.include_free_text} onChange={(e) => setV({ ...v, include_free_text: e.target.checked })} />Include free-text fields (diagnoses, notes)</label>
            {v.include_free_text && (
              <label className="flex items-center gap-2 text-amber-300"><input type="checkbox" checked={!!v.reviewed} onChange={(e) => setV({ ...v, reviewed: e.target.checked })} />I reviewed the free text and it contains no names or identifying details</label>
            )}
            <p className="text-[10px] text-muted-foreground">Free text and attachments are excluded from research exports by default. Attachments are never exported.
              {v.mode === 'anonymized' ? ' Removing names does not guarantee anonymity: generalise dates and avoid rare combinations.' : ' Pseudonym codes are stable within the study; the correspondence key stays on the server.'}</p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={run} disabled={busy} data-testid="iir-export-btn">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Download className="w-3 h-3 mr-1" />Export</>}</Button>
          <Badge variant="outline" className="text-[10px]">Every export is logged with its filters</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
