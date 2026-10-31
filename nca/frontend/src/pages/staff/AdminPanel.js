import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  ArrowLeft, 
  UserPlus, 
  Users, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Shield,
  Trash2
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AdminPanel() {
  const navigate = useNavigate();
  const { user, getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [pendingAthletes, setPendingAthletes] = useState([]);
  const [allAthletes, setAllAthletes] = useState([]);
  const [activeTab, setActiveTab] = useState('pending');

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, pendingRes, allRes] = await Promise.all([
        axios.get(`${API}/admin/stats`, getAuthHeaders()),
        axios.get(`${API}/admin/pending-athletes`, getAuthHeaders()),
        axios.get(`${API}/admin/all-athletes`, getAuthHeaders())
      ]);
      
      setStats(statsRes.data);
      setPendingAthletes(pendingRes.data);
      setAllAthletes(allRes.data);
    } catch (error) {
      toast.error('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const approveAthlete = async (athleteId) => {
    try {
      await axios.put(`${API}/admin/athlete/${athleteId}/approve`, {}, getAuthHeaders());
      toast.success('Athlete approved');
      fetchData();
    } catch (error) {
      toast.error('Failed to approve athlete');
    }
  };

  const rejectAthlete = async (athleteId) => {
    try {
      await axios.put(`${API}/admin/athlete/${athleteId}/reject`, {}, getAuthHeaders());
      toast.success('Athlete rejected');
      fetchData();
    } catch (error) {
      toast.error('Failed to reject athlete');
    }
  };

  const deleteAthlete = async (athleteId) => {
    if (!window.confirm('Are you sure you want to delete this athlete? This action cannot be undone.')) {
      return;
    }
    
    try {
      await axios.delete(`${API}/admin/athlete/${athleteId}`, getAuthHeaders());
      toast.success('Athlete deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete athlete');
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Approved</Badge>;
      case 'pending':
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Pending</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Rejected</Badge>;
      default:
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Active</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="admin-panel">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
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
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="font-heading font-bold text-lg">Admin Panel</h1>
                <p className="text-xs text-muted-foreground">User Management</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card className="glass-light border-white/5 animate-fade-in">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="text-xs text-muted-foreground uppercase">Pending</span>
                </div>
                <p className="text-3xl font-heading font-bold text-amber-400">{stats.pending_athletes}</p>
              </CardContent>
            </Card>
            
            <Card className="glass-light border-white/5 animate-fade-in" style={{ animationDelay: '50ms' }}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs text-muted-foreground uppercase">Approved</span>
                </div>
                <p className="text-3xl font-heading font-bold text-emerald-400">{stats.approved_athletes}</p>
              </CardContent>
            </Card>
            
            <Card className="glass-light border-white/5 animate-fade-in" style={{ animationDelay: '100ms' }}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-xs text-muted-foreground uppercase">Rejected</span>
                </div>
                <p className="text-3xl font-heading font-bold text-red-400">{stats.rejected_athletes}</p>
              </CardContent>
            </Card>
            
            <Card className="glass-light border-white/5 animate-fade-in" style={{ animationDelay: '150ms' }}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-blue-400" />
                  <span className="text-xs text-muted-foreground uppercase">Staff</span>
                </div>
                <p className="text-3xl font-heading font-bold">{stats.total_staff}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="pending" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Pending ({pendingAthletes.length})
            </TabsTrigger>
            <TabsTrigger value="all" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              All Athletes ({allAthletes.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-4 space-y-3">
            {pendingAthletes.length === 0 ? (
              <Card className="glass-light border-white/5">
                <CardContent className="p-8 text-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                  <p className="text-lg font-medium">No Pending Registrations</p>
                  <p className="text-muted-foreground">All athlete registrations have been reviewed.</p>
                </CardContent>
              </Card>
            ) : (
              pendingAthletes.map((athlete, index) => (
                <Card 
                  key={athlete.id} 
                  className="glass-light border-amber-500/20 animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-lg font-bold text-amber-400">
                          {athlete.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-lg">{athlete.name}</p>
                          <p className="text-sm text-muted-foreground">{athlete.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {athlete.team.includes('Men') ? "Men's Team" : "Women's Team"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Registered: {new Date(athlete.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button 
                          size="sm"
                          onClick={() => approveAthlete(athlete.id)}
                          className="bg-emerald-600 hover:bg-emerald-700"
                          data-testid={`approve-${athlete.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                        <Button 
                          size="sm"
                          variant="destructive"
                          onClick={() => rejectAthlete(athlete.id)}
                          data-testid={`reject-${athlete.id}`}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="all" className="mt-4 space-y-3">
            {allAthletes.length === 0 ? (
              <Card className="glass-light border-white/5">
                <CardContent className="p-8 text-center text-muted-foreground">
                  No athletes registered yet.
                </CardContent>
              </Card>
            ) : (
              allAthletes.map((athlete, index) => (
                <Card 
                  key={athlete.id} 
                  className="glass-light border-white/5 animate-fade-in"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-secondary/30 flex items-center justify-center font-bold">
                          {athlete.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{athlete.name}</p>
                            {getStatusBadge(athlete.status)}
                          </div>
                          <p className="text-sm text-muted-foreground">{athlete.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {athlete.team.includes('Men') ? "Men's Team" : "Women's Team"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {athlete.status === 'pending' && (
                          <>
                            <Button 
                              size="sm"
                              onClick={() => approveAthlete(athlete.id)}
                              className="bg-emerald-600 hover:bg-emerald-700"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="sm"
                              variant="destructive"
                              onClick={() => rejectAthlete(athlete.id)}
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {athlete.status === 'rejected' && (
                          <Button 
                            size="sm"
                            onClick={() => approveAthlete(athlete.id)}
                            className="bg-emerald-600 hover:bg-emerald-700"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                        )}
                        <Button 
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => deleteAthlete(athlete.id)}
                          data-testid={`delete-${athlete.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
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
