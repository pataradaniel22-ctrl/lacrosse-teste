#!/usr/bin/env python3
"""Verificações de segurança automáticas contra o backend publicado.

Uso:
    python3 qa/security_check.py [URL_DO_BACKEND] [--json saida.json]

Padrão: https://lacrosse-teste-api.onrender.com

Só faz leituras e tentativas de login; não altera dados (o seed público é
verificado com HEAD, que não o dispara).

Verifica:
  1. Rotas protegidas recusam acesso sem login (401/403)
  2. Token falso / adulterado é recusado
  3. Atleta não acessa rotas de equipe/admin (controle de acesso por papel)
  4. Senhas padrão conhecidas ainda funcionam
  5. Rotas perigosas expostas sem login (ex.: /api/seed-demo)
  6. CORS e cabeçalhos de segurança
  7. Respostas não vazam password_hash nem _id do MongoDB
"""
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

BASE = "https://lacrosse-teste-api.onrender.com"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
if args:
    BASE = args[0]
BASE = BASE.rstrip("/")
JSON_OUT = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None

CTX = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or None)

# Rotas que exigem login (amostra representativa de cada módulo).
PROTECTED_GET = [
    "/api/auth/me",
    "/api/staff/athletes",
    "/api/admin/pending-athletes",
    "/api/admin/all-athletes",
    "/api/admin/staff",
    "/api/admin/stats",
    "/api/staff/events",
    "/api/research/datasets",
    "/api/research/export",
    "/api/health/staff/athletes",
    "/api/push/preferences",
]
# Rotas só para equipe/admin, testadas com token de atleta.
STAFF_ONLY_GET = [
    "/api/staff/athletes",
    "/api/admin/pending-athletes",
    "/api/admin/all-athletes",
    "/api/admin/staff",
    "/api/research/datasets",
    "/api/research/export",
    "/api/health/staff/athletes",
]
DEFAULT_CREDS = [
    ("pataradaniel@gmail.com", "123456"),
    ("cristina.velez@brasillacrosse.com", "123456"),
    ("coach@brazillacrosse.com", "staff123"),
    ("fisio@brazillacrosse.com", "staff123"),
    ("lucas.silva@email.com", "demo123"),
]
DANGEROUS_PUBLIC = ["/api/seed-demo"]

results = []


def record(check, status, detail):
    results.append({"check": check, "status": status, "detail": detail})
    icon = {"ok": "✅", "falha": "❌", "aviso": "⚠️ "}[status]
    print(f"{icon} {check}: {detail}")


def req(method, path, token=None, body=None, headers=None):
    h = {"Accept": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if body is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=90, context=CTX) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 0, {}, str(e)


def login(email, password):
    code, _, text = req("POST", "/api/auth/login", body={"email": email, "password": password})
    if code == 200:
        try:
            return json.loads(text)
        except ValueError:
            return None
    return None


def main():
    code, _, _ = req("GET", "/api/")
    if code != 200:
        record("Backend no ar", "falha", f"/api/ respondeu {code}")
        return
    record("Backend no ar", "ok", "/api/ respondeu 200")

    # 1. Sem login
    open_routes = []
    for p in PROTECTED_GET:
        c, _, _ = req("GET", p)
        if c not in (401, 403, 404, 405):
            open_routes.append(f"{p} ({c})")
    record("Rotas protegidas sem login", "falha" if open_routes else "ok",
           ("abertas: " + ", ".join(open_routes)) if open_routes else f"{len(PROTECTED_GET)} rotas recusaram acesso")

    # 2. Token falso
    fake = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoieCIsInVzZXJfdHlwZSI6InN0YWZmIn0.invalido"
    c, _, _ = req("GET", "/api/auth/me", token=fake)
    record("Token adulterado", "ok" if c in (401, 403) else "falha", f"/api/auth/me respondeu {c}")

    # 4. Senhas padrão
    working, athlete_token = [], None
    for email, pw in DEFAULT_CREDS:
        data = login(email, pw)
        if data:
            role = (data.get("user") or {}).get("role") or data.get("user_type")
            working.append(f"{email} ({role})")
            if data.get("user_type") == "athlete" and not athlete_token:
                athlete_token = data.get("token")
            leaked = [k for k in ("password_hash", "_id") if k in json.dumps(data)]
            if leaked:
                record("Vazamento no login", "falha", f"resposta contém {leaked}")
    admins = [w for w in working if "Admin" in w]
    record("Senhas padrão", "falha" if admins else ("aviso" if working else "ok"),
           ("funcionam: " + ", ".join(working)) if working else "nenhuma senha padrão funciona")

    # 3. Atleta acessando área de equipe
    if athlete_token:
        leaks = []
        for p in STAFF_ONLY_GET:
            c, _, _ = req("GET", p, token=athlete_token)
            if c == 200:
                leaks.append(p)
        record("Atleta em rotas de equipe", "falha" if leaks else "ok",
               ("acessou: " + ", ".join(leaks)) if leaks else "todas recusadas")
    else:
        record("Atleta em rotas de equipe", "aviso", "sem login de atleta para testar")

    # 5. Rotas perigosas públicas (sem disparar: usa HEAD)
    for p in DANGEROUS_PUBLIC:
        c, _, _ = req("HEAD", p)
        if c in (401, 403, 404):
            record(f"Rota {p}", "ok", f"protegida ({c})")
        else:
            record(f"Rota {p}", "falha", f"responde {c} sem login (qualquer pessoa pode disparar)")

    # 6. CORS e cabeçalhos
    c, h, _ = req("OPTIONS", "/api/auth/login",
                  headers={"Origin": "https://site-malicioso.example", "Access-Control-Request-Method": "POST"})
    allow = {k.lower(): v for k, v in h.items()}.get("access-control-allow-origin", "")
    record("CORS", "aviso" if allow in ("*", "https://site-malicioso.example") else "ok",
           f"origem estranha recebe allow-origin='{allow or 'nenhum'}'")
    _, h, _ = req("GET", "/api/")
    hl = {k.lower() for k in h}
    missing = [x for x in ("strict-transport-security", "x-content-type-options", "x-frame-options") if x not in hl]
    record("Cabeçalhos de segurança", "aviso" if missing else "ok",
           ("faltando: " + ", ".join(missing)) if missing else "presentes")


if __name__ == "__main__":
    try:
        main()
    finally:
        fails = sum(r["status"] == "falha" for r in results)
        warns = sum(r["status"] == "aviso" for r in results)
        print(f"\nResumo: {fails} falha(s), {warns} aviso(s), {len(results)} verificações")
        if JSON_OUT:
            with open(JSON_OUT, "w") as f:
                json.dump({"base": BASE, "results": results}, f, ensure_ascii=False, indent=2)
