import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  ArrowLeft, 
  AlertTriangle, 
  CheckCircle2,
  Clock,
  Filter
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AlertsPage() {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState('all');
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [resolvedAlerts, setResolvedAlerts] = useState([]);

  const fetchAlerts = useCallback(async () => {
    try {
      const teamParam = teamFilter !== 'all' ? `&team=${teamFilter}` : '';
      const [activeRes, resolvedRes] = await Promise.all([
        axios.get(`${API}/staff/alerts?resolved=false${teamParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/alerts?resolved=true${teamParam}`, getAuthHeaders())
      ]);
      
      setActiveAlerts(activeRes.data);
      setResolvedAlerts(resolvedRes.data);
    } catch (error) {
      toast.error('Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [teamFilter, getAuthHeaders]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const resolveAlert = async (alertId) => {
    try {
      await axios.put(`${API}/staff/alerts/${alertId}/resolve`, {}, getAuthHeaders());
      toast.success('Alert resolved');
      fetchAlerts();
    } catch (error) {
      toast.error('Failed to resolve alert');
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'Red': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'Yellow': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default: return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    }
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case 'LowReadiness': return '😴';
      case 'HighLoadSpike': return '⚡';
      case 'PersistentPain': return '🤕';
      case 'MissingEntries': return '📝';
      default: return '⚠️';
    }
  };

  const formatAlertType = (type) => {
    return type.replace(/([A-Z])/g, ' $1').trim();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="alerts-page">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => navigate('/staff')}
              data-testid="back-btn"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h1 className="font-heading font-bold text-lg">Alerts Management</h1>
                <p className="text-xs text-muted-foreground">
                  {activeAlerts.length} active alert{activeAlerts.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
          
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="w-40 bg-background/50 border-white/10" data-testid="team-filter">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teams</SelectItem>
              <SelectItem value="Brazil Lacrosse Men">Men&apos;s Team</SelectItem>
              <SelectItem value="Brazil Lacrosse Women">Women&apos;s Team</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <Tabs defaultValue="active" className="animate-fade-in">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="active" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Active ({activeAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="resolved" className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Resolved ({resolvedAlerts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4 space-y-3">
            {activeAlerts.length === 0 ? (
              <Card className="glass-light border-white/5">
                <CardContent className="p-8 text-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                  <p className="text-lg font-medium">All Clear!</p>
                  <p className="text-muted-foreground">No active alerts at this time.</p>
                </CardContent>
              </Card>
            ) : (
              activeAlerts.map((alert, index) => (
                <Card 
                  key={alert.id} 
                  className={`border ${getSeverityColor(alert.severity)} animate-fade-in`}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{getAlertIcon(alert.alert_type)}</span>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold">{alert.athlete_name}</span>
                            <Badge variant="outline" className={getSeverityColor(alert.severity)}>
                              {alert.severity}
                            </Badge>
                          </div>
                          <p className="text-sm font-medium mb-1">{formatAlertType(alert.alert_type)}</p>
                          <p className="text-sm text-muted-foreground">{alert.message}</p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Created: {new Date(alert.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Button 
                        size="sm" 
                        onClick={() => resolveAlert(alert.id)}
                        className="shrink-0"
                        data-testid={`resolve-alert-${alert.id}`}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        Resolve
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="resolved" className="mt-4 space-y-3">
            {resolvedAlerts.length === 0 ? (
              <Card className="glass-light border-white/5">
                <CardContent className="p-8 text-center text-muted-foreground">
                  No resolved alerts yet.
                </CardContent>
              </Card>
            ) : (
              resolvedAlerts.map((alert, index) => (
                <Card 
                  key={alert.id} 
                  className="glass-light border-white/5 opacity-70 animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl opacity-50">{getAlertIcon(alert.alert_type)}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{alert.athlete_name}</span>
                          <Badge variant="outline" className="border-white/20 text-muted-foreground">
                            {alert.severity}
                          </Badge>
                          <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Resolved
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{alert.message}</p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                          <span>Created: {new Date(alert.created_at).toLocaleDateString()}</span>
                          {alert.resolved_at && (
                            <span>Resolved: {new Date(alert.resolved_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
