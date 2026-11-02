import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { FlaskConical, UserRound, LayoutDashboard, RotateCcw, Loader2, Save, ShieldCheck } from 'lucide-react';
import { enterDemo } from './demoMode';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const selectCls = 'h-10 w-full rounded-md bg-background/50 border border-white/10 px-2 text-sm';

const LABELS = {
  daily_readiness: 'Check-ins', training_sessions: 'Training logs', recovery_logs: 'Recovery logs',
  health_weekly_submissions: 'Health (OSTRC)', iir_episodes: 'Injuries/illnesses', cmj_tests: 'CMJ tests',
  survey_responses: 'Survey answers',
};

export default function DemoModePanel({ getAuthHeaders }) {
  const [st, setSt] = useState(null);
  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/sandbox`, getAuthHeaders());
      setSt(r.data);
      setName(r.data.athlete_name || '');
      setTeam(r.data.team || r.data.teams?.[0] || '');
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not load demo mode');
    }
  }, [getAuthHeaders]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy('save');
    try {
      await axios.post(`${API}/admin/sandbox/setup`, { name, team }, getAuthHeaders());
      toast.success('Test athlete saved');
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Could not save'); } finally { setBusy(''); }
  };

  const enter = async (as) => {
    setBusy(as);
    try {
      if (name && (name !== st?.athlete_name || team !== st?.team)) {
        await axios.post(`${API}/admin/sandbox/setup`, { name, team }, getAuthHeaders());
      }
      const r = await axios.post(`${API}/admin/sandbox/enter`, { as }, getAuthHeaders());
      enterDemo(r.data);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Could not enter demo mode'); setBusy(''); }
  };

  const reset = async () => {
    if (!window.confirm('Delete ALL demo data (check-ins, logs, injuries… of the test athlete)? Real data is not affected.')) return;
    setBusy('reset');
    try {
      await axios.post(`${API}/admin/sandbox/reset`, {}, getAuthHeaders());
      toast.success('Demo data cleared');
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Could not reset'); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-4" data-testid="demo-mode-panel">
      <Card className="glass-light border-fuchsia-500/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="w-5 h-5 text-fuchsia-400" />Demo mode</CardTitle>
          <p className="text-xs text-muted-foreground">
            Use the app as a test athlete — check-ins, training logs, recovery, health surveys — for testing and demonstrations.
            Everything done in demo mode is stored in a <b>separate demo database</b>: it never appears in real dashboards,
            statistics, rankings, reports or exports.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <p className="text-xs mb-1">Test athlete name</p>
              <Input className="h-10 bg-background/50 border-white/10" value={name} placeholder="e.g. Daniel (Teste)" onChange={(e) => setName(e.target.value)} data-testid="demo-name-input" />
            </div>
            <div>
              <p className="text-xs mb-1">Team</p>
              <select className={selectCls} value={team} onChange={(e) => setTeam(e.target.value)} data-testid="demo-team-select">
                {(st?.teams || []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <Button variant="outline" onClick={save} disabled={!!busy || !name.trim()} data-testid="demo-save-btn">
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-1" />Save</>}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button className="h-14 bg-fuchsia-600 hover:bg-fuchsia-500 text-white" onClick={() => enter('athlete')} disabled={!!busy} data-testid="demo-enter-athlete-btn">
              {busy === 'athlete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserRound className="w-5 h-5 mr-2" />Enter as test athlete</>}
            </Button>
            <Button className="h-14" variant="outline" onClick={() => enter('staff')} disabled={!!busy} data-testid="demo-enter-staff-btn">
              {busy === 'staff' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><LayoutDashboard className="w-5 h-5 mr-2" />View staff dashboard with demo data</>}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A purple bar stays at the top while you are in demo mode; use <b>Exit demo</b> to return to your admin account without logging in again.
            The staff view in demo mode shows only the test athlete and the demo data.
          </p>
        </CardContent>
      </Card>

      <Card className="glass-light border-white/5">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" />Demo data</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {st?.exists ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(st.counts || {}).map(([k, v]) => (
                <div key={k} className="rounded-md border border-white/10 px-3 py-2">
                  <p className="text-lg font-bold">{v}</p><p className="text-[10px] text-muted-foreground">{LABELS[k] || k}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No demo data yet. It is created the first time you enter demo mode.</p>}
          <Button variant="outline" className="border-red-500/40 text-red-300 hover:bg-red-500/10" onClick={reset} disabled={!!busy || !st?.exists} data-testid="demo-reset-btn">
            {busy === 'reset' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RotateCcw className="w-4 h-4 mr-1" />Clear demo data</>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
