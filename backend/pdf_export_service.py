"""
Visual PDF Export Service for Brazil Lacrosse Athlete Monitoring System
Generates presentation-ready PDF reports with charts, visualizations, and minimal tables.

REFACTORED VERSION - Fixed layout issues, improved stability, and cleaner design.
"""

import io
import math
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for server-side rendering
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import Wedge, Circle
import numpy as np

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, 
    Image, PageBreak, HRFlowable, KeepTogether
)

# Color palette matching app theme
COLORS = {
    'primary': '#6366f1',
    'secondary': '#8b5cf6',
    'success': '#10b981',
    'warning': '#f59e0b',
    'danger': '#ef4444',
    'info': '#3b82f6',
    'muted': '#64748b',
    'dark': '#1e293b',
    'light': '#f8fafc',
}

def create_chart_image(fig, width=6, height=3):
    """Convert matplotlib figure to image bytes for PDF embedding"""
    buf = io.BytesIO()
    fig.set_size_inches(width, height)
    fig.savefig(buf, format='png', dpi=120, bbox_inches='tight', 
                facecolor='white', edgecolor='none', pad_inches=0.1)
    plt.close(fig)
    buf.seek(0)
    return buf

def create_readiness_trend_chart(readiness_data: List[dict], days: int = 14) -> io.BytesIO:
    """Create a line chart showing readiness score trend with risk threshold"""
    if not readiness_data:
        return create_empty_chart("No readiness data available")
    
    sorted_data = sorted(readiness_data, key=lambda x: x.get('date', ''))[-days:]
    
    if not sorted_data:
        return create_empty_chart("No readiness data available")
    
    dates = [d.get('date', '')[-5:] for d in sorted_data]
    scores = [d.get('readiness_score', 0) for d in sorted_data]
    
    fig, ax = plt.subplots(figsize=(6, 2.5))
    
    ax.fill_between(range(len(dates)), scores, alpha=0.3, color=COLORS['primary'])
    ax.plot(range(len(dates)), scores, color=COLORS['primary'], linewidth=2, marker='o', markersize=5)
    
    # Risk threshold
    ax.axhline(y=5, color=COLORS['danger'], linestyle='--', linewidth=1.5, alpha=0.7)
    
    # Mark low scores
    for i, score in enumerate(scores):
        if score < 5:
            ax.scatter(i, score, color=COLORS['danger'], s=80, zorder=5)
    
    ax.set_xticks(range(len(dates)))
    ax.set_xticklabels(dates, rotation=45, ha='right', fontsize=7)
    ax.set_ylabel('Score', fontsize=9)
    ax.set_ylim(0, 10.5)
    ax.grid(True, alpha=0.3, axis='y')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    
    plt.tight_layout()
    return create_chart_image(fig, 6, 2.5)

def create_radar_chart(wellness_data: dict) -> io.BytesIO:
    """Create a radar chart for wellness dimensions"""
    categories = ['Sleep', 'Energy', 'Recovery', 'Mental', 'Ready']
    
    values = [
        wellness_data.get('sleep_quality', 5),
        10 - wellness_data.get('morning_fatigue', 5),
        10 - wellness_data.get('muscle_soreness', 5),
        10 - wellness_data.get('stress', 5),
        wellness_data.get('readiness_score', 5)
    ]
    
    num_vars = len(categories)
    angles = [n / float(num_vars) * 2 * np.pi for n in range(num_vars)]
    angles += angles[:1]
    values += values[:1]
    
    fig, ax = plt.subplots(figsize=(3, 3), subplot_kw=dict(polar=True))
    
    ax.fill(angles, values, color=COLORS['primary'], alpha=0.25)
    ax.plot(angles, values, color=COLORS['primary'], linewidth=2)
    ax.scatter(angles[:-1], values[:-1], color=COLORS['primary'], s=40, zorder=5)
    
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, fontsize=8)
    ax.set_ylim(0, 10)
    ax.set_yticks([2, 4, 6, 8, 10])
    ax.set_yticklabels(['', '', '', '', ''], fontsize=6)
    ax.grid(True, alpha=0.3)
    
    plt.tight_layout()
    return create_chart_image(fig, 3, 3)

