import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { PainReportInput } from '../../components/PainReportInput';
import { Slider } from '../../components/ui/slider';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Checkbox } from '../../components/ui/checkbox';
import { toast } from 'sonner';
import axios from 'axios';
import { ArrowLeft, Sun, Save, Info, Camera, X } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Questionnaire microcopy - explanations for each field
const FIELD_DESCRIPTIONS = {
  sleep_quality: "Rate the overall quality of your sleep last night. Consider how rested you feel, sleep interruptions, and ease of falling asleep.",
  morning_fatigue: "Rate your current level of tiredness. 0 = fully energized, 10 = extremely exhausted and struggling to stay awake.",
  muscle_soreness: "Rate any muscle pain or stiffness you feel right now. Consider delayed onset muscle soreness (DOMS) from recent training.",
  stress: "Rate your current mental/emotional stress level. Consider work, personal life, and general anxiety levels.",
  readiness: "Rate how prepared you feel to train at full intensity today. Consider your energy, motivation, and physical state."
};

const ScaleLabels = {
  sleep_quality: ['Very Poor', 'Poor', 'Fair', 'Good', 'Excellent'],
  morning_fatigue: ['None', 'Mild', 'Moderate', 'High', 'Extreme'],
  muscle_soreness: ['None', 'Mild', 'Moderate', 'High', 'Extreme'],
  stress: ['None', 'Low', 'Moderate', 'High', 'Very High'],
  readiness: ['Not Ready', 'Low', 'Moderate', 'Good', 'Fully Ready']
};

const MENSTRUAL_SYMPTOMS = [
  { id: 'cramps', label: 'Cramps' },
  { id: 'low_back_pain', label: 'Low Back Pain' },
  { id: 'abdominal_pain', label: 'Abdominal Pain/Bloating' },
  { id: 'headache', label: 'Headache' },
  { id: 'breast_tenderness', label: 'Breast Tenderness' }
];

const FLOW_LEVELS = [
  { value: 'None', label: 'None', color: 'bg-gray-500' },
  { value: 'Spotting', label: 'Spotting', color: 'bg-pink-300' },
  { value: 'Light', label: 'Light', color: 'bg-pink-400' },
  { value: 'Moderate', label: 'Moderate', color: 'bg-red-400' },
  { value: 'Heavy', label: 'Heavy', color: 'bg-red-600' }
];

const PAIN_LEVELS = [
  { value: 'None', label: 'None' },
  { value: 'Mild', label: 'Mild' },
  { value: 'Moderate', label: 'Moderate' },
  { value: 'Severe', label: 'Severe' },
  { value: 'Very Severe', label: 'Very Severe' }
];

const getScaleLabel = (field, value) => {
  const labels = ScaleLabels[field];
  const index = Math.floor(value / 2.5);
  return labels[Math.min(index, labels.length - 1)];
};

const getScaleColor = (field, value) => {
  if (field === 'morning_fatigue' || field === 'muscle_soreness' || field === 'stress') {
    if (value <= 3) return 'text-emerald-400';
    if (value <= 6) return 'text-amber-400';
    return 'text-red-400';
  }
  if (value >= 7) return 'text-emerald-400';
  if (value >= 4) return 'text-amber-400';
  return 'text-red-400';
};

// Urine-color hydration self-check scale (1 = well hydrated ... 8 = severe dehydration)
const HYDRATION_LEVELS = [
  { level: 1, color: '#FCFCE3', status: 'Good', action: 'You are hydrated' },
  { level: 2, color: '#F7F8CB', status: 'Good', action: 'You are hydrated' },
  { level: 3, color: '#F2F080', status: 'Good', action: 'You are hydrated' },
  { level: 4, color: '#FBE251', status: 'Fair', action: 'Start drinking water' },
  { level: 5, color: '#FBD332', status: 'Dehydrated', action: 'Drink water' },
  { level: 6, color: '#F5C518', status: 'Dehydrated', action: 'Drink water' },
  { level: 7, color: '#DFB878', status: 'Very Dehydrated', action: 'Consider Rehydration sachets' },
  { level: 8, color: '#C89A28', status: 'Severe Dehydration', action: 'Consider Rehydration sachets' },
];

