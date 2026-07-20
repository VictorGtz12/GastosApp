from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("GASTOSAPP_DATA_DIR", ROOT_DIR / "backend" / "data"))
DB_PATH = Path(os.getenv("GASTOSAPP_DB_PATH", DATA_DIR / "gastosapp.sqlite"))
ADMIN_EMAIL = os.getenv("GASTOSAPP_ADMIN_EMAIL", "vedu.gutierrez@gmail.com").lower()
SESSION_DAYS = int(os.getenv("GASTOSAPP_SESSION_DAYS", "365"))


DATA_TABLES: dict[str, tuple[str, ...]] = {
    "gs_gastos": ("workspace_id", "id", "estado", "data", "updated_at", "updated_by_device", "deleted_at"),
    "gs_cuentas": ("workspace_id", "id", "data", "updated_at", "updated_by_device", "deleted_at"),
    "gs_catalogos": ("workspace_id", "id", "tipo", "valor", "data", "updated_at", "updated_by_device", "deleted_at"),
    "gs_cuentas_ahorro": ("workspace_id", "id", "data", "updated_at", "updated_by_device", "deleted_at"),
    "gs_movimientos_ahorro": ("workspace_id", "id", "cuenta_id", "mov_id", "data", "updated_at", "updated_by_device", "deleted_at"),
    "gs_recurrentes": ("workspace_id", "id", "data", "updated_at", "updated_by_device", "deleted_at"),
    "gs_deudas": ("workspace_id", "id", "data", "updated_at", "updated_by_device", "deleted_at"),
    "gs_app_settings": ("workspace_id", "id", "data", "updated_at", "updated_by_device", "deleted_at"),
    "gs_tasks": ("workspace_id", "id", "data", "updated_at", "updated_by_device", "deleted_at"),
    "gs_task_projects": ("workspace_id", "id", "data", "updated_at", "updated_by_device", "deleted_at"),
}

