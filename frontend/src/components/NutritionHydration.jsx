import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Textarea } from './ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog';
import {
  Utensils, Droplets, Calculator, History, Pencil, Save, Trash2,
  Bike, Sparkles, Clock, Info, TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ReferenceArea, ReferenceLine, Cell,
} from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function sectionIcon(section) {
  if (section.startsWith('Hydration')) return Droplets;
  if (section.startsWith('Pre-Competition')) return Clock;
  if (section.startsWith('Daily')) return Utensils;
  return Info;
}

// --- unit conversion (metric <-> US customary) ---
function convUnit(unit) {
  const u = (unit || '').trim();
  if (/ml/i.test(u)) return { factor: 1 / 29.5735, label: u.replace(/ml/i, 'fl oz') };
  if (/^l\b/i.test(u) || u.toLowerCase() === 'l' || /\bl\/day\b/i.test(u)) return { factor: 33.814, label: u.replace(/\bl\b/i, 'fl oz') };
  if (/(^|\/|\s)g(\b|\/)/.test(u) && !/kg|mg/i.test(u)) return { factor: 1 / 28.3495, label: u.replace(/\bg\b/, 'oz') };
  return null;
}
function fmtNum(n) {
  if (n === null || n === undefined) return n;
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
// Convert mL / g numbers embedded in free-text metrics to US units (fl oz / oz)
function convText(text) {
  if (!text) return text;
  let t = String(text);
  t = t.replace(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*mL/gi, (_m, a, b) => `${fmtNum(a / 29.5735)}–${fmtNum(b / 29.5735)} fl oz`);
  t = t.replace(/(\d+(?:\.\d+)?)\s*mL/gi, (_m, a) => `${fmtNum(a / 29.5735)} fl oz`);
  t = t.replace(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*g(?![\/A-Za-z])/g, (_m, a, b) => `${fmtNum(a / 28.3495)}–${fmtNum(b / 28.3495)} oz`);
  t = t.replace(/(\d+(?:\.\d+)?)\s*g(?![\/A-Za-z])/g, (_m, a) => `${fmtNum(a / 28.3495)} oz`);
  return t;
}

// Render the display value for a metric (applying override if present)
function MetricRow({ m, unitSystem = 'metric' }) {
  const conv = unitSystem === 'us' ? convUnit(m.unit) : null;
  const d = (v) => (conv ? fmtNum(v * conv.factor) : v);
  const unitLabel = conv ? conv.label : m.unit;
  const hasRange = m.min !== null && m.min !== undefined;
  let display;
  if (m.is_overridden) {
    const omin = m.override_min ?? m.min;
    const omax = m.override_max ?? m.max;
    display = omax !== null && omax !== undefined && omax !== omin
      ? `${d(omin)} – ${d(omax)} ${unitLabel}`
      : `${d(omin)} ${unitLabel}`;
  } else if (hasRange) {
    display = m.max !== null && m.max !== undefined && m.max !== m.min
      ? `${d(m.min)} – ${d(m.max)} ${unitLabel}`
      : `${d(m.min)} ${unitLabel}`;
  } else {
    display = unitSystem === 'us' ? convText(m.text) : m.text;
  }
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-white/5 last:border-0" data-testid={`nutri-metric-${m.key}`}>
      <div className="flex-1 min-w-0 pr-1">
        <p className="text-sm font-medium text-foreground break-words">{m.label}</p>
        {m.note && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug break-words">{m.note}</p>}
      </div>
      <div className="text-right shrink-0 max-w-[55%]">
        <p className={`text-sm font-semibold break-words ${m.is_overridden ? 'text-amber-400' : 'text-foreground'}`}>{display}</p>
        {m.is_overridden && (
          <Badge variant="outline" className="mt-1 border-amber-500/40 text-amber-400 text-[9px] px-1.5 py-0">
            <Pencil className="w-2.5 h-2.5 mr-1" /> Modified by staff
          </Badge>
        )}
      </div>
    </div>
  );
}

function groupBySection(metrics) {
  const groups = [];
  const idx = {};
  metrics.forEach((m) => {
    if (!(m.section in idx)) {
      idx[m.section] = groups.length;
      groups.push({ section: m.section, items: [] });
    }
    groups[idx[m.section]].items.push(m);
  });
  return groups;
}

function PlanMetrics({ metrics, unitSystem }) {
  const groups = groupBySection(metrics);
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const Icon = sectionIcon(g.section);
        return (
          <div key={g.section} className="rounded-lg bg-muted/20 border border-white/5 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4 text-primary" />
              <h4 className="text-xs font-heading font-bold uppercase tracking-wide text-muted-foreground">{g.section}</h4>
            </div>
            <div>
              {g.items.map((m) => <MetricRow key={m.key} m={m} unitSystem={unitSystem} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function NutritionHydration({ athleteId = null, isStaff = false, athleteName = '' }) {
  const { getAuthHeaders } = useAuth();
  const aidParam = athleteId ? `?athlete_id=${athleteId}` : '';

  const [weight, setWeight] = useState('');
  const athleteType = 'endurance'; // Fixed: all lacrosse athletes use endurance values
  const [preview, setPreview] = useState(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  const [weightLost, setWeightLost] = useState('');
  const [unitSystem, setUnitSystem] = useState('metric'); // 'metric' (mL/g) | 'us' (oz)
  const [hydration, setHydration] = useState([]);

  // Override dialog state (staff only)
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideValues, setOverrideValues] = useState({});
  const [overrideNote, setOverrideNote] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);

  const debounceRef = useRef(null);

  const loadPlans = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const [curRes, histRes] = await Promise.all([
        axios.get(`${API}/nutrition/plans/current${aidParam}`, getAuthHeaders()),
        axios.get(`${API}/nutrition/plans/history${aidParam}`, getAuthHeaders()),
      ]);
      setCurrent(curRes.data);
      setHistory(histRes.data || []);
    } catch (e) {
      setCurrent(null);
      setHistory([]);
    } finally {
      setLoadingPlans(false);
    }
  }, [aidParam, getAuthHeaders]);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  // Hydration self-check history (urine color) from the daily check-in
  useEffect(() => {
    axios.get(`${API}/nutrition/hydration${aidParam}`, getAuthHeaders())
      .then((r) => setHydration(r.data?.entries || []))
      .catch(() => setHydration([]));
  }, [aidParam, getAuthHeaders]);

  // Live preview (debounced)
  useEffect(() => {
    const w = parseFloat(weight);
    if (!w || w <= 0) { setPreview(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setCalcLoading(true);
      try {
        const res = await axios.post(`${API}/nutrition/calculate`,
          { body_weight_kg: w, athlete_type: athleteType }, getAuthHeaders());
        setPreview(res.data);
      } catch (e) {
        setPreview(null);
      } finally {
        setCalcLoading(false);
      }
    }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [weight, athleteType, getAuthHeaders]);

  const handleSave = async () => {
    const w = parseFloat(weight);
    if (!w || w <= 0) { toast.error('Enter a valid weight (kg)'); return; }
    setSaving(true);
    try {
      const body = { body_weight_kg: w, athlete_type: athleteType };
      if (isStaff && athleteId) body.athlete_id = athleteId;
      await axios.post(`${API}/nutrition/plans`, body, getAuthHeaders());
      toast.success('Plan saved and set as current');
      await loadPlans();
    } catch (e) {
      toast.error('Failed to save the plan');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (planId) => {
    if (!window.confirm('Delete this plan from history?')) return;
    try {
      await axios.delete(`${API}/nutrition/plans/${planId}`, getAuthHeaders());
      toast.success('Plan deleted');
      await loadPlans();
    } catch (e) {
      toast.error('Failed to delete');
    }
  };

  // ---- Override (staff) ----
  const openOverride = () => {
    if (!current) return;
    const init = {};
    current.metrics.filter((m) => m.editable).forEach((m) => {
      const ov = current.overrides?.[m.key];
      init[m.key] = {
        min: ov?.min ?? '',
        max: ov?.max ?? '',
        defMin: m.min,
        defMax: m.max,
        label: m.label,
        section: m.section,
        unit: m.unit,
      };
    });
    setOverrideValues(init);
    setOverrideNote('');
    setOverrideOpen(true);
  };

  const handleOverrideSave = async () => {
    setOverrideSaving(true);
    try {
      const overrides = {};
      Object.entries(overrideValues).forEach(([key, v]) => {
        const mn = v.min === '' || v.min === null ? null : parseFloat(v.min);
        const mx = v.max === '' || v.max === null ? null : parseFloat(v.max);
        if (mn !== null || mx !== null) overrides[key] = { min: mn, max: mx };
      });
      await axios.patch(`${API}/nutrition/plans/${current.id}/override`,
        { overrides, note: overrideNote }, getAuthHeaders());
      toast.success('Staff adjustments applied');
      setOverrideOpen(false);
      await loadPlans();
    } catch (e) {
      toast.error('Failed to apply adjustments');
    } finally {
      setOverrideSaving(false);
    }
  };

  const clearOverrides = async () => {
    if (!current) return;
    if (!window.confirm('Remove all manual adjustments and return to automatic calculation?')) return;
    try {
      await axios.patch(`${API}/nutrition/plans/${current.id}/override`,
        { overrides: {}, note: null }, getAuthHeaders());
      toast.success('Adjustments removed');
      await loadPlans();
    } catch (e) {
      toast.error('Failed to remove adjustments');
    }
  };

  const factor = preview?.post_hydration_factor || current?.post_hydration_factor || 1.5;
  const litersAfter = parseFloat(weightLost) > 0 ? (parseFloat(weightLost) * factor) : null;

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return iso; }
  };

  return (
    <div className="space-y-4" data-testid="nutrition-hydration">
      {/* Unit system toggle (Metric mL/g <-> US oz) */}
      <div className="flex items-center justify-end gap-1" data-testid="nutrition-unit-toggle">
        <span className="text-[11px] text-muted-foreground mr-1">Units:</span>
        <button
          type="button" onClick={() => setUnitSystem('metric')} data-testid="unit-metric"
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${unitSystem === 'metric' ? 'bg-primary border-primary text-primary-foreground' : 'border-white/10 text-muted-foreground hover:text-foreground'}`}
        >Metric (mL/g)</button>
        <button
          type="button" onClick={() => setUnitSystem('us')} data-testid="unit-us"
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${unitSystem === 'us' ? 'bg-primary border-primary text-primary-foreground' : 'border-white/10 text-muted-foreground hover:text-foreground'}`}
        >US (oz)</button>
      </div>

      {/* Current plan summary */}
      {!loadingPlans && current && (
        <Card className="glass-light border-emerald-500/20" data-testid="nutrition-current-plan">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Current Nutrition & Hydration Plan
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-white/10 text-xs">
                  {current.body_weight_kg} kg · {current.athlete_type_label}
                </Badge>
                {current.modified_by_staff && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
                    <Pencil className="w-2.5 h-2.5 mr-1" /> Adjusted by staff
                  </Badge>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Updated on {fmtDate(current.created_at)}
              {current.created_by_name ? ` · by ${current.created_by_name}` : ''}
              {current.modified_by_staff && current.modified_by_name ? ` · adjusted by ${current.modified_by_name}` : ''}
            </p>
          </CardHeader>
          <CardContent>
            <PlanMetrics metrics={current.metrics} unitSystem={unitSystem} />
            {isStaff && (
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  onClick={openOverride} data-testid="nutrition-override-btn">
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Manual adjustment
                </Button>
                {current.modified_by_staff && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={clearOverrides}
                    data-testid="nutrition-clear-override-btn">
                    Remove adjustments
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hydration self-check history (urine color from the daily check-in) */}
      {hydration.length > 0 && (
        <Card className="glass-light border-blue-500/20" data-testid="hydration-report">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Droplets className="w-4 h-4 text-blue-400" /> Hydration Check-ins
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">Reported by the athlete in the daily check-in (urine color)</p>
          </CardHeader>
          <CardContent className="space-y-1">
            {hydration.slice(0, 8).map((h) => {
              const tone = {
                Good: 'text-emerald-400', Fair: 'text-yellow-400',
                Dehydrated: 'text-orange-400', 'Very Dehydrated': 'text-red-400', 'Severe Dehydration': 'text-red-300',
              }[h.status] || 'text-foreground';
              return (
                <div key={h.date} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0" data-testid={`hydration-entry-${h.date}`}>
                  <span className="w-5 h-7 rounded border border-white/20 shrink-0" style={{ background: h.color }} />
                  <span className="text-sm font-medium w-24 shrink-0">{fmtDate(h.date)}</span>
                  <span className={`text-sm font-semibold ${tone}`}>{h.status}</span>
                  <span className="text-xs text-muted-foreground truncate ml-auto text-right">{h.action}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Hydration charts (urine color scale 1-8; attention when >= 5 = Dehydrated) */}
      {hydration.length > 0 && (() => {
        const chrono = [...hydration].reverse();
        const trend = chrono.map((h) => ({ date: fmtDate(h.date).replace(/,.*/, ''), level: h.level }));
        const colorByLevel = {};
        hydration.forEach((h) => { colorByLevel[h.level] = h.color; });
        const dist = [1, 2, 3, 4, 5, 6, 7, 8].map((lvl) => ({
          level: `L${lvl}`, count: hydration.filter((h) => h.level === lvl).length, color: colorByLevel[lvl] || '#64748b',
        }));
        const dehydratedDays = hydration.filter((h) => h.level >= 5).length;
        const pctDehydrated = Math.round(100 * dehydratedDays / hydration.length);
        return (
          <Card className="glass-light border-blue-500/20" data-testid="hydration-charts">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-400" /> Hydration Trends
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Urine color scale 1 (well hydrated) → 8 (severe dehydration). Attention zone: level ≥ 5.
                <span className={`ml-2 font-medium ${pctDehydrated >= 30 ? 'text-orange-400' : 'text-emerald-400'}`}>
                  {pctDehydrated}% of reports dehydrated
                </span>
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Urine color over time</p>
                <div className="h-48" data-testid="hydration-trend-chart">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <ReferenceArea y1={5} y2={8} fill="#f97316" fillOpacity={0.1} />
                      <ReferenceLine y={5} stroke="#f97316" strokeDasharray="4 3" label={{ value: 'Attention', fill: '#fb923c', fontSize: 10, position: 'insideTopRight' }} />
                      <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <YAxis domain={[1, 8]} ticks={[1, 2, 3, 4, 5, 6, 7, 8]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <RTooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                      <Line type="monotone" dataKey="level" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} name="Urine color" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Distribution of reports (level 1–8)</p>
                <div className="h-40" data-testid="hydration-distribution-chart">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={dist} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey="level" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <RTooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                        {dist.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <Tabs defaultValue="calculator">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="calculator" className="text-xs sm:text-sm" data-testid="nutrition-tab-calculator">
            <Calculator className="w-4 h-4 mr-1.5" /> Calculator
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs sm:text-sm" data-testid="nutrition-tab-history">
            <History className="w-4 h-4 mr-1.5" /> History
          </TabsTrigger>
        </TabsList>

        {/* Calculator */}
        <TabsContent value="calculator" className="mt-4 space-y-4">
          <Card className="glass-light border-white/5">
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="nutri-weight" className="text-xs text-muted-foreground">Body weight (kg)</Label>
                  <Input
                    id="nutri-weight"
                    type="number"
                    inputMode="decimal"
                    placeholder="e.g. 80"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="mt-1 bg-background/50 border-white/10"
                    data-testid="nutrition-weight-input"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Athlete type</Label>
                  <div className="mt-1 flex items-center gap-2 min-h-10 py-1.5 px-3 rounded-md border border-cyan-500/30 bg-cyan-500/10"
                    data-testid="nutrition-type-fixed">
                    <Bike className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">Lacrosse Athlete</span>
                    <Badge variant="outline" className="ml-auto shrink-0 border-cyan-500/40 text-cyan-400 text-[10px]">Endurance</Badge>
                  </div>
                </div>
              </div>

              {preview && (
                <>
                  <PlanMetrics metrics={preview.metrics} unitSystem={unitSystem} />
                  {/* Post-competition mini calculator */}
                  <div className="rounded-lg bg-muted/20 border border-white/5 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Droplets className="w-4 h-4 text-blue-400" />
                      <h4 className="text-xs font-heading font-bold uppercase tracking-wide text-muted-foreground">
                        Post-Competition Replacement
                      </h4>
                    </div>
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <Label htmlFor="nutri-weight-lost" className="text-xs text-muted-foreground">Weight lost (kg)</Label>
                        <Input
                          id="nutri-weight-lost"
                          type="number"
                          inputMode="decimal"
                          placeholder="e.g. 1.5"
                          value={weightLost}
                          onChange={(e) => setWeightLost(e.target.value)}
                          className="mt-1 bg-background/50 border-white/10"
                          data-testid="nutrition-weight-lost-input"
                        />
                      </div>
                      <div className="text-right pb-1">
                        <p className="text-[11px] text-muted-foreground">Fluid replacement</p>
                        <p className="text-lg font-bold text-blue-400" data-testid="nutrition-post-liters">
                          {litersAfter !== null
                            ? (unitSystem === 'us' ? `${(litersAfter * 33.814).toFixed(1)} fl oz` : `${litersAfter.toFixed(1)} L`)
                            : (unitSystem === 'us' ? '— fl oz' : '— L')}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Formula: weight lost × {factor}</p>
                  </div>

                  <Button onClick={handleSave} disabled={saving} className="w-full bg-emerald-500 hover:bg-emerald-600"
                    data-testid="nutrition-save-btn">
                    <Save className="w-4 h-4 mr-2" /> {saving ? 'Saving...' : 'Save as current plan'}
                  </Button>
                </>
              )}
              {!preview && !calcLoading && (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  Enter the weight to automatically calculate macros and hydration.
                </div>
              )}
              {calcLoading && (
                <div className="py-8 text-center text-primary text-sm animate-pulse">Calculating...</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4 space-y-3">
          {loadingPlans ? (
            <div className="py-8 text-center text-primary text-sm animate-pulse">Loading...</div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">No plans saved yet.</div>
          ) : (
            history.map((p) => (
              <Card key={p.id} className={`glass-light ${p.is_current ? 'border-emerald-500/30' : 'border-white/5'}`}
                data-testid={`nutrition-history-${p.id}`}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{fmtDate(p.created_at)}</span>
                      <Badge variant="outline" className="border-white/10 text-[10px]">
                        {p.body_weight_kg} kg · {p.athlete_type_label}
                      </Badge>
                      {p.is_current && (
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">Current</Badge>
                      )}
                      {p.modified_by_staff && (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
                          <Pencil className="w-2.5 h-2.5 mr-1" /> Adjusted
                        </Badge>
                      )}
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-400"
                      onClick={() => handleDelete(p.id)} data-testid={`nutrition-delete-${p.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <details>
                    <summary className="text-xs text-primary cursor-pointer select-none">View plan details</summary>
                    <div className="mt-2">
                      <PlanMetrics metrics={p.metrics} />
                    </div>
                  </details>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Override dialog (staff) */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-amber-400" /> Manual adjustment (staff)
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            Leave blank to keep the automatic calculation. Filled values replace the recommendation.
          </p>
          <div className="space-y-3 mt-2">
            {Object.entries(overrideValues).map(([key, v]) => (
              <div key={key} className="rounded-lg bg-muted/20 border border-white/5 p-2.5">
                <p className="text-xs font-medium">{v.section}</p>
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  {v.label} <span className="opacity-60">(auto: {v.defMin}{v.defMax && v.defMax !== v.defMin ? `–${v.defMax}` : ''} {v.unit})</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number" placeholder={`min (${v.defMin})`} value={v.min}
                    onChange={(e) => setOverrideValues((s) => ({ ...s, [key]: { ...s[key], min: e.target.value } }))}
                    className="bg-background/50 border-white/10 h-8 text-sm"
                    data-testid={`nutrition-override-${key}-min`}
                  />
                  <Input
                    type="number" placeholder={`max (${v.defMax})`} value={v.max}
                    onChange={(e) => setOverrideValues((s) => ({ ...s, [key]: { ...s[key], max: e.target.value } }))}
                    className="bg-background/50 border-white/10 h-8 text-sm"
                    data-testid={`nutrition-override-${key}-max`}
                  />
                </div>
              </div>
            ))}
            <div>
              <Label className="text-xs text-muted-foreground">Note (optional)</Label>
              <Textarea value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)}
                className="mt-1 bg-background/50 border-white/10 text-sm" rows={2}
                placeholder="Reason for adjustment..." data-testid="nutrition-override-note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-white/10" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button className="bg-amber-500 hover:bg-amber-600" onClick={handleOverrideSave} disabled={overrideSaving}
              data-testid="nutrition-override-save-btn">
              {overrideSaving ? 'Saving...' : 'Apply adjustments'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
