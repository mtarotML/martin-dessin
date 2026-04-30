import os
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")


def get_connection():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL manquant. Configure-le (via .env ou variables d'environnement)."
        )
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def init_db():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(40) UNIQUE NOT NULL,
                    email VARCHAR(254) UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    google_id TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT")
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key "
                "ON users (google_id) WHERE google_id IS NOT NULL"
            )

            cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    session_token VARCHAR(128) UNIQUE NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS google_pending_signups (
                    token VARCHAR(128) PRIMARY KEY,
                    google_id TEXT NOT NULL,
                    email VARCHAR(254) NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS google_pending_signups_expires_idx "
                "ON google_pending_signups (expires_at)"
            )

            cur.execute("""
                CREATE TABLE IF NOT EXISTS drawings (
                    id SERIAL PRIMARY KEY,
                    image TEXT NOT NULL,
                    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS reactions (
                    id SERIAL PRIMARY KEY,
                    drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    emoji VARCHAR(32) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(drawing_id, user_id)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS comments (
                    id SERIAL PRIMARY KEY,
                    drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    content VARCHAR(500) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS contests (
                    id SERIAL PRIMARY KEY,
                    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    ends_at TIMESTAMP NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'running',
                    finalized_at TIMESTAMP
                )
            """)
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS contests_one_running_idx "
                "ON contests (status) WHERE status = 'running'"
            )

            cur.execute("""
                CREATE TABLE IF NOT EXISTS contest_winners (
                    id SERIAL PRIMARY KEY,
                    contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
                    image TEXT NOT NULL,
                    author_username VARCHAR(40),
                    like_count INTEGER NOT NULL DEFAULT 0,
                    archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS contest_winners_archived_idx "
                "ON contest_winners (archived_at DESC)"
            )

            conn.commit()
