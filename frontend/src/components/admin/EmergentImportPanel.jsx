import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { DatabaseZap, Search, Loader2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const errMsg = (err, fb) => err?.response?.data?.detail || fb;

export default function EmergentImportPanel({ getAuthHeaders }) {
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState('');
  const [includeFiles, setIncludeFiles] = useState(true);
  const [uploadPct, setUploadPct] = useState(null);
  const timer = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/emergent-import/status`, getAuthHeaders());
      setStatus(r.data);
      return r.data;
    } catch { return null; }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadStatus();
    return () => clearInterval(timer.current);
  }, [loadStatus]);

  const poll = () => {
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const s = await loadStatus();
      if (s && s.state !== 'running') clearInterval(timer.current);
    }, 3000);
  };

  const runPreview = async () => {
    setBusy('preview');
    try {
      const r = await axios.get(`${API}/admin/emergent-import/preview`, getAuthHeaders());
      setPreview(r.data);
    } catch (err) {
      toast.error(errMsg(err, 'Could not read the Emergent database'));
    } finally { setBusy(''); }
  };

  const uploadBackup = async (file) => {
    if (!file) return;
    setBusy('upload');
    setUploadPct(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await axios.post(`${API}/admin/emergent-import/upload`, fd, {
        headers: { ...getAuthHeaders().headers, 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => e.total && setUploadPct(Math.round((e.loaded / e.total) * 100)),
      });
      setPreview({ ...r.data, fromFile: true, staff: [], athletes: r.data.collections.find((c) => c.collection === 'athletes')?.emergent, files_key_configured: true });
      toast.success('Backup file checked');
    } catch (err) {
      toast.error(errMsg(err, 'Could not read the backup file'));
    } finally { setBusy(''); setUploadPct(null); }
  };

  const runImport = async () => {
    setBusy('run');
    try {
      if (preview?.fromFile) {
        await axios.post(`${API}/admin/emergent-import/run-file`, { upload_id: preview.upload_id, confirm, include_files: includeFiles }, getAuthHeaders());
      } else {
        await axios.post(`${API}/admin/emergent-import/run`, { confirm, include_files: includeFiles }, getAuthHeaders());
      }
      toast.success('Import started');
      setConfirm('');
      poll();
      loadStatus();
    } catch (err) {
      toast.error(errMsg(err, 'Could not start the import'));
    } finally { setBusy(''); }
  };

  const running = status?.state === 'running';

  return (
    <div className="space-y-4" data-testid="emergent-import-panel">
      <Card className="glass-light border-sky-500/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><DatabaseZap className="w-5 h-5 text-sky-400" />Import data from Emergent</CardTitle>
          <p className="text-xs text-muted-foreground">
            Copies the data of the original app (athletes, staff, check-ins, training, recovery, health, messages, files…) into this app.
            The Emergent app is only <b>read</b> — nothing is changed there. Configure <code>EMERGENT_MONGO_URL</code> (and optionally
            <code> EMERGENT_DB_NAME</code>, <code>EMERGENT_LLM_KEY</code> for photos/PDFs) in Render → Environment first.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
            <p className="text-xs"><b>Recommended:</b> upload the <b>full backup ZIP</b> downloaded from the Emergent app (Admin → Download full backup). The file is checked first; nothing is imported until you confirm, and it is deleted from the server after the import.</p>
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer rounded-md border border-white/15 px-3 py-2 hover:bg-white/5">
              <input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => uploadBackup(e.target.files?.[0])} disabled={!!busy || running} data-testid="emergent-upload-input" />
              {busy === 'upload' ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading {uploadPct ?? 0}%</> : <>1 · Choose backup ZIP</>}
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">Alternative (only works if Emergent allows outside connections — currently it does not):</p>
          <Button onClick={runPreview} disabled={!!busy || running} variant="outline" data-testid="emergent-preview-btn">
            {busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-4 h-4 mr-1" />1 · Simulate (counts only, changes nothing)</>}
          </Button>

          {preview && (
            <div className="space-y-2">
              <p className="text-xs">Emergent database: <b>{preview.database}</b> · {preview.athletes ?? '?'} athlete(s){preview.staff?.length ? ` · staff: ${preview.staff.map((s) => `${s.name} (${s.role})`).join(', ')}` : ''}{preview.generated_at ? ` · backup of ${String(preview.generated_at).slice(0, 16).replace('T', ' ')}` : ''}</p>
              {preview.fromFile ? (
                <p className="text-xs">Files (photos/PDFs) in the backup: <b>{preview.files}</b>{preview.missing_in_zip?.length ? <span className="text-amber-300"> · missing in ZIP: {preview.missing_in_zip.join(', ')}</span> : ''}</p>
              ) : (
                <p className="text-xs">Files (photos/PDFs) referenced: <b>{preview.files}</b> · storage key {preview.files_key_configured ? <span className="text-emerald-400">configured</span> : <span className="text-amber-300">NOT configured — files will not be copied</span>}</p>
              )}
              <div className="max-h-72 overflow-y-auto rounded border border-white/10">
                <table className="w-full text-xs" data-testid="emergent-preview-table">
                  <thead className="bg-white/5 text-muted-foreground"><tr><th className="text-left p-1.5">Collection</th><th className="text-right p-1.5">In Emergent</th><th className="text-right p-1.5">Here now</th><th className="text-left p-1.5">Action</th></tr></thead>
                  <tbody>
                    {preview.collections.map((c) => (
                      <tr key={c.collection} className="border-t border-white/5">
                        <td className="p-1.5 font-mono">{c.collection}</td>
                        <td className="p-1.5 text-right">{c.emergent}</td>
                        <td className="p-1.5 text-right text-muted-foreground">{c.here}</td>
                        <td className="p-1.5">{c.action === 'replace' ? 'replace with Emergent data' : 'keep this app\'s'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.local_only_collections_kept?.length > 0 && (
                <p className="text-[11px] text-muted-foreground">Kept as they are (exist only in this app): {preview.local_only_collections_kept.join(', ')}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card className="glass-light border-red-500/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" />2 · Import</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-xs">
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
              <li>The data currently in this app for the collections above (the <b>demo data</b>) is <b>replaced</b>. This cannot be undone.</li>
              <li>Passwords are kept: everybody logs in with the same password they use in the Emergent app — including you (admin).</li>
              <li>After the import you will probably be logged out; log in with your <b>Emergent</b> admin password.</li>
              <li>Demo data will never be created automatically again.</li>
            </ul>
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeFiles} onChange={(e) => setIncludeFiles(e.target.checked)} />Also copy photos and PDFs</label>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-9 w-48 bg-background/50 border-white/10" placeholder="Type IMPORTAR" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="emergent-confirm-input" />
              <Button className="bg-red-600 hover:bg-red-500 text-white" onClick={runImport} disabled={confirm.trim().toUpperCase() !== 'IMPORTAR' || !!busy || running} data-testid="emergent-run-btn">
                {busy === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Import now'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {status && status.state !== 'idle' && (
        <Card className="glass-light border-white/10" data-testid="emergent-status">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {status.state === 'running' && <Loader2 className="w-4 h-4 animate-spin text-sky-400" />}
              {status.state === 'finished' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {status.state === 'failed' && <XCircle className="w-4 h-4 text-red-400" />}
              Import {status.state} {status.phase ? `· ${status.phase}` : ''}
              {status.state === 'finished' && <Badge variant="outline" className={status.all_counts_match ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'}>{status.all_counts_match ? 'all counts match' : 'check differences'}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            <p className="text-muted-foreground">Started {status.started_at?.slice(0, 16).replace('T', ' ')} by {status.started_by}{status.finished_at ? ` · finished ${status.finished_at.slice(0, 16).replace('T', ' ')}` : ''}</p>
            {status.files_total > 0 && <p>Files: {status.files_done} copied · {status.files_failed} failed · of {status.files_total}</p>}
            {(status.collections_done || []).length > 0 && (
              <div className="max-h-56 overflow-y-auto">
                {status.collections_done.map((c) => (
                  <p key={c.collection} className={c.ok ? '' : 'text-amber-300'}>{c.ok ? '✓' : '!'} {c.collection}: {c.copied}/{c.emergent}</p>
                ))}
              </div>
            )}
            {(status.errors || []).length > 0 && (
              <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300 space-y-0.5">
                {status.errors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
