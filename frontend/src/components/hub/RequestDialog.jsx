import { useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Send, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { API } from '../../lib/hub';

/** Ask one or many athletes to complete specific items (or everything missing). */
export default function RequestDialog({ open, onOpenChange, athletes, fields, docTypes, getAuthHeaders, onSent }) {
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);

  const catalog = useMemo(() => [
    ...docTypes.filter((d) => d.athlete_can_upload).map((d) => ({ key: d.key, label: d.label, kind: 'Document' })),
    ...fields.filter((f) => f.athlete_editable && !f.hidden).map((f) => ({ key: f.key, label: f.label, kind: 'Info' })),
  ], [fields, docTypes]);

  const send = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/staff/hub/requests`, {
        athlete_ids: athletes.map((a) => a.id), items, message, due_date: due || null,
      }, getAuthHeaders());
      const skipped = r.data.skipped_complete?.length ? ` · ${r.data.skipped_complete.length} already complete` : '';
      toast.success(`Request sent to ${r.data.created} athlete(s)${skipped}`);
      setItems([]); setMessage(''); setDue('');
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not send');
    } finally { setBusy(false); }
  };

  const toggle = (k) => setItems((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="hub-request-dialog">
        <DialogHeader><DialogTitle>Request information</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            To: <b className="text-foreground">{athletes.length === 1 ? athletes[0].name : `${athletes.length} athletes`}</b>.
            They get a notification and a reminder in the app until it is done.
          </p>
          <div>
            <p className="text-xs font-medium mb-1.5">What is needed?</p>
            <button type="button" onClick={() => setItems([])}
              className={`text-xs px-2.5 py-1 rounded-full border mr-1.5 mb-1.5 ${!items.length ? 'bg-primary text-primary-foreground border-primary' : 'border-white/10 text-muted-foreground'}`}
              data-testid="hub-request-missing">Everything missing</button>
            {catalog.map((c) => (
              <button key={c.key} type="button" onClick={() => toggle(c.key)}
                className={`text-xs px-2.5 py-1 rounded-full border mr-1.5 mb-1.5 ${items.includes(c.key) ? 'bg-sky-500 text-white border-sky-500' : 'border-white/10 text-muted-foreground hover:border-white/30'}`}
                data-testid={`hub-request-item-${c.key}`}>{c.label}</button>
            ))}
          </div>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000}
            placeholder="Message (optional), e.g. Please upload your passport photo page before the camp." className="bg-background/50 border-white/10" data-testid="hub-request-message" />
          <label className="flex items-center gap-2 text-xs">Due date (optional)
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-40 bg-background/50 border-white/10" />
          </label>
          <Button onClick={send} disabled={busy || !athletes.length} className="w-full" data-testid="hub-request-send">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-1.5" />Send request</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
