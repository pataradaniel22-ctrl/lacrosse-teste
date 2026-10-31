"""Health Surveillance PDF reports (individual + team).

Clean, confidential OSTRC-H2 health reports. No ACWR. Training load is shown as
descriptive context only (never as an injury-prediction ratio).
"""
import io
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, HRFlowable,
)

C = {
    "primary": "#0ea5e9", "success": "#10b981", "warning": "#f59e0b",
    "danger": "#ef4444", "muted": "#64748b", "dark": "#0f172a", "rose": "#f43f5e",
}
CONFIDENTIAL_ATHLETE = ("Confidential athlete health information. Access and distribution "
                        "are restricted to authorized personnel.")
CONFIDENTIAL_TEAM = "Confidential team availability information. Restricted to authorized personnel."
DISCLAIMER = ("This report supports athlete monitoring and does not replace medical diagnosis "
              "or clinical assessment.")


def _styles():
    s = getSampleStyleSheet()
    s.add(ParagraphStyle("HTitle", fontSize=20, leading=24, textColor=colors.HexColor(C["dark"]),
                         spaceAfter=2, fontName="Helvetica-Bold"))
    s.add(ParagraphStyle("HSub", fontSize=10, leading=13, textColor=colors.HexColor(C["muted"]), spaceAfter=2))
    s.add(ParagraphStyle("HSection", fontSize=13, leading=16, textColor=colors.HexColor(C["primary"]),
                         spaceBefore=14, spaceAfter=6, fontName="Helvetica-Bold"))
    s.add(ParagraphStyle("HBody", fontSize=9.5, leading=13, textColor=colors.HexColor("#334155")))
    s.add(ParagraphStyle("HFoot", fontSize=7.5, leading=10, textColor=colors.HexColor(C["muted"]),
                         alignment=TA_CENTER))
    s.add(ParagraphStyle("HInsight", fontSize=9.5, leading=13, textColor=colors.HexColor("#334155"),
                         leftIndent=10, spaceAfter=2))
    return s


def _chart_img(fig, w=6.4, h=2.4):
    buf = io.BytesIO()
    fig.set_size_inches(w, h)
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight", facecolor="white", pad_inches=0.1)
    plt.close(fig)
    buf.seek(0)
    return buf


def _kpi_table(rows, styles):
    """rows: list of (label, value). Renders a compact 3-per-row KPI grid."""
    cells = []
    line = []
    for label, value in rows:
        block = [Paragraph(f'<font size=15 color="{C["dark"]}"><b>{value}</b></font>', styles["HBody"]),
                 Paragraph(f'<font size=8 color="{C["muted"]}">{label}</font>', styles["HBody"])]
        line.append(block)
        if len(line) == 3:
            cells.append(line)
            line = []
    if line:
        while len(line) < 3:
            line.append("")
        cells.append(line)
    t = Table(cells, colWidths=[2.3 * inch] * 3)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    return t


def _severity_trend_chart(points):
    """points: list of {'label': 'Jul 12', 'score': int}."""
    fig, ax = plt.subplots(figsize=(6.4, 2.2))
    if points:
        labels = [p["label"] for p in points]
        scores = [p["score"] for p in points]
        ax.plot(range(len(scores)), scores, color=C["primary"], linewidth=2, marker="o", markersize=5)
        ax.fill_between(range(len(scores)), scores, alpha=0.15, color=C["primary"])
        ax.set_xticks(range(len(labels)))
        ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=7)
    ax.set_ylim(0, 100)
    ax.set_ylabel("Severity Score", fontsize=9)
    ax.axhline(y=17, color=C["warning"], linestyle="--", linewidth=1, alpha=0.6)
    ax.grid(True, alpha=0.3, axis="y")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.tight_layout()
    return _chart_img(fig)


def _bar_chart(labels, values, palette, ylabel):
    fig, ax = plt.subplots(figsize=(6.4, 2.2))
    ax.bar(range(len(values)), values, color=palette)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, fontsize=8)
    ax.set_ylabel(ylabel, fontsize=9)
    for i, v in enumerate(values):
        if v:
            ax.text(i, v, str(v), ha="center", va="bottom", fontsize=8)
    ax.grid(True, alpha=0.3, axis="y")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.tight_layout()
    return _chart_img(fig)


def _footer(styles, confidential):
    return [Spacer(1, 12), HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e2e8f0")),
            Spacer(1, 4), Paragraph(confidential, styles["HFoot"]),
            Paragraph(DISCLAIMER, styles["HFoot"])]


