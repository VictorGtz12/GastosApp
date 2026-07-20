from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.app.storage import connect, dedupe_rows, init_db, migration_report, upsert_data_row, utc_now


def seed_workspace(conn):
    now = utc_now()
    conn.execute(
        "insert into app_users(id,email,display_name,role,created_at,updated_at) values (?,?,?,?,?,?)",
        ("user_admin", "vedu.gutierrez@gmail.com", "Victor", "admin", now, now),
    )
    conn.execute(
        "insert into app_workspaces(id,name,created_by,is_personal,created_at,updated_at) values (?,?,?,?,?,?)",
        ("ws_main", "Base Victor", "user_admin", 1, now, now),
    )
    conn.execute(
        "insert into app_workspace_members(workspace_id,user_id,role,created_at,updated_at) values (?,?,?,?,?)",
        ("ws_main", "user_admin", "admin", now, now),
    )
    conn.commit()
    return "ws_main"


class SQLiteStorageTests(unittest.TestCase):
    def test_schema_starts_empty_and_healthy(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = connect(Path(tmp) / "gastosapp.sqlite")
            try:
                init_db(conn)
                report = migration_report(conn)
                self.assertTrue(report["ok"], report)
                self.assertEqual(report["counts"]["gs_gastos"], 0)
                self.assertEqual(report["counts"]["gs_movimientos_ahorro"], 0)
            finally:
                conn.close()

    def test_duplicate_rows_keep_latest_before_upsert(self):
        rows = [
            {"workspace_id": "w1", "id": "1", "data": {"v": 1}, "updated_at": "2026-01-01T00:00:00Z"},
            {"workspace_id": "w1", "id": "1", "data": {"v": 2}, "updated_at": "2026-01-02T00:00:00Z"},
        ]
        deduped = dedupe_rows(rows, ("workspace_id", "id"))
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["data"]["v"], 2)

    def test_sqlite_upsert_updates_existing_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = connect(Path(tmp) / "gastosapp.sqlite")
            try:
                init_db(conn)
                workspace_id = seed_workspace(conn)
                upsert_data_row(
                    conn,
                    "gs_gastos",
                    {
                        "workspace_id": workspace_id,
                        "id": "test-gasto",
                        "estado": "activo",
                        "data": {"fecha": "2026-07-19", "cuenta": "Test", "motivo": "Test", "cantidad": 1},
                        "updated_at": "2026-07-19T00:00:00Z",
                    },
                )
                upsert_data_row(
                    conn,
                    "gs_gastos",
                    {
                        "workspace_id": workspace_id,
                        "id": "test-gasto",
                        "estado": "activo",
                        "data": {"fecha": "2026-07-19", "cuenta": "Test", "motivo": "Test", "cantidad": 2},
                        "updated_at": "2026-07-19T00:01:00Z",
                    },
                )
                row = conn.execute(
                    "select data from gs_gastos where workspace_id=? and id=?",
                    (workspace_id, "test-gasto"),
                ).fetchone()
                self.assertIn('"cantidad":2', row["data"])
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
