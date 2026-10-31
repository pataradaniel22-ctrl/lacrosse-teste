import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Slider } from '../../components/ui/slider';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { toast } from 'sonner';
import axios from 'axios';
import { ArrowLeft, Dumbbell, Save, Clock, Zap, Info, Plus, X, Camera } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SESSION_TYPES = [
  'Strength', 'Conditioning', 'Technical', 'Tactical', 'Match', 'Rehab', 'Recovery', 'Other'
];

const BODY_REGIONS = [
  'Neck', 'Shoulder', 'Elbow', 'WristHand', 'LowBack', 'HipGroin', 'Knee', 'AnkleFoot', 'Other'
];

const LATERALITY_OPTIONS = [
  { value: 'Left', label: 'Left Side' },
  { value: 'Right', label: 'Right Side' },
  { value: 'Both', label: 'Both Sides' },
  { value: 'N/A', label: 'N/A (Central region)' }
];

// Regions that typically don't have laterality (central regions)
const CENTRAL_REGIONS = ['Neck', 'LowBack'];

// Evidence-based explanations for each metric
const FIELD_EXPLANATIONS = {
  rpe: {
    description: "Rate how hard the session felt overall. Consider your breathing, muscle fatigue, and mental effort during the session.",
    scale: "0 = Rest / No effort, 5 = Moderate / Comfortable pace, 10 = Maximum effort / Could not continue"
  },
  pain_during: {
    description: "Rate any pain you experienced during the training session. Focus on unusual or concerning pain, not normal exercise discomfort.",
    scale: "0 = No pain at all, 5 = Moderate pain affecting performance, 10 = Severe pain forcing you to stop"
  },
  pain_after: {
    description: "Rate any pain you feel now, after completing the session. This helps track how your body responds to training.",
    scale: "0 = No pain at all, 5 = Noticeable pain but manageable, 10 = Severe pain requiring attention"
  },
  end_fatigue: {
    description: "Rate how tired you feel right now after the session. This reflects your immediate response to the training load.",
    scale: "0 = Fully energized, 5 = Moderately fatigued, 10 = Completely exhausted"
  },
  internal_load: {
    description: "Your session's internal training load, calculated automatically. This represents the overall stress placed on your body.",
    scale: "Calculated as: Duration (minutes) × RPE. Higher values indicate more demanding sessions."
  }
};

