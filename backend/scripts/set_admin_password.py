from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.app.storage import ADMIN_EMAIL, DB_PATH, connect, get_user_by_email, init_db, set_user_password  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Cambia la contraseña de un usuario en la DB SQLite de GastosApp.")
    parser.add_argument("--db", default=str(DB_PATH), help="Ruta de la DB SQLite.")
    parser.add_argument("--email", default=ADMIN_EMAIL, help="Correo del usuario.")
    parser.add_argument("--password", default=None, help="Nueva contraseña. Si se omite, se pide oculto.")
    args = parser.parse_args()

    password = args.password or getpass.getpass("Nueva contraseña: ")
    if len(password) < 8:
        raise SystemExit("Usa una contraseña de al menos 8 caracteres.")

    conn = connect(Path(args.db))
    try:
        init_db(conn)
        user = get_user_by_email(conn, args.email)
        if not user:
            raise SystemExit(f"No existe usuario con email: {args.email}")
        with conn:
            set_user_password(conn, user["id"], password)
    finally:
        conn.close()
    print(f"Contraseña actualizada para {args.email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
