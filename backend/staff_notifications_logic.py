"""Staff notification centre — pure rules (unit-tested).

Every source is turned into the same item shape:
  {id, kind, title, subtitle, severity, at (ISO), link, athlete_id?, resolvable}
Each staff member has their own state: when they last opened the bell
(``seen_at``) and which items they dismissed. The badge counts items newer
than ``seen_at`` that were not dismissed.
"""
from __future__ import annotations

from typing import Iterable, Optional

SEVERITY_ORDER = {"red": 0, "yellow": 1, "info": 2}


def sev_of_alert(sev: Optional[str]) -> str:
    s = (sev or "").lower()
    if s.startswith("red"):
        return "red"
    if s.startswith("yellow") or s.startswith("amber") or s.startswith("orange"):
        return "yellow"
    return "info"


ALERT_TITLES = {
    "LOW_READINESS": "Low readiness", "HIGH_LOAD_SPIKE": "Training load spike", "PERSISTENT_PAIN": "Persistent pain",
    "SHARP_DROP": "Sharp readiness drop", "HIGH_PAIN": "High pain", "SEVERE_PAIN": "Severe pain",
}


def alert_title(a: dict) -> str:
    t = str(a.get("alert_type") or a.get("type") or "Alert")
    return ALERT_TITLES.get(t.upper(), t.replace("_", " ").title())


def build_items(alerts: Iterable[dict] = (), conversations: Iterable[dict] = (), documents: Iterable[dict] = (),
                requests_done: Iterable[dict] = (), follow_ups: Iterable[dict] = (), pending: Iterable[dict] = ()) -> list:
    items = []
    for a in alerts:
        items.append({
            "id": f"alert:{a['id']}", "kind": "alert", "ref": a["id"], "athlete_id": a.get("athlete_id"),
            "title": f"{alert_title(a)} · {a.get('athlete_name') or 'Athlete'}",
            "subtitle": a.get("message") or "", "severity": sev_of_alert(a.get("severity")),
            "at": str(a.get("created_at") or ""), "link": f"/staff/athlete/{a.get('athlete_id')}",
            "resolvable": not a.get("auto"),
        })
    for c in conversations:
        pain = c.get("is_pain_related")
        urgent = c.get("priority") in ("high", "urgent")
        items.append({
            "id": f"msg:{c['id']}:{c.get('last_message_at') or ''}", "kind": "message", "ref": c["id"],
            "title": f"{'Pain report' if pain else 'Message'} · {c.get('athlete_name') or 'Athlete'}",
            "subtitle": c.get("last_message_preview") or c.get("title") or "",
            "severity": "red" if pain or urgent else "info",
            "at": str(c.get("last_message_at") or ""), "link": f"/staff/messages/{c['id']}", "resolvable": False,
        })
    for d in documents:
        items.append({
            "id": f"doc:{d['id']}", "kind": "document", "ref": d["id"], "athlete_id": d.get("athlete_id"),
            "title": f"New document · {d.get('athlete_name') or 'Athlete'}",
            "subtitle": d.get("type_label") or d.get("doc_type") or "", "severity": "info",
            "at": str(d.get("uploaded_at") or ""), "link": f"/staff/athlete/{d.get('athlete_id')}", "resolvable": False,
        })
    for r in requests_done:
        items.append({
            "id": f"req:{r['id']}", "kind": "request", "ref": r["id"], "athlete_id": r.get("athlete_id"),
            "title": f"Request completed · {r.get('athlete_name') or 'Athlete'}",
            "subtitle": ", ".join(i.get("label", "") for i in r.get("items") or []), "severity": "info",
            "at": str(r.get("completed_at") or ""), "link": f"/staff/athlete/{r.get('athlete_id')}", "resolvable": False,
        })
    for n in follow_ups:
        overdue = n.get("status") == "overdue"
        items.append({
            "id": f"fu:{n['id']}:{n.get('follow_up_on')}", "kind": "follow_up", "ref": n["id"], "athlete_id": n.get("athlete_id"),
            "title": f"{'Follow-up overdue' if overdue else 'Follow-up due'} · {n.get('athlete_name') or 'Athlete'}",
            "subtitle": f"{n.get('follow_up_on')} — {n.get('title') or n.get('entry_type') or 'Clinical entry'}",
            "severity": "yellow" if overdue else "info",
            "at": str(n.get("follow_up_on") or ""), "link": f"/staff/athlete/{n.get('athlete_id')}", "resolvable": False,
        })
    for p in pending:
        items.append({
            "id": f"reg:{p['id']}", "kind": "registration", "ref": p["id"],
            "title": f"New registration · {p.get('name') or ''}".strip(),
            "subtitle": f"{p.get('kind', 'Athlete')} waiting for approval", "severity": "yellow",
            "at": str(p.get("created_at") or ""), "link": "/staff/admin", "resolvable": False,
        })
    items.sort(key=lambda i: i["at"], reverse=True)
    return items


def apply_state(items: list, seen_at: Optional[str], dismissed: Iterable[str]) -> dict:
    """Drop dismissed items, flag new ones, count unread."""
    dismissed = set(dismissed or [])
    out = []
    for i in items:
        if i["id"] in dismissed:
            continue
        i = dict(i)
        i["new"] = not seen_at or (i["at"] or "") > seen_at
        out.append(i)
    unread = sum(1 for i in out if i["new"])
    return {"items": out, "unread": unread, "red_unread": sum(1 for i in out if i["new"] and i["severity"] == "red"),
            "seen_at": seen_at}
