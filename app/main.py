from fastapi import FastAPI, Depends, Response, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pathlib import Path
from typing import List
from contextlib import asynccontextmanager
import uvicorn
import os
import re

from .database import init_db, get_connection
from .auth import (
    admin_auth,
    current_user,
    optional_user,
    hash_password,
    verify_password,
    create_session,
    delete_session,
)

BASE_DIR = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


# ===================== Auth endpoints =====================

class RegisterIn(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    email: str
    password: str = Field(min_length=4, max_length=128)


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/auth/register")
def register(data: RegisterIn, response: Response):
    username = data.username.strip()
    email = data.email.strip().lower()

    if not re.match(r"^[a-zA-Z0-9_-]+$", username):
        return JSONResponse({"error": "Caractères autorisés: lettres, chiffres, _ et -"}, 400)
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return JSONResponse({"error": "Email invalide"}, 400)

    pw_hash = hash_password(data.password)

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (username, email, password_hash) VALUES (%s, %s, %s) RETURNING id, username, email",
                    (username, email, pw_hash),
                )
                user = cur.fetchone()
                conn.commit()
    except Exception:
        return JSONResponse({"error": "Ce nom d'utilisateur ou cet email est déjà pris"}, 409)

    create_session(user["id"], response)
    return {"user": {"id": user["id"], "username": user["username"], "email": user["email"]}}


@app.post("/auth/login")
def login(data: LoginIn, response: Response):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, email, password_hash FROM users WHERE username = %s",
                (data.username.strip(),),
            )
            user = cur.fetchone()

    if not user or not verify_password(data.password, user["password_hash"]):
        return JSONResponse({"error": "Identifiants incorrects"}, 401)

    create_session(user["id"], response)
    return {"user": {"id": user["id"], "username": user["username"], "email": user["email"]}}


@app.post("/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        delete_session(token, response)
    return {"status": "ok"}


@app.get("/auth/me")
def me(user=Depends(optional_user)):
    if not user:
        return {"user": None}
    return {"user": {"id": user["id"], "username": user["username"], "email": user["email"]}}


# ===================== Pages =====================

@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/auth")
def auth_page():
    return FileResponse(BASE_DIR / "static" / "auth.html")


@app.get("/admin")
def admin_page():
    return FileResponse(BASE_DIR / "static" / "admin.html")


# ===================== Drawings =====================

class DrawingIn(BaseModel):
    image: str


@app.post("/drawings")
def save_drawing(data: DrawingIn, user=Depends(current_user)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO drawings (image, user_id) VALUES (%s, %s)",
                (data.image, user["id"]),
            )
            conn.commit()
    return {"status": "ok"}


@app.get("/drawings")
def list_drawings():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT d.id, d.image, d.created_at,
                       u.username AS author,
                       (SELECT COUNT(*) FROM reactions r WHERE r.drawing_id = d.id AND r.emoji = 'like') AS heart_count,
                       (SELECT COUNT(*) FROM comments c WHERE c.drawing_id = d.id) AS comment_count
                FROM drawings d
                LEFT JOIN users u ON d.user_id = u.id
                ORDER BY d.id DESC
            """)
            rows = cur.fetchall()
    return {"drawings": rows}


@app.get("/leaderboard")
def get_leaderboard():
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


@app.get("/top-liked")
def get_top_liked():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    d.id,
                    d.image,
                    d.created_at,
                    u.username AS author,
                    COUNT(r.id) AS like_count
                FROM drawings d
                LEFT JOIN users u ON d.user_id = u.id
                LEFT JOIN reactions r ON r.drawing_id = d.id AND r.emoji = 'like'
                GROUP BY d.id, d.image, d.created_at, u.username
                ORDER BY like_count DESC, d.created_at DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()

    if not row:
        return {"top": None}

    return {
        "top": {
            "id": row["id"],
            "image": row["image"],
            "author": row["author"],
            "like_count": row["like_count"],
        }
    }


@app.get("/drawings/{drawing_id}")
def get_drawing(drawing_id: int, user=Depends(optional_user)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT d.id, d.image, d.created_at, u.username AS author
                FROM drawings d LEFT JOIN users u ON d.user_id = u.id
                WHERE d.id = %s
            """, (drawing_id,))
            drawing = cur.fetchone()

            if not drawing:
                return JSONResponse({"error": "Dessin introuvable"}, 404)

            # Heart count for this drawing
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM reactions WHERE drawing_id = %s AND emoji = 'like'",
                (drawing_id,),
            )
            heart_row = cur.fetchone()
            heart_count = int(heart_row["cnt"]) if heart_row else 0

            # Current user's heart
            user_liked = False
            if user:
                cur.execute(
                    "SELECT 1 FROM reactions WHERE drawing_id = %s AND user_id = %s AND emoji = 'like'",
                    (drawing_id, user["id"]),
                )
                user_liked = cur.fetchone() is not None

            # Comments
            cur.execute("""
                SELECT c.id, c.content, c.created_at, u.username
                FROM comments c JOIN users u ON c.user_id = u.id
                WHERE c.drawing_id = %s ORDER BY c.created_at ASC
            """, (drawing_id,))
            comments = cur.fetchall()

    return {
        "drawing": drawing,
        "heart_count": heart_count,
        "user_liked": user_liked,
        "comments": comments,
    }


# ===================== Reactions =====================

@app.post("/drawings/{drawing_id}/reaction")
def add_reaction(drawing_id: int, user=Depends(current_user)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO reactions (drawing_id, user_id, emoji)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (drawing_id, user_id)
                   DO UPDATE SET emoji = EXCLUDED.emoji""",
                (drawing_id, user["id"], "like"),
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


# ===================== Comments =====================

class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=500)


@app.post("/drawings/{drawing_id}/comments")
def add_comment(drawing_id: int, data: CommentIn, user=Depends(current_user)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO comments (drawing_id, user_id, content) VALUES (%s, %s, %s) RETURNING id, content, created_at",
                (drawing_id, user["id"], data.content.strip()),
            )
            comment = cur.fetchone()
            conn.commit()
    return {"comment": {**comment, "username": user["username"]}}


@app.get("/drawings/{drawing_id}/comments")
def list_comments(drawing_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT c.id, c.content, c.created_at, u.username
                FROM comments c JOIN users u ON c.user_id = u.id
                WHERE c.drawing_id = %s ORDER BY c.created_at ASC
            """, (drawing_id,))
            rows = cur.fetchall()
    return {"comments": rows}


# ===================== Admin (unchanged) =====================

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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
