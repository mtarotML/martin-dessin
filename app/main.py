from fastapi import FastAPI, Depends, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pathlib import Path
from typing import List
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import uvicorn
import os
import re
import secrets
from urllib.parse import urlencode

import requests

from .database import init_db, get_connection
from .auth import (
    admin_auth,
    current_user,
    optional_user,
    create_session,
    delete_session,
    is_admin,
)

BASE_DIR = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


# ===================== Auth endpoints =====================

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def app_base_url(request: Request) -> str:
    configured = os.getenv("APP_BASE_URL")
    if configured:
        return configured.rstrip("/")
    return str(request.base_url).rstrip("/")


def google_redirect_uri(request: Request) -> str:
    return f"{app_base_url(request)}/auth/google/callback"


def google_oauth_config():
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    return client_id, client_secret


def get_existing_google_user(profile: dict):
    google_id = profile.get("sub")
    email = (profile.get("email") or "").strip().lower()

    if not google_id or not email:
        raise ValueError("Profil Google incomplet")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, email FROM users WHERE google_id = %s",
                (google_id,),
            )
            user = cur.fetchone()
            if user:
                return user

            cur.execute(
                "SELECT id, username, email FROM users WHERE email = %s",
                (email,),
            )
            user = cur.fetchone()
            if user:
                cur.execute(
                    "UPDATE users SET google_id = %s WHERE id = %s",
                    (google_id, user["id"]),
                )
                conn.commit()
                return {"id": user["id"], "username": user["username"], "email": user["email"]}
            return None


def create_google_pending_signup(profile: dict) -> str:
    google_id = profile.get("sub")
    email = (profile.get("email") or "").strip().lower()
    if not google_id or not email:
        raise ValueError("Profil Google incomplet")

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM google_pending_signups WHERE expires_at <= NOW()")
            cur.execute(
                """
                INSERT INTO google_pending_signups (token, google_id, email, expires_at)
                VALUES (%s, %s, %s, %s)
                """,
                (token, google_id, email, expires_at),
            )
            conn.commit()
    return token


class GoogleUsernameIn(BaseModel):
    username: str = Field(min_length=2, max_length=40)


