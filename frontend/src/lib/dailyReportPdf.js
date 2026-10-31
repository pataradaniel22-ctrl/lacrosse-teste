import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Brasil Lacrosse identity
const GREEN = [0, 155, 58];
const YELLOW = [255, 204, 0];
const INK = [17, 24, 39];
const MUTED = [107, 114, 128];
const LINE = [226, 232, 240];
const RED = [220, 38, 38];
const ORANGE = [234, 88, 12];
const OKGREEN = [22, 163, 74];
const GRAY = [107, 114, 128];

const bostonTime = () => {
  try {
    return new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

const STATUS_LABEL = {
  sharp_drop: 'Sharp drop', at_risk: 'At risk', trending_down: 'Trending down',
  stable: 'Stable', improving: 'Improving', no_response: 'No response',
};
const STATUS_COLOR = {
  sharp_drop: RED, at_risk: RED, trending_down: ORANGE,
  stable: MUTED, improving: OKGREEN, no_response: GRAY,
};

const num = (v) => (v === null || v === undefined ? '—' : (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(1)) : v));

const changeText = (c) => {
  if (c === null || c === undefined) return '—';
  if (c > 0) return `Up ${c.toFixed(1)}`;
  if (c < 0) return `Down ${Math.abs(c).toFixed(1)}`;
  return 'Stable';
};
const trendArrow = (c) => {
  if (c === null || c === undefined) return 'new';
  if (c > 0) return `▲${c.toFixed(1)}`;
  if (c < 0) return `▼${Math.abs(c).toFixed(1)}`;
  return '▬0.0';
};

const setFill = (d, c) => d.setFillColor(c[0], c[1], c[2]);
const setText = (d, c) => d.setTextColor(c[0], c[1], c[2]);
const setDraw = (d, c) => d.setDrawColor(c[0], c[1], c[2]);

export function buildWhatsAppSummary({ data, lang, teamLabel }) {
  if (!data) return '';
  const pt = lang === 'pt';
  const s = data.summary;
  const rd = data.readiness_report;
  const none = pt ? 'Nenhum' : 'None';
  const names = (arr) => (arr.length ? arr.join(', ') : none);

  const rosterLines = rd.map((r) => (r.responded_today
    ? `${r.name}: ${num(r.today_readiness)} (${trendArrow(r.change)})`
    : `${r.name}: ${pt ? 'sem resposta hoje' : 'no response today'}`)).join('\n');

  const byStatus = (st) => rd.filter((r) => r.responded_today && r.status === st).map((r) => r.name);
  const sharp = byStatus('sharp_drop');
  const atRisk = byStatus('at_risk');
  const trending = byStatus('trending_down');
  const severePain = data.pain_report.filter((p) => p.intensity >= 8).map((p) => p.athlete);
  const persistent = data.persistent_pain.map((p) => p.athlete);
  const elevated = data.training_load.elevated_athletes.map((e) => e.name);
  const noResp = data.non_responders.map((r) => r.athlete);

  const painLines = data.pain_report.length
    ? data.pain_report.map((p) => `${p.athlete} — ${p.region} (${p.intensity}/10)`).join('\n')
    : none;

  const L = pt ? {
    title: 'RELATÓRIO DIÁRIO DE MONITORAMENTO', date: 'Data', team: 'Equipe',
    resp: 'Respostas', avg: 'Readiness médio (quem respondeu)',
    roster: 'Readiness por atleta', alerts: 'Alertas ativos', painT: 'Dor reportada hoje', nr: 'Sem resposta (>3 dias)',
    sharp: 'Queda Brusca', atRisk: 'Em Risco', trending: 'Em Queda',
    severe: 'Dor Severa', persistent: 'Dor Persistente', elevated: 'Carga Elevada', noRespL: 'Sem Resposta (>3d)',
  } : {
    title: 'DAILY MONITORING REPORT', date: 'Date', team: 'Team',
    resp: 'Responses', avg: 'Avg readiness (responders)',
    roster: 'Readiness by athlete', alerts: 'Active alerts', painT: 'Pain reported today', nr: 'Not responding (>3 days)',
    sharp: 'Sharp Drop', atRisk: 'At Risk', trending: 'Trending Down',
    severe: 'Severe Pain', persistent: 'Persistent Pain', elevated: 'Elevated Load', noRespL: 'No Response (>3d)',
  };

  const alertsBlock = [
    `${L.sharp}: ${names(sharp)}`,
    `${L.atRisk}: ${names(atRisk)}`,
    `${L.trending}: ${names(trending)}`,
    `${L.severe}: ${names(severePain)}`,
    `${L.persistent}: ${names(persistent)}`,
    `${L.elevated}: ${names(elevated)}`,
    `${L.noRespL}: ${names(noResp)}`,
  ].join('\n');

  return `*${L.title}*
${L.date}: ${data.date}
${L.team}: ${teamLabel}

*${L.resp}:* ${s.responded_today}/${s.athletes} (${s.response_rate}%)
*${L.avg}:* ${s.team_readiness_avg != null ? `${s.team_readiness_avg}/10` : (pt ? 'sem dados' : 'no data')}

*${L.roster}:*
${rosterLines}

*${L.alerts}:*
${alertsBlock}

*${L.painT}:*
${painLines}

*${L.nr}:* ${data.non_responders.length}`;
}

export function generateDailyReportPdf({ data, teamLabel }) {
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const drawHeader = () => {
    setFill(doc, GREEN); doc.rect(0, 0, pageW, 16, 'F');
    setFill(doc, YELLOW); doc.rect(0, 16, pageW, 1.4, 'F');
    setText(doc, [255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Brasil Lacrosse — Daily Monitoring Report', 12, 10.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`${data.date}  •  ${teamLabel}`, pageW - 12, 10.5, { align: 'right' });
  };

  const drawFooterAll = () => {
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      setText(doc, MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text(`Brasil Lacrosse • ${data.date} • Generated ${bostonTime()}`, 12, pageH - 6);
      doc.text(`${i} / ${pages}`, pageW - 12, pageH - 6, { align: 'right' });
    }
  };

  const state = { y: 24 };
  const ensure = (need) => {
    if (state.y + need > pageH - 12) { doc.addPage(); drawHeader(); state.y = 24; }
  };

  const sectionTitle = (text) => {
    ensure(22);
    setFill(doc, GREEN); doc.rect(12, state.y - 3.6, 2.2, 5, 'F');
    setText(doc, INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(text, 16.5, state.y);
    state.y += 4;
  };

  const emptyNote = (text) => {
    setText(doc, MUTED); doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
    doc.text(text, 16, state.y + 2); state.y += 8;
  };

  const drawCards = (cards) => {
    ensure(22);
    const gap = 4; const cols = cards.length;
    const w = (pageW - 24 - gap * (cols - 1)) / cols;
    let x = 12;
    cards.forEach((c) => {
      setDraw(doc, LINE); setFill(doc, [248, 250, 252]);
      doc.roundedRect(x, state.y, w, 17, 1.6, 1.6, 'FD');
      setText(doc, MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text(String(c.label).toUpperCase(), x + 3, state.y + 5.5);
      setText(doc, c.color || INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      doc.text(String(c.value), x + 3, state.y + 13);
      x += w + gap;
    });
    state.y += 22;
  };

  const drawTrend = (cell, dir) => {
    const cx = cell.x + cell.width / 2;
    const cy = cell.y + cell.height / 2;
    if (dir === 'up') { setFill(doc, OKGREEN); doc.triangle(cx - 2.2, cy + 2, cx + 2.2, cy + 2, cx, cy - 2.6, 'F'); }
    else if (dir === 'down') { setFill(doc, RED); doc.triangle(cx - 2.2, cy - 2, cx + 2.2, cy - 2, cx, cy + 2.6, 'F'); }
    else if (dir === 'stable') { setFill(doc, [37, 99, 235]); doc.rect(cx - 2.6, cy - 0.8, 5.2, 1.6, 'F'); }
    else if (dir === 'base') { setFill(doc, GRAY); doc.rect(cx - 2, cy - 0.5, 4, 1, 'F'); }
  };

  const table = (opts) => {
    autoTable(doc, {
      startY: state.y,
      margin: { top: 22, left: 12, right: 12, bottom: 14 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0.1, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'left' },
      alternateRowStyles: { fillColor: [247, 249, 251] },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      didDrawPage: () => drawHeader(),
      ...opts,
    });
    state.y = doc.lastAutoTable.finalY + 8;
  };

  const drawTeamLoadChart = (daily) => {
    ensure(62);
    const x0 = 16; const w = pageW - 28; const h = 46; const y0 = state.y;
    setText(doc, MUTED); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    if (!daily || daily.length === 0) { doc.text('No valid training sessions in this window.', x0, y0 + 10); state.y = y0 + 16; return; }
    const maxV = Math.max(...daily.map((d) => Math.max(d.avg, d.peak))) * 1.1 || 10;
    const n = daily.length;
    const px = (i) => x0 + (n === 1 ? w / 2 : (w * i) / (n - 1));
    const py = (v) => y0 + h - (h * v) / maxV;
    setDraw(doc, LINE); doc.setLineWidth(0.2);
    doc.line(x0, y0, x0, y0 + h); doc.line(x0, y0 + h, x0 + w, y0 + h);
    setText(doc, MUTED); doc.setFontSize(6.5);
    for (let g = 0; g <= 4; g++) {
      const val = (maxV / 4) * g; const yy = py(val);
      setDraw(doc, [241, 245, 249]); doc.line(x0, yy, x0 + w, yy);
      doc.text(String(Math.round(val)), x0 - 2, yy + 1.5, { align: 'right' });
    }
    const drawSeries = (key, color) => {
      doc.setLineWidth(0.6); setDraw(doc, color);
      for (let i = 1; i < n; i++) doc.line(px(i - 1), py(daily[i - 1][key]), px(i), py(daily[i][key]));
      setFill(doc, color);
      daily.forEach((d, i) => doc.circle(px(i), py(d[key]), 0.8, 'F'));
    };
    drawSeries('avg', GREEN);
    drawSeries('peak', ORANGE);
    setText(doc, MUTED); doc.setFontSize(6);
    const step = Math.ceil(n / 8);
    daily.forEach((d, i) => { if (i % step === 0 || i === n - 1) doc.text(String(d.date).slice(5), px(i), y0 + h + 4, { align: 'center' }); });
    let ly = y0 + h + 8;
    setFill(doc, GREEN); doc.rect(x0, ly - 2, 3, 1.6, 'F'); setText(doc, INK); doc.setFontSize(7);
    doc.text('Team average', x0 + 5, ly);
    setFill(doc, ORANGE); doc.rect(x0 + 40, ly - 2, 3, 1.6, 'F'); doc.text('Peak athlete', x0 + 45, ly);
    const topDay = [...daily].sort((a, b) => b.peak - a.peak)[0];
    setText(doc, MUTED);
    doc.text(`Highest: ${topDay.date} — ${topDay.peak_athlete} (${topDay.peak} AU)`, x0 + w, ly, { align: 'right' });
    state.y = ly + 8;
  };

  const drawRadar = (dims, responders) => {
    ensure(80);
    const cx = 72; const cy = state.y + 38; const R = 34; const N = 5;
    const ang = (i) => (-Math.PI / 2) + (2 * Math.PI * i) / N;
    setText(doc, MUTED); doc.setFontSize(8);
    if (!dims || dims.length === 0) { doc.text(`No valid responses for ${data.date}.`, 16, state.y + 8); state.y += 14; return; }
    setDraw(doc, [226, 232, 240]); doc.setLineWidth(0.2);
    [2, 4, 6, 8, 10].forEach((lvl) => {
      const r = (R * lvl) / 10;
      for (let i = 0; i < N; i++) { const a1 = ang(i); const a2 = ang((i + 1) % N); doc.line(cx + r * Math.cos(a1), cy + r * Math.sin(a1), cx + r * Math.cos(a2), cy + r * Math.sin(a2)); }
    });
    setText(doc, INK); doc.setFontSize(6.5);
    dims.forEach((d, i) => {
      const a = ang(i);
      doc.line(cx, cy, cx + R * Math.cos(a), cy + R * Math.sin(a));
      const lx = cx + (R + 6) * Math.cos(a); const ly = cy + (R + 6) * Math.sin(a);
      doc.text(d.dimension, lx, ly, { align: Math.cos(a) > 0.3 ? 'left' : Math.cos(a) < -0.3 ? 'right' : 'center' });
    });
    setDraw(doc, GREEN); doc.setLineWidth(0.7); setFill(doc, GREEN);
    const pts = dims.map((d, i) => { const a = ang(i); const r = (R * d.value) / 10; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; const q = pts[(i + 1) % pts.length]; doc.line(p[0], p[1], q[0], q[1]); }
    pts.forEach((p) => doc.circle(p[0], p[1], 0.9, 'F'));
    let vy = state.y + 8; const vx = 138;
    setText(doc, MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(`Based on ${responders} responder(s) for ${data.date}`, vx, vy); vy += 6;
    doc.setFontSize(9);
    dims.forEach((d) => {
      setText(doc, INK); doc.setFont('helvetica', 'normal'); doc.text(d.dimension, vx, vy);
      setText(doc, GREEN); doc.setFont('helvetica', 'bold'); doc.text(`${d.value}/10`, vx + 55, vy, { align: 'right' });
      vy += 6;
    });
    state.y = Math.max(cy + R + 12, vy) + 4;
  };

  // ---- Build ----
  drawHeader();
  const s = data.summary;
  setText(doc, INK); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`${s.responded_today} of ${s.athletes} athletes responded (${s.response_rate}%)`, 12, state.y); state.y += 6;

  drawCards([
    { label: 'Athletes', value: s.athletes },
    { label: 'Responded', value: s.responded_today },
    { label: 'Response rate', value: `${s.response_rate}%` },
    { label: 'Team readiness', value: s.team_readiness_avg != null ? `${s.team_readiness_avg}` : '—', color: GREEN },
    { label: 'At risk', value: s.at_risk, color: s.at_risk ? RED : INK },
    { label: 'Sharp drops', value: s.sharp_drops, color: s.sharp_drops ? ORANGE : INK },
  ]);

  sectionTitle('Daily Readiness Report — All Athletes');
  table({
    head: [['Athlete', 'Response', 'Today', 'Prev', 'Prev date', 'Change', 'Trend', 'Status', 'Last resp / days']],
    body: data.readiness_report.map((r) => ([
      r.name,
      r.responded_today ? 'Yes' : 'No response',
      r.responded_today ? num(r.today_readiness) : '—',
      r.previous_readiness != null ? num(r.previous_readiness) : (r.responded_today ? 'Baseline' : '—'),
      r.previous_date || '—',
      changeText(r.change),
      '',
      STATUS_LABEL[r.status] || r.status,
      r.responded_today ? 'Today' : (r.last_response ? `${r.last_response} (${r.days_without_response}d)` : 'Never'),
    ])),
    columnStyles: { 0: { cellWidth: 42 }, 4: { cellWidth: 24 }, 6: { cellWidth: 18, halign: 'center' }, 8: { cellWidth: 34 } },
    didParseCell: (h) => {
      if (h.section !== 'body') return;
      const row = data.readiness_report[h.row.index];
      if (h.column.index === 7) { const c = STATUS_COLOR[row.status] || INK; h.cell.styles.textColor = c; h.cell.styles.fontStyle = 'bold'; }
      if (h.column.index === 5 && row.change != null) h.cell.styles.textColor = row.change < 0 ? RED : row.change > 0 ? OKGREEN : MUTED;
      if (h.column.index === 2 && row.responded_today && row.today_readiness < 5) h.cell.styles.textColor = RED;
      if (!row.responded_today) h.cell.styles.textColor = GRAY;
    },
    didDrawCell: (h) => {
      if (h.section !== 'body' || h.column.index !== 6) return;
      const r = data.readiness_report[h.row.index];
      const dir = !r.responded_today ? 'none' : (r.change == null ? 'base' : r.change > 0 ? 'up' : r.change < 0 ? 'down' : 'stable');
      drawTrend(h.cell, dir);
    },
  });

  sectionTitle('Active Alerts');
  if (data.active_alerts.length === 0) emptyNote('No active alerts for this day.');
  else table({
    head: [['Athlete', 'Alert type', 'Current', 'Previous', 'Change', 'Date', 'Explanation']],
    body: data.active_alerts.map((a) => ([a.athlete, a.type, num(a.current), num(a.previous), a.change != null ? String(a.change) : '—', a.date || '—', a.explanation])),
    columnStyles: { 6: { cellWidth: 90 } },
    didParseCell: (h) => { if (h.section === 'body' && h.column.index === 1) { h.cell.styles.textColor = RED; h.cell.styles.fontStyle = 'bold'; } },
  });

  const tl = data.training_load;
  sectionTitle('Training Load Monitoring');
  drawCards([
    { label: 'Avg training day', value: tl.avg_training_day != null ? `${tl.avg_training_day}` : '—' },
    { label: 'Latest training day', value: tl.latest_training_day_avg != null ? `${tl.latest_training_day_avg}` : '—' },
    { label: 'Team avg / day', value: tl.team_avg_per_day != null ? `${tl.team_avg_per_day}` : '—' },
    { label: 'Elevated load', value: tl.elevated_count, color: tl.elevated_count ? ORANGE : INK },
  ]);
  sectionTitle('Athletes with Elevated Load');
  if (tl.elevated_athletes.length === 0) emptyNote('No athletes above the load threshold in this window.');
  else table({
    head: [['Athlete', 'Latest load (AU)', 'Personal avg (AU)', 'Difference', 'Sessions', 'Latest session']],
    body: tl.elevated_athletes.map((e) => ([e.name, num(e.latest_load), num(e.personal_avg), e.pct_diff != null ? `${e.pct_diff > 0 ? '+' : ''}${e.pct_diff}%` : '—', e.sessions, e.latest_date])),
  });
  sectionTitle('Daily Team Load — Team Average vs Peak Athlete');
  drawTeamLoadChart(tl.daily_team_load);

  const ps = data.pain_summary;
  sectionTitle('Daily Pain Report');
  drawCards([
    { label: 'Reporting pain', value: ps.athletes_reporting_pain },
    { label: 'Total reports', value: ps.total_reports },
    { label: 'Severe (8-10)', value: ps.severe_reports, color: ps.severe_reports ? RED : INK },
    { label: 'Persistent', value: ps.persistent_cases, color: ps.persistent_cases ? RED : INK },
    { label: 'Most reported', value: ps.most_reported_region || '—' },
  ]);
  if (data.pain_report.length === 0) emptyNote('No pain reported on this day.');
  else table({
    head: [['Athlete', 'Region', 'Side', 'Intensity', 'Type', 'Recurrence', 'Days', 'Prev', 'Change', 'Context', 'Note', 'Follow-up']],
    body: data.pain_report.map((p) => ([p.athlete, p.region, p.side, `${p.intensity}/10`, p.duration_type, p.recurrence, p.consecutive_days, num(p.previous_score), p.change != null ? String(p.change) : '—', p.context, p.note, p.follow_up])),
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.6, textColor: INK, lineColor: LINE, lineWidth: 0.1, valign: 'top', overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: 30 }, 9: { cellWidth: 26 }, 10: { cellWidth: 60 }, 11: { cellWidth: 22 } },
    didParseCell: (h) => {
      if (h.section !== 'body') return;
      const p = data.pain_report[h.row.index];
      if (h.column.index === 3 && p.intensity >= 8) { h.cell.styles.textColor = RED; h.cell.styles.fontStyle = 'bold'; }
      if (h.column.index === 5 && p.recurrence === 'Persistent') { h.cell.styles.textColor = RED; h.cell.styles.fontStyle = 'bold'; }
    },
  });

  sectionTitle('Persistent Pain — 3+ Consecutive Days');
  if (data.persistent_pain.length === 0) emptyNote('No persistent-pain cases right now.');
  else table({
    head: [['Athlete', 'Region', 'Side', 'Current', 'Consecutive days', 'First reported', 'Latest reported', 'Trend', 'Follow-up']],
    body: data.persistent_pain.map((p) => ([p.athlete, p.region, p.side, num(p.current_score), p.consecutive_days, p.first_date, p.latest_date, '', p.follow_up])),
    columnStyles: { 7: { cellWidth: 16, halign: 'center' } },
    didParseCell: (h) => { if (h.section === 'body' && h.column.index === 4) { h.cell.styles.textColor = RED; h.cell.styles.fontStyle = 'bold'; } },
    didDrawCell: (h) => {
      if (h.section !== 'body' || h.column.index !== 7) return;
      const p = data.persistent_pain[h.row.index];
      const dir = p.trend === 'Improving' ? 'up' : p.trend === 'Worsening' ? 'down' : 'stable';
      drawTrend(h.cell, dir);
    },
  });

  sectionTitle('Athletes Not Responding');
  if (data.non_responders.length === 0) emptyNote('All athletes have checked in within the last 3 days.');
  else table({
    head: [['Athlete', 'Last check-in', 'Days without response', 'Last known readiness', 'Follow-up']],
    body: data.non_responders.map((r) => ([r.athlete, r.last_check_in || 'Never', r.days_without_response != null ? `${r.days_without_response}` : '—', r.last_known_readiness != null ? num(r.last_known_readiness) : '—', r.follow_up])),
  });

  sectionTitle('Team Daily Readiness Profile');
  drawRadar(data.radar.dimensions, data.radar.responders_count);

  drawFooterAll();
  return doc;
}
