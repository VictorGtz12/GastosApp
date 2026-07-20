from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.app.storage import DB_PATH, connect, import_supabase_export, load_export  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Migra un export JSON de Supabase a SQLite.")
    parser.add_argument(
        "--export",
        default=str(ROOT / "backups" / "supabase-full-export-20260719-213406.json"),
        help="Ruta del JSON exportado desde Supabase.",
    )
    parser.add_argument(
        "--db",
        default=str(DB_PATH),
        help="Ruta de salida de la base SQLite.",
    )
    parser.add_argument(
        "--admin-password",
        default=os.getenv("GASTOSAPP_ADMIN_PASSWORD"),
        help="Contraseña nueva para el usuario admin. Si se omite, genera una temporal.",
    )
    parser.add_argument("--replace", action="store_true", help="Borra la DB existente antes de migrar.")
    args = parser.parse_args()

    export_path = Path(args.export)
    db_path = Path(args.db)
    if not export_path.exists():
        raise SystemExit(f"No existe el export: {export_path}")
    if args.replace and db_path.exists():
        db_path.unlink()
        wal = db_path.with_suffix(db_path.suffix + "-wal")
        shm = db_path.with_suffix(db_path.suffix + "-shm")
        if wal.exists():
            wal.unlink()
        if shm.exists():
            shm.unlink()

    export = load_export(export_path)
    conn = connect(db_path)
    try:
        report = import_supabase_export(conn, export, admin_password=args.admin_password)
    finally:
        conn.close()

    print(json.dumps({"db": str(db_path), "report": report}, ensure_ascii=False, indent=2))
    if "admin_temp_password" in report:
        print("\nIMPORTANTE: se generó una contraseña temporal para el admin. Guárdala o vuelve a correr con --admin-password.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
