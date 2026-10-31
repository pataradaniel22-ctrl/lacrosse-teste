import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  Download, 
  FileText, 
  Table2, 
  X, 
  Calendar,
  Users,
  User,
  FileDown,
  Loader2,
  CheckCircle2
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ExportModal({ 
  isOpen, 
  onClose, 
  scope = 'team',  // 'team' or 'individual'
  athleteId = null,
  athleteName = null 
}) {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [options, setOptions] = useState(null);
  
  // Form state
  const [format, setFormat] = useState('pdf');
  const [team, setTeam] = useState('all');
  const [dateMode, setDateMode] = useState('range'); // 'range', 'event', 'all'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [eventId, setEventId] = useState('');
  
  // Data sections to include
  const [includeReadiness, setIncludeReadiness] = useState(true);
  const [includeTraining, setIncludeTraining] = useState(true);
  const [includePain, setIncludePain] = useState(true);
  const [includeRecovery, setIncludeRecovery] = useState(true);
  const [includeCompliance, setIncludeCompliance] = useState(true);

  // Set default dates (last 30 days)
  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  }, []);

  // Fetch export options - refetch when team changes
  useEffect(() => {
    if (isOpen) {
      fetchOptions();
    }
  }, [isOpen, team]);

  const fetchOptions = async () => {
    setLoading(true);
    try {
      const teamParam = team !== 'all' ? `?team=${team}` : '';
      const res = await axios.get(`${API}/export/options${teamParam}`, getAuthHeaders());
      setOptions(res.data);
    } catch (error) {
      toast.error('Failed to load export options');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const requestBody = {
        format,
        scope: scope === 'individual' ? 'individual' : 'team',
        athlete_id: athleteId,
        team: scope === 'team' ? team : null,
        start_date: dateMode === 'event' ? null : startDate,
        end_date: dateMode === 'event' ? null : endDate,
        event_id: dateMode === 'event' ? eventId : null,
        include_readiness: includeReadiness,
        include_training: includeTraining,
        include_pain: includePain,
        include_recovery: includeRecovery,
        include_compliance: includeCompliance
      };

      const endpoint = scope === 'individual' 
        ? `${API}/export/athlete/${athleteId}`
        : `${API}/export/team`;

      const response = await axios.post(endpoint, requestBody, {
        ...getAuthHeaders(),
        responseType: 'blob'
      });

      // Create download link
      const blob = new Blob([response.data], { 
        type: format === 'pdf' ? 'application/pdf' : 'text/csv' 
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Get filename from response headers or generate one
      const contentDisposition = response.headers['content-disposition'];
      let filename = `export_${new Date().toISOString().split('T')[0]}.${format}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename=(.+)/);
        if (match) filename = match[1];
      }
      
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.success('Export downloaded successfully!');
      onClose();
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to generate export');
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <Card className="relative z-10 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto glass-heavy border-white/10">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Download className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Export Data</CardTitle>
                <CardDescription>
                  {scope === 'individual' ? `Export ${athleteName}'s data` : 'Export team data'}
                </CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Format Selection */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Export Format</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormat('pdf')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      format === 'pdf' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <FileText className={`w-6 h-6 mx-auto mb-2 ${format === 'pdf' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <p className="font-medium text-sm">PDF Report</p>
                    <p className="text-xs text-muted-foreground mt-1">Professional report format</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormat('csv')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      format === 'csv' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <Table2 className={`w-6 h-6 mx-auto mb-2 ${format === 'csv' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <p className="font-medium text-sm">CSV Spreadsheet</p>
                    <p className="text-xs text-muted-foreground mt-1">For data analysis</p>
                  </button>
                </div>
              </div>

              {/* Team Selection (only for team export) */}
              {scope === 'team' && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Team Filter</Label>
                  <Select value={team} onValueChange={setTeam}>
                    <SelectTrigger className="bg-background/50 border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options?.teams?.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4" />
                            <span>{t.label}</span>
                            <Badge variant="secondary" className="ml-2">{t.count}</Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Date Range Selection */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Time Period</Label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setDateMode('range')}
                    className={`p-2 rounded-lg border text-sm transition-all ${
                      dateMode === 'range' 
                        ? 'border-primary bg-primary/10 text-primary' 
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <Calendar className="w-4 h-4 mx-auto mb-1" />
                    Date Range
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateMode('event')}
                    className={`p-2 rounded-lg border text-sm transition-all ${
                      dateMode === 'event' 
                        ? 'border-primary bg-primary/10 text-primary' 
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <Calendar className="w-4 h-4 mx-auto mb-1" />
                    Event
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDateMode('all');
                      setStartDate('2020-01-01');
                      setEndDate(new Date().toISOString().split('T')[0]);
                    }}
                    className={`p-2 rounded-lg border text-sm transition-all ${
                      dateMode === 'all' 
                        ? 'border-primary bg-primary/10 text-primary' 
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <Calendar className="w-4 h-4 mx-auto mb-1" />
                    All Time
                  </button>
                </div>

                {dateMode === 'range' && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Start Date</Label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-background/50 border-white/10"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">End Date</Label>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-background/50 border-white/10"
                      />
                    </div>
                  </div>
                )}

                {dateMode === 'event' && (
                  <div className="mt-3">
                    <Select value={eventId} onValueChange={setEventId}>
                      <SelectTrigger className="bg-background/50 border-white/10">
                        <SelectValue placeholder="Select an event..." />
                      </SelectTrigger>
                      <SelectContent>
                        {options?.events?.length === 0 && (
                          <SelectItem value="" disabled>No events found</SelectItem>
                        )}
                        {options?.events?.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            <div className="flex items-center gap-2">
                              <span>{e.name}</span>
                              <span className="text-xs text-muted-foreground">
                                ({e.start_date} - {e.end_date})
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Data Sections */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Include Data</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="readiness" 
                      checked={includeReadiness}
                      onCheckedChange={setIncludeReadiness}
                    />
                    <Label htmlFor="readiness" className="text-sm cursor-pointer">
                      Daily Readiness
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="training" 
                      checked={includeTraining}
                      onCheckedChange={setIncludeTraining}
                    />
                    <Label htmlFor="training" className="text-sm cursor-pointer">
                      Training Sessions
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="pain" 
                      checked={includePain}
                      onCheckedChange={setIncludePain}
                    />
                    <Label htmlFor="pain" className="text-sm cursor-pointer">
                      Pain Reports
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="recovery" 
                      checked={includeRecovery}
                      onCheckedChange={setIncludeRecovery}
                    />
                    <Label htmlFor="recovery" className="text-sm cursor-pointer">
                      Recovery Data
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="compliance" 
                      checked={includeCompliance}
                      onCheckedChange={setIncludeCompliance}
                    />
                    <Label htmlFor="compliance" className="text-sm cursor-pointer">
                      Compliance
                    </Label>
                  </div>
                </div>
              </div>

              {/* Export Summary */}
              <div className="p-4 rounded-lg bg-muted/30 border border-white/5">
                <p className="text-sm font-medium mb-2">Export Summary</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-primary/30">
                    {format.toUpperCase()}
                  </Badge>
                  {scope === 'individual' ? (
                    <Badge variant="outline" className="border-blue-500/30">
                      <User className="w-3 h-3 mr-1" />
                      {athleteName}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-500/30">
                      <Users className="w-3 h-3 mr-1" />
                      {team === 'all' ? 'All Teams' : team === 'men' ? "Men's" : "Women's"}
                    </Badge>
                  )}
                  <Badge variant="outline" className="border-amber-500/30">
                    <Calendar className="w-3 h-3 mr-1" />
                    {dateMode === 'event' 
                      ? (options?.events?.find(e => e.id === eventId)?.name || 'Select event')
                      : `${startDate} - ${endDate}`}
                  </Badge>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button 
                  variant="outline" 
                  onClick={onClose}
                  className="flex-1 border-white/10"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleExport}
                  disabled={exporting || (dateMode === 'event' && !eventId)}
                  className="flex-1 bg-primary hover:bg-primary/90"
                >
                  {exporting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <FileDown className="w-4 h-4 mr-2" />
                      Export {format.toUpperCase()}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
