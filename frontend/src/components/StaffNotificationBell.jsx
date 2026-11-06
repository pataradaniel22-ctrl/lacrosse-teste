import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Bell, HeartPulse, MessageSquare, FileUp, CheckCircle2, CalendarClock, UserPlus, AlertTriangle, X, CheckCheck, Loader2, BellOff,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_MS = 60000;

const KIND_ICON = { alert: AlertTriangle, message: MessageSquare, document: FileUp, request: CheckCircle2, follow_up: CalendarClock, registration: UserPlus };
const SEV = {
  red: { icon: 'text-red-400', dot: 'bg-red-500', bar: 'border-l-red-500' },
  yellow: { icon: 'text-amber-300', dot: 'bg-amber-400', bar: 'border-l-amber-400' },
  info: { icon: 'text-sky-400', dot: 'bg-sky-400', bar: 'border-l-sky-500' },
};

function ago(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (Number.isNaN(s)) return '';
  if (s < 0) return d.toLocaleDateString();
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return d.toLocaleDateString();
}

/** The staff bell: unified notifications, badge = new since you last opened it. */
export default function StaffNotificationBell({ getAuthHeaders: gah }) {
  const auth = useRef(gah); auth.current = gah;
  const getAuthHeaders = useCallback(() => auth.current(), []);
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState('all');

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/staff/notifications`, getAuthHeaders());
      setData(r.data);
    } catch { /* keep last */ }
  }, [getAuthHeaders]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const onOpenChange = async (v) => {
    setOpen(v);
    if (v) {
      await load();
      // opening the bell = seen: the badge goes to zero, new items stay highlighted while open
      axios.post(`${API}/staff/notifications/seen`, {}, getAuthHeaders()).catch(() => {});
    } else if (data?.unread) {
      setData((d) => d && { ...d, unread: 0, red_unread: 0, items: d.items.map((i) => ({ ...i, new: false })) });
    }
  };

  const dismiss = async (ids) => {
    setData((d) => d && { ...d, items: d.items.filter((i) => !ids.includes(i.id)) });
    try { await axios.post(`${API}/staff/notifications/dismiss`, { ids }, getAuthHeaders()); }
    catch { toast.error('Could not update'); load(); }
  };

  const resolve = async (item) => {
    setBusy(item.id);
    try {
      await axios.put(`${API}/staff/alerts/${item.ref}/resolve`, {}, getAuthHeaders());
      setData((d) => d && { ...d, items: d.items.filter((i) => i.id !== item.id) });
      toast.success('Alert resolved for the whole staff');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not resolve'); } finally { setBusy(''); }
  };

  const go = (item) => { setOpen(false); navigate(item.link); };

  const unread = data?.unread || 0;
  const items = data?.items || [];
  const shown = tab === 'all' ? items : items.filter((i) => (tab === 'alerts' ? i.kind === 'alert' : i.kind !== 'alert'));
  const nAlerts = items.filter((i) => i.kind === 'alert').length;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8 sm:h-9 sm:w-9" data-testid="staff-bell-btn" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`}>
          <Bell className={`w-4 h-4 sm:w-5 sm:h-5`} />
          {unread > 0 && (
            <span className={`absolute -top-1 -right-1 min-w-4 h-4 sm:min-w-5 sm:h-5 px-1 rounded-full text-[8px] sm:text-[10px] text-white flex items-center justify-center font-bold ${data?.red_unread ? 'bg-red-500' : 'bg-sky-500'}`} data-testid="staff-bell-count">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0" data-testid="staff-bell-popover">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <p className="font-semibold text-sm flex items-center gap-2">Notifications
            {items.some((i) => i.new) && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300">{items.filter((i) => i.new).length} new</span>}
          </p>
          <div className="flex items-center gap-3">
            {items.length > 0 && (
              <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => dismiss(items.filter((i) => i.kind !== 'alert').map((i) => i.id))} title="Remove all except health alerts" data-testid="staff-bell-clear">
                <CheckCheck className="w-3.5 h-3.5" />Clear
              </button>
            )}
            <Link to="/staff/alerts" onClick={() => setOpen(false)} className="text-[11px] text-primary hover:underline">Health alerts</Link>
          </div>
        </div>
        <div className="flex gap-1 px-3 pt-2">
          {[['all', `All ${items.length}`], ['alerts', `Health alerts ${nAlerts}`], ['other', `Other ${items.length - nAlerts}`]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`text-[11px] px-2.5 py-1 rounded-full ${tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`} data-testid={`staff-bell-tab-${k}`}>{l}</button>
          ))}
        </div>
        <div className="max-h-[26rem] overflow-y-auto py-2">
          {!data ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !shown.length ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground" data-testid="staff-bell-empty">
              <BellOff className="w-6 h-6 mx-auto mb-2 opacity-50" />You're all caught up.
            </div>
          ) : shown.map((i) => {
            const Icon = i.kind === 'message' && i.severity === 'red' ? HeartPulse : (KIND_ICON[i.kind] || Bell);
            const sev = SEV[i.severity] || SEV.info;
            return (
              <div key={i.id} className={`group relative mx-2 mb-1 rounded-lg border-l-2 ${sev.bar} ${i.new ? 'bg-white/[0.06]' : 'bg-transparent opacity-80'} hover:bg-white/10 transition-colors`} data-testid={`staff-notif-${i.kind}`}>
                <button type="button" onClick={() => go(i)} className="w-full text-left px-3 py-2.5 pr-16">
                  <div className="flex items-start gap-2">
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${sev.icon}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13px] leading-tight truncate ${i.new ? 'font-semibold' : 'font-medium'}`}>{i.title}</p>
                      {i.subtitle && <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{i.subtitle}</p>}
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{ago(i.at)}</p>
                    </div>
                    {i.new && <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />}
                  </div>
                </button>
                <div className="absolute right-2 top-2 flex items-center gap-1">
                  {i.kind === 'alert' && i.resolvable && (
                    <button type="button" onClick={() => resolve(i)} disabled={busy === i.id} className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15" data-testid="staff-notif-resolve">
                      {busy === i.id ? '…' : 'Resolve'}
                    </button>
                  )}
                  <button type="button" onClick={() => dismiss([i.id])} className="p-0.5 rounded text-muted-foreground opacity-60 hover:opacity-100" aria-label="Dismiss" title="Hide for me" data-testid="staff-notif-dismiss">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