export default function PostTrainingLog() {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    date_time_start: (() => {
      const n = new Date();
      return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    })(),
    session_type: 'Technical',
    duration_min: 60,
    rpe: 6,
    pain_during: 0,
    pain_after: 0,
    end_fatigue: 5,
    session_notes: ''
  });
  
  // Multiple pain locations state
  const [painReports, setPainReports] = useState([]);
  const [newPain, setNewPain] = useState({
    body_region: null,
    laterality: null,
    pain_level: 5,
    region_note: ''
  });

  // Optional session photo
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const fileInputRef = useRef(null);

  const onSelectPhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      toast.error('Image too large (max 15MB)');
      return;
    }
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const removePhoto = () => {
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSliderChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value[0] }));
  };
  
  // Add a new pain location
  const addPainLocation = () => {
    if (!newPain.body_region) {
      toast.error('Please select a body region');
      return;
    }
    if (!newPain.laterality) {
      toast.error('Please select laterality (side)');
      return;
    }
    if (newPain.body_region === 'Other' && !(newPain.region_note || '').trim()) {
      toast.error('Describe the "Other" pain location');
      return;
    }
    
    // Check if this region+laterality already exists
    const exists = painReports.some(
      p => p.body_region === newPain.body_region && p.laterality === newPain.laterality
        && (p.body_region !== 'Other' || (p.region_note || '').trim().toLowerCase() === (newPain.region_note || '').trim().toLowerCase())
    );
    if (exists) {
      toast.error('This pain location already added');
      return;
    }
    
    setPainReports(prev => [...prev, { ...newPain, region_note: (newPain.region_note || '').trim() || null }]);
    setNewPain({ body_region: null, laterality: null, pain_level: 5, region_note: '' });
    toast.success('Pain location added');
  };
  
  // Remove a pain location
  const removePainLocation = (index) => {
    setPainReports(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    // Session type is required (free text)
    if (!formData.session_type || !formData.session_type.trim()) {
      toast.error('Please enter or select a session type');
      return;
    }
    // Check if user has pain but no region specified
    const hasPain = formData.pain_during > 0 || formData.pain_after > 0;
    if (hasPain && painReports.length === 0) {
      toast.warning('You reported pain but didn\'t specify the body region. Please add a pain location for better tracking.', {
        duration: 5000,
        action: {
          label: 'Add Now',
          onClick: () => {
            // Scroll to pain location section
            document.getElementById('pain-location-section')?.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });
      return;
    }
    
    setIsSubmitting(true);
    try {
      // Upload optional session photo / device screenshot first (higher-quality endpoint)
      let photoId;
      if (photoFile) {
        const fd = new FormData();
        fd.append('file', photoFile);
        const up = await axios.post(`${API}/device-screenshot`, fd, {
          ...getAuthHeaders(),
          headers: { ...getAuthHeaders().headers, 'Content-Type': 'multipart/form-data' },
        });
        photoId = up.data.photo_id;
      }
      const submitData = {
        ...formData,
        session_type: formData.session_type.trim(),
        // Store the athlete's local wall-clock time (their timezone), not UTC
        date_time_start: formData.date_time_start,
        // Include multiple pain reports if any
        pain_reports: painReports.length > 0 ? painReports : undefined,
        photo_id: photoId,
      };
      await axios.post(`${API}/sessions`, submitData, getAuthHeaders());
      toast.success('Training session logged!', {
        description: 'Share it on The Fittest to earn a point.',
        action: { label: 'Postar no The Fittest 🔥', onClick: () => navigate('/athlete/the-fittest?compose=training_checkin') },
        duration: 8000,
      });
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

  const internalLoad = formData.duration_min * formData.rpe;

  const getScaleColor = (field, value) => {
    if (field === 'rpe') {
      if (value <= 3) return 'text-emerald-400';
      if (value <= 6) return 'text-amber-400';
      return 'text-red-400';
    }
    if (value <= 3) return 'text-emerald-400';
    if (value <= 6) return 'text-amber-400';
    return 'text-red-400';
  };

  const getScaleLabel = (field, value) => {
    if (field === 'rpe') {
      if (value <= 2) return 'Very Easy';
      if (value <= 4) return 'Easy';
      if (value <= 6) return 'Moderate';
      if (value <= 8) return 'Hard';
      return 'Max Effort';
    }
    if (value <= 2) return 'None/Minimal';
    if (value <= 4) return 'Mild';
    if (value <= 6) return 'Moderate';
    if (value <= 8) return 'High';
    return 'Severe';
  };

  return (
    <div className="min-h-screen bg-background" data-testid="post-training-page">
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
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Dumbbell className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg">Post Training Log</h1>
              <p className="text-xs text-muted-foreground">Record your session</p>
            </div>
          </div>
        </div>
      </header>

      {/* Form */}
      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        {/* Session Info */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4 space-y-4">
            <div>
              <Label className="font-medium">Session Start</Label>
              <Input
                type="datetime-local"
                value={formData.date_time_start}
                onChange={(e) => setFormData(prev => ({ ...prev, date_time_start: e.target.value }))}
                className="mt-2 bg-background/50 border-white/10"
                data-testid="datetime-input"
              />
            </div>
            <div>
              <Label className="font-medium">Session Type</Label>
              <div className="mt-2 flex flex-wrap gap-2" data-testid="session-type-chips">
                {SESSION_TYPES.map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, session_type: type }))}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      formData.session_type === type
                        ? 'bg-primary/20 border-primary/50 text-primary font-medium'
                        : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'
                    }`}
                    data-testid={`session-type-${type.toLowerCase()}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <Input
                type="text"
                value={formData.session_type}
                onChange={(e) => setFormData(prev => ({ ...prev, session_type: e.target.value }))}
                placeholder="Or write your own (e.g., Home training)"
                maxLength={80}
                className="mt-2 bg-background/50 border-white/10"
                data-testid="session-type-input"
              />
            </div>
            <div>
              <Label className="font-medium">Duration (minutes)</Label>
              <Input
                type="number"
                value={formData.duration_min}
                onChange={(e) => setFormData(prev => ({ ...prev, duration_min: parseInt(e.target.value) || 0 }))}
                className="mt-2 bg-background/50 border-white/10"
                min={0}
                max={300}
                data-testid="duration-input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Enter the total active training time, excluding rest periods and breaks.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* RPE */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                <Label className="font-medium">Rate of Perceived Exertion (RPE)</Label>
              </div>
              <div className="text-right">
                <span className={`text-2xl font-mono font-bold ${getScaleColor('rpe', formData.rpe)}`}>
                  {formData.rpe}
                </span>
                <p className={`text-xs ${getScaleColor('rpe', formData.rpe)}`}>
                  {getScaleLabel('rpe', formData.rpe)}
                </p>
              </div>
            </div>
            
            {/* Explanation */}
            <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              {FIELD_EXPLANATIONS.rpe.description}
            </p>
            
            <Slider
              value={[formData.rpe]}
              onValueChange={(value) => handleSliderChange('rpe', value)}
              min={0}
              max={10}
              step={1}
              className="touch-none"
              data-testid="slider-rpe"
            />
            <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
              <span>0 - Rest</span>
              <span>5 - Moderate</span>
              <span>10 - Max</span>
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-2 text-center italic">
              {FIELD_EXPLANATIONS.rpe.scale}
            </p>
          </CardContent>
        </Card>

        {/* Internal Load Preview */}
        <Card className="border-primary/30 bg-primary/5 animate-fade-in">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                <span className="font-medium">Internal Load</span>
              </div>
              <span className="text-2xl font-mono font-bold text-primary">{internalLoad} AU</span>
            </div>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              {FIELD_EXPLANATIONS.internal_load.description}
            </p>
            <p className="text-[10px] text-muted-foreground/70 mt-1 italic">
              {formData.duration_min} min × {formData.rpe} RPE = {internalLoad} Arbitrary Units
            </p>
          </CardContent>
        </Card>

        {/* Pain During */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚡</span>
                <Label className="font-medium">Pain During Session</Label>
              </div>
              <div className="text-right">
                <span className={`text-2xl font-mono font-bold ${getScaleColor('pain', formData.pain_during)}`}>
                  {formData.pain_during}
                </span>
                <p className={`text-xs ${getScaleColor('pain', formData.pain_during)}`}>
                  {getScaleLabel('pain', formData.pain_during)}
                </p>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              {FIELD_EXPLANATIONS.pain_during.description}
            </p>
            
            <Slider
              value={[formData.pain_during]}
              onValueChange={(value) => handleSliderChange('pain_during', value)}
              min={0}
              max={10}
              step={1}
              className="touch-none"
              data-testid="slider-pain_during"
            />
            <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
              <span>0 - No Pain</span>
              <span>5 - Moderate</span>
              <span>10 - Severe</span>
            </div>
          </CardContent>
        </Card>

        {/* Pain After */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔥</span>
                <Label className="font-medium">Pain After Session</Label>
              </div>
              <div className="text-right">
                <span className={`text-2xl font-mono font-bold ${getScaleColor('pain', formData.pain_after)}`}>
                  {formData.pain_after}
                </span>
                <p className={`text-xs ${getScaleColor('pain', formData.pain_after)}`}>
                  {getScaleLabel('pain', formData.pain_after)}
                </p>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              {FIELD_EXPLANATIONS.pain_after.description}
            </p>
            
            <Slider
              value={[formData.pain_after]}
              onValueChange={(value) => handleSliderChange('pain_after', value)}
              min={0}
              max={10}
              step={1}
              className="touch-none"
              data-testid="slider-pain_after"
            />
            <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
              <span>0 - No Pain</span>
              <span>5 - Moderate</span>
              <span>10 - Severe</span>
            </div>
          </CardContent>
        </Card>

        {/* End Fatigue */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">😓</span>
                <Label className="font-medium">End Fatigue Level</Label>
              </div>
              <div className="text-right">
                <span className={`text-2xl font-mono font-bold ${getScaleColor('fatigue', formData.end_fatigue)}`}>
                  {formData.end_fatigue}
                </span>
                <p className={`text-xs ${getScaleColor('fatigue', formData.end_fatigue)}`}>
                  {getScaleLabel('fatigue', formData.end_fatigue)}
                </p>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              {FIELD_EXPLANATIONS.end_fatigue.description}
            </p>
            
            <Slider
              value={[formData.end_fatigue]}
              onValueChange={(value) => handleSliderChange('end_fatigue', value)}
              min={0}
              max={10}
              step={1}
              className="touch-none"
              data-testid="slider-end_fatigue"
            />
            <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
              <span>0 - Energized</span>
              <span>5 - Tired</span>
              <span>10 - Exhausted</span>
            </div>
          </CardContent>
        </Card>

        {/* Body Region - Required when pain > 0 */}
        <Card id="pain-location-section" className={`glass-light border-white/5 animate-fade-in ${(formData.pain_during > 0 || formData.pain_after > 0) && painReports.length === 0 ? 'border-amber-500/50 ring-2 ring-amber-500/20' : ''}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Label className="font-medium">Pain Locations</Label>
                {(formData.pain_during > 0 || formData.pain_after > 0) && painReports.length === 0 && (
                  <Badge variant="outline" className="border-amber-500/50 text-amber-400 text-xs animate-pulse">
                    Required
                  </Badge>
                )}
              </div>
              {painReports.length > 0 && (
                <Badge variant="outline" className="border-red-500/30 text-red-400">
                  {painReports.length} pain{painReports.length > 1 ? 's' : ''} reported
                </Badge>
              )}
            </div>
            
            {(formData.pain_during > 0 || formData.pain_after > 0) && painReports.length === 0 ? (
              <p className="text-xs text-amber-400 mb-4 flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                You reported pain above. Please specify where it hurts for accurate tracking.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mb-4">
                Add pain locations if needed. For each pain, select the body region, side, and intensity.
              </p>
            )}
            
            {/* Already added pain locations */}
            {painReports.length > 0 && (
              <div className="space-y-2 mb-4">
                {painReports.map((pain, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-3">
                      <span className="text-red-400 text-lg">🔥</span>
                      <div>
                        <p className="font-medium text-sm">{pain.body_region === 'Other' && pain.region_note ? `Other — ${pain.region_note}` : pain.body_region}</p>
                        <p className="text-xs text-muted-foreground">
                          {pain.laterality} side • Level {pain.pain_level}/10
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removePainLocation(index)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/20 h-8 w-8 p-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            
            {/* Add new pain location form */}
            <div className="p-4 rounded-lg bg-muted/20 border border-white/5 space-y-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Add Pain Location</p>
              
              {/* Body Region Selector */}
              <div>
                <Label className="text-sm">Body Region</Label>
                <div className="mt-2 flex flex-wrap gap-2" data-testid="body-region-select">
                  {BODY_REGIONS.map(region => (
                    <button
                      key={region}
                      type="button"
                      onClick={() => setNewPain(prev => ({
                        ...prev,
                        body_region: region,
                        laterality: CENTRAL_REGIONS.includes(region) ? 'N/A' : (CENTRAL_REGIONS.includes(prev.body_region) ? null : prev.laterality),
                        region_note: region === 'Other' ? prev.region_note : ''
                      }))}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                        newPain.body_region === region
                          ? 'bg-primary/20 border-primary/50 text-primary font-medium'
                          : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'
                      }`}
                      data-testid={`body-region-${region}`}
                    >
                      {region}
                    </button>
                  ))}
                </div>
              </div>

              {/* Required free-text when region is Other */}
              {newPain.body_region === 'Other' && (
                <div className="animate-fade-in">
                  <Label className="text-sm">Describe the location <span className="text-red-400">*</span></Label>
                  <Input
                    type="text"
                    value={newPain.region_note || ''}
                    onChange={(e) => setNewPain(prev => ({ ...prev, region_note: e.target.value }))}
                    placeholder="e.g., Jaw, Ribs, Head…"
                    maxLength={200}
                    className="mt-2 bg-background/50 border-white/10"
                    data-testid="body-region-other-note"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Required — this exact text is shown to your staff.</p>
                </div>
              )}
              
              {/* Laterality Selector */}
              {newPain.body_region && (
                <div className="animate-fade-in">
                  <Label className="text-sm">Side (Laterality)</Label>
                  <div className="mt-2 flex flex-wrap gap-2" data-testid="laterality-select">
                    {LATERALITY_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setNewPain(prev => ({ ...prev, laterality: option.value }))}
                        className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                          newPain.laterality === option.value
                            ? 'bg-primary/20 border-primary/50 text-primary font-medium'
                            : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'
                        }`}
                        data-testid={`laterality-${option.value}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {CENTRAL_REGIONS.includes(newPain.body_region) && (
                    <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                      <Info className="w-3 h-3" />
                      Central region - typically N/A
                    </p>
                  )}
                </div>
              )}
              
              {/* Pain Level Slider */}
              {newPain.body_region && newPain.laterality && (
                <div className="animate-fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm">Pain Level</Label>
                    <span className={`text-lg font-bold ${
                      newPain.pain_level >= 7 ? 'text-red-400' : 
                      newPain.pain_level >= 4 ? 'text-amber-400' : 'text-emerald-400'
                    }`}>
                      {newPain.pain_level}/10
                    </span>
                  </div>
                  <Slider
                    value={[newPain.pain_level]}
                    onValueChange={(value) => setNewPain(prev => ({ ...prev, pain_level: value[0] }))}
                    min={1}
                    max={10}
                    step={1}
                    className="touch-none"
                  />
                  <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                    <span>1 - Mild</span>
                    <span>5 - Moderate</span>
                    <span>10 - Severe</span>
                  </div>
                </div>
              )}
              
              {/* Add Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={addPainLocation}
                disabled={!newPain.body_region || !newPain.laterality || (newPain.body_region === 'Other' && !(newPain.region_note || '').trim())}
                className="w-full border-primary/30 text-primary hover:bg-primary/10"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Pain Location
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Session Photo / Device Screenshot (Optional) */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Camera className="w-5 h-5 text-primary" />
              <Label className="font-medium">Session Photo / Device Screenshot (Optional)</Label>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Add a photo of your session or a screenshot from Whoop, Garmin, Apple Health, Oura, etc. Your staff can view it next to this session's values.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onSelectPhoto}
              data-testid="session-photo-input"
            />
            {!photoPreview ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-white/10 hover:bg-primary/10"
                data-testid="session-photo-add-btn"
              >
                <Camera className="w-4 h-4 mr-2" />
                Add Photo
              </Button>
            ) : (
              <div className="relative">
                <img
                  src={photoPreview}
                  alt="Session preview"
                  className="w-full max-h-64 object-cover rounded-lg border border-white/10"
                  data-testid="session-photo-preview"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  onClick={removePhoto}
                  className="absolute top-2 right-2 h-8 w-8"
                  data-testid="session-photo-remove-btn"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <Label className="font-medium mb-2 block">Session Notes (Optional)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Add any additional context about your session — technique focus, how you felt mentally, or anything unusual that happened.
            </p>
            <Textarea
              placeholder="Any additional notes about your session..."
              value={formData.session_notes}
              onChange={(e) => setFormData(prev => ({ ...prev, session_notes: e.target.value }))}
              className="bg-background/50 border-white/10 min-h-[100px]"
              data-testid="notes-input"
            />
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
          {isSubmitting ? 'Submitting...' : 'Log Session'}
        </Button>
      </main>
    </div>
  );
}
