import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Phone, Mail, MapPin, Cake, FileCheck2, AlertTriangle, ChevronRight, IdCard, HeartPulse, Siren } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { ValuePill } from './FieldInput';
import { API, formatValue, parseAlerts, toneOf } from '../../lib/hub';

const KEY_FIELDS = ['passport_status', 'passport_expiry', 'dues_2026', 'safeguarding', 'cpf_status'];

/**
 * "Encyclopedia" header on the staff athlete page: who the athlete is, how to
 * reach them and their admin status at a glance; the full record is one tap away.
 */
export default function AthleteSummaryCard({ athleteId, getAuthHeaders, onOpenFull }) {
  const auth = useRef(getAuthHeaders); auth.current = getAuthHeaders;
  const [rec, setRec] = useState(null);
  useEffect(() => {
    setRec(null);
    axios.get(`${API}/staff/hub/athlete/${athleteId}`, { ...auth.current(), skipGroupFilter: true })
      .then((r) => setRec(r.data)).catch(() => setRec(false));
  }, [athleteId]);
  if (!rec) return null;

  const f = Object.fromEntries(rec.fields.map((x) => [x.key, x]));
  const v = rec.values;
  const fullName = [v.first_name, v.last_name].filter(Boolean).join(' ');
  const place = [v.city_state, v.country].filter(Boolean).join(', ');
  const status = KEY_FIELDS.filter((k) => f[k] && !f[k].hidden);
  const docCount = rec.documents.length;

  return (
    <Card className="glass-light border-primary/20 mb-4" data-testid="athlete-summary-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 space-y-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><IdCard className="w-3.5 h-3.5" />Athlete profile</p>
            {fullName && fullName !== rec.athlete.name && <p className="text-sm font-medium">{fullName}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {v.birth_date && <span className="flex items-center gap-1"><Cake className="w-3.5 h-3.5" />{formatValue(f.birth_date, v.birth_date)}{rec.age != null ? ` · ${rec.age} y` : ''}</span>}
              {place && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{place}</span>}
              {v.phone && <a href={`tel:${v.phone}`} className="flex items-center gap-1 hover:text-foreground"><Phone className="w-3.5 h-3.5" />{v.phone}</a>}
              {v.contact_email && <a href={`mailto:${v.contact_email}`} className="flex items-center gap-1 hover:text-foreground"><Mail className="w-3.5 h-3.5" />{v.contact_email}</a>}
            </div>
          </div>
          <button type="button" onClick={onOpenFull} className="text-xs text-primary flex items-center gap-0.5 hover:underline shrink-0" data-testid="athlete-summary-open">
            Full profile & documents<ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {status.map((k) => (
            <div key={k}>
              <p className="text-[10px] text-muted-foreground">{f[k].label}</p>
              <ValuePill field={f[k]} value={v[k]} alert={rec.alerts?.[k]} />
            </div>
          ))}
          <div>
            <p className="text-[10px] text-muted-foreground">Documents</p>
            <span className="text-xs flex items-center gap-1"><FileCheck2 className="w-3.5 h-3.5 text-sky-400" />{docCount}</span>
          </div>
        </div>
        {(v.medical_alerts || v.has_allergies || v.emergency_contact) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2" data-testid="athlete-summary-medical">
            <span className="text-[10px] uppercase tracking-wider text-rose-300 flex items-center gap-1"><HeartPulse className="w-3.5 h-3.5" />Medical</span>
            {v.medical_alerts && (
              <span className="flex flex-wrap gap-1 items-center"><Siren className="w-3.5 h-3.5 text-muted-foreground" />
                {parseAlerts(v.medical_alerts).map((a, i) => <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border ${toneOf(a.tone).pill}`}>{a.label}</span>)}
              </span>
            )}
            {f.has_allergies && v.has_allergies && (
              <span className="text-xs">Allergies: <ValuePill field={f.has_allergies} value={v.has_allergies} />{v.has_allergies === 'Yes' && (v.drug_allergies || v.food_allergies) ? <span className="text-muted-foreground"> {[v.drug_allergies, v.food_allergies].filter(Boolean).join(' · ').slice(0, 60)}</span> : null}</span>
            )}
            {v.emergency_contact && (
              <span className="text-xs flex items-center gap-1">Emergency: <b>{v.emergency_contact}</b>
                {v.emergency_phone && <a href={`tel:${v.emergency_phone}`} className="text-emerald-400 hover:underline">{v.emergency_phone}</a>}
              </span>
            )}
          </div>
        )}
        {rec.missing.length > 0 && (
          <p className="text-[11px] text-amber-300 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Missing: {rec.missing.map((m) => (m.kind === 'doc' ? `${m.label} (file)` : m.label)).join(' · ')}</p>
        )}
      </CardContent>
    </Card>
  );
}
