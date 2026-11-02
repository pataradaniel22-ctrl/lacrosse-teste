import { ScanLine, X } from 'lucide-react';
import { Button } from '../ui/button';

/** Shows what was read from the passport and lets the user apply it. */
export default function PassportSuggestion({ data, onApply, onClose }) {
  if (!data) return null;
  const rows = [
    ['first_name', 'First name', data.first_name],
    ['last_name', 'Last name', data.last_name],
    ['birth_date', 'Date of birth', data.birth_date],
    ['passport_expiry', 'Passport expiration', data.expiry_date],
  ].filter((r) => r[2]);
  const okAll = data.checks && Object.values(data.checks).every(Boolean);
  const suggestion = Object.fromEntries(rows.map(([k, , v]) => [k, v]));
  if (data.expiry_date) {
    const exp = new Date(`${data.expiry_date}T00:00:00`);
    if (!Number.isNaN(exp.getTime())) suggestion.passport_status = exp < new Date() ? 'Expired' : 'Valid';
  }
  return (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 space-y-2 text-sm" data-testid="hub-passport-suggestion">
      <div className="flex items-center justify-between">
        <p className="font-medium flex items-center gap-1.5"><ScanLine className="w-4 h-4 text-sky-300" />Read from passport{data.nationality ? ` (${data.nationality})` : ''}</p>
        <button type="button" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {rows.map(([k, label, v]) => (<p key={k}><span className="text-muted-foreground">{label}: </span><b>{v}</b></p>))}
        {suggestion.passport_status && <p><span className="text-muted-foreground">Status: </span><b>{suggestion.passport_status}</b></p>}
      </div>
      {!okAll && <p className="text-[11px] text-amber-300">Some characters may have been misread — please check before applying.</p>}
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={() => onApply(suggestion)} data-testid="hub-passport-apply">Apply to profile</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Ignore</Button>
      </div>
    </div>
  );
}
