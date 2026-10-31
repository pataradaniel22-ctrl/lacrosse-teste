import axios from 'axios';
import { toast } from 'sonner';

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const PERIOD_PRESETS = [
  { key: '4w', label: 'Last 4 weeks', days: 28 },
  { key: '12w', label: 'Last 12 weeks', days: 84 },
  { key: '6m', label: 'Last 6 months', days: 182 },
  { key: '12m', label: 'Last 12 months', days: 365 },
  { key: 'all', label: 'All time', days: null },
  { key: 'custom', label: 'Custom', days: null },
];

const iso = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export const presetRange = (key) => {
  const p = PERIOD_PRESETS.find((x) => x.key === key);
  if (!p || !p.days) return { start: '', end: '' };
  const end = new Date();
  const start = new Date(end.getTime() - (p.days - 1) * 86400000);
  return { start: iso(start), end: iso(end) };
};

export const buildQuery = (params) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== '' && v !== null && v !== undefined && v !== 'all-teams') q.append(k, v);
  });
  return q.toString();
};

export const downloadExport = async (path, params, headers, fallbackName) => {
  const t = toast.loading('Preparing spreadsheet…');
  try {
    const res = await axios.get(`${API}${path}?${buildQuery(params)}`, { ...headers, responseType: 'blob' });
    const url = window.URL.createObjectURL(res.data);
    const link = document.createElement('a');
    const cd = res.headers['content-disposition'] || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    link.href = url;
    link.download = match ? match[1] : fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    toast.success('Download ready', { id: t });
  } catch (e) {
    toast.error('Export failed', { id: t });
  }
};
