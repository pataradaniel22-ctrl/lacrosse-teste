import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { ArrowLeft, Database, FileSpreadsheet, Sheet, Download, ShieldCheck, UserCheck, Link2, BookOpen } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { AdherenceReport } from '../../components/research/AdherenceReport';
import { SheetsLinks } from '../../components/research/SheetsLinks';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { PeriodFilter } from '../../components/research/PeriodFilter';
import { DataTable } from '../../components/research/DataTable';
import { API, presetRange, buildQuery, downloadExport } from '../../components/research/exportUtils';

const DatasetRow = ({ d, checked, active, onToggle, onOpen }) => (
  <div onClick={onOpen}
    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${active ? 'border-primary/50 bg-primary/10' : 'border-white/5 hover:border-white/20'}`}
    data-testid={`dataset-${d.key}`}>
    <input type="checkbox" className="mt-1" checked={checked} onClick={(e) => e.stopPropagation()} onChange={onToggle} data-testid={`dataset-check-${d.key}`} />
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium truncate">{d.label}</p>
        <Badge variant="outline" className="border-white/10 text-[10px]" data-testid={`dataset-count-${d.key}`}>{d.count}</Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">{d.description}</p>
    </div>
  </div>
);

export default function ResearchData() {
  const { getAuthHeaders } = useAuth();
  const [filter, setFilter] = useState({ preset: 'all', ...presetRange('all'), team: 'all-teams' });
  const [anonymize, setAnonymize] = useState(true);
  const [archived, setArchived] = useState(true);
  const [meta, setMeta] = useState({ datasets: [], teams: [] });
  const [selected, setSelected] = useState([]);
  const [active, setActive] = useState('ostrc_responses');
  const [preview, setPreview] = useState(null);

  const params = useMemo(() => ({ start: filter.start, end: filter.end, team: filter.team, anonymize, include_archived: archived }),
    [filter, anonymize, archived]);

  const loadMeta = useCallback(async () => {
    try {
      const { anonymize: _a, ...p } = params;
      const r = await axios.get(`${API}/research/datasets?${buildQuery(p)}`, getAuthHeaders());
      setMeta(r.data);
      setSelected((s) => (s.length ? s : r.data.datasets.map((d) => d.key)));
    } catch (e) { toast.error('Failed to load datasets'); }
  }, [params, getAuthHeaders]);

  const loadPreview = useCallback(async () => {
    setPreview(null);
    try {
      const r = await axios.get(`${API}/research/preview/${active}?${buildQuery({ ...params, limit: 200 })}`, getAuthHeaders());
      setPreview(r.data);
    } catch (e) { toast.error('Failed to load preview'); }
  }, [active, params, getAuthHeaders]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { loadPreview(); }, [loadPreview]);

  const toggle = (k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const exportSel = (format) => {
    if (!selected.length) { toast.error('Select at least one dataset'); return; }
    downloadExport('/research/export', { ...params, datasets: selected.join(','), format }, getAuthHeaders(), `research_data.${format === 'csv' ? 'zip' : 'xlsx'}`);
    if (format === 'csv') toast.info('Google Sheets: File → Import → Upload each CSV (or upload the .xlsx to Drive)');
  };

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="research-data-page">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <Link to="/staff" className="text-muted-foreground hover:text-foreground" data-testid="research-back-btn"><ArrowLeft className="w-5 h-5" /></Link>
          <Database className="w-5 h-5 text-primary" />
          <div>
            <h1 className="font-heading font-bold text-lg leading-none">Research Data</h1>
            <p className="text-xs text-muted-foreground">All app data, tabulated and ready for spreadsheets</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="datasets" className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="datasets" data-testid="research-tab-datasets"><Database className="w-3.5 h-3.5 mr-1.5" /> Datasets</TabsTrigger>
            <TabsTrigger value="adherence" data-testid="research-tab-adherence"><UserCheck className="w-3.5 h-3.5 mr-1.5" /> Adherence</TabsTrigger>
            <TabsTrigger value="sheets" data-testid="research-tab-sheets"><Link2 className="w-3.5 h-3.5 mr-1.5" /> Google Sheets live</TabsTrigger>
          </TabsList>
          <TabsContent value="adherence"><AdherenceReport teams={meta.teams} includeArchived={archived} /></TabsContent>
          <TabsContent value="sheets"><SheetsLinks datasets={meta.datasets} teams={meta.teams} /></TabsContent>
          <TabsContent value="datasets" className="space-y-4">
        <Card className="glass-light border-white/5">
          <CardContent className="p-4 flex flex-wrap items-end gap-4 justify-between">
            <PeriodFilter value={filter} onChange={setFilter} teams={meta.teams} testPrefix="research" />
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs"><Switch className="shrink-0" checked={anonymize} onCheckedChange={setAnonymize} data-testid="research-anonymize-switch" />
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Anonymize (athlete codes)</label>
              <label className="flex items-center gap-2 text-xs"><Switch className="shrink-0" checked={archived} onCheckedChange={setArchived} data-testid="research-archived-switch" />
                Include archived periods</label>
            </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => exportSel('xlsx')} data-testid="research-export-xlsx-btn">
              <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel ({selected.length})
            </Button>
            <Button size="sm" variant="outline" className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10" onClick={() => exportSel('csv')} data-testid="research-export-csv-btn">
              <Sheet className="w-4 h-4 mr-1.5" /> CSV / Google Sheets
            </Button>
            <Button size="sm" variant="outline" className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
              onClick={() => downloadExport('/research/dictionary', { datasets: selected.length ? selected.join(',') : 'all', anonymize, format: 'xlsx' }, getAuthHeaders(), 'data_dictionary.xlsx')}
              data-testid="research-dictionary-btn">
              <BookOpen className="w-4 h-4 mr-1.5" /> Data dictionary
            </Button>
          </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-[340px_1fr] gap-4">
          <Card className="glass-light border-white/5">
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium">Datasets</CardTitle>
              <button className="text-[11px] text-primary hover:underline" data-testid="research-toggle-all"
                onClick={() => setSelected(selected.length === meta.datasets.length ? [] : meta.datasets.map((d) => d.key))}>
                {selected.length === meta.datasets.length ? 'Clear all' : 'Select all'}
              </button>
            </CardHeader>
            <CardContent className="space-y-2">
              {meta.datasets.map((d) => (
                <DatasetRow key={d.key} d={d} checked={selected.includes(d.key)} active={active === d.key}
                  onToggle={() => toggle(d.key)} onOpen={() => setActive(d.key)} />
              ))}
            </CardContent>
          </Card>

          <Card className="glass-light border-white/5 min-w-0">
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
              <CardTitle className="text-sm font-medium" data-testid="research-preview-title">
                {preview?.label || 'Loading…'} {preview && <span className="text-muted-foreground font-normal">· {preview.total} rows · {preview.columns.length} columns</span>}
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadExport('/research/export', { ...params, datasets: active, format: 'xlsx' }, getAuthHeaders(), `${active}.xlsx`)} data-testid="research-preview-xlsx-btn">
                  <Download className="w-3.5 h-3.5 mr-1" /> .xlsx
                </Button>
                <Button size="sm" variant="outline" onClick={() => downloadExport('/research/export', { ...params, datasets: active, format: 'csv' }, getAuthHeaders(), `${active}.csv`)} data-testid="research-preview-csv-btn">
                  <Download className="w-3.5 h-3.5 mr-1" /> .csv
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {preview ? <DataTable columns={preview.columns} rows={preview.rows} testid="research-preview-table" maxHeight="max-h-[560px]" />
                : <p className="text-sm text-muted-foreground py-10 text-center">Loading…</p>}
              {preview && preview.total > preview.rows.length && (
                <p className="text-[11px] text-muted-foreground mt-2">Showing first {preview.rows.length} rows — the export contains all {preview.total}.</p>
              )}
            </CardContent>
          </Card>
        </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
