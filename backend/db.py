import sqlite3
from typing import Any
from pathlib import Path


DB_PATH = Path(__file__).resolve().parent / "jobs.db"


def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                status TEXT,
                input_r2_key TEXT,
                output_fbx_key TEXT,
                output_mp4_key TEXT,
                error TEXT,
                created_at TEXT
            )
            """
        )
        conn.commit()


def create_job(job_id: str, input_r2_key: str, status: str, created_at: str) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO jobs (job_id, status, input_r2_key, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (job_id, status, input_r2_key, created_at),
        )
        conn.commit()


def get_job(job_id: str) -> dict[str, Any] | None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT job_id, status, input_r2_key, output_fbx_key, output_mp4_key, error, created_at
            FROM jobs
            WHERE job_id = ?
            """,
            (job_id,),
        ).fetchone()

    if row is None:
        return None

    return dict(row)


def update_job_status(job_id: str, status: str) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            UPDATE jobs
            SET status = ?
            WHERE job_id = ?
            """,
            (status, job_id),
        )
        conn.commit()


def update_job_error(job_id: str, error: str) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            UPDATE jobs
            SET error = ?
            WHERE job_id = ?
            """,
            (error, job_id),
        )
        conn.commit()


def update_job_output_fbx_key(job_id: str, output_fbx_key: str) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            UPDATE jobs
            SET output_fbx_key = ?
            WHERE job_id = ?
            """,
            (output_fbx_key, job_id),
        )
        conn.commit()
