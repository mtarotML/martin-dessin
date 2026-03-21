import os
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException, Response, Request
from dotenv import load_dotenv

from .database import get_connection

load_dotenv()

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")
SESSION_MAX_AGE_DAYS = 30


def admin_auth(x_admin_token: str = Header(...)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


# --------------- password helpers ---------------

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return f"{salt}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt, expected = stored.split("$", 1)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return secrets.compare_digest(h.hex(), expected)


# --------------- session helpers ---------------

def create_session(user_id: int, response: Response) -> str:
    token = secrets.token_hex(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_MAX_AGE_DAYS)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO sessions (user_id, session_token, expires_at) VALUES (%s, %s, %s)",
                (user_id, token, expires),
            )
            conn.commit()

    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_MAX_AGE_DAYS * 86400,
    )
    return token


def delete_session(token: str, response: Response):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE session_token = %s", (token,))
            conn.commit()
    response.delete_cookie("session_token")


# --------------- FastAPI dependencies ---------------

def current_user(request: Request):
    """Require a logged-in user. Raises 401 otherwise."""
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Non connecté")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT u.id, u.username, u.email
                   FROM sessions s JOIN users u ON s.user_id = u.id
                   WHERE s.session_token = %s AND s.expires_at > NOW()""",
                (token,),
            )
            user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="Session invalide")
    return user


def optional_user(request: Request):
    """Return user dict or None (no 401)."""
    token = request.cookies.get("session_token")
    if not token:
        return None

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT u.id, u.username, u.email
                   FROM sessions s JOIN users u ON s.user_id = u.id
                   WHERE s.session_token = %s AND s.expires_at > NOW()""",
                (token,),
            )
            return cur.fetchone()
