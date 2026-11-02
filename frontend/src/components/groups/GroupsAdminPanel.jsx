import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tags, Plus, Trash2, Save, Search, Loader2, Check } from 'lucide-react';
import { GROUP_COLORS, colorOf, fetchGroups, setGroupsCache } from '../../lib/athleteGroups';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const errMsg = (e, fb) => e?.response?.data?.detail || fb;

export default function GroupsAdminPanel({ getAuthHeaders: getAuthHeadersProp }) {
  const authRef = useRef(getAuthHeadersProp);
  authRef.current = getAuthHeadersProp;
  const getAuthHeaders = useCallback(() => authRef.current(), []);
  const [groups, setGroups] = useState([]);
  const [draft, setDraft] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState({});
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('all');
  const [only, setOnly] = useState('all'); // all | none | <group id>
  const [selected, setSelected] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, a] = await Promise.all([
        fetchGroups(true),
        axios.get(`${API}/staff/athletes`, { ...getAuthHeaders(), skipGroupFilter: true }),
      ]);
      setGroups(g);
      setDraft(g.map((x) => ({ ...x })));
      const list = Array.isArray(a.data) ? a.data : (a.data?.athletes || []);
      setAthletes(list.sort((x, y) => (x.name || '').trim().localeCompare((y.name || '').trim())));
    } catch (e) {
      toast.error(errMsg(e, 'Could not load groups'));
    } finally { setLoading(false); }
  }, [getAuthHeaders]);

  useEffect(() => { load(); }, [load]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(groups);

  const saveDefs = async () => {
    setSaving(true);
    try {
      const r = await axios.put(`${API}/admin/athlete-groups`, { groups: draft.map(({ id, name, color }) => ({ id, name, color })) }, getAuthHeaders());
      setGroups(r.data.groups);
      setDraft(r.data.groups.map((x) => ({ ...x })));
      setGroupsCache(r.data.groups);
      if (r.data.removed?.length) {
        setAthletes((list) => list.map((a) => ({ ...a, groups: (a.groups || []).filter((g) => !r.data.removed.includes(g)) })));
      }
      toast.success('Groups saved');
    } catch (e) {
      toast.error(errMsg(e, 'Could not save groups'));
    } finally { setSaving(false); }
  };

  const setAthleteGroups = async (athlete, next) => {
    setBusy((b) => ({ ...b, [athlete.id]: true }));
    const prev = athlete.groups || [];
    setAthletes((list) => list.map((a) => (a.id === athlete.id ? { ...a, groups: next } : a)));
    try {
      await axios.put(`${API}/staff/athletes/${athlete.id}/groups`, { groups: next }, getAuthHeaders());
    } catch (e) {
      setAthletes((list) => list.map((a) => (a.id === athlete.id ? { ...a, groups: prev } : a)));
      toast.error(errMsg(e, 'Could not update'));
    } finally { setBusy((b) => ({ ...b, [athlete.id]: false })); }
  };

  const toggle = (athlete, gid) => {
    const cur = athlete.groups || [];
    setAthleteGroups(athlete, cur.includes(gid) ? cur.filter((x) => x !== gid) : [...cur, gid]);
  };

  const bulk = async (gid, add) => {
    const targets = athletes.filter((a) => selected.has(a.id));
    for (const a of targets) {
      const cur = a.groups || [];
      const next = add ? (cur.includes(gid) ? cur : [...cur, gid]) : cur.filter((x) => x !== gid);
      if (next.length !== cur.length) await setAthleteGroups(a, next); // eslint-disable-line no-await-in-loop
    }
    toast.success(`${targets.length} athlete(s) updated`);
  };

  const teams = useMemo(() => [...new Set(athletes.map((a) => a.team).filter(Boolean))], [athletes]);
  const visible = athletes.filter((a) => {
    if (q && !`${a.name} ${a.email}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (team !== 'all' && a.team !== team) return false;
    if (only === 'none') return !(a.groups || []).length;
    if (only !== 'all') return (a.groups || []).includes(only);
    return true;
  });
  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.id));
  const toggleAllVisible = () => setSelected((s) => {
    const n = new Set(s);
    if (allVisibleSelected) visible.forEach((a) => n.delete(a.id)); else visible.forEach((a) => n.add(a.id));
    return n;
  });

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4" data-testid="groups-admin-panel">
      {/* Group definitions */}
      <Card className="glass-light border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Tags className="w-5 h-5 text-primary" />Athlete groups</CardTitle>
          <p className="text-xs text-muted-foreground">Groups appear as quick filters on the dashboard and as labels next to athlete names. An athlete can be in several groups.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {draft.map((g, i) => (
            <div key={g.id || `new-${i}`} className="flex items-center gap-2 flex-wrap">
              <Input
                value={g.name} maxLength={30} className="h-9 w-48 bg-background/50 border-white/10"
                onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                data-testid={`group-name-${i}`}
              />
              <div className="flex gap-1">
                {Object.keys(GROUP_COLORS).map((c) => (
                  <button
                    key={c} type="button" title={c} aria-label={c}
                    onClick={() => setDraft((d) => d.map((x, j) => (j === i ? { ...x, color: c } : x)))}
                    className={`w-6 h-6 rounded-full ${GROUP_COLORS[c].dot} flex items-center justify-center ${g.color === c ? 'ring-2 ring-offset-2 ring-offset-background ring-white' : 'opacity-60 hover:opacity-100'}`}
                    data-testid={`group-color-${i}-${c}`}
                  >{g.color === c && <Check className="w-3.5 h-3.5 text-black" />}</button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground w-20">{athletes.filter((a) => (a.groups || []).includes(g.id)).length} athletes</span>
              <Button
                variant="ghost" size="sm" className="text-red-400 hover:text-red-300"
                onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} data-testid={`group-delete-${i}`}
              ><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
          <div className="flex gap-2 pt-1 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setDraft((d) => [...d, { id: '', name: 'New group', color: 'purple' }])} disabled={draft.length >= 20} data-testid="group-add-btn">
              <Plus className="w-4 h-4 mr-1" />Add group
            </Button>
            <Button size="sm" onClick={saveDefs} disabled={!dirty || saving || draft.some((g) => !g.name.trim())} data-testid="group-save-btn">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-1" />Save groups</>}
            </Button>
            {dirty && <span className="text-xs text-amber-300 self-center">Unsaved changes. Deleting a group removes it from all athletes.</span>}
          </div>
        </CardContent>
      </Card>

      {/* Assignment */}
      <Card className="glass-light border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Who is in each group</CardTitle>
          <p className="text-xs text-muted-foreground">Tap a label to add or remove the athlete. Changes are saved immediately.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search athlete" className="h-9 w-48 pl-8 bg-background/50 border-white/10" data-testid="groups-search" />
            </div>
            <select value={team} onChange={(e) => setTeam(e.target.value)} className="h-9 rounded-md bg-background/50 border border-white/10 px-2 text-sm" data-testid="groups-team-filter">
              <option value="all">All teams</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={only} onChange={(e) => setOnly(e.target.value)} className="h-9 rounded-md bg-background/50 border border-white/10 px-2 text-sm" data-testid="groups-only-filter">
              <option value="all">Everyone</option>
              <option value="none">Without group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>Only {g.name}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">{visible.length} shown</span>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-md border border-primary/30 bg-primary/5 p-2 text-xs" data-testid="groups-bulk-bar">
              <b>{selected.size} selected</b>
              {groups.map((g) => (
                <span key={g.id} className="flex gap-1">
                  <button type="button" onClick={() => bulk(g.id, true)} className={`px-2 py-1 rounded-full border ${colorOf(g.color).chip}`} data-testid={`bulk-add-${g.id}`}>+ {g.name}</button>
                  <button type="button" onClick={() => bulk(g.id, false)} className="px-2 py-1 rounded-full border border-white/15 text-muted-foreground" data-testid={`bulk-remove-${g.id}`}>− {g.name}</button>
                </span>
              ))}
              <button type="button" onClick={() => setSelected(new Set())} className="ml-auto underline text-muted-foreground">Clear selection</button>
            </div>
          )}

          <div className="rounded border border-white/10 divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
            <label className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground bg-white/5 sticky top-0 z-10 backdrop-blur">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} data-testid="groups-select-all" />
              Select all shown
            </label>
            {visible.map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-2 flex-wrap" data-testid={`groups-row-${a.id}`}>
                <input
                  type="checkbox" checked={selected.has(a.id)}
                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
                />
                <div className="min-w-[10rem] flex-1">
                  <p className="text-sm font-medium leading-tight">{(a.name || '').trim()}</p>
                  <p className="text-[11px] text-muted-foreground">{a.team}</p>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {groups.map((g) => {
                    const on = (a.groups || []).includes(g.id);
                    return (
                      <button
                        key={g.id} type="button" disabled={busy[a.id]} onClick={() => toggle(a, g.id)}
                        className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${on ? colorOf(g.color).solid : 'border-white/10 text-muted-foreground hover:border-white/30'}`}
                        data-testid={`toggle-${a.id}-${g.id}`}
                      >{on ? '✓ ' : ''}{g.name}</button>
                    );
                  })}
                </div>
              </div>
            ))}
            {!visible.length && <p className="text-xs text-muted-foreground p-4 text-center">No athletes match.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
