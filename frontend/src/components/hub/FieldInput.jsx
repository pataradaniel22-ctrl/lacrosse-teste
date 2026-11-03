import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { toneOf, formatValue, optionOf, daysUntil, parseAlerts } from '../../lib/hub';

/** Coloured value pill for select fields; formatted text otherwise. */
export function ValuePill({ field, value, alert, className = '' }) {
  if (value === null || value === undefined || value === '') return <span className={`text-muted-foreground/50 ${className}`}>—</span>;
  if (field.key === 'medical_alerts') {
    return (
      <span className={`inline-flex flex-wrap gap-1 justify-end ${className}`}>
        {parseAlerts(value).map((a, i) => <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${toneOf(a.tone).pill}`}>{a.label}</span>)}
      </span>
    );
  }
  if (field.type === 'select') {
    const o = optionOf(field, value);
    return (
      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${toneOf(o?.tone).pill} ${className}`}>
        {o?.label || value}
      </span>
    );
  }
  if (field.type === 'date' && alert) {
    const d = daysUntil(value);
    return (
      <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${alert === 'expired' ? 'text-red-400' : 'text-amber-300'} ${className}`}>
        {formatValue(field, value)}
        <span className={`text-[10px] px-1.5 rounded-full border ${alert === 'expired' ? 'border-red-500/40 bg-red-500/10' : 'border-amber-400/40 bg-amber-400/10'}`}>
          {alert === 'expired' ? 'expired' : `${d}d left`}
        </span>
      </span>
    );
  }
  return <span className={`text-sm break-words ${className}`}>{formatValue(field, value)}</span>;
}

/** Editable input for one field definition. */
export default function FieldInput({ field, value, onChange, disabled }) {
  const v = value ?? '';
  const common = { disabled, 'data-testid': `hub-input-${field.key}` };
  if (field.type === 'select') {
    return (
      <div className="flex flex-wrap gap-1.5" {...common}>
        {(field.options || []).map((o) => {
          const on = v === o.value;
          return (
            <button
              key={o.value} type="button" disabled={disabled}
              onClick={() => onChange(on ? '' : o.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? toneOf(o.tone).pill + ' ring-1 ring-white/30' : 'border-white/10 text-muted-foreground hover:border-white/30'}`}
              data-testid={`hub-opt-${field.key}-${o.value}`}
            >{o.label}</button>
          );
        })}
      </div>
    );
  }
  if (field.type === 'textarea') {
    return <Textarea value={v} onChange={(e) => onChange(e.target.value)} rows={2} className="bg-background/50 border-white/10 text-sm" {...common} />;
  }
  const type = { date: 'date', email: 'email', phone: 'tel', number: 'number' }[field.type] || 'text';
  return <Input type={type} value={v} onChange={(e) => onChange(e.target.value)} className="h-9 bg-background/50 border-white/10 text-sm" {...common} />;
}