@app.post("/auth/google/complete")
def complete_google_signup(data: GoogleUsernameIn, request: Request):
    signup_token = request.cookies.get("google_signup_token")
    if not signup_token:
        return JSONResponse({"error": "Session d'inscription expirée"}, 401)

    username = data.username.strip()
    if not re.match(r"^[a-zA-Z0-9_-]+$", username):
        return JSONResponse({"error": "Caractères autorisés: lettres, chiffres, _ et -"}, 400)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT token, google_id, email
                FROM google_pending_signups
                WHERE token = %s AND expires_at > NOW()
                """,
                (signup_token,),
            )
            pending = cur.fetchone()
            if not pending:
                return JSONResponse({"error": "Session d'inscription expirée"}, 401)

            cur.execute("SELECT 1 FROM users WHERE username = %s", (username,))
            if cur.fetchone():
                return JSONResponse({"error": "Ce nom d'utilisateur est déjà pris"}, 409)

            try:
                cur.execute(
                    """
                    INSERT INTO users (username, email, password_hash, google_id)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id, username, email
                    """,
                    (username, pending["email"], "google_oauth", pending["google_id"]),
                )
                user = cur.fetchone()
            except Exception:
                conn.rollback()
                return JSONResponse({"error": "Ce nom d'utilisateur est déjà pris"}, 409)
            cur.execute("DELETE FROM google_pending_signups WHERE token = %s", (signup_token,))
            conn.commit()

    response = JSONResponse({"user": user})
    response.delete_cookie("google_signup_token")
    create_session(user["id"], response)
    return response


@app.get("/auth/google/start")
def google_start(request: Request):
    config = google_oauth_config()
    if not config:
        return JSONResponse({"error": "Google OAuth n'est pas configuré"}, 500)

    client_id, _ = config
    state = secrets.token_urlsafe(24)
    params = {
        "client_id": client_id,
        "redirect_uri": google_redirect_uri(request),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    response = RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")
    response.set_cookie("oauth_state", state, httponly=True, samesite="lax", max_age=600)
    return response


@app.get("/auth/google/callback")
def google_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return JSONResponse({"error": error}, 400)
    if not code or not state or state != request.cookies.get("oauth_state"):
        return JSONResponse({"error": "Connexion Google invalide"}, 400)

    config = google_oauth_config()
    if not config:
        return JSONResponse({"error": "Google OAuth n'est pas configuré"}, 500)

    client_id, client_secret = config
    token_res = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": google_redirect_uri(request),
            "grant_type": "authorization_code",
        },
        timeout=10,
    )
    if not token_res.ok:
        return JSONResponse({"error": "Impossible de valider la connexion Google"}, 400)

    access_token = token_res.json().get("access_token")
    if not access_token:
        return JSONResponse({"error": "Réponse Google invalide"}, 400)

    profile_res = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    if not profile_res.ok:
        return JSONResponse({"error": "Impossible de récupérer le profil Google"}, 400)

    try:
        profile = profile_res.json()
        user = get_existing_google_user(profile)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, 400)

    base = app_base_url(request)
    if user:
        response = RedirectResponse(f"{base}/")
        response.delete_cookie("oauth_state")
        create_session(user["id"], response)
        return response

    try:
        signup_token = create_google_pending_signup(profile)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, 400)

    response = RedirectResponse(f"{base}/")
    response.delete_cookie("oauth_state")
    response.set_cookie("google_signup_token", signup_token, httponly=True, samesite="lax", max_age=600)
    return response


@app.post("/auth/google/cancel")
def cancel_google_signup(request: Request):
    signup_token = request.cookies.get("google_signup_token")
    if signup_token:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM google_pending_signups WHERE token = %s",
                    (signup_token,),
                )
                conn.commit()
    response = JSONResponse({"status": "ok"})
    response.delete_cookie("google_signup_token")
    return response


@app.post("/auth/logout")
def logout(request: Request):
    response = JSONResponse({"status": "ok"})
    token = request.cookies.get("session_token")
    if token:
        delete_session(token, response)
    return response


@app.get("/auth/me")
def me(request: Request, user=Depends(optional_user)):
    if user:
        return {
            "user": {
                "id": user["id"],
                "username": user["username"],
                "email": user["email"],
                "is_admin": is_admin(user),
            },
            "pending_signup": None,
        }

    pending = None
    signup_token = request.cookies.get("google_signup_token")
    if signup_token:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT email FROM google_pending_signups WHERE token = %s AND expires_at > NOW()",
                    (signup_token,),
                )
                row = cur.fetchone()
                if row:
                    pending = {"email": row["email"]}
    return {"user": None, "pending_signup": pending}


# ===================== Pages =====================

@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/auth")
def auth_page():
    return FileResponse(BASE_DIR / "static" / "auth.html")


@app.get("/admin")
def admin_page(request: Request, user=Depends(optional_user)):
    if not is_admin(user):
        return RedirectResponse(f"{app_base_url(request)}/")
    return FileResponse(BASE_DIR / "static" / "admin.html")


# ===================== Drawings =====================

class DrawingIn(BaseModel):
    image: str


@app.post("/drawings")
def save_drawing(data: DrawingIn, user=Depends(optional_user)):
    _finalize_due_contest()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO drawings (image, user_id) VALUES (%s, %s)",
                (data.image, user["id"] if user else None),
            )
            conn.commit()
    return {"status": "ok"}


@app.get("/drawings")
def list_drawings(user=Depends(optional_user)):
    _finalize_due_contest()
    user_id = user["id"] if user else None
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.id, d.image, d.created_at,
                       u.username AS author,
                       (SELECT COUNT(*) FROM reactions r WHERE r.drawing_id = d.id AND r.emoji = 'like') AS heart_count,
                       EXISTS(
                           SELECT 1 FROM reactions r
                           WHERE r.drawing_id = d.id
                             AND r.user_id = %s
                             AND r.emoji = 'like'
                       ) AS user_liked,
                       (d.user_id IS NOT NULL AND d.user_id = %s) AS is_own
                FROM drawings d
                LEFT JOIN users u ON d.user_id = u.id
                ORDER BY d.id DESC
                """,
                (user_id, user_id),
            )
            rows = cur.fetchall()
    return {"drawings": rows}


