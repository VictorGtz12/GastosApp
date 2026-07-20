from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.app.storage import (
    ALL_EXPORT_TABLES,
    connect,
    dedupe_rows,
    import_supabase_export,
    load_export,
    migration_report,
    upsert_data_row,
)


ROOT = Path(__file__).resolve().parents[2]
EXPORT_PATH = ROOT / "backups" / "supabase-full-export-20260719-213406.json"


class MigrationTests(unittest.TestCase):
    def test_supabase_export_imports_with_same_counts(self):
        export = load_export(EXPORT_PATH)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "gastosapp.sqlite"
            conn = connect(db_path)
            try:
                report = import_supabase_export(conn, export, admin_password="Temporal-test-123")
                self.assertTrue(report["ok"], report)
                for table in ALL_EXPORT_TABLES:
                    self.assertEqual(
                        report["counts"][table],
                        len(export.get(table, [])),
                        f"conteo distinto en {table}",
                    )
                self.assertEqual(report["saldo_ahorro"], migration_report(conn)["saldo_ahorro"])
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
        export = load_export(EXPORT_PATH)
        workspace_id = export["app_workspaces"][0]["id"]
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "gastosapp.sqlite"
            conn = connect(db_path)
            try:
                import_supabase_export(conn, export, admin_password="Temporal-test-123")
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
