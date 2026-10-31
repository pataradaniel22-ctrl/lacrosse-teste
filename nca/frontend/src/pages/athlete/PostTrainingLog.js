import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Slider } from '../../components/ui/slider';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import axios from 'axios';
import { ArrowLeft, Dumbbell, Save, Clock, Zap, Info, Plus, X } from 'lucide-react';

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
    date_time_start: new Date().toISOString().slice(0, 16),
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
    pain_level: 5
  });

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
    
    // Check if this region+laterality already exists
    const exists = painReports.some(
      p => p.body_region === newPain.body_region && p.laterality === newPain.laterality
    );
    if (exists) {
      toast.error('This pain location already added');
      return;
    }
    
    setPainReports(prev => [...prev, { ...newPain }]);
    setNewPain({ body_region: null, laterality: null, pain_level: 5 });
    toast.success('Pain location added');
  };
  
  // Remove a pain location
  const removePainLocation = (index) => {
    setPainReports(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const submitData = {
        ...formData,
        date_time_start: new Date(formData.date_time_start).toISOString(),
        // Include multiple pain reports if any
        pain_reports: painReports.length > 0 ? painReports : undefined
      };
      await axios.post(`${API}/sessions`, submitData, getAuthHeaders());
      toast.success('Training session logged!');
      navigate('/athlete');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit');
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
              <Select
                value={formData.session_type}
                onValueChange={(value) => setFormData(prev => ({ ...prev, session_type: value }))}
              >
                <SelectTrigger className="mt-2 bg-background/50 border-white/10" data-testid="session-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_TYPES.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

        {/* Body Region (Optional) */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="font-medium">Pain Locations (Optional)</Label>
              {painReports.length > 0 && (
                <Badge variant="outline" className="border-red-500/30 text-red-400">
                  {painReports.length} pain{painReports.length > 1 ? 's' : ''} reported
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Add multiple pain locations if needed. For each pain, select the body region, side, and intensity.
            </p>
            
            {/* Already added pain locations */}
            {painReports.length > 0 && (
              <div className="space-y-2 mb-4">
                {painReports.map((pain, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-3">
                      <span className="text-red-400 text-lg">🔥</span>
                      <div>
                        <p className="font-medium text-sm">{pain.body_region}</p>
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
                <Select
                  value={newPain.body_region || undefined}
                  onValueChange={(value) => setNewPain(prev => ({ 
                    ...prev, 
                    body_region: value,
                    laterality: CENTRAL_REGIONS.includes(value) ? 'N/A' : prev.laterality
                  }))}
                >
                  <SelectTrigger className="mt-1 bg-background/50 border-white/10" data-testid="body-region-select">
                    <SelectValue placeholder="Select body region" />
                  </SelectTrigger>
                  <SelectContent>
                    {BODY_REGIONS.map(region => (
                      <SelectItem key={region} value={region}>{region}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Laterality Selector */}
              {newPain.body_region && (
                <div className="animate-fade-in">
                  <Label className="text-sm">Side (Laterality)</Label>
                  <Select
                    value={newPain.laterality || undefined}
                    onValueChange={(value) => setNewPain(prev => ({ ...prev, laterality: value }))}
                  >
                    <SelectTrigger className="mt-1 bg-background/50 border-white/10" data-testid="laterality-select">
                      <SelectValue placeholder="Select side" />
                    </SelectTrigger>
                    <SelectContent>
                      {LATERALITY_OPTIONS.map(option => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                disabled={!newPain.body_region || !newPain.laterality}
                className="w-full border-primary/30 text-primary hover:bg-primary/10"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Pain Location
              </Button>
            </div>
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