@app.get("/leaderboard")
def get_leaderboard():
    _finalize_due_contest()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id,
                    u.username,
                    (SELECT COUNT(*) FROM drawings d WHERE d.user_id = u.id) AS drawing_count,
                    (SELECT COUNT(*) FROM reactions r JOIN drawings d ON d.id = r.drawing_id WHERE d.user_id = u.id AND r.emoji = 'like') AS like_count
                FROM users u
                ORDER BY like_count DESC, drawing_count DESC
                LIMIT 5
                """
            )
            rows = cur.fetchall()

    return {"leaderboard": rows}


# ===================== Contest =====================

def _finalize_due_contest():
    """Lazy finalization: if a running contest's deadline has passed, archive
    the most-liked drawing as winner and wipe all drawings."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Atomically claim the contest so concurrent requests don't double-finalize
            cur.execute(
                """
                UPDATE contests
                SET status = 'finalized', finalized_at = NOW()
                WHERE status = 'running' AND ends_at <= NOW()
                RETURNING id
                """
            )
            row = cur.fetchone()
            if not row:
                return
            contest_id = row["id"]

            cur.execute(
                """
                SELECT d.image, u.username AS author,
                       COUNT(r.id) AS like_count
                FROM drawings d
                LEFT JOIN users u ON d.user_id = u.id
                LEFT JOIN reactions r ON r.drawing_id = d.id AND r.emoji = 'like'
                GROUP BY d.id, d.image, u.username
                ORDER BY like_count DESC, d.created_at ASC
                LIMIT 1
                """
            )
            winner = cur.fetchone()
            if winner:
                cur.execute(
                    """
                    INSERT INTO contest_winners (contest_id, image, author_username, like_count)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (contest_id, winner["image"], winner["author"], int(winner["like_count"] or 0)),
                )

            cur.execute("DELETE FROM drawings")
            conn.commit()


def _serialize_contest(contest: dict | None) -> dict | None:
    if not contest:
        return None
    ends_at = contest["ends_at"]
    if ends_at and ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=timezone.utc)
    started_at = contest.get("started_at")
    if started_at and started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    seconds_left = max(0, int((ends_at - datetime.now(timezone.utc)).total_seconds()))
    return {
        "id": contest["id"],
        "status": contest["status"],
        "started_at": started_at.isoformat() if started_at else None,
        "ends_at": ends_at.isoformat(),
        "seconds_left": seconds_left,
    }


@app.get("/contest")
def get_contest():
    _finalize_due_contest()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, started_at, ends_at, status FROM contests "
                "WHERE status = 'running' LIMIT 1"
            )
            row = cur.fetchone()
    return {"contest": _serialize_contest(row)}


@app.get("/contests/winners")
def get_contest_winners():
    _finalize_due_contest()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, contest_id, image, author_username, like_count, archived_at
                FROM contest_winners
                ORDER BY archived_at DESC, id DESC
                """
            )
            rows = cur.fetchall()
    winners = []
    for r in rows:
        archived_at = r["archived_at"]
        if archived_at and archived_at.tzinfo is None:
            archived_at = archived_at.replace(tzinfo=timezone.utc)
        winners.append({
            "id": r["id"],
            "contest_id": r["contest_id"],
            "image": r["image"],
            "author": r["author_username"],
            "like_count": r["like_count"],
            "archived_at": archived_at.isoformat() if archived_at else None,
        })
    return {"winners": winners}


@app.get("/drawings/{drawing_id}")
def get_drawing(drawing_id: int, user=Depends(optional_user)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT d.id, d.image, d.created_at, d.user_id, u.username AS author
                FROM drawings d LEFT JOIN users u ON d.user_id = u.id
                WHERE d.id = %s
            """, (drawing_id,))
            drawing = cur.fetchone()

            if not drawing:
                return JSONResponse({"error": "Dessin introuvable"}, 404)

            cur.execute(
                "SELECT COUNT(*) AS cnt FROM reactions WHERE drawing_id = %s AND emoji = 'like'",
                (drawing_id,),
            )
            heart_row = cur.fetchone()
            heart_count = int(heart_row["cnt"]) if heart_row else 0

            user_liked = False
            if user:
                cur.execute(
                    "SELECT 1 FROM reactions WHERE drawing_id = %s AND user_id = %s AND emoji = 'like'",
                    (drawing_id, user["id"]),
                )
                user_liked = cur.fetchone() is not None

    is_own = bool(user and drawing["user_id"] is not None and drawing["user_id"] == user["id"])
    drawing.pop("user_id", None)

    return {
        "drawing": drawing,
        "heart_count": heart_count,
        "user_liked": user_liked,
        "is_own": is_own,
    }


# ===================== Reactions =====================

@app.post("/drawings/{drawing_id}/reaction")
def add_reaction(drawing_id: int, user=Depends(current_user)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM drawings WHERE id = %s", (drawing_id,))
            row = cur.fetchone()
            if not row:
                return JSONResponse({"error": "Dessin introuvable"}, 404)
            if row["user_id"] is not None and row["user_id"] == user["id"]:
                return JSONResponse(
                    {"error": "Tu ne peux pas liker ton propre dessin."},
                    403,
                )

            cur.execute(
                "DELETE FROM reactions WHERE user_id = %s AND emoji = 'like'",
                (user["id"],),
            )
            cur.execute(
                """INSERT INTO reactions (drawing_id, user_id, emoji)
                   VALUES (%s, %s, 'like')""",
                (drawing_id, user["id"]),
            )
            conn.commit()
    return {"status": "ok"}


@app.delete("/drawings/{drawing_id}/reaction")
def remove_reaction(drawing_id: int, user=Depends(current_user)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM reactions WHERE drawing_id = %s AND user_id = %s",
                (drawing_id, user["id"]),
            )
            conn.commit()
    return {"status": "ok"}


# ===================== Admin =====================

class DeleteRequest(BaseModel):
    ids: List[int]


@app.get("/admin/drawings", dependencies=[Depends(admin_auth)])
def get_all_drawings():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, image FROM drawings ORDER BY id DESC")
            rows = cur.fetchall()
    return {"drawings": rows}


@app.delete("/admin/drawings", dependencies=[Depends(admin_auth)])
def delete_drawings(data: DeleteRequest):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                "DELETE FROM drawings WHERE id = %s",
                [(i,) for i in data.ids],
            )
            conn.commit()
    return {"deleted": data.ids}


@app.delete("/admin/drawings/all", dependencies=[Depends(admin_auth)])
def delete_all_drawings():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM drawings")
            conn.commit()
    return {"status": "all_deleted"}


@app.get("/admin/users")
def get_all_users(admin=Depends(admin_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id,
                    u.username,
                    u.email,
                    u.created_at,
                    (SELECT COUNT(*) FROM drawings d WHERE d.user_id = u.id) AS drawing_count
                FROM users u
                ORDER BY u.created_at DESC
                """
            )
            rows = cur.fetchall()
    return {"users": rows, "admin_id": admin["id"]}


