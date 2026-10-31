import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Slider } from '../../components/ui/slider';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { toast } from 'sonner';
import axios from 'axios';
import { ArrowLeft, Moon, Save, Info } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Evidence-based explanations for each metric
const FIELD_EXPLANATIONS = {
  overall_feeling: {
    description: "Rate how you feel overall right now — physically, mentally, and emotionally. Consider your energy, mood, and general wellness.",
    scale: "0 = Terrible (very unwell), 5 = Okay (neither good nor bad), 10 = Excellent (feeling great)"
  },
  recovery_quality: {
    description: "Rate how well you feel you have recovered from today's training. Consider your energy levels compared to this morning.",
    scale: "0 = Not recovered at all, 5 = Partially recovered, 10 = Fully recovered and ready for more"
  },
  sleep_after: {
    description: "Based on how you feel right now, rate how well you expect to sleep tonight. Consider your mental state and physical tiredness.",
    scale: "0 = Very poor sleep expected, 5 = Average sleep expected, 10 = Excellent sleep expected"
  },
  residual_pain: {
    description: "Rate any lingering pain or discomfort you still feel from training. Focus on pain that concerns you, not normal post-exercise sensations.",
    scale: "0 = No pain at all, 5 = Moderate lingering pain, 10 = Severe pain affecting daily activities"
  }
};

export default function EveningRecovery() {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    overall_feeling: 7,
    recovery_quality: 7,
    sleep_after: 7,
    residual_pain: 2,
    notes: ''
  });

  const handleSliderChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value[0] }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await axios.post(`${API}/recovery`, formData, getAuthHeaders());
      toast.success('Evening recovery submitted!');
      navigate('/athlete');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate recovery score preview
  const recoveryScore = (
    (formData.overall_feeling + formData.recovery_quality + formData.sleep_after + (10 - formData.residual_pain)) / 4
  ).toFixed(1);

  const fields = [
    { 
      key: 'overall_feeling', 
      label: 'Overall Feeling', 
      icon: '😊',
      lowLabel: 'Terrible',
      midLabel: 'Okay',
      highLabel: 'Excellent'
    },
    { 
      key: 'recovery_quality', 
      label: 'Recovery Quality', 
      icon: '🔋',
      lowLabel: 'Not Recovered',
      midLabel: 'Partial',
      highLabel: 'Fully Recovered'
    },
    { 
      key: 'sleep_after', 
      label: 'Sleep Expectation', 
      icon: '🌙',
      lowLabel: 'Poor',
      midLabel: 'Average',
      highLabel: 'Excellent'
    },
    { 
      key: 'residual_pain', 
      label: 'Residual Pain', 
      icon: '🤕',
      lowLabel: 'None',
      midLabel: 'Moderate',
      highLabel: 'Severe',
      inverted: true
    }
  ];

  const getScaleColor = (field, value) => {
    if (field.inverted) {
      if (value <= 3) return 'text-emerald-400';
      if (value <= 6) return 'text-amber-400';
      return 'text-red-400';
    }
    if (value >= 7) return 'text-emerald-400';
    if (value >= 4) return 'text-amber-400';
    return 'text-red-400';
  };

  const getScaleLabel = (field, value) => {
    if (field.inverted) {
      if (value <= 2) return 'None';
      if (value <= 4) return 'Mild';
      if (value <= 6) return 'Moderate';
      if (value <= 8) return 'High';
      return 'Severe';
    }
    if (value <= 2) return 'Very Poor';
    if (value <= 4) return 'Poor';
    if (value <= 6) return 'Fair';
    if (value <= 8) return 'Good';
    return 'Excellent';
  };

  return (
    <div className="min-h-screen bg-background" data-testid="evening-recovery-page">
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
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <Moon className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg">Evening Recovery</h1>
              <p className="text-xs text-muted-foreground">Track your recovery</p>
            </div>
          </div>
        </div>
      </header>

      {/* Form */}
      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        {/* Recovery Score Preview */}
        <Card className="border-purple-500/30 bg-purple-500/5 animate-fade-in">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">Recovery Score</p>
            <p className="text-4xl font-heading font-bold text-purple-400">{recoveryScore}</p>
            <p className="text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1">
              <Info className="w-3 h-3" />
              Average of your wellness ratings (pain is inverted)
            </p>
          </CardContent>
        </Card>

        {/* Scale Fields */}
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
                  <span className={`text-2xl font-mono font-bold ${getScaleColor(field, formData[field.key])}`}>
                    {formData[field.key]}
                  </span>
                  <p className={`text-xs ${getScaleColor(field, formData[field.key])}`}>
                    {getScaleLabel(field, formData[field.key])}
                  </p>
                </div>
              </div>
              
              {/* Explanation */}
              <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                {FIELD_EXPLANATIONS[field.key].description}
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
              <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
                <span>0 - {field.lowLabel}</span>
                <span>5 - {field.midLabel}</span>
                <span>10 - {field.highLabel}</span>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Notes */}
        <Card className="glass-light border-white/5 animate-fade-in">
          <CardContent className="p-4">
            <Label className="font-medium mb-2 block">Notes (Optional)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Add any additional context about your recovery — what helped, what didn&apos;t, or anything affecting your wellness tonight.
            </p>
            <Textarea
              placeholder="Any additional notes about your recovery..."
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
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
          {isSubmitting ? 'Submitting...' : 'Submit Recovery'}
        </Button>
      </main>
    </div>
  );
}