def create_workload_bar_chart(sessions: List[dict], days: int = 14) -> io.BytesIO:
    """Create a bar chart showing daily training load"""
    if not sessions:
        return create_empty_chart("No training data available")
    
    load_by_date = {}
    for session in sessions:
        date = session.get('date_time_start', '')[:10]
        load = session.get('internal_load', 0)
        load_by_date[date] = load_by_date.get(date, 0) + load
    
    sorted_dates = sorted(load_by_date.keys())[-days:]
    if not sorted_dates:
        return create_empty_chart("No training data available")
    
    loads = [load_by_date.get(d, 0) for d in sorted_dates]
    dates = [d[-5:] for d in sorted_dates]
    
    fig, ax = plt.subplots(figsize=(6, 2.5))
    
    bar_colors = []
    for load in loads:
        if load < 300:
            bar_colors.append(COLORS['success'])
        elif load < 600:
            bar_colors.append(COLORS['info'])
        elif load < 800:
            bar_colors.append(COLORS['warning'])
        else:
            bar_colors.append(COLORS['danger'])
    
    ax.bar(range(len(dates)), loads, color=bar_colors, alpha=0.8, width=0.7)
    
    ax.set_xticks(range(len(dates)))
    ax.set_xticklabels(dates, rotation=45, ha='right', fontsize=7)
    ax.set_ylabel('Load (AU)', fontsize=9)
    ax.grid(True, axis='y', alpha=0.3)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    
    if loads:
        avg_load = sum(loads) / len(loads)
        ax.axhline(y=avg_load, color=COLORS['muted'], linestyle='--', linewidth=1)
    
    plt.tight_layout()
    return create_chart_image(fig, 6, 2.5)

def create_pain_heatmap(pain_data: dict) -> io.BytesIO:
    """Create a horizontal bar chart showing pain by body region"""
    if not pain_data:
        return create_empty_chart("No pain data available")
    
    sorted_regions = sorted(pain_data.items(), key=lambda x: x[1].get('count', 0), reverse=True)[:6]
    
    if not sorted_regions:
        return create_empty_chart("No pain data available")
    
    regions = [r[0][:12] for r in sorted_regions]
    counts = [r[1].get('count', 0) for r in sorted_regions]
    avg_levels = [r[1].get('avg_level', 0) for r in sorted_regions]
    
    fig, ax = plt.subplots(figsize=(5, 2.5))
    
    bar_colors = []
    for level in avg_levels:
        if level <= 3:
            bar_colors.append(COLORS['success'])
        elif level <= 6:
            bar_colors.append(COLORS['warning'])
        else:
            bar_colors.append(COLORS['danger'])
    
    y_pos = range(len(regions))
    ax.barh(y_pos, counts, color=bar_colors, alpha=0.8, height=0.6)
    
    for i, (count, level) in enumerate(zip(counts, avg_levels)):
        ax.text(count + 0.2, i, f'{level:.1f}', va='center', fontsize=8, color=COLORS['muted'])
    
    ax.set_yticks(y_pos)
    ax.set_yticklabels(regions, fontsize=8)
    ax.set_xlabel('Reports', fontsize=9)
    ax.invert_yaxis()
    ax.grid(True, axis='x', alpha=0.3)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    
    plt.tight_layout()
    return create_chart_image(fig, 5, 2.5)

def create_compliance_chart(compliance_data: dict) -> io.BytesIO:
    """Create a horizontal bar chart showing compliance rates"""
    if not compliance_data:
        return create_empty_chart("No compliance data available")
    
    sorted_data = sorted(compliance_data.items(), key=lambda x: x[1].get('rate', 0), reverse=True)[:8]
    
    names = [d[1].get('name', '')[:12] for d in sorted_data]
    rates = [d[1].get('rate', 0) for d in sorted_data]
    
    fig, ax = plt.subplots(figsize=(5, 2.5))
    
    bar_colors = []
    for rate in rates:
        if rate >= 80:
            bar_colors.append(COLORS['success'])
        elif rate >= 50:
            bar_colors.append(COLORS['warning'])
        else:
            bar_colors.append(COLORS['danger'])
    
    y_pos = range(len(names))
    ax.barh(y_pos, rates, color=bar_colors, alpha=0.8, height=0.6)
    
    for i, rate in enumerate(rates):
        ax.text(rate + 1, i, f'{rate:.0f}%', va='center', fontsize=8)
    
    ax.set_yticks(y_pos)
    ax.set_yticklabels(names, fontsize=8)
    ax.set_xlabel('Compliance %', fontsize=9)
    ax.set_xlim(0, 105)
    ax.invert_yaxis()
    ax.axvline(x=80, color=COLORS['success'], linestyle='--', linewidth=1, alpha=0.5)
    ax.grid(True, axis='x', alpha=0.3)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    
    plt.tight_layout()
    return create_chart_image(fig, 5, 2.5)

def create_empty_chart(message: str) -> io.BytesIO:
    """Create a placeholder chart with a message"""
    fig, ax = plt.subplots(figsize=(4, 1.5))
    ax.text(0.5, 0.5, message, ha='center', va='center', fontsize=10, color=COLORS['muted'])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis('off')
    plt.tight_layout()
    return create_chart_image(fig, 4, 1.5)

# ============ PDF LAYOUT HELPERS ============

