import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  Activity, 
  Users,
  Calendar,
  Save,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CMJ_CONTEXTS = [
  { value: 'pre_training', label: 'Pre-Training' },
  { value: 'post_training', label: 'Post-Training' },
  { value: 'pre_competition', label: 'Pre-Competition' },
  { value: 'post_competition', label: 'Post-Competition' },
  { value: 'retest', label: 'Re-test / Re-evaluation' },
  { value: 'testing_session', label: 'Testing Session' },
];

export default function CMJEvaluationDay({ isOpen, onClose }) {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [athletes, setAthletes] = useState([]);
  const [events, setEvents] = useState([]);
  
  // Form state
  const [team, setTeam] = useState('all');
  const [selectedAthletes, setSelectedAthletes] = useState([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [context, setContext] = useState('testing_session');
  const [eventId, setEventId] = useState('');
  const [armsUsed, setArmsUsed] = useState(true);
  
  // Test data for each athlete
  const [testData, setTestData] = useState({});
  
  // Results after submission
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, team]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const teamParam = team !== 'all' ? `?team=${team}` : '';
      const [athletesRes, eventsRes] = await Promise.all([
        axios.get(`${API}/staff/athletes${teamParam}`, getAuthHeaders()),
        axios.get(`${API}/export/options${teamParam}`, getAuthHeaders())
      ]);
      
      setAthletes(athletesRes.data);
      setEvents(eventsRes.data.events || []);
      
      // Initialize test data for all athletes
      const initialData = {};
      athletesRes.data.forEach(a => {
        initialData[a.id] = { trial_1: '', trial_2: '', trial_3: '' };
      });
      setTestData(initialData);
      setSelectedAthletes(athletesRes.data.map(a => a.id));
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const toggleAthlete = (athleteId) => {
    setSelectedAthletes(prev => 
      prev.includes(athleteId) 
        ? prev.filter(id => id !== athleteId)
        : [...prev, athleteId]
    );
  };

  const updateTrials = (athleteId, field, value) => {
    setTestData(prev => ({
      ...prev,
      [athleteId]: {
        ...prev[athleteId],
        [field]: value
      }
    }));
  };

  const handleSubmit = async () => {
    // Validate - check that selected athletes have all 3 trials
    const testsToSubmit = [];
    const errors = [];
    
    selectedAthletes.forEach(athleteId => {
      const data = testData[athleteId];
      if (data.trial_1 && data.trial_2 && data.trial_3) {
        testsToSubmit.push({
          athlete_id: athleteId,
          trial_1: parseFloat(data.trial_1),
          trial_2: parseFloat(data.trial_2),
          trial_3: parseFloat(data.trial_3)
        });
      } else if (data.trial_1 || data.trial_2 || data.trial_3) {
        const athlete = athletes.find(a => a.id === athleteId);
        errors.push(`${athlete?.name}: Incomplete trials`);
      }
    });
    
    if (testsToSubmit.length === 0) {
      toast.error('No complete tests to submit');
      return;
    }
    
    if (errors.length > 0) {
      toast.warning(`${errors.length} athletes have incomplete data and will be skipped`);
    }
    
    setSubmitting(true);
    try {
      const response = await axios.post(`${API}/cmj/batch`, {
        date,
        context,
        event_id: eventId || null,
        arms_used: armsUsed,
        tests: testsToSubmit
      }, getAuthHeaders());
      
      setResults(response.data);
      toast.success(`${response.data.results?.length || 0} tests recorded successfully`);
    } catch (error) {
      toast.error('Failed to save tests');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setResults(null);
    setTestData({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      
      <Card className="relative z-10 w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden glass-heavy border-white/10">
        <CardHeader className="border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                <Activity className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <CardTitle>CMJ Evaluation Day</CardTitle>
                <CardDescription>Batch test multiple athletes</CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="p-4 overflow-y-auto max-h-[calc(90vh-180px)]">
          {results ? (
            // Results View
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="font-medium">Tests Recorded Successfully</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {results.results?.length} athletes tested on {date}
                </p>
              </div>
              
              {results.errors?.length > 0 && (
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 text-amber-400" />
                    <span className="font-medium">{results.errors.length} Errors</span>
                  </div>
                  <ul className="text-sm text-muted-foreground list-disc list-inside">
                    {results.errors.map((err, i) => (
                      <li key={i}>{err.athlete_id}: {err.error}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <Button onClick={handleClose} className="w-full">
                Close
              </Button>
            </div>
          ) : (
            // Input Form
            <div className="space-y-4">
              {/* Settings Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Team</Label>
                  <Select value={team} onValueChange={setTeam}>
                    <SelectTrigger className="bg-background/50 border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Teams</SelectItem>
                      <SelectItem value="Brazil Lacrosse Men">Men&apos;s Team</SelectItem>
                      <SelectItem value="Brazil Lacrosse Women">Women&apos;s Team</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Date</Label>
                  <Input 
                    type="date" 
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="bg-background/50 border-white/10"
                  />
                </div>
                <div>
                  <Label className="text-xs">Context</Label>
                  <Select value={context} onValueChange={setContext}>
                    <SelectTrigger className="bg-background/50 border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CMJ_CONTEXTS.map(ctx => (
                        <SelectItem key={ctx.value} value={ctx.value}>{ctx.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Event (optional)</Label>
                  <Select value={eventId || "none"} onValueChange={(v) => setEventId(v === "none" ? "" : v)}>
                    <SelectTrigger className="bg-background/50 border-white/10">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {events.map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="flex items-center gap-2 py-2">
                <Checkbox 
                  id="batch-arms"
                  checked={armsUsed}
                  onCheckedChange={setArmsUsed}
                />
                <Label htmlFor="batch-arms">Arms Used (applies to all tests)</Label>
              </div>
              
              {/* Athletes Table */}
              <div className="border border-white/10 rounded-lg overflow-hidden">
                <div className="bg-muted/30 px-3 py-2 flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Athletes ({selectedAthletes.length} selected)
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      if (selectedAthletes.length === athletes.length) {
                        setSelectedAthletes([]);
                      } else {
                        setSelectedAthletes(athletes.map(a => a.id));
                      }
                    }}
                  >
                    {selectedAthletes.length === athletes.length ? 'Deselect All' : 'Select All'}
                  </Button>
                </div>
                
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : athletes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Users className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-sm">No athletes found for this team.</p>
                    <p className="text-xs mt-1">Try selecting a different team filter.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-muted/20">
                          <th className="text-left py-2 px-3 w-8"></th>
                          <th className="text-left py-2 px-3">Athlete</th>
                          <th className="text-center py-2 px-2 w-20">Trial 1</th>
                          <th className="text-center py-2 px-2 w-20">Trial 2</th>
                          <th className="text-center py-2 px-2 w-20">Trial 3</th>
                        </tr>
                      </thead>
                      <tbody>
                        {athletes.map((athlete) => (
                          <tr 
                            key={athlete.id} 
                            className={`border-b border-white/5 ${
                              selectedAthletes.includes(athlete.id) ? '' : 'opacity-50'
                            }`}
                          >
                            <td className="py-2 px-3">
                              <Checkbox 
                                checked={selectedAthletes.includes(athlete.id)}
                                onCheckedChange={() => toggleAthlete(athlete.id)}
                              />
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{athlete.name}</span>
                                <Badge variant="outline" className="text-[10px]">
                                  {athlete.team?.includes('Men') ? 'M' : 'W'}
                                </Badge>
                              </div>
                            </td>
                            <td className="py-2 px-2">
                              <Input 
                                type="number"
                                step="0.1"
                                placeholder="cm"
                                value={testData[athlete.id]?.trial_1 || ''}
                                onChange={(e) => updateTrials(athlete.id, 'trial_1', e.target.value)}
                                disabled={!selectedAthletes.includes(athlete.id)}
                                className="h-8 text-center bg-background/50 border-white/10"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <Input 
                                type="number"
                                step="0.1"
                                placeholder="cm"
                                value={testData[athlete.id]?.trial_2 || ''}
                                onChange={(e) => updateTrials(athlete.id, 'trial_2', e.target.value)}
                                disabled={!selectedAthletes.includes(athlete.id)}
                                className="h-8 text-center bg-background/50 border-white/10"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <Input 
                                type="number"
                                step="0.1"
                                placeholder="cm"
                                value={testData[athlete.id]?.trial_3 || ''}
                                onChange={(e) => updateTrials(athlete.id, 'trial_3', e.target.value)}
                                disabled={!selectedAthletes.includes(athlete.id)}
                                className="h-8 text-center bg-background/50 border-white/10"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
        
        {!results && (
          <div className="border-t border-white/10 p-4 flex gap-3">
            <Button variant="outline" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={submitting || selectedAthletes.length === 0}
              className="flex-1"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save All Tests
                </>
              )}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