SNAPSHOT_TABLES = ("snapshots", "task_snapshots", "version_snapshots")
ALL_EXPORT_TABLES = (
    "app_users",
    "app_workspaces",
    "app_workspace_members",
    *DATA_TABLES.keys(),
    *SNAPSHOT_TABLES,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: Any) -> Any:
    if value is None or value == "":
        return None
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def connect(db_path: Path | str = DB_PATH) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys = on")
    conn.execute("pragma journal_mode = wal")
    conn.execute("pragma synchronous = normal")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        create table if not exists app_users (
          id text primary key,
          email text not null unique,
          display_name text,
          role text not null default 'user',
          password_hash text,
          password_salt text,
          password_set_at text,
          created_at text,
          updated_at text
        );

        create table if not exists app_workspaces (
          id text primary key,
          name text not null,
          created_by text,
          is_personal integer not null default 1,
          created_at text,
          updated_at text,
          foreign key(created_by) references app_users(id) on delete set null
        );

        create table if not exists app_workspace_members (
          workspace_id text not null,
          user_id text not null,
          role text not null default 'editor',
          created_at text,
          updated_at text,
          primary key (workspace_id, user_id),
          foreign key(workspace_id) references app_workspaces(id) on delete cascade,
          foreign key(user_id) references app_users(id) on delete cascade
        );

        create table if not exists auth_sessions (
          token text primary key,
          user_id text not null,
          created_at text not null,
          expires_at text not null,
          foreign key(user_id) references app_users(id) on delete cascade
        );

        create table if not exists migration_meta (
          key text primary key,
          value text not null
        );
        """
    )

    for table, columns in DATA_TABLES.items():
        extra_cols = []
        for col in columns:
            if col in {"workspace_id", "id"}:
                continue
            extra_cols.append(f"{col} text")
        conn.execute(
            f"""
            create table if not exists {table} (
              workspace_id text not null,
              id text not null,
              {",".join(extra_cols)},
              primary key (workspace_id, id),
              foreign key(workspace_id) references app_workspaces(id) on delete cascade
            )
            """
        )
        conn.execute(f"create index if not exists idx_{table}_updated_at on {table}(workspace_id, updated_at)")
        conn.execute(f"create index if not exists idx_{table}_deleted_at on {table}(workspace_id, deleted_at)")

    for table in SNAPSHOT_TABLES:
        conn.execute(
            f"""
            create table if not exists {table} (
              id text primary key,
              workspace_id text,
              data text,
              created_at text,
              updated_at text
            )
            """
        )

    conn.commit()


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    if not salt:
        salt = base64.urlsafe_b64encode(secrets.token_bytes(16)).decode("ascii")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 240_000)
    return base64.urlsafe_b64encode(digest).decode("ascii"), salt


def verify_password(password: str, password_hash: str | None, salt: str | None) -> bool:
    if not password_hash or not salt:
        return False
    digest, _ = hash_password(password, salt)
    return hmac.compare_digest(digest, password_hash)


def set_user_password(conn: sqlite3.Connection, user_id: str, password: str) -> None:
    password_hash, salt = hash_password(password)
    conn.execute(
        "update app_users set password_hash=?, password_salt=?, password_set_at=?, updated_at=? where id=?",
        (password_hash, salt, utc_now(), utc_now(), user_id),
    )


def create_session(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    token = "ga_" + secrets.token_urlsafe(36)
    now = utc_now()
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    expires_at = expires.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    conn.execute(
        "insert into auth_sessions(token,user_id,created_at,expires_at) values (?,?,?,?)",
        (token, user_id, now, expires_at),
    )
    user = get_user(conn, user_id)
    return {
        "access_token": token,
        "refresh_token": token,
        "token_type": "bearer",
        "expires_at": int(expires.timestamp()),
        "expires_in": SESSION_DAYS * 86400,
        "user": auth_user_payload(user),
    }


def get_user(conn: sqlite3.Connection, user_id: str) -> dict[str, Any] | None:
    row = conn.execute("select * from app_users where id=?", (user_id,)).fetchone()
    return dict(row) if row else None


def get_user_by_email(conn: sqlite3.Connection, email: str) -> dict[str, Any] | None:
    row = conn.execute("select * from app_users where lower(email)=lower(?)", (email,)).fetchone()
    return dict(row) if row else None


def auth_user_payload(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return None
    return {
        "id": user["id"],
        "email": user["email"],
        "user_metadata": {"display_name": user.get("display_name") or user["email"]},
        "app_metadata": {"role": user.get("role") or "user"},
    }


def session_user(conn: sqlite3.Connection, token: str) -> dict[str, Any] | None:
    row = conn.execute(
        """
        select u.* from auth_sessions s
        join app_users u on u.id = s.user_id
        where s.token = ? and s.expires_at > ?
        """,
        (token, utc_now()),
    ).fetchone()
    return dict(row) if row else None


def is_admin(user: dict[str, Any] | None) -> bool:
    return bool(user and ((user.get("role") == "admin") or (user.get("email") or "").lower() == ADMIN_EMAIL))


def workspace_role(conn: sqlite3.Connection, workspace_id: str, user_id: str) -> str | None:
    row = conn.execute(
        "select role from app_workspace_members where workspace_id=? and user_id=?",
        (workspace_id, user_id),
    ).fetchone()
    return row["role"] if row else None


def can_read_workspace(conn: sqlite3.Connection, user: dict[str, Any], workspace_id: str) -> bool:
    return is_admin(user) or workspace_role(conn, workspace_id, user["id"]) is not None


def can_write_workspace(conn: sqlite3.Connection, user: dict[str, Any], workspace_id: str) -> bool:
    if is_admin(user):
        return True
    return workspace_role(conn, workspace_id, user["id"]) in {"admin", "editor"}


def row_to_api(table: str, row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    raw = dict(row)
    if "data" in raw:
        raw["data"] = json_loads(raw.get("data"))
    if table in {"app_workspaces"}:
        raw["is_personal"] = bool(raw.get("is_personal"))
    return raw


def table_count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"select count(*) as c from {table}").fetchone()["c"])


def upsert_data_row(conn: sqlite3.Connection, table: str, row: dict[str, Any]) -> None:
    columns = DATA_TABLES[table]
    clean: dict[str, Any] = {}
    for col in columns:
        value = row.get(col)
        if col == "data":
            value = json_dumps(value or {})
        elif value is not None:
            value = str(value)
        clean[col] = value
    clean["updated_at"] = clean.get("updated_at") or utc_now()
    placeholders = ",".join("?" for _ in columns)
    updates = ",".join(f"{c}=excluded.{c}" for c in columns if c not in {"workspace_id", "id"})
    conn.execute(
        f"insert into {table}({','.join(columns)}) values ({placeholders}) "
        f"on conflict(workspace_id,id) do update set {updates}",
        tuple(clean[c] for c in columns),
    )


def soft_delete_data_row(conn: sqlite3.Connection, table: str, workspace_id: str, row: dict[str, Any]) -> None:
    deleted_at = row.get("deleted_at") or utc_now()
    conn.execute(
        f"update {table} set deleted_at=?, updated_at=?, updated_by_device=? where workspace_id=? and id=?",
        (deleted_at, deleted_at, row.get("updated_by_device"), workspace_id, str(row.get("id"))),
    )


def dedupe_rows(rows: list[dict[str, Any]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, ...], dict[str, Any]] = {}
    for row in rows or []:
        key = tuple(str(row.get(k) or "") for k in keys)
        existing = by_key.get(key)
        if not existing:
            by_key[key] = row
            continue
        row_ts = str(row.get("updated_at") or (row.get("data") or {}).get("updatedAt") or "")
        existing_ts = str(existing.get("updated_at") or (existing.get("data") or {}).get("updatedAt") or "")
        if row_ts >= existing_ts:
            by_key[key] = row
    return list(by_key.values())


def migration_report(conn: sqlite3.Connection, export: dict[str, Any] | None = None) -> dict[str, Any]:
    counts = {table: table_count(conn, table) for table in ALL_EXPORT_TABLES}
    expected = {}
    if export:
        expected = {table: len(export.get(table, [])) for table in ALL_EXPORT_TABLES}
    saldo_rows = conn.execute(
        "select data from gs_movimientos_ahorro where deleted_at is null"
    ).fetchall()
    saldo = 0.0
    for row in saldo_rows:
        data = json_loads(row["data"]) or {}
        amount = float(data.get("cantidad") or 0)
        saldo += amount if data.get("tipo") in {"abono", "traspaso-in"} else -amount
    return {
        "ok": all(counts.get(k) == expected.get(k, counts.get(k)) for k in counts),
        "counts": counts,
        "expected_counts": expected,
        "saldo_ahorro": round(saldo, 2),
        "generated_at": utc_now(),
    }
