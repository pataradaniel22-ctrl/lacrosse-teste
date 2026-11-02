import { useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { FileText, Image as ImageIcon, Upload, Eye, Download, Trash2, Loader2, ScanLine, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { API, fmtBytes, openDocument, documentBlobUrl } from '../../lib/hub';
import { readPassport } from './passportReader';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

/**
 * Documents grouped by type, with upload / view / download / delete.
 * `onPassportData(data)` (optional) receives what was read from a passport photo.
 */
export default function DocumentsPanel({
  athleteId, docTypes, documents, getAuthHeaders, canUpload, canDelete, onChanged, onPassportData, compact = false,
}) {
  const [busy, setBusy] = useState('');
  const [reading, setReading] = useState(null); // {docId, pct}
  const inputs = useRef({});

  const upload = async (dt, file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('File too large (max 10 MB)'); return; }
    setBusy(dt.key);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('doc_type', dt.key);
      const r = await axios.post(`${API}/hub/athlete/${athleteId}/documents`, fd, {
        headers: { ...getAuthHeaders().headers, 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`${dt.label} uploaded`);
      onChanged?.();
      if (dt.key === 'passport' && onPassportData && file.type.startsWith('image/')) runReader(r.data, file);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Upload failed');
    } finally { setBusy(''); }
  };

  const runReader = async (doc, fileOrNull) => {
    setReading({ docId: doc.id, pct: 0 });
    let url = null;
    try {
      let src = fileOrNull;
      if (!src) { url = await documentBlobUrl(doc, getAuthHeaders); src = url; }
      const data = await readPassport(src, (pct) => setReading({ docId: doc.id, pct }));
      if (!data) {
        toast.message('Could not read the passport lines. Make sure the two lines with <<< at the bottom are sharp and visible.');
      } else {
        onPassportData(data);
      }
    } catch (e) {
      toast.error(e.message || 'Passport reader failed');
    } finally {
      if (url) URL.revokeObjectURL(url);
      setReading(null);
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Remove "${doc.filename}"?`)) return;
    try {
      await axios.delete(`${API}/hub/documents/${doc.id}`, getAuthHeaders());
      toast.success('Document removed');
      onChanged?.();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not remove'); }
  };

  const view = (doc, dl) => openDocument(doc, getAuthHeaders, dl).catch((e) => toast.error(e?.response?.status === 403 ? 'Not allowed' : 'Could not open the document'));

  return (
    <div className={`grid gap-2 ${compact ? '' : 'sm:grid-cols-2'}`} data-testid="hub-documents">
      {docTypes.map((dt) => {
        const docs = documents.filter((d) => d.doc_type === dt.key);
        const allowed = canUpload(dt);
        return (
          <div key={dt.key} className="rounded-lg border border-white/10 bg-background/40 p-3 space-y-2" data-testid={`hub-doc-type-${dt.key}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                {docs.length ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : (dt.required ? <AlertCircle className="w-4 h-4 text-red-400" /> : <FileText className="w-4 h-4 text-muted-foreground" />)}
                {dt.label}
                {dt.required && !docs.length && <span className="text-[10px] text-red-300">required</span>}
              </p>
              {allowed && (
                <>
                  <input
                    ref={(el) => { inputs.current[dt.key] = el; }} type="file" accept={ACCEPT} className="hidden"
                    onChange={(e) => { upload(dt, e.target.files?.[0]); e.target.value = ''; }}
                    data-testid={`hub-upload-input-${dt.key}`}
                  />
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy} onClick={() => inputs.current[dt.key]?.click()} data-testid={`hub-upload-btn-${dt.key}`}>
                    {busy === dt.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Upload className="w-3.5 h-3.5 mr-1" />{docs.length ? 'Add' : 'Upload'}</>}
                  </Button>
                </>
              )}
            </div>
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-xs rounded-md bg-white/5 px-2 py-1.5">
                {d.content_type === 'application/pdf' ? <FileText className="w-4 h-4 shrink-0 text-sky-400" /> : <ImageIcon className="w-4 h-4 shrink-0 text-sky-400" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{d.filename}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtBytes(d.size)} · {String(d.uploaded_at).slice(0, 10)} · by {d.uploaded_by?.name || '—'}</p>
                </div>
                <button type="button" className="p-1 hover:text-primary" title="View" onClick={() => view(d, false)} data-testid={`hub-doc-view-${d.id}`}><Eye className="w-4 h-4" /></button>
                <button type="button" className="p-1 hover:text-primary" title="Download" onClick={() => view(d, true)}><Download className="w-4 h-4" /></button>
                {dt.key === 'passport' && onPassportData && d.content_type.startsWith('image/') && (
                  <button type="button" className="p-1 hover:text-primary" title="Read passport data" disabled={!!reading} onClick={() => runReader(d, null)} data-testid={`hub-doc-read-${d.id}`}>
                    {reading?.docId === d.id ? <span className="text-[10px]">{reading.pct}%</span> : <ScanLine className="w-4 h-4" />}
                  </button>
                )}
                {canDelete(d) && (
                  <button type="button" className="p-1 text-red-400 hover:text-red-300" title="Remove" onClick={() => remove(d)} data-testid={`hub-doc-delete-${d.id}`}><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
            ))}
            {!docs.length && <p className="text-[11px] text-muted-foreground">{allowed ? 'Photo or PDF, up to 10 MB.' : 'Not uploaded yet.'}</p>}
            {reading && docs.some((d) => d.id === reading.docId) && (
              <p className="text-[11px] text-sky-300 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Reading passport… {reading.pct}%</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