def build_athlete_health_pdf(d: dict) -> io.BytesIO:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=0.6 * inch, bottomMargin=0.6 * inch,
                            leftMargin=0.6 * inch, rightMargin=0.6 * inch)
    s = _styles()
    E = []
    a = d["athlete"]
    E.append(Paragraph("Athlete Health Report", s["HTitle"]))
    E.append(Paragraph(f'{a.get("name","")} &nbsp;·&nbsp; {a.get("team","") or "—"}'
                       f'{" · " + a["position"] if a.get("position") else ""}', s["HSub"]))
    E.append(Paragraph(f'Report period: {d["period"]} &nbsp;·&nbsp; Generated: {d["generated_at"]}', s["HSub"]))
    E.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor(C["primary"]), spaceBefore=6, spaceAfter=4))

    cur = d["current"]
    E.append(Paragraph("Current Health Status", s["HSection"]))
    E.append(_kpi_table([
        ("Availability", cur["availability"].replace("_", " ").title()),
        ("Highest Severity", f'{cur["highest_severity"]}/100'),
        ("Health Trend", cur["trend"].title()),
        ("Active Problems", cur["active_problems"]),
        ("Last Submission", cur["last_submission"] or "—"),
        ("Questionnaire Compliance", cur["compliance"]),
    ], s))

    w = d["weekly_summary"]
    E.append(Paragraph("Weekly Health Summary", s["HSection"]))
    E.append(_kpi_table([
        ("Problems Reported", w["reported"]), ("New", w["new"]), ("Ongoing", w["ongoing"]),
        ("Resolved", w["resolved"]), ("Substantial", w["substantial"]), ("Submissions", w["submissions"]),
    ], s))

    E.append(Paragraph("Severity Trend", s["HSection"]))
    E.append(Image(_severity_trend_chart(d["severity_trend"]), width=6.4 * inch, height=2.2 * inch))

    p = d["participation"]
    E.append(Paragraph("Participation Summary", s["HSection"]))
    E.append(Image(_bar_chart(["Full", "Modified", "Unable"],
                        [p["full"], p["modified"], p["unable"]],
                        [C["success"], C["warning"], C["danger"]], "Weeks"),
                   width=6.4 * inch, height=2.2 * inch))

    ctx = d["context"]
    E.append(Paragraph("Integrated Context (descriptive)", s["HSection"]))
    ctx_rows = [
        ["Avg readiness (7d)", ctx["readiness"]],
        ["Pain reports (7d)", ctx["pain_reports"]],
        ["Weekly training load", ctx["weekly_load"]],
        ["CMJ (latest)", ctx["cmj"]],
    ]
    t = Table(ctx_rows, colWidths=[3.2 * inch, 3.2 * inch])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor(C["muted"])),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    E.append(t)

    if d.get("insights"):
        E.append(Paragraph("Key Insights", s["HSection"]))
        for ins in d["insights"]:
            E.append(Paragraph(f"• {ins}", s["HInsight"]))

    E += _footer(s, CONFIDENTIAL_ATHLETE)
    doc.build(E)
    buf.seek(0)
    return buf


def build_team_health_pdf(d: dict) -> io.BytesIO:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=0.6 * inch, bottomMargin=0.6 * inch,
                            leftMargin=0.6 * inch, rightMargin=0.6 * inch)
    s = _styles()
    E = []
    E.append(Paragraph("Team Health Report", s["HTitle"]))
    E.append(Paragraph(f'{d["team_label"]} &nbsp;·&nbsp; Generated: {d["generated_at"]}', s["HSub"]))
    E.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor(C["primary"]), spaceBefore=6, spaceAfter=4))

    o = d["overview"]
    E.append(Paragraph("Overview", s["HSection"]))
    E.append(_kpi_table([
        ("Weekly Response Rate", f'{o["response_rate"]}%'),
        ("Athletes With Problems", o["with_problems"]),
        ("Substantial Problems", o["substantial"]),
        ("New Problems", o["new_problems"]),
        ("Recovered", o["recovered"]),
        ("Avg Severity", f'{o["avg_severity"]}/100'),
    ], s))

    sd = d["severity_distribution"]
    E.append(Paragraph("Severity Distribution", s["HSection"]))
    E.append(Image(_bar_chart(["None", "Minimal", "Moderate", "High"],
                        [sd.get("none", 0), sd.get("minimal", 0), sd.get("moderate", 0), sd.get("high", 0)],
                        [C["success"], "#84cc16", C["warning"], C["danger"]], "Athletes"),
                   width=6.4 * inch, height=2.2 * inch))

    cd = d["category_distribution"]
    if cd:
        E.append(Paragraph("Problem Categories", s["HSection"]))
        E.append(Image(_bar_chart([k.title() for k in cd.keys()], list(cd.values()),
                            [C["primary"]] * len(cd), "Problems"),
                       width=6.4 * inch, height=2.2 * inch))

    E.append(Paragraph("Athlete Priority List", s["HSection"]))
    head = ["Athlete", "Availability", "Severity", "Active", "Substantial", "Trend"]
    body = [head] + d["priority_rows"]
    t = Table(body, colWidths=[1.9*inch, 1.2*inch, 0.9*inch, 0.7*inch, 1.0*inch, 0.9*inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(C["dark"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    E.append(t)

    if d.get("insights"):
        E.append(Paragraph("Key Insights", s["HSection"]))
        for ins in d["insights"]:
            E.append(Paragraph(f"• {ins}", s["HInsight"]))

    E += _footer(s, CONFIDENTIAL_TEAM)
    doc.build(E)
    buf.seek(0)
    return buf
