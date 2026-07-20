from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

from .storage import (
    ALL_EXPORT_TABLES,
    ADMIN_EMAIL,
    DATA_TABLES,
    DB_PATH,
    ROOT_DIR,
    auth_user_payload,
    can_read_workspace,
    can_write_workspace,
    connect,
    create_session,
    dedupe_rows,
    get_user,
    get_user_by_email,
    init_db,
    is_admin,
    json_loads,
    migration_report,
    row_to_api,
    session_user,
    set_user_password,
    soft_delete_data_row,
    upsert_data_row,
    utc_now,
    verify_password,
)


app = FastAPI(title="GastosApp SQLite API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def db():
    conn = connect(DB_PATH)
    init_db(conn)
    try:
        yield conn
    finally:
        conn.close()


def bearer_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Falta sesión")
    return authorization.split(" ", 1)[1].strip()


def current_user(token: str = Depends(bearer_token), conn=Depends(db)) -> dict[str, Any]:
    user = session_user(conn, token)
    if not user:
        raise HTTPException(status_code=401, detail="Sesión inválida")
    return user


def parse_eq_filter(params: dict[str, str], field: str) -> str | None:
    value = params.get(field)
    if value and value.startswith("eq."):
        return value[3:]
    return None


def normalize_data_row(row: dict[str, Any], workspace_id: str | None = None) -> dict[str, Any]:
    clean = dict(row)
    if workspace_id and not clean.get("workspace_id"):
        clean["workspace_id"] = workspace_id
    return clean


@app.get("/api/health")
def health(conn=Depends(db)):
    return {"ok": True, "db": str(DB_PATH), "report": migration_report(conn)}


@app.post("/api/auth/login")
def login(payload: dict[str, Any], conn=Depends(db)):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    user = get_user_by_email(conn, email)
    if not user or not verify_password(password, user.get("password_hash"), user.get("password_salt")):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")
    with conn:
        return create_session(conn, user["id"])


@app.post("/api/auth/refresh")
def refresh(current=Depends(current_user), conn=Depends(db)):
    with conn:
        return create_session(conn, current["id"])


@app.get("/api/me")
def me(current=Depends(current_user)):
    return auth_user_payload(current)


@app.post("/api/me/ensure")
def ensure_me(current=Depends(current_user), conn=Depends(db)):
    return {"user": auth_user_payload(current), "workspaces": list_workspaces(current, conn)}


@app.get("/api/workspaces")
def list_workspaces(current=Depends(current_user), conn=Depends(db)):
    if is_admin(current):
        rows = conn.execute(
            "select id,name,is_personal,created_at,'admin' as role from app_workspaces order by created_at asc"
        ).fetchall()
    else:
        rows = conn.execute(
            """
            select w.id,w.name,w.is_personal,w.created_at,m.role
            from app_workspace_members m
            join app_workspaces w on w.id = m.workspace_id
            where m.user_id=?
            order by m.created_at asc
            """,
            (current["id"],),
        ).fetchall()
    return [row_to_api("app_workspaces", row) for row in rows]


@app.post("/api/admin/users")
def admin_create_user(payload: dict[str, Any], current=Depends(current_user), conn=Depends(db)):
    if not is_admin(current):
        raise HTTPException(status_code=403, detail="Solo admin")
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    name = payload.get("display_name") or payload.get("name") or email
    if not email or not password:
        raise HTTPException(status_code=400, detail="Correo y contraseña son obligatorios")
    user = get_user_by_email(conn, email)
    user_id = user["id"] if user else payload.get("id") or f"user_{email}"
    now = utc_now()
    role = payload.get("role") or ("admin" if email == ADMIN_EMAIL else "user")
    with conn:
        conn.execute(
            """
            insert into app_users(id,email,display_name,role,created_at,updated_at)
            values (?,?,?,?,?,?)
            on conflict(id) do update set
              email=excluded.email,
              display_name=excluded.display_name,
              role=excluded.role,
              updated_at=excluded.updated_at
            """,
            (user_id, email, name, role, now, now),
        )
        set_user_password(conn, user_id, password)
        workspace_id = payload.get("workspace_id") or f"ws_{user_id}"
        conn.execute(
            """
            insert or ignore into app_workspaces(id,name,created_by,is_personal,created_at,updated_at)
            values (?,?,?,?,?,?)
            """,
            (workspace_id, f"Base de {name or email}", user_id, 1, now, now),
        )
        conn.execute(
            """
            insert or ignore into app_workspace_members(workspace_id,user_id,role,created_at,updated_at)
            values (?,?,?,?,?)
            """,
            (workspace_id, user_id, "admin", now, now),
        )
    return {"ok": True, "user": auth_user_payload(get_user(conn, user_id))}


@app.get("/api/admin/sqlite-backup")
def admin_sqlite_backup(current=Depends(current_user), conn=Depends(db)):
    if not is_admin(current):
        raise HTTPException(status_code=403, detail="Solo admin")
    backup_dir = Path(tempfile.mkdtemp(prefix="gastosapp-backup-"))
    stamp = utc_now().replace(":", "-").replace(".", "-")
    backup_path = backup_dir / f"gastosapp-{stamp}.sqlite"
    dest = sqlite3.connect(backup_path)
    try:
        conn.backup(dest)
    finally:
        dest.close()
    return FileResponse(
        backup_path,
        media_type="application/vnd.sqlite3",
        filename=backup_path.name,
        background=BackgroundTask(lambda: shutil.rmtree(backup_dir, ignore_errors=True)),
    )


def get_workspace_or_403(conn, current, workspace_id: str, write: bool = False):
    allowed = can_write_workspace(conn, current, workspace_id) if write else can_read_workspace(conn, current, workspace_id)
    if not allowed:
        raise HTTPException(status_code=403, detail="Sin acceso a esta base")


@app.get("/api/sync/download")
def sync_download(workspace_id: str = Query(...), current=Depends(current_user), conn=Depends(db)):
    get_workspace_or_403(conn, current, workspace_id)
    tables: dict[str, list[dict[str, Any]]] = {}
    latest = ""
    for table in DATA_TABLES:
        rows = conn.execute(f"select * from {table} where workspace_id=? order by updated_at asc", (workspace_id,)).fetchall()
        api_rows = [row_to_api(table, row) for row in rows]
        tables[table] = api_rows
        for row in api_rows:
            latest = max(latest, str(row.get("updated_at") or ""))
    return {"workspace_id": workspace_id, "remoteLatest": latest or utc_now(), "tables": tables}


@app.post("/api/sync/upload")
def sync_upload(payload: dict[str, Any], current=Depends(current_user), conn=Depends(db)):
    workspace_id = payload.get("workspace_id")
    if not workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id requerido")
    get_workspace_or_403(conn, current, workspace_id, write=True)
    data = payload.get("payload") or {}
    deleted = payload.get("deleted") or {}
    map_keys = {
        "gastos": "gs_gastos",
        "cuentas": "gs_cuentas",
        "catalogos": "gs_catalogos",
        "cuentasAhorro": "gs_cuentas_ahorro",
        "movimientosAhorro": "gs_movimientos_ahorro",
        "recurrentes": "gs_recurrentes",
        "deudas": "gs_deudas",
    }
    counts: dict[str, int] = {}
    with conn:
        for key, table in map_keys.items():
            rows = dedupe_rows([normalize_data_row(r, workspace_id) for r in data.get(key, [])], ("workspace_id", "id"))
            for row in rows:
                upsert_data_row(conn, table, row)
            counts[table] = len(rows)
        if data.get("settings"):
            upsert_data_row(conn, "gs_app_settings", normalize_data_row(data["settings"], workspace_id))
            counts["gs_app_settings"] = 1
        for key, table in map_keys.items():
            rows = dedupe_rows([normalize_data_row(r, workspace_id) for r in deleted.get(key, [])], ("id",))
            for row in rows:
                soft_delete_data_row(conn, table, workspace_id, row)
    return {"ok": True, "counts": counts, "serverTime": utc_now()}


@app.api_route("/api/rest/{rest_path:path}", methods=["GET", "POST", "PATCH"])
async def mini_rest(rest_path: str, request: Request, current=Depends(current_user), conn=Depends(db)):
    table = rest_path.split("/", 1)[0]
    if table not in ALL_EXPORT_TABLES:
        raise HTTPException(status_code=404, detail="Tabla no encontrada")
    params = dict(request.query_params)

    if request.method == "GET":
        return rest_get(conn, current, table, params)

    body = await request.json()
    rows = body if isinstance(body, list) else [body]
    if request.method == "POST":
        return rest_post(conn, current, table, rows)
    if request.method == "PATCH":
        return rest_patch(conn, current, table, params, rows[0] if rows else {})
    raise HTTPException(status_code=405, detail="Método no soportado")


def rest_get(conn, current, table: str, params: dict[str, str]):
    if table == "app_workspaces":
        return list_workspaces(current, conn)
    if table == "app_workspace_members":
        rows = conn.execute(
            "select * from app_workspace_members where user_id=? order by created_at asc",
            (current["id"],),
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            workspace = conn.execute("select id,name,is_personal from app_workspaces where id=?", (row["workspace_id"],)).fetchone()
            if workspace:
                item["app_workspaces"] = row_to_api("app_workspaces", workspace)
            result.append(item)
        return result
    if table == "app_users":
        if is_admin(current):
            return [row_to_api(table, row) for row in conn.execute("select id,email,display_name,role,created_at,updated_at from app_users").fetchall()]
        return [auth_user_payload(current)]
    if table not in DATA_TABLES:
        return []
    workspace_id = parse_eq_filter(params, "workspace_id") or params.get("workspace_id") or ""
    if not workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id requerido")
    get_workspace_or_403(conn, current, workspace_id)
    sql = f"select * from {table} where workspace_id=?"
    args: list[Any] = [workspace_id]
    row_id = parse_eq_filter(params, "id")
    if row_id:
        sql += " and id=?"
        args.append(row_id)
    sql += " order by updated_at asc"
    rows = conn.execute(sql, args).fetchall()
    limit = params.get("limit")
    if limit and limit.isdigit():
        rows = rows[: int(limit)]
    return [row_to_api(table, row) for row in rows]


def rest_post(conn, current, table: str, rows: list[dict[str, Any]]):
    now = utc_now()
    with conn:
        if table == "app_users":
            for row in rows:
                target_id = str(row.get("id") or current["id"])
                if target_id != current["id"] and not is_admin(current):
                    raise HTTPException(status_code=403, detail="Sin permiso")
                conn.execute(
                    """
                    insert into app_users(id,email,display_name,role,created_at,updated_at)
                    values (?,?,?,?,?,?)
                    on conflict(id) do update set
                      email=excluded.email,
                      display_name=excluded.display_name,
                      role=excluded.role,
                      updated_at=excluded.updated_at
                    """,
                    (
                        target_id,
                        row.get("email") or current["email"],
                        row.get("display_name") or row.get("email") or "",
                        row.get("role") or current.get("role") or "user",
                        row.get("created_at") or now,
                        row.get("updated_at") or now,
                    ),
                )
            return {"ok": True}
        if table == "app_workspaces":
            for row in rows:
                if not is_admin(current) and row.get("created_by") != current["id"]:
                    raise HTTPException(status_code=403, detail="Sin permiso")
                conn.execute(
                    """
                    insert into app_workspaces(id,name,created_by,is_personal,created_at,updated_at)
                    values (?,?,?,?,?,?)
                    on conflict(id) do update set
                      name=excluded.name,
                      updated_at=excluded.updated_at
                    """,
                    (row["id"], row.get("name") or "Base sin nombre", row.get("created_by") or current["id"], 1 if row.get("is_personal") else 0, row.get("created_at") or now, row.get("updated_at") or now),
                )
            return {"ok": True}
        if table == "app_workspace_members":
            for row in rows:
                workspace_id = row["workspace_id"]
                if not can_write_workspace(conn, current, workspace_id):
                    raise HTTPException(status_code=403, detail="Sin permiso")
                conn.execute(
                    """
                    insert into app_workspace_members(workspace_id,user_id,role,created_at,updated_at)
                    values (?,?,?,?,?)
                    on conflict(workspace_id,user_id) do update set role=excluded.role, updated_at=excluded.updated_at
                    """,
                    (workspace_id, row["user_id"], row.get("role") or "editor", row.get("created_at") or now, row.get("updated_at") or now),
                )
            return {"ok": True}
        if table in DATA_TABLES:
            for row in dedupe_rows(rows, ("workspace_id", "id")):
                workspace_id = row.get("workspace_id")
                if not workspace_id:
                    raise HTTPException(status_code=400, detail="workspace_id requerido")
                get_workspace_or_403(conn, current, workspace_id, write=True)
                upsert_data_row(conn, table, row)
            return {"ok": True}
    return {"ok": True}


def rest_patch(conn, current, table: str, params: dict[str, str], row: dict[str, Any]):
    if table not in DATA_TABLES:
        raise HTTPException(status_code=400, detail="PATCH solo para tablas de datos")
    workspace_id = parse_eq_filter(params, "workspace_id")
    row_id = parse_eq_filter(params, "id")
    if not workspace_id or not row_id:
        raise HTTPException(status_code=400, detail="workspace_id e id requeridos")
    get_workspace_or_403(conn, current, workspace_id, write=True)
    allowed = {k: v for k, v in row.items() if k in DATA_TABLES[table] and k not in {"workspace_id", "id", "data"}}
    if not allowed:
        return {"ok": True}
    sets = ",".join(f"{k}=?" for k in allowed)
    with conn:
        conn.execute(
            f"update {table} set {sets} where workspace_id=? and id=?",
            (*allowed.values(), workspace_id, row_id),
        )
    return {"ok": True}


@app.get("/{path:path}")
def static_frontend(path: str):
    target = ROOT_DIR / path
    if path and target.exists() and target.is_file() and "backend" not in target.parts:
        return FileResponse(target)
    return FileResponse(ROOT_DIR / "index.html")
