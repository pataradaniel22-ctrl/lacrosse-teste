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
  Trash2,
  Database,
  RefreshCw,
  Archive,
  UserCog,
  Ban,
  RotateCcw,
  Lock,
  ClipboardList
} from 'lucide-react';
import { Input } from '../../components/ui/input';
import DemoModePanel from '../../components/demo/DemoModePanel';
import { FlaskConical, DatabaseZap, Tags } from 'lucide-react';
import GroupsAdminPanel from '../../components/groups/GroupsAdminPanel';
import GroupBadges from '../../components/groups/GroupBadges';
import EmergentImportPanel from '../../components/admin/EmergentImportPanel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AdminPanel() {
  const navigate = useNavigate();
  const { user, getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [pendingAthletes, setPendingAthletes] = useState([]);
  const [allAthletes, setAllAthletes] = useState([]);
  const [pendingStaff, setPendingStaff] = useState([]);
  const [allStaff, setAllStaff] = useState([]);
  const [staffConfirm, setStaffConfirm] = useState(null); // { action, staff }
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'pending');
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [liveCounts, setLiveCounts] = useState(null);

  const ARCHIVE_EVENT_NAME = 'Seletivas Brewster';
  const ARCHIVE_START = '2026-06-24';
  const ARCHIVE_END = '2026-06-29';

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, pendingRes, allRes, countsRes, pendingStaffRes, allStaffRes] = await Promise.all([
        axios.get(`${API}/admin/stats`, getAuthHeaders()),
        axios.get(`${API}/admin/pending-athletes`, getAuthHeaders()),
        axios.get(`${API}/admin/all-athletes`, getAuthHeaders()),
        axios.get(`${API}/staff/archive/live-counts`, getAuthHeaders()).catch(() => ({ data: null })),
        axios.get(`${API}/admin/pending-staff`, getAuthHeaders()),
        axios.get(`${API}/admin/staff`, getAuthHeaders()),
      ]);
      
      setStats(statsRes.data);
      setPendingAthletes(pendingRes.data);
      setAllAthletes(allRes.data);
      setLiveCounts(countsRes.data);
      setPendingStaff(pendingStaffRes.data);
      setAllStaff(allStaffRes.data);
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

  // ===== Staff account management =====
  const approveStaff = async (id) => {
    try {
      await axios.put(`${API}/admin/staff/${id}/approve`, {}, getAuthHeaders());
      toast.success('Staff account approved');
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to approve staff'); }
  };

  const runStaffAction = async () => {
    if (!staffConfirm) return;
    const { action, staff } = staffConfirm;
    try {
      if (action === 'reject') {
        await axios.put(`${API}/admin/staff/${staff.id}/reject`, {}, getAuthHeaders());
        toast.success('Staff account rejected');
      } else if (action === 'deactivate') {
        await axios.put(`${API}/admin/staff/${staff.id}/deactivate`, {}, getAuthHeaders());
        toast.success('Staff access revoked');
      } else if (action === 'activate') {
        await axios.put(`${API}/admin/staff/${staff.id}/activate`, {}, getAuthHeaders());
        toast.success('Staff access restored');
      } else if (action === 'delete') {
        await axios.delete(`${API}/admin/staff/${staff.id}`, getAuthHeaders());
        toast.success('Staff account deleted');
      }
      setStaffConfirm(null);
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Action failed');
      setStaffConfirm(null);
    }
  };

  const seedDemoData = async () => {
    setDemoLoading(true);
    try {
      const response = await axios.get(`${API}/seed-demo`, getAuthHeaders());
      if (response.data.success) {
        toast.success(`Demo data created! ${response.data.data_created}`);
        fetchData();
      } else {
        console.error('Seed error:', response.data);
        toast.error(response.data.error || 'Error creating demo data');
      }
    } catch (error) {
      console.error('Seed error:', error);
      toast.error(error.response?.data?.error || error.message || 'Error creating demo data');
    } finally {
      setDemoLoading(false);
    }
  };

  const clearDemoData = async () => {
    setDemoLoading(true);
    try {
      const response = await axios.delete(`${API}/admin/clear-demo-data`, getAuthHeaders());
      if (response.data.success) {
        toast.success(`Demo data removed! ${response.data.deleted.athletes} athletes, ${response.data.deleted.check_ins} check-ins, ${response.data.deleted.sessions} sessions`);
        setShowClearDialog(false);
        fetchData();
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Error removing demo data');
    } finally {
      setDemoLoading(false);
    }
  };

  const archiveAndReset = async () => {
    setArchiveLoading(true);
    try {
      const response = await axios.post(`${API}/staff/archive-collection`, {
        event_name: ARCHIVE_EVENT_NAME,
        confirm_name: archiveConfirm.trim(),
        start_date: ARCHIVE_START,
        end_date: ARCHIVE_END,
      }, getAuthHeaders());
      toast.success(`Archived ${response.data.total} records into "${response.data.event_name}". The app is ready for a new collection.`);
      setShowArchiveDialog(false);
      setArchiveConfirm('');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Error archiving data');
    } finally {
      setArchiveLoading(false);
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
                {stats.pending_staff > 0 && (
                  <p className="text-[11px] text-amber-400 mt-1">{stats.pending_staff} pending approval</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Quick Surveys */}
        <Card className="glass-light border-primary/20 mb-6 animate-fade-in" data-testid="surveys-link-card">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <ClipboardList className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Quick Surveys</p>
                <p className="text-xs text-muted-foreground">Build one-day surveys athletes must answer before their daily entries. See responses & analysis.</p>
              </div>
            </div>
            <Button onClick={() => navigate('/staff/surveys')} data-testid="open-surveys-btn">
              <ClipboardList className="w-4 h-4 mr-1" /> Manage surveys
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-light border-emerald-500/20 mb-6 animate-fade-in" data-testid="research-data-card">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <Database className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="font-medium text-sm">Research Data</p>
                <p className="text-xs text-muted-foreground">All app data tabulated by dataset, filtered by period/team, anonymizable. Export to Excel or CSV (Google Sheets).</p>
              </div>
            </div>
            <Button onClick={() => navigate('/staff/research-data')} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="open-research-data-btn">
              <Database className="w-4 h-4 mr-1" /> Open Research Data
            </Button>
          </CardContent>
        </Card>

        {/* Demo Data Management */}
        <Card className="glass-light border-white/5 mb-6 animate-fade-in">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="w-4 h-4 text-purple-400" />
              Demo Data
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground mb-4">
              Use the buttons below to add demo data for presentations or remove it when you start using the app for real.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={seedDemoData}
                disabled={demoLoading}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {demoLoading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-2" />
                )}
                Add Demo Data
              </Button>
              <Button
                onClick={() => setShowClearDialog(true)}
                disabled={demoLoading}
                variant="destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove Demo Data
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">
              ⚠️ Removing demo data will delete: 16 demo athletes, all associated check-ins and training sessions.
            </p>
          </CardContent>
        </Card>

        {/* Archive & Start New Collection */}
        <Card className="glass-light border-amber-500/20 mb-6 animate-fade-in" data-testid="archive-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Archive className="w-4 h-4 text-amber-400" />
              Archive & Start New Collection
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground mb-4">
              Archive all current monitoring data (check-ins, training sessions, recovery logs and alerts)
              under the event <span className="font-semibold text-foreground">"{ARCHIVE_EVENT_NAME}"</span> and reset
              the live app for a new collection period. Athlete profiles and the roster are kept. The archived
              data stays available in the Event Report.
            </p>
            {liveCounts && (
              <div className="flex flex-wrap gap-2 mb-4 text-[11px]">
                <Badge variant="outline" className="border-white/10">Check-ins: {liveCounts.daily_readiness ?? 0}</Badge>
                <Badge variant="outline" className="border-white/10">Sessions: {liveCounts.training_sessions ?? 0}</Badge>
                <Badge variant="outline" className="border-white/10">Recovery: {liveCounts.recovery_logs ?? 0}</Badge>
                <Badge variant="outline" className="border-white/10">Alerts: {liveCounts.alerts ?? 0}</Badge>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Total: {liveCounts.total ?? 0}</Badge>
              </div>
            )}
            <Button
              onClick={() => { setArchiveConfirm(''); setShowArchiveDialog(true); }}
              disabled={archiveLoading || (liveCounts && liveCounts.total === 0)}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              data-testid="archive-start-btn"
            >
              <Archive className="w-4 h-4 mr-2" />
              Archive & Start New Collection
            </Button>
            <p className="text-[10px] text-muted-foreground mt-3">
              ⚠️ This moves live data into archive storage and empties the live monitoring collections. No data is deleted.
            </p>
          </CardContent>
        </Card>


        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in">
          <TabsList className="bg-muted/50 flex-wrap h-auto">
            <TabsTrigger value="pending" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Pending ({pendingAthletes.length})
            </TabsTrigger>
            <TabsTrigger value="all" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              All Athletes ({allAthletes.length})
            </TabsTrigger>
            <TabsTrigger value="pending-staff" className="flex items-center gap-2" data-testid="tab-pending-staff">
              <Clock className="w-4 h-4" />
              Pending Staff ({pendingStaff.length})
            </TabsTrigger>
            <TabsTrigger value="staff" className="flex items-center gap-2" data-testid="tab-staff">
              <UserCog className="w-4 h-4" />
              Staff ({allStaff.length})
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex items-center gap-2" data-testid="tab-groups">
              <Tags className="w-4 h-4" />
              Groups
            </TabsTrigger>
            <TabsTrigger value="demo" className="flex items-center gap-2" data-testid="tab-demo">
              <FlaskConical className="w-4 h-4" />
              Demo mode
            </TabsTrigger>
            <TabsTrigger value="import" className="flex items-center gap-2" data-testid="tab-import">
              <DatabaseZap className="w-4 h-4" />
              Import from Emergent
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
                            <GroupBadges groups={athlete.groups} />
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

          {/* ===== Pending Staff ===== */}
          <TabsContent value="pending-staff" className="mt-4 space-y-3">
            {pendingStaff.length === 0 ? (
              <Card className="glass-light border-white/5">
                <CardContent className="p-8 text-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                  <p className="text-lg font-medium">No Staff Awaiting Approval</p>
                  <p className="text-muted-foreground">New staff registrations will appear here for your approval.</p>
                </CardContent>
              </Card>
            ) : (
              pendingStaff.map((s, index) => (
                <Card key={s.id} className="glass-light border-amber-500/20 animate-fade-in" style={{ animationDelay: `${index * 50}ms` }} data-testid={`pending-staff-${s.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-lg font-bold text-amber-400">
                          {s.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-lg">{s.name}</p>
                          <p className="text-sm text-muted-foreground">{s.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">{s.role}</Badge>
                            {s.team && <Badge variant="outline" className="text-xs">{s.team}</Badge>}
                            <span className="text-xs text-muted-foreground">
                              Registered: {new Date(s.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => approveStaff(s.id)} className="bg-emerald-600 hover:bg-emerald-700" data-testid={`approve-staff-${s.id}`}>
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setStaffConfirm({ action: 'reject', staff: s })} data-testid={`reject-staff-${s.id}`}>
                          <XCircle className="w-4 h-4 mr-1" /> Reject
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ===== All Staff ===== */}
          <TabsContent value="groups" className="mt-4">
            <GroupsAdminPanel getAuthHeaders={getAuthHeaders} />
          </TabsContent>

          <TabsContent value="demo" className="mt-4">
            <DemoModePanel getAuthHeaders={getAuthHeaders} />
          </TabsContent>

          <TabsContent value="import" className="mt-4">
            <EmergentImportPanel getAuthHeaders={getAuthHeaders} />
          </TabsContent>

          <TabsContent value="staff" className="mt-4 space-y-3">
            {allStaff.length === 0 ? (
              <Card className="glass-light border-white/5">
                <CardContent className="p-8 text-center text-muted-foreground">No staff accounts yet.</CardContent>
              </Card>
            ) : (
              allStaff.map((s, index) => (
                <Card key={s.id} className="glass-light border-white/5 animate-fade-in" style={{ animationDelay: `${index * 30}ms` }} data-testid={`staff-row-${s.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-secondary/30 flex items-center justify-center font-bold">
                          {s.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">{s.name}</p>
                            {getStatusBadge(s.status)}
                            {!s.active && s.status !== 'rejected' && (
                              <Badge className="bg-slate-500/20 text-slate-300 border-slate-500/30">Revoked</Badge>
                            )}
                            {s.is_protected && (
                              <Badge className="bg-primary/20 text-primary border-primary/30 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Admin
                              </Badge>
                            )}
                            {s.is_self && <Badge variant="outline" className="text-xs">You</Badge>}
                          </div>
                          <p className="text-sm text-muted-foreground">{s.email}</p>
                          <p className="text-xs text-muted-foreground">{s.role}{s.team ? ` · ${s.team}` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.is_protected ? (
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Protected</span>
                        ) : s.is_self ? (
                          <span className="text-xs text-muted-foreground">Your account</span>
                        ) : (
                          <>
                            {s.status === 'pending' && (
                              <Button size="sm" onClick={() => approveStaff(s.id)} className="bg-emerald-600 hover:bg-emerald-700" title="Approve">
                                <CheckCircle2 className="w-4 h-4" />
                              </Button>
                            )}
                            {s.active && s.status !== 'rejected' && s.status !== 'pending' && (
                              <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10" onClick={() => setStaffConfirm({ action: 'deactivate', staff: s })} data-testid={`deactivate-staff-${s.id}`}>
                                <Ban className="w-4 h-4 mr-1" /> Revoke
                              </Button>
                            )}
                            {(!s.active || s.status === 'rejected') && (
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setStaffConfirm({ action: 'activate', staff: s })} data-testid={`activate-staff-${s.id}`}>
                                <RotateCcw className="w-4 h-4 mr-1" /> Restore
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => setStaffConfirm({ action: 'delete', staff: s })} data-testid={`delete-staff-${s.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Clear Demo Data Confirmation Dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent className="bg-background border-red-500/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-400">
              <Trash2 className="w-5 h-5" />
              Remove Demo Data
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>Are you sure you want to remove all demonstration data?</p>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
                <p className="font-medium">⚠️ This action will remove:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>16 demonstration athletes</li>
                  <li>All morning check-ins of these athletes</li>
                  <li>All training sessions of these athletes</li>
                  <li>All CMJ tests of these athletes</li>
                </ul>
              </div>
              <p className="text-amber-400 text-sm">
                💡 Use this option when you're about to start using the app with real data.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={demoLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={clearDemoData}
              disabled={demoLoading}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {demoLoading ? 'Removing...' : 'Confirm Removal'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive & Reset Confirmation Dialog */}
      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent className="bg-background border-amber-500/20" data-testid="archive-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-400">
              <Archive className="w-5 h-5" />
              Archive & Start New Collection
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                All current monitoring data will be archived under the event{' '}
                <span className="font-semibold text-foreground">"{ARCHIVE_EVENT_NAME}"</span>{' '}
                and the live app will be reset for a new collection period.
              </p>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-amber-400 text-sm">
                <p className="font-medium">This will move to the archive:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>{liveCounts?.daily_readiness ?? 0} morning check-ins</li>
                  <li>{liveCounts?.training_sessions ?? 0} training sessions</li>
                  <li>{liveCounts?.recovery_logs ?? 0} recovery logs</li>
                  <li>{liveCounts?.alerts ?? 0} alerts</li>
                </ul>
                <p className="mt-2 text-xs">Athlete profiles and roster are kept. No data is deleted.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-foreground">
                  Type <span className="font-semibold text-amber-400">{ARCHIVE_EVENT_NAME}</span> to confirm:
                </label>
                <Input
                  value={archiveConfirm}
                  onChange={(e) => setArchiveConfirm(e.target.value)}
                  placeholder={ARCHIVE_EVENT_NAME}
                  data-testid="archive-confirm-input"
                  autoFocus
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={archiveAndReset}
              disabled={archiveLoading || archiveConfirm.trim() !== ARCHIVE_EVENT_NAME}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              data-testid="archive-confirm-btn"
            >
              {archiveLoading ? 'Archiving...' : 'Archive & Reset'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Staff action confirmation */}
      <AlertDialog open={!!staffConfirm} onOpenChange={(o) => !o && setStaffConfirm(null)}>
        <AlertDialogContent className="bg-background border-white/10" data-testid="staff-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {staffConfirm?.action === 'delete' && <Trash2 className="w-5 h-5 text-red-400" />}
              {staffConfirm?.action === 'deactivate' && <Ban className="w-5 h-5 text-amber-400" />}
              {staffConfirm?.action === 'reject' && <XCircle className="w-5 h-5 text-red-400" />}
              {staffConfirm?.action === 'activate' && <RotateCcw className="w-5 h-5 text-emerald-400" />}
              {staffConfirm?.action === 'delete' && 'Delete staff account'}
              {staffConfirm?.action === 'deactivate' && 'Revoke staff access'}
              {staffConfirm?.action === 'reject' && 'Reject staff account'}
              {staffConfirm?.action === 'activate' && 'Restore staff access'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {staffConfirm && (
                <>
                  <span className="font-semibold text-foreground">{staffConfirm.staff.name}</span> ({staffConfirm.staff.email}, {staffConfirm.staff.role}).{' '}
                  {staffConfirm.action === 'delete' && 'This permanently deletes the account. This cannot be undone.'}
                  {staffConfirm.action === 'deactivate' && 'They will be logged out and blocked from signing in until you restore access.'}
                  {staffConfirm.action === 'reject' && 'They will not be able to log in. You can restore access later.'}
                  {staffConfirm.action === 'activate' && 'They will be able to sign in again.'}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runStaffAction}
              className={staffConfirm?.action === 'activate' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-red-500 hover:bg-red-600 text-white'}
              data-testid="staff-confirm-btn"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