def get_styles():
    """Get custom paragraph styles for PDF - FIXED VERSION"""
    styles = getSampleStyleSheet()
    
    # Cover page styles
    styles.add(ParagraphStyle(
        'CoverTitle',
        parent=styles['Title'],
        fontSize=28,
        textColor=colors.HexColor('#1e293b'),
        spaceAfter=12,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontSize=14,
        textColor=colors.HexColor('#64748b'),
        spaceAfter=8,
        alignment=TA_CENTER
    ))
    
    # Section styles
    styles.add(ParagraphStyle(
        'SectionTitle',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#1e293b'),
        spaceBefore=16,
        spaceAfter=10,
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        'ChartCaption',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.HexColor('#64748b'),
        spaceAfter=12,
        alignment=TA_LEFT
    ))
    
    styles.add(ParagraphStyle(
        'Insight',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.HexColor('#334155'),
        spaceBefore=4,
        spaceAfter=8
    ))
    
    styles.add(ParagraphStyle(
        'MetricLabel',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.HexColor('#64748b'),
        alignment=TA_CENTER
    ))
    
    styles.add(ParagraphStyle(
        'MetricValue',
        parent=styles['Normal'],
        fontSize=18,
        textColor=colors.HexColor('#6366f1'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    ))
    
    styles.add(ParagraphStyle(
        'Footer',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.HexColor('#94a3b8'),
        alignment=TA_CENTER
    ))
    
    return styles

def create_cover_page(story, styles, title: str, subtitle: str, date_range: str, generated_at: str):
    """Create a professional cover page - SIMPLIFIED"""
    story.append(Spacer(1, 2*inch))
    
    story.append(Paragraph("BRAZIL LACROSSE", styles['CoverTitle']))
    story.append(Spacer(1, 0.2*inch))
    story.append(Paragraph(title, styles['CoverSubtitle']))
    story.append(Paragraph(subtitle, styles['CoverSubtitle']))
    
    story.append(Spacer(1, 0.4*inch))
    story.append(HRFlowable(width="50%", thickness=2, color=colors.HexColor('#6366f1'), 
                           spaceBefore=10, spaceAfter=10, hAlign='CENTER'))
    story.append(Spacer(1, 0.2*inch))
    
    story.append(Paragraph(f"Period: {date_range}", styles['CoverSubtitle']))
    story.append(Spacer(1, 1.5*inch))
    story.append(Paragraph(f"Generated: {generated_at}", styles['Footer']))
    story.append(PageBreak())

def create_key_metrics_section(story, styles, metrics: dict):
    """Create a visual key metrics summary - FIXED LAYOUT"""
    story.append(Paragraph("Key Metrics Summary", styles['SectionTitle']))
    
    # Build table data with separate cells for label and value
    metric_items = list(metrics.items())
    table_data = []
    
    # Create rows with 3 metrics per row
    for i in range(0, len(metric_items), 3):
        row_labels = []
        row_values = []
        
        for j in range(3):
            if i + j < len(metric_items):
                label, value = metric_items[i + j]
                row_labels.append(Paragraph(label, styles['MetricLabel']))
                row_values.append(Paragraph(str(value), styles['MetricValue']))
            else:
                row_labels.append('')
                row_values.append('')
        
        table_data.append(row_values)
        table_data.append(row_labels)
    
    if table_data:
        col_width = 2.2 * inch
        table = Table(table_data, colWidths=[col_width, col_width, col_width])
        table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f8fafc')),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
            ('LINEBELOW', (0, 0), (-1, -2), 0.5, colors.HexColor('#e2e8f0')),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ]))
        story.append(table)
    
    story.append(Spacer(1, 0.3*inch))

def add_chart_with_caption(story, styles, chart_bytes: io.BytesIO, caption: str, 
                          insight: str = None, width: float = 5.5*inch, height: float = 2.2*inch):
    """Add a chart image with caption and optional insight"""
    try:
        img = Image(chart_bytes, width=width, height=height)
        story.append(img)
        if caption:
            story.append(Paragraph(caption, styles['ChartCaption']))
        if insight:
            story.append(Paragraph(f"Insight: {insight}", styles['Insight']))
    except Exception as e:
        story.append(Paragraph(f"Chart could not be rendered", styles['ChartCaption']))
    story.append(Spacer(1, 0.15*inch))

def create_simple_table(story, styles, headers: List[str], data: List[List], title: str = None):
    """Create a simple compact table"""
    if title:
        story.append(Paragraph(title, styles['SectionTitle']))
    
    if not data:
        story.append(Paragraph("No data available", styles['ChartCaption']))
        return
    
    table_data = [headers] + data[:8]  # Limit rows
    
    col_width = 6.5 * inch / len(headers)
    table = Table(table_data, colWidths=[col_width] * len(headers))
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e2e8f0')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1e293b')),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafc')]),
    ]))
    story.append(table)
    story.append(Spacer(1, 0.2*inch))
