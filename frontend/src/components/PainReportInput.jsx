import { useState } from 'react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Slider } from './ui/slider';
import { toast } from 'sonner';
import { Plus, X, Info, Activity } from 'lucide-react';

const BODY_REGIONS = ['Neck', 'Shoulder', 'Elbow', 'WristHand', 'LowBack', 'HipGroin', 'Knee', 'AnkleFoot', 'Other'];
const REGION_LABELS = {
  Neck: 'Neck', Shoulder: 'Shoulder', Elbow: 'Elbow', WristHand: 'Wrist/Hand',
  LowBack: 'Low Back', HipGroin: 'Hip/Groin', Knee: 'Knee', AnkleFoot: 'Ankle/Foot', Other: 'Other',
};
const LATERALITY_OPTIONS = [
  { value: 'Left', label: 'Left' },
  { value: 'Right', label: 'Right' },
  { value: 'Both', label: 'Both' },
  { value: 'N/A', label: 'N/A (Central)' },
];
const CENTRAL_REGIONS = ['Neck', 'LowBack'];

/**
 * Controlled, optional pain-report input.
 * Uses tappable chip selectors (instead of dropdowns) so it works reliably on
 * mobile/touch devices.
 * Props: value (array of {body_region, laterality, pain_level}), onChange(newArray)
 */
export function PainReportInput({ value = [], onChange, title = 'Pain Report', subtitle = 'Optional — add any pain you feel right now.' }) {
  const [newPain, setNewPain] = useState({ body_region: null, laterality: null, pain_level: 5, region_note: '' });

  const selectRegion = (region) => {
    setNewPain((p) => ({
      ...p,
      body_region: region,
      laterality: CENTRAL_REGIONS.includes(region) ? 'N/A' : (p.body_region === region ? p.laterality : null),
      region_note: region === 'Other' ? p.region_note : '',
    }));
  };

  const regionLabel = (p) => (p.body_region === 'Other' && p.region_note)
    ? `Other — ${p.region_note}`
    : (REGION_LABELS[p.body_region] || p.body_region);

  const addPain = () => {
    if (!newPain.body_region) { toast.error('Select a body region'); return; }
    if (!newPain.laterality) { toast.error('Select the side (laterality)'); return; }
    if (newPain.body_region === 'Other' && !(newPain.region_note || '').trim()) {
      toast.error('Describe the "Other" pain location'); return;
    }
    const exists = value.some((p) => p.body_region === newPain.body_region && p.laterality === newPain.laterality
      && (p.body_region !== 'Other' || (p.region_note || '').trim().toLowerCase() === (newPain.region_note || '').trim().toLowerCase()));
    if (exists) { toast.error('This pain location was already added'); return; }
    onChange([...value, { ...newPain, region_note: (newPain.region_note || '').trim() || null }]);
    setNewPain({ body_region: null, laterality: null, pain_level: 5, region_note: '' });
    toast.success('Pain location added');
  };

  const removePain = (idx) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3" data-testid="pain-report-input">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-red-500" />
          <Label className="font-medium">{title}</Label>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">Optional</Badge>
        </div>
        {value.length > 0 && (
          <Badge variant="outline" className="border-red-500/40 text-red-600 text-xs">
            {value.length} reported
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{subtitle}</p>

      {/* Existing pain locations */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((pain, index) => (
            <div key={index} className="flex items-center justify-between p-2.5 rounded-lg bg-red-500/10 border border-red-500/20" data-testid={`pain-item-${index}`}>
              <div className="flex items-center gap-2">
                <span className="text-red-500">🔥</span>
                <div>
                  <p className="font-medium text-sm">{regionLabel(pain)}</p>
                  <p className="text-xs text-muted-foreground">{pain.laterality} • Level {pain.pain_level}/10</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => removePain(index)} className="text-red-500 hover:bg-red-500/20 h-8 w-8 p-0" data-testid={`remove-pain-${index}`}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add new pain */}
      <div className="p-3 rounded-lg bg-muted/30 border border-white/5 space-y-3">
        {/* Body Region chips */}
        <div>
          <Label className="text-sm">Body Region</Label>
          <div className="grid grid-cols-3 gap-2 mt-2" data-testid="pain-region-options">
            {BODY_REGIONS.map((r) => {
              const active = newPain.body_region === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => selectRegion(r)}
                  data-testid={`pain-region-${r}`}
                  className={`px-2 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-red-500 text-white border-red-500'
                      : 'bg-background/50 border-white/10 text-foreground hover:border-red-500/40'
                  }`}
                >
                  {REGION_LABELS[r]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Required free-text when region is Other */}
        {newPain.body_region === 'Other' && (
          <div className="animate-fade-in">
            <Label className="text-sm">Describe the location <span className="text-red-500">*</span></Label>
            <input
              type="text"
              value={newPain.region_note || ''}
              onChange={(e) => setNewPain((p) => ({ ...p, region_note: e.target.value }))}
              placeholder="e.g., Jaw, Ribs, Head…"
              maxLength={200}
              data-testid="pain-region-note-input"
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm bg-background/50 border border-white/10 focus:border-red-500/50 outline-none"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Required — this exact text is shown to your staff.</p>
          </div>
        )}

        {/* Side chips */}
        {newPain.body_region && (
          <div className="animate-fade-in">
            <Label className="text-sm">Side</Label>
            <div className="grid grid-cols-2 gap-2 mt-2" data-testid="pain-laterality-options">
              {LATERALITY_OPTIONS.map((o) => {
                const active = newPain.laterality === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setNewPain((p) => ({ ...p, laterality: o.value }))}
                    data-testid={`pain-laterality-${o.value}`}
                    className={`px-2 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-red-500 text-white border-red-500'
                        : 'bg-background/50 border-white/10 text-foreground hover:border-red-500/40'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {CENTRAL_REGIONS.includes(newPain.body_region) && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><Info className="w-3 h-3" /> Central region — typically N/A</p>
            )}
          </div>
        )}

        {/* Pain level slider */}
        {newPain.body_region && newPain.laterality && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-sm">Pain Level</Label>
              <span className={`text-base font-bold ${newPain.pain_level >= 7 ? 'text-red-500' : newPain.pain_level >= 4 ? 'text-amber-500' : 'text-emerald-500'}`}>{newPain.pain_level}/10</span>
            </div>
            <Slider value={[newPain.pain_level]} onValueChange={(v) => setNewPain((p) => ({ ...p, pain_level: v[0] }))} min={1} max={10} step={1} className="touch-none" data-testid="pain-level-slider" />
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
              <span>1 - Mild</span><span>5 - Moderate</span><span>10 - Severe</span>
            </div>
          </div>
        )}

        <Button variant="outline" size="sm" onClick={addPain} disabled={!newPain.body_region || !newPain.laterality || (newPain.body_region === 'Other' && !(newPain.region_note || '').trim())} className="w-full" data-testid="add-pain-btn">
          <Plus className="w-4 h-4 mr-1" /> Add Pain Location
        </Button>
      </div>
    </div>
  );
}
