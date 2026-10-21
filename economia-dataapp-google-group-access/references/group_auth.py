"""Google Group access gate for the data app.

Sits in front of every route (registered as a Flask `before_request` hook in
app.py) and restricts access to members of the group(s) in REQUIRED_GROUP_EMAIL.
No-op if that env var is unset. Requires GOOGLE_SERVICE_ACCOUNT_KEY (full
service-account JSON) — the service account must be Owner/Manager of every
group listed, no domain-wide delegation needed (Cloud Identity Groups API).

Requires BOTH "google-auth" and "requests" in pyproject.toml dependencies —
google.auth.transport.requests needs requests installed separately, it is
NOT pulled in transitively by google-auth. Forgetting it crashes the whole
app on import (see SKILL.md Gotcha 6), not just this gate.
"""
from __future__ import annotations

import json
import os
import time

from flask import Response, request
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

SCOPES = ["https://www.googleapis.com/auth/cloud-identity.groups.readonly"]
EMAIL_HEADER_CANDIDATES = [
    "X-Kbc-User-Email",
    "X-Forwarded-Email",
    "X-Auth-Request-Email",
    "X-Forwarded-User",
]
MEMBERSHIP_CACHE_TTL_SECONDS = 5 * 60

_session: AuthorizedSession | None = None
_group_resource_name_cache: dict[str, str] = {}
_membership_cache: dict[tuple[str, str], tuple[bool, float]] = {}


def _get_session() -> AuthorizedSession:
    global _session
    if _session is not None:
        return _session
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    if not raw:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_KEY secret is not set")
    info = json.loads(raw)
    credentials = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    _session = AuthorizedSession(credentials)
    return _session


def _get_group_resource_name(group_email: str) -> str:
    cached = _group_resource_name_cache.get(group_email)
    if cached:
        return cached
    session = _get_session()
    resp = session.get(
        "https://cloudidentity.googleapis.com/v1/groups:lookup",
        params={"groupKey.id": group_email},
    )
    resp.raise_for_status()
    name = resp.json()["name"]
    _group_resource_name_cache[group_email] = name
    return name


def _is_group_member(email: str, group: str) -> bool:
    cache_key = (group, email)
    cached = _membership_cache.get(cache_key)
    if cached and time.monotonic() - cached[1] < MEMBERSHIP_CACHE_TTL_SECONDS:
        return cached[0]
    session = _get_session()
    group_resource_name = _get_group_resource_name(group)
    resp = session.get(
        f"https://cloudidentity.googleapis.com/v1/{group_resource_name}/memberships:checkTransitiveMembership",
        params={"query": f"member_key_id=='{email}'"},
    )
    resp.raise_for_status()
    is_member = bool(resp.json().get("hasMembership"))
    _membership_cache[cache_key] = (is_member, time.monotonic())
    return is_member


def _is_member_of_any_group(email: str, groups: list[str]) -> bool:
    errors = []
    for group in groups:
        try:
            if _is_group_member(email, group):
                return True
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    if len(errors) == len(groups):
        raise errors[0]
    return False


def _get_user_email() -> str | None:
    for header in EMAIL_HEADER_CANDIDATES:
        value = request.headers.get(header)
        if value and "@" in value:
            return value
    return None


def _is_health_check() -> bool:
    if request.path == "/api/health":
        return True
    if request.method == "POST" and request.path == "/":
        return True
    if request.headers.get("User-Agent", "").startswith("kube-probe"):
        return True
    return False


def _denied_page(reason: str) -> Response:
    import html

    body = f"""<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Přístup odepřen</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:96px auto;text-align:center;color:#1a1a2e;">
<div style="font-size:2.5rem;margin-bottom:8px;">\U0001F512</div>
<h1 style="font-size:1.4rem;margin:0 0 12px;">Přístup odepřen</h1>
<p style="color:#666;line-height:1.5;">{html.escape(reason)}</p>
</body></html>"""
    return Response(body, status=403, mimetype="text/html")


def check_group_access() -> Response | None:
    """Flask before_request hook. Returns a Response to short-circuit, or None to continue."""
    if _is_health_check():
        return None
    raw_groups = os.environ.get("REQUIRED_GROUP_EMAIL")
    if not raw_groups:
        return None
    groups = [g.strip() for g in raw_groups.split(",") if g.strip()]
    email = _get_user_email()
    if not email:
        return _denied_page("Nepodařilo se ověřit přihlášeného uživatele. Zkuste se prosím přihlásit znovu.")
    try:
        member = _is_member_of_any_group(email, groups)
    except Exception as exc:  # noqa: BLE001
        print(f"[groupAuth] Directory API check failed for {email}: {exc}", flush=True)
        return _denied_page("Chyba při ověřování přístupu. Zkuste to prosím později.")
    if not member:
        return _denied_page(
            f"Tento report je dostupný jen pro členy skupiny {' / '.join(groups)}. "
            "Pokud si myslíte, že byste přístup mít měli, napište na "
            "vit.svoboda@economia.cz nebo pavel.stepanek@economia.cz."
        )
    return None
