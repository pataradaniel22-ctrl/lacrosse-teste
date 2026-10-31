import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';
import axios from 'axios';
import { NotebookPen, Trash2, Loader2, Plus } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CATEGORIES = ['General', 'Pain', 'Injury', 'Mental Health', 'Nutrition', 'Other'];
const CAT_STYLE = {
  General: 'bg-muted/40 text-muted-foreground border-white/10',
  Pain: 'bg-red-500/10 text-red-400 border-red-500/30',
  Injury: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  'Mental Health': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  Nutrition: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  Other: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
};

export default function AthleteRecord({ athleteId }) {
  const { getAuthHeaders, user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('General');
  const [related, setRelated] = useState('');

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/staff/athlete/${athleteId}/notes`, getAuthHeaders());
      setNotes(res.data.notes || []);
    } catch (e) {
      toast.error('Failed to load clinical record.');
    } finally {
      setLoading(false);
    }
  }, [athleteId, getAuthHeaders]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const addNote = async () => {
    if (!body.trim()) { toast.error('Write something first.'); return; }
    setSaving(true);
    try {
      const res = await axios.post(`${API}/staff/athlete/${athleteId}/notes`,
        { body: body.trim(), category, related: related.trim() || null }, getAuthHeaders());
      setNotes((n) => [res.data.note, ...n]);
      setBody(''); setRelated(''); setCategory('General');
      toast.success('Note added to record.');
    } catch (e) {
      toast.error('Could not save note.');
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async (id) => {
    try {
      await axios.delete(`${API}/staff/athlete-note/${id}`, getAuthHeaders());
      setNotes((n) => n.filter((x) => x.id !== id));
      toast.success('Note deleted.');
    } catch (e) {
      toast.error(e?.response?.status === 403 ? 'Only an admin can delete notes.' : 'Could not delete note.');
    }
  };

  return (
    <div className="space-y-4" data-testid="athlete-record">
      <Card className="glass-light border-white/5">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <NotebookPen className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Clinical Record — add entry</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1 h-9" data-testid="record-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Related to (optional — e.g. Knee, complaint)</label>
              <Input value={related} onChange={(e) => setRelated(e.target.value)} placeholder="Optional" className="mt-1 h-9" data-testid="record-related" />
            </div>
          </div>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write an observation, assessment or plan..." rows={3} data-testid="record-body" />
          <div className="flex justify-end">
            <Button size="sm" onClick={addNote} disabled={saving} data-testid="record-add-btn">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Add to record
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
      ) : notes.length === 0 ? (
        <Card className="glass-light border-white/5"><CardContent className="py-8 text-center text-muted-foreground" data-testid="record-empty">No entries yet.</CardContent></Card>
      ) : (
        <div className="space-y-2" data-testid="record-list">
          {notes.map((n) => (
            <Card key={n.id} className="glass-light border-white/5" data-testid={`record-note-${n.id}`}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] ${CAT_STYLE[n.category] || CAT_STYLE.General}`}>{n.category}</Badge>
                    {n.related && <Badge variant="outline" className="text-[10px] border-white/10">Re: {n.related}</Badge>}
                    <span className="text-[11px] text-muted-foreground">{n.author} · {String(n.created_at).slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:bg-red-500/10 shrink-0" onClick={() => removeNote(n.id)} data-testid={`record-delete-${n.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
                <p className="text-sm mt-2 whitespace-pre-wrap">{n.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
