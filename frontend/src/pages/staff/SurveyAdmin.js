import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { ArrowLeft, Plus, Trash2, ClipboardList, BarChart3, Pencil, Power, X, EyeOff, GripVertical } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TEAMS = [
  { value: 'all', label: 'All teams' },
  { value: 'Brazil Lacrosse Men', label: "Men's Team" },
  { value: 'Brazil Lacrosse Women', label: "Women's Team" },
];
const todayStr = () => new Date().toISOString().slice(0, 10);
const blankQuestion = () => ({ id: `q-${Math.random().toString(36).slice(2)}`, text: '', type: 'single', options: ['', ''], allow_other: false, required: true });
const blankSurvey = () => ({ title: '', description: '', target_date: todayStr(), team: 'all', anonymous: false, active: true, questions: [blankQuestion()] });

export default function SurveyAdmin() {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankSurvey());
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState(null); // { survey_id, data }
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/admin/surveys`, getAuthHeaders());
      setSurveys(r.data || []);
    } catch (e) { toast.error('Failed to load surveys'); }
    finally { setLoading(false); }
  }, [getAuthHeaders]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditingId(null); setForm(blankSurvey()); setBuilderOpen(true); };
  const openEdit = (s) => {
    setEditingId(s.id);
    setForm({ title: s.title, description: s.description || '', target_date: s.target_date, team: s.team || 'all', anonymous: !!s.anonymous, active: s.active !== false, questions: s.questions?.length ? s.questions : [blankQuestion()] });
    setBuilderOpen(true);
  };

  const updateQ = (idx, patch) => setForm((f) => ({ ...f, questions: f.questions.map((q, i) => i === idx ? { ...q, ...patch } : q) }));
  const addQ = () => setForm((f) => ({ ...f, questions: [...f.questions, blankQuestion()] }));
  const removeQ = (idx) => setForm((f) => ({ ...f, questions: f.questions.filter((_, i) => i !== idx) }));
  const updateOpt = (qi, oi, val) => updateQ(qi, { options: form.questions[qi].options.map((o, i) => i === oi ? val : o) });
  const addOpt = (qi) => updateQ(qi, { options: [...form.questions[qi].options, ''] });
  const removeOpt = (qi, oi) => updateQ(qi, { options: form.questions[qi].options.filter((_, i) => i !== oi) });

  const save = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.target_date) { toast.error('Target date is required'); return; }
    const cleaned = form.questions.map((q) => ({
      ...q,
      text: q.text.trim(),
      options: q.type === 'text' ? [] : q.options.map((o) => o.trim()).filter(Boolean),
    }));
    if (cleaned.some((q) => !q.text)) { toast.error('Every question needs text'); return; }
    if (cleaned.some((q) => q.type !== 'text' && q.options.length < 2)) { toast.error('Choice questions need at least 2 options'); return; }
    setSaving(true);
    try {
      const payload = { ...form, questions: cleaned };
      if (editingId) await axios.put(`${API}/admin/surveys/${editingId}`, payload, getAuthHeaders());
      else await axios.post(`${API}/admin/surveys`, payload, getAuthHeaders());
      toast.success(editingId ? 'Survey updated' : 'Survey created');
      setBuilderOpen(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (s) => {
    try { await axios.put(`${API}/admin/surveys/${s.id}/toggle`, {}, getAuthHeaders()); load(); }
    catch (e) { toast.error('Failed to toggle'); }
  };
  const remove = async (s) => {
    if (!window.confirm(`Delete "${s.title}" and all its responses?`)) return;
    try { await axios.delete(`${API}/admin/surveys/${s.id}`, getAuthHeaders()); toast.success('Deleted'); load(); }
    catch (e) { toast.error('Failed to delete'); }
  };
  const openAnalysis = async (s) => {
    setAnalysis({ survey_id: s.id, data: null }); setAnalysisLoading(true);
    try { const r = await axios.get(`${API}/admin/surveys/${s.id}/analysis`, getAuthHeaders()); setAnalysis({ survey_id: s.id, data: r.data }); }
    catch (e) { toast.error('Failed to load analysis'); setAnalysis(null); }
    finally { setAnalysisLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background" data-testid="survey-admin">
      <header className="sticky top-0 z-40 glass-heavy border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/staff')} data-testid="survey-back"><ArrowLeft className="w-5 h-5" /></Button>
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-primary" />
              <div>
                <h1 className="font-heading font-bold text-lg">Quick Surveys</h1>
                <p className="text-xs text-muted-foreground">Build one-day surveys athletes answer before their daily entries</p>
              </div>
            </div>
          </div>
          <Button onClick={openCreate} data-testid="survey-new"><Plus className="w-4 h-4 mr-1" /> New survey</Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-3">
        {loading ? (
          <p className="text-center text-muted-foreground py-10 animate-pulse">Loading...</p>
        ) : surveys.length === 0 ? (
          <Card className="glass-light border-white/5"><CardContent className="p-10 text-center text-muted-foreground">
            No surveys yet. Click <span className="text-primary font-medium">New survey</span> to build one.
          </CardContent></Card>
        ) : surveys.map((s) => (
          <Card key={s.id} className="glass-light border-white/5" data-testid={`survey-card-${s.id}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{s.title}</p>
                    {s.active !== false ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Active</Badge> : <Badge className="bg-slate-500/20 text-slate-300 border-slate-500/30">Off</Badge>}
                    {s.anonymous && <Badge variant="outline" className="border-cyan-500/30 text-cyan-400 flex items-center gap-1"><EyeOff className="w-3 h-3" /> Anonymous</Badge>}
                    <Badge variant="outline" className="border-white/10">{s.target_date}</Badge>
                    <Badge variant="outline" className="border-white/10">{TEAMS.find((t) => t.value === (s.team || 'all'))?.label}</Badge>
                  </div>
                  {s.description && <p className="text-xs text-muted-foreground mt-1">{s.description}</p>}
                  <p className="text-xs text-muted-foreground mt-1">{s.questions?.length || 0} question(s) · {s.response_count || 0} response(s)</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="border-white/10" onClick={() => openAnalysis(s)} data-testid={`survey-analysis-${s.id}`}><BarChart3 className="w-4 h-4 mr-1" /> Results</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(s)} title="Toggle active" data-testid={`survey-toggle-${s.id}`}><Power className={`w-4 h-4 ${s.active !== false ? 'text-emerald-400' : 'text-muted-foreground'}`} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(s)} title="Edit" data-testid={`survey-edit-${s.id}`}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-500/10" onClick={() => remove(s)} data-testid={`survey-delete-${s.id}`}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </main>

      {/* Builder */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid="survey-builder">
          <DialogHeader><DialogTitle>{editingId ? 'Edit survey' : 'New survey'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Weekly overload" data-testid="survey-title" />
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Active on date</Label>
                <Input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} data-testid="survey-date" />
              </div>
              <div>
                <Label className="text-xs">Team</Label>
                <Select value={form.team} onValueChange={(v) => setForm({ ...form, team: v })}>
                  <SelectTrigger data-testid="survey-team"><SelectValue /></SelectTrigger>
                  <SelectContent>{TEAMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.anonymous} onCheckedChange={(v) => setForm({ ...form, anonymous: v })} data-testid="survey-anon" />
                <Label className="text-sm">Anonymous responses</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="survey-active" />
                <Label className="text-sm">Active</Label>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Questions</Label>
                <Button size="sm" variant="outline" className="border-white/10" onClick={addQ} data-testid="survey-add-question"><Plus className="w-4 h-4 mr-1" /> Add question</Button>
              </div>
              {form.questions.map((q, qi) => (
                <div key={q.id} className="rounded-lg border border-white/10 bg-muted/20 p-3 space-y-2" data-testid={`builder-q-${qi}`}>
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input value={q.text} onChange={(e) => updateQ(qi, { text: e.target.value })} placeholder={`Question ${qi + 1}`} className="flex-1" data-testid={`builder-q-${qi}-text`} />
                    <Select value={q.type} onValueChange={(v) => updateQ(qi, { type: v })}>
                      <SelectTrigger className="w-40 shrink-0" data-testid={`builder-q-${qi}-type`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="single">Choose one</SelectItem>
                        <SelectItem value="multi">Choose many</SelectItem>
                        <SelectItem value="text">Free text</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" className="text-red-400 shrink-0" onClick={() => removeQ(qi)} data-testid={`builder-q-${qi}-remove`}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                  {q.type !== 'text' && (
                    <div className="pl-6 space-y-1.5">
                      {q.options.map((o, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <Input value={o} onChange={(e) => updateOpt(qi, oi, e.target.value)} placeholder={`Option ${oi + 1}`} className="h-8 text-sm" data-testid={`builder-q-${qi}-opt-${oi}`} />
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground shrink-0" onClick={() => removeOpt(qi, oi)}><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" className="text-primary h-7" onClick={() => addOpt(qi)} data-testid={`builder-q-${qi}-add-opt`}><Plus className="w-3.5 h-3.5 mr-1" /> Add option</Button>
                    </div>
                  )}
                  <div className="flex items-center gap-5 pl-6 pt-1">
                    {q.type !== 'text' && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={q.allow_other} onCheckedChange={(v) => updateQ(qi, { allow_other: v })} /> Allow "Other"
                      </label>
                    )}
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch checked={q.required} onCheckedChange={(v) => updateQ(qi, { required: v })} /> Required
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="outline" className="border-white/10" onClick={() => setBuilderOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} data-testid="survey-save">{saving ? 'Saving...' : (editingId ? 'Save changes' : 'Create survey')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Analysis */}
      <Dialog open={!!analysis} onOpenChange={(o) => !o && setAnalysis(null)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid="survey-analysis-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" /> Survey results</DialogTitle></DialogHeader>
          {analysisLoading || !analysis?.data ? (
            <p className="text-center text-muted-foreground py-8 animate-pulse">Loading...</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold">{analysis.data.survey.title}</p>
                {analysis.data.anonymous && <Badge variant="outline" className="border-cyan-500/30 text-cyan-400"><EyeOff className="w-3 h-3 mr-1" /> Anonymous</Badge>}
                <Badge variant="outline" className="border-white/10">{analysis.data.response_count}/{analysis.data.target_total} responded</Badge>
              </div>
              {analysis.data.questions.map((q, qi) => {
                const total = q.options ? q.options.reduce((a, o) => a + o.count, 0) : 0;
                return (
                  <div key={q.question_id} className="rounded-lg border border-white/5 bg-muted/20 p-3">
                    <p className="text-sm font-medium mb-2">{qi + 1}. {q.text}</p>
                    {q.type === 'text' ? (
                      <div className="space-y-1.5">
                        {(q.texts || []).length === 0 ? <p className="text-xs text-muted-foreground">No answers yet.</p> :
                          q.texts.map((t, i) => (
                            <div key={i} className="text-sm bg-white/5 rounded px-2.5 py-1.5">
                              {t.text}{t.athlete_name && <span className="text-xs text-muted-foreground"> — {t.athlete_name}</span>}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {q.options.map((o) => {
                          const pct = total > 0 ? Math.round(100 * o.count / total) : 0;
                          return (
                            <div key={o.label}>
                              <div className="flex justify-between text-xs mb-0.5"><span>{o.label}</span><span className="text-muted-foreground">{o.count} ({pct}%)</span></div>
                              <div className="h-2 rounded bg-white/10 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                            </div>
                          );
                        })}
                        {(q.other_texts || []).length > 0 && (
                          <div className="pt-1">
                            <p className="text-[11px] text-muted-foreground">Other:</p>
                            {q.other_texts.map((t, i) => <p key={i} className="text-xs bg-white/5 rounded px-2 py-1 mt-1">{t}</p>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
