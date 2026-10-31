import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { FileDown, Copy, FileText, MessageSquare, Loader2 } from 'lucide-react';
import { generateDailyReportPdf, buildWhatsAppSummary } from '../lib/dailyReportPdf';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const bostonToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export default function DailyReportModal({ open, onOpenChange, teamFilter, setTeamFilter, getAuthHeaders }) {
  const [reportDate, setReportDate] = useState(bostonToday());
  const [format, setFormat] = useState('both');
  const [lang, setLang] = useState('en');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [data, setData] = useState(null);
  const [waText, setWaText] = useState('');

  const daysAgo = useMemo(() => {
    const diff = Math.round((new Date(bostonToday()) - new Date(reportDate)) / 86400000);
    return Math.max(0, diff);
  }, [reportDate]);

  const teamLabel = teamFilter === 'Brazil Lacrosse Men' ? 'Men'
    : teamFilter === 'Brazil Lacrosse Women' ? 'Women' : 'All athletes';

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const teamP = teamFilter && teamFilter !== 'all' ? `&team=${teamFilter}` : '';
      const res = await axios.get(`${API}/staff/dashboard/daily-report?days_ago=${daysAgo}${teamP}`, getAuthHeaders());
      setData(res.data);
      setWaText('');
    } catch (e) {
      toast.error(lang === 'pt' ? 'Falha ao carregar dados do relatório.' : 'Failed to load report data.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [daysAgo, teamFilter, getAuthHeaders, lang]);

  useEffect(() => {
    if (open) fetchReport();
  }, [open, fetchReport]);

  const handleGenerate = () => {
    if (!data) { toast.error(lang === 'pt' ? 'Dados ainda não carregados.' : 'Data not loaded yet.'); return; }
    setGenerating(true);
    try {
      if (format === 'whatsapp' || format === 'both') setWaText(buildWhatsAppSummary({ data, lang, teamLabel }));
      if (format === 'pdf' || format === 'both') {
        const doc = generateDailyReportPdf({ data, teamLabel });
        doc.save(`daily-report-${data.date}.pdf`);
        toast.success(lang === 'pt' ? 'PDF gerado!' : 'PDF generated!');
      }
    } catch (e) {
      console.error(e);
      toast.error(lang === 'pt' ? 'Falha ao gerar o PDF.' : 'Failed to generate the PDF.');
    } finally {
      setGenerating(false);
    }
  };

  const copyWa = async () => {
    const txt = waText || buildWhatsAppSummary({ data, lang, teamLabel });
    if (!waText) setWaText(txt);
    try { await navigator.clipboard.writeText(txt); toast.success(lang === 'pt' ? 'Texto copiado!' : 'Copied!'); }
    catch { toast.error(lang === 'pt' ? 'Não foi possível copiar' : 'Could not copy'); }
  };

  const s = data?.summary;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="daily-report-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            {lang === 'pt' ? 'Relatório Diário de Monitoramento' : 'Daily Monitoring Report'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{lang === 'pt' ? 'Data' : 'Date'}</Label>
              <input
                type="date" value={reportDate} max={bostonToday()}
                onChange={(e) => setReportDate(e.target.value)}
                data-testid="report-date"
                className="mt-1 h-9 w-full rounded-md border border-white/10 bg-background/50 px-3 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">{lang === 'pt' ? 'Equipe' : 'Team'}</Label>
              <Select value={teamFilter} onValueChange={setTeamFilter}>
                <SelectTrigger className="mt-1 h-9 text-sm" data-testid="report-team"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{lang === 'pt' ? 'Todos' : 'All'}</SelectItem>
                  <SelectItem value="Brazil Lacrosse Men">{lang === 'pt' ? 'Masculino' : 'Men'}</SelectItem>
                  <SelectItem value="Brazil Lacrosse Women">{lang === 'pt' ? 'Feminino' : 'Women'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{lang === 'pt' ? 'Formato' : 'Format'}</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger className="mt-1 h-9 text-sm" data-testid="report-format"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="both">PDF + WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{lang === 'pt' ? 'Idioma' : 'Language'}</Label>
              <Select value={lang} onValueChange={setLang}>
                <SelectTrigger className="mt-1 h-9 text-sm" data-testid="report-lang"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt">Português</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2" data-testid="report-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> {lang === 'pt' ? 'Carregando dados...' : 'Loading data...'}
            </div>
          ) : s ? (
            <div className="grid grid-cols-3 gap-2 text-center" data-testid="report-preview">
              {[
                { l: lang === 'pt' ? 'Responderam' : 'Responded', v: `${s.responded_today}/${s.athletes}` },
                { l: 'Readiness', v: s.team_readiness_avg != null ? s.team_readiness_avg : '—' },
                { l: lang === 'pt' ? 'Taxa' : 'Rate', v: `${s.response_rate}%` },
                { l: lang === 'pt' ? 'Em risco' : 'At risk', v: s.at_risk },
                { l: lang === 'pt' ? 'Quedas' : 'Sharp drops', v: s.sharp_drops },
                { l: lang === 'pt' ? 'Alertas' : 'Alerts', v: data.active_alerts.length },
              ].map((c, i) => (
                <div key={i} className="rounded-md border border-white/10 bg-background/40 py-2">
                  <p className="text-lg font-bold">{c.v}</p>
                  <p className="text-[10px] text-muted-foreground">{c.l}</p>
                </div>
              ))}
            </div>
          ) : null}

          {s && s.responded_today === 0 && (
            <p className="text-xs text-amber-400" data-testid="report-noresp-note">
              {lang === 'pt'
                ? 'Nenhum atleta respondeu nesta data — os scores atuais aparecerão como "sem resposta".'
                : 'No athletes responded on this date — current scores will show as "no response".'}
            </p>
          )}

          <Button className="w-full" onClick={handleGenerate} disabled={generating || loading || !data} data-testid="report-generate-btn">
            {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
            {lang === 'pt' ? 'Gerar relatório' : 'Generate report'}
          </Button>

          {(format === 'whatsapp' || format === 'both') && waText && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {lang === 'pt' ? 'Resumo WhatsApp' : 'WhatsApp summary'}</Label>
                <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={copyWa} data-testid="report-copy-wa">
                  <Copy className="w-3 h-3 mr-1" /> {lang === 'pt' ? 'Copiar' : 'Copy'}
                </Button>
              </div>
              <textarea readOnly value={waText} data-testid="report-wa-text"
                className="w-full h-56 text-xs font-mono rounded-md border border-white/10 bg-background/50 p-3 resize-none" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