const HYDRATION_STATUS_TONE = {
  Good: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  Fair: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
  Dehydrated: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  'Very Dehydrated': 'text-red-400 border-red-500/30 bg-red-500/10',
  'Severe Dehydration': 'text-red-300 border-red-600/40 bg-red-600/15',
};


export default function MorningCheckIn() {
  const navigate = useNavigate();
  const { user, getAuthHeaders } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    sleep_quality: 7,
    morning_fatigue: 3,
    muscle_soreness: 3,
    stress: 3,
    readiness: 7,
    notes: '',
    pain_reports: [],
    // Menstrual cycle fields
    is_menstruating: false,
    menstrual_flow: null,
    menstrual_pain: null,
    menstrual_symptoms: [],
    hydration_level: null
  });

  const isFemaleTeam = user?.team?.includes('Women');

  // Optional device screenshot (Whoop / Garmin / Apple Health, etc.)
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const screenshotInputRef = useRef(null);
  const onSelectScreenshot = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    setScreenshotFile(f);
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotPreview(URL.createObjectURL(f));
  };
  const removeScreenshot = () => {
    setScreenshotFile(null);
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotPreview(null);
    if (screenshotInputRef.current) screenshotInputRef.current.value = '';
  };

  // Hard gate: the daily check-in stays locked each week until the OSTRC health check is done
  const [gateChecked, setGateChecked] = useState(false);
  useEffect(() => {
    let active = true;
    axios.get(`${API}/health/status`, getAuthHeaders())
      .then((res) => {
        if (!active) return;
        if (res.data?.blocks_daily) {
          toast.warning('Please complete your Weekly Health Check first.');
          navigate('/athlete/health-check', { replace: true });
        } else {
          setGateChecked(true);
        }
      })
      .catch(() => { if (active) setGateChecked(true); });
    return () => { active = false; };
  }, [getAuthHeaders, navigate]);

  const handleSliderChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value[0] }));
  };

  const handleSymptomToggle = (symptomId) => {
    setFormData(prev => ({
      ...prev,
      menstrual_symptoms: prev.menstrual_symptoms.includes(symptomId)
        ? prev.menstrual_symptoms.filter(s => s !== symptomId)
        : [...prev.menstrual_symptoms, symptomId]
    }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // Upload optional device screenshot first (stored on the backend)
      let screenshotId;
      if (screenshotFile) {
        const fd = new FormData();
        fd.append('file', screenshotFile);
        const up = await axios.post(`${API}/device-screenshot`, fd, {
          headers: { ...getAuthHeaders().headers, 'Content-Type': 'multipart/form-data' },
        });
        screenshotId = up.data.photo_id;
      }

      const submitData = {
        sleep_quality: formData.sleep_quality,
        morning_fatigue: formData.morning_fatigue,
        muscle_soreness: formData.muscle_soreness,
        stress: formData.stress,
        readiness: formData.readiness,
        notes: formData.notes || null,
        pain_reports: formData.pain_reports.length > 0 ? formData.pain_reports : null,
        hydration_level: formData.hydration_level || null,
        screenshot_id: screenshotId || null,
      };

      // Add menstrual data for female athletes
      if (isFemaleTeam) {
        submitData.is_menstruating = formData.is_menstruating;
        if (formData.is_menstruating) {
          submitData.menstrual_flow = formData.menstrual_flow;
          submitData.menstrual_pain = formData.menstrual_pain;
          submitData.menstrual_symptoms = formData.menstrual_symptoms;
        }
      }

      await axios.post(`${API}/readiness`, submitData, getAuthHeaders());
      toast.success('Morning check-in submitted!');
      navigate('/athlete');
    } catch (error) {
      if (error.response?.status === 428) {
        toast.error(error.response?.data?.detail?.message || 'Please answer the required survey first.');
        navigate('/athlete/survey');
        return;
      }
      const d = error.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : (d?.message || 'Failed to submit'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const fields = [
    { key: 'sleep_quality', label: 'Sleep Quality', icon: '😴' },
    { key: 'morning_fatigue', label: 'Morning Fatigue', icon: '🥱' },
    { key: 'muscle_soreness', label: 'Muscle Soreness', icon: '💪' },
    { key: 'stress', label: 'Stress Level', icon: '😰' },
    { key: 'readiness', label: 'Readiness to Train', icon: '🏃' }
  ];

  if (!gateChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" data-testid="morning-checkin-gate-loading">
        <div className="animate-pulse text-primary text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="morning-checkin-page">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate('/athlete')}
            data-testid="back-btn"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Sun className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg">Morning Check-In</h1>
              <p className="text-xs text-muted-foreground">How are you feeling today?</p>
            </div>
          </div>
        </div>
      </header>

      {/* Form */}
      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        {fields.map((field, index) => (
          <Card 
            key={field.key} 
            className="glass-light border-white/5 animate-fade-in"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{field.icon}</span>
                  <Label className="font-medium">{field.label}</Label>
                </div>
                <div className="text-right">
                  <span className={`text-2xl font-mono font-bold ${getScaleColor(field.key, formData[field.key])}`}>
                    {formData[field.key]}
                  </span>
                  <p className={`text-xs ${getScaleColor(field.key, formData[field.key])}`}>
                    {getScaleLabel(field.key, formData[field.key])}
                  </p>
                </div>
              </div>
              
              {/* Microcopy description */}
              <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                {FIELD_DESCRIPTIONS[field.key]}
              </p>
              
              <Slider
                value={[formData[field.key]]}
                onValueChange={(value) => handleSliderChange(field.key, value)}
                min={0}
                max={10}
                step={1}
                className="touch-none"
                data-testid={`slider-${field.key}`}
              />
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>0</span>
                <span>5</span>
                <span>10</span>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Menstrual Cycle Tracking - Female Team Only */}
        {isFemaleTeam && (
          <Card className="glass-light border-pink-500/20 animate-fade-in">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🌸</span>
                  <Label className="font-medium">Menstrual Cycle</Label>
                </div>
                <Switch
                  checked={formData.is_menstruating}
                  onCheckedChange={(checked) => setFormData(prev => ({ 
                    ...prev, 
                    is_menstruating: checked,
                    menstrual_flow: checked ? prev.menstrual_flow : null,
                    menstrual_pain: checked ? prev.menstrual_pain : null,
                    menstrual_symptoms: checked ? prev.menstrual_symptoms : []
                  }))}
                  data-testid="menstrual-toggle"
                />
              </div>
              
              <p className="text-xs text-muted-foreground mb-3">
                Are you currently on your menstrual period? This information helps staff understand your wellness better.
              </p>

              {formData.is_menstruating && (
                <div className="space-y-4 pt-4 border-t border-white/10">
                  {/* Flow Level */}
                  <div>
                    <Label className="text-sm mb-2 block">Menstrual Flow Level</Label>
                    <div className="grid grid-cols-5 gap-2">
                      {FLOW_LEVELS.map((flow) => (
                        <button
                          key={flow.value}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, menstrual_flow: flow.value }))}
                          className={`p-2 rounded-lg text-xs text-center transition-all ${
                            formData.menstrual_flow === flow.value 
                              ? 'ring-2 ring-primary bg-primary/20' 
                              : 'bg-muted/30 hover:bg-muted/50'
                          }`}
                        >
                          <div className={`w-3 h-3 rounded-full ${flow.color} mx-auto mb-1`} />
                          {flow.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pain Level */}
                  <div>
                    <Label className="text-sm mb-2 block">Menstrual Pain Level</Label>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {PAIN_LEVELS.map((pain) => (
                        <button
                          key={pain.value}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, menstrual_pain: pain.value }))}
                          data-testid={`menstrual-pain-${pain.value.replace(/\s+/g, '-').toLowerCase()}`}
                          className={`p-2 rounded-lg text-xs text-center transition-all ${
                            formData.menstrual_pain === pain.value
                              ? 'ring-2 ring-primary bg-primary/20'
                              : 'bg-muted/30 hover:bg-muted/50'
                          }`}
                        >
                          {pain.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Symptoms */}
                  <div>
                    <Label className="text-sm mb-2 block">Associated Symptoms</Label>
                    <div className="space-y-2">
                      {MENSTRUAL_SYMPTOMS.map((symptom) => (
                        <div key={symptom.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={symptom.id}
                            checked={formData.menstrual_symptoms.includes(symptom.id)}
                            onCheckedChange={() => handleSymptomToggle(symptom.id)}
                          />
                          <label htmlFor={symptom.id} className="text-sm text-muted-foreground cursor-pointer">
                            {symptom.label}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Pain Report (optional) */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <PainReportInput
              value={formData.pain_reports}
              onChange={(arr) => setFormData(prev => ({ ...prev, pain_reports: arr }))}
              subtitle="Optional — report any pain you feel this morning."
            />
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <Label className="font-medium mb-2 block">Notes (Optional)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Add any additional context about how you&apos;re feeling that might help staff understand your wellness.
            </p>
            <Textarea
              placeholder="Any additional notes about how you're feeling..."
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              className="bg-background/50 border-white/10 min-h-[100px]"
              data-testid="notes-input"
            />
          </CardContent>
        </Card>

        {/* Hydration self-check (optional) */}
        <Card className="glass-light border-white/5 animate-fade-in" data-testid="hydration-card">
          <CardContent className="p-4">
            <Label className="font-medium mb-1 block">
              Hydration Check <span className="text-muted-foreground font-normal">(Optional)</span>
            </Label>
            <p className="text-xs text-muted-foreground mb-3">
              Select the color that best matches your urine. You&apos;ll get instant guidance.
            </p>
            <div className="grid grid-cols-8 gap-1.5">
              {HYDRATION_LEVELS.map((h) => {
                const selected = formData.hydration_level === h.level;
                return (
                  <button
                    key={h.level}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, hydration_level: selected ? null : h.level }))}
                    data-testid={`hydration-level-${h.level}`}
                    className={`aspect-[2/3] rounded-md border-2 transition-all ${selected ? 'border-white scale-105 ring-2 ring-white/40' : 'border-white/10 hover:border-white/30'}`}
                    style={{ background: h.color }}
                    aria-label={`Hydration level ${h.level}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-0.5">
              <span>Well hydrated</span>
              <span>Dehydrated</span>
            </div>
            {formData.hydration_level && (
              <div
                className={`mt-3 rounded-lg border p-3 flex items-center gap-3 ${HYDRATION_STATUS_TONE[HYDRATION_LEVELS[formData.hydration_level - 1].status]}`}
                data-testid="hydration-feedback"
              >
                <span className="w-6 h-9 rounded border border-white/20 shrink-0" style={{ background: HYDRATION_LEVELS[formData.hydration_level - 1].color }} />
                <div className="min-w-0">
                  <p className="text-sm font-bold">{HYDRATION_LEVELS[formData.hydration_level - 1].status}</p>
                  <p className="text-xs opacity-90">{HYDRATION_LEVELS[formData.hydration_level - 1].action}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Optional device screenshot (Whoop / Garmin / Apple Health, etc.) */}
        <Card className="glass-light border-white/5 animate-fade-in" data-testid="screenshot-card">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Camera className="w-5 h-5 text-primary" />
              <Label className="font-medium">Device Screenshot (Optional)</Label>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Add a screenshot from Whoop, Garmin, Apple Health, Oura, etc. Your staff can view it next to today's values.
            </p>
            <input
              ref={screenshotInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onSelectScreenshot}
              data-testid="screenshot-input"
            />
            {!screenshotPreview ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => screenshotInputRef.current?.click()}
                data-testid="screenshot-add-btn"
              >
                <Camera className="w-4 h-4 mr-2" />
                Add Screenshot
              </Button>
            ) : (
              <div className="relative inline-block">
                <img
                  src={screenshotPreview}
                  alt="Device screenshot preview"
                  className="max-h-56 rounded-lg border border-white/10"
                  data-testid="screenshot-preview"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute -top-2 -right-2 h-7 w-7 rounded-full"
                  onClick={removeScreenshot}
                  data-testid="screenshot-remove-btn"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Submit Button */}
        <Button 
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full h-14 font-bold uppercase tracking-wider neon-shadow hover:scale-[1.02] transition-transform"
          data-testid="submit-btn"
        >
          <Save className="w-5 h-5 mr-2" />
          {isSubmitting ? 'Submitting...' : 'Submit Check-In'}
        </Button>
      </main>
    </div>
  );
}