@app.delete("/admin/users/{user_id}")
def delete_user(user_id: int, admin=Depends(admin_auth)):
    if user_id == admin["id"]:
        return JSONResponse(
            {"error": "Tu ne peux pas supprimer ton propre compte admin."},
            400,
        )
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id = %s RETURNING id", (user_id,))
            deleted = cur.fetchone()
            conn.commit()
    if not deleted:
        return JSONResponse({"error": "Utilisateur introuvable"}, 404)
    return {"deleted": deleted["id"]}


# ===================== Admin – Contest =====================

# 10 seconds minimum so admins can't start something that's already over,
# 1 year maximum to keep things sane.
CONTEST_MIN_SECONDS = 10
CONTEST_MAX_SECONDS = 365 * 24 * 3600


class ContestStartIn(BaseModel):
    duration_seconds: int = Field(ge=CONTEST_MIN_SECONDS, le=CONTEST_MAX_SECONDS)


@app.get("/admin/contest", dependencies=[Depends(admin_auth)])
def admin_get_contest():
    _finalize_due_contest()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, started_at, ends_at, status FROM contests "
                "WHERE status = 'running' LIMIT 1"
            )
            row = cur.fetchone()
            cur.execute("SELECT COUNT(*) AS cnt FROM drawings")
            drawing_count = int(cur.fetchone()["cnt"])
    return {
        "contest": _serialize_contest(row),
        "drawing_count": drawing_count,
    }


@app.post("/admin/contest/start", dependencies=[Depends(admin_auth)])
def admin_start_contest(data: ContestStartIn):
    _finalize_due_contest()
    ends_at = datetime.now(timezone.utc) + timedelta(seconds=data.duration_seconds)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM contests WHERE status = 'running' LIMIT 1")
            if cur.fetchone():
                return JSONResponse(
                    {"error": "Un concours est déjà en cours. Annule-le ou clôture-le d'abord."},
                    409,
                )
            cur.execute(
                """
                INSERT INTO contests (ends_at, status)
                VALUES (%s, 'running')
                RETURNING id, started_at, ends_at, status
                """,
                (ends_at,),
            )
            contest = cur.fetchone()
            conn.commit()
    return {"contest": _serialize_contest(contest)}


@app.post("/admin/contest/cancel", dependencies=[Depends(admin_auth)])
def admin_cancel_contest():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE contests
                SET status = 'cancelled', finalized_at = NOW()
                WHERE status = 'running'
                RETURNING id
                """
            )
            row = cur.fetchone()
            conn.commit()
    if not row:
        return JSONResponse({"error": "Aucun concours en cours."}, 404)
    return {"cancelled": row["id"]}


@app.post("/admin/contest/close-now", dependencies=[Depends(admin_auth)])
def admin_close_contest_now():
    """Force the running contest's deadline to NOW(), then run the lazy finalizer."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE contests
                SET ends_at = NOW()
                WHERE status = 'running'
                RETURNING id
                """
            )
            row = cur.fetchone()
            conn.commit()
    if not row:
        return JSONResponse({"error": "Aucun concours en cours."}, 404)
    _finalize_due_contest()
    return {"closed": row["id"]}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
