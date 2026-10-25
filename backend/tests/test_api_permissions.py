from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from backend.app import main as api
from backend.app.storage import connect, create_session, init_db, utc_now


class ApiPermissionsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.conn = connect(Path(self.directory.name) / "test.sqlite")
        init_db(self.conn)
        now = utc_now()
        for uid, role in [("owner", "user"), ("editor", "user"), ("viewer", "user"), ("other", "user")]:
            self.conn.execute("insert into app_users(id,email,display_name,role,created_at,updated_at) values (?,?,?,?,?,?)", (uid, uid+"@example.test", uid, role, now, now))
        for wid, owner in [("one", "owner"), ("two", "other")]:
            self.conn.execute("insert into app_workspaces(id,name,created_by,is_personal,created_at,updated_at) values (?,?,?,?,?,?)", (wid, wid, owner, 1, now, now))
        for wid, uid, role in [("one", "owner", "admin"), ("one", "editor", "editor"), ("one", "viewer", "viewer"), ("two", "other", "admin")]:
            self.conn.execute("insert into app_workspace_members(workspace_id,user_id,role,created_at,updated_at) values (?,?,?,?,?)", (wid, uid, role, now, now))
        self.tokens = {uid: create_session(self.conn, uid)["access_token"] for uid in ["owner", "editor", "viewer", "other"]}
        self.conn.commit()
        def database():
            yield self.conn
        api.app.dependency_overrides[api.db] = database
        self.client = TestClient(api.app)

    def tearDown(self):
        self.client.close()
        api.app.dependency_overrides.clear()
        self.conn.close()
        self.directory.cleanup()

    def headers(self, user="editor"):
        return {"Authorization": "Bearer " + self.tokens[user]}

    def test_user_cannot_promote_own_global_role(self):
        response = self.client.post("/api/rest/app_users", headers=self.headers(), json=[{"id":"editor", "role":"admin"}])
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.conn.execute("select role from app_users where id='editor'").fetchone()[0], "user")

    def test_user_cannot_replace_identity_with_admin_email(self):
        response = self.client.post("/api/rest/app_users", headers=self.headers(), json=[{"id":"editor", "email":api.ADMIN_EMAIL}])
        self.assertEqual(response.status_code, 403)

    def test_editor_cannot_grant_memberships(self):
        response = self.client.post("/api/rest/app_workspace_members", headers=self.headers(), json=[{"workspace_id":"one", "user_id":"editor", "role":"admin"}])
        self.assertEqual(response.status_code, 403)

    def test_owner_can_create_first_membership_for_own_new_workspace(self):
        response = self.client.post("/api/rest/app_workspaces", headers=self.headers("owner"), json=[{"id":"new-space", "created_by":"owner", "name":"New"}])
        self.assertEqual(response.status_code, 200)
        response = self.client.post("/api/rest/app_workspace_members", headers=self.headers("owner"), json=[{"workspace_id":"new-space", "user_id":"owner", "role":"admin"}])
        self.assertEqual(response.status_code, 200)

    def test_user_cannot_rename_workspace_by_claiming_ownership(self):
        response = self.client.post("/api/rest/app_workspaces", headers=self.headers(), json=[{"id":"two", "created_by":"editor", "name":"Changed"}])
        self.assertEqual(response.status_code, 403)

    def test_upload_rejects_rows_for_another_workspace_atomically(self):
        response = self.client.post("/api/sync/upload", headers=self.headers(), json={"workspace_id":"one", "payload":{"gastos":[{"id":"ok", "workspace_id":"one", "data":{"cantidad":5}}, {"id":"bad", "workspace_id":"two", "data":{"cantidad":9}}]}})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.conn.execute("select count(*) from gs_gastos").fetchone()[0], 0)

    def test_upload_rejects_settings_for_another_workspace(self):
        response = self.client.post("/api/sync/upload", headers=self.headers(), json={"workspace_id":"one", "payload":{"settings":{"id":"main", "workspace_id":"two", "data":{"presupuesto":1}}}})
        self.assertEqual(response.status_code, 400)

    def test_viewer_can_read_but_cannot_upload(self):
        self.assertEqual(self.client.get("/api/sync/download?workspace_id=one", headers=self.headers("viewer")).status_code, 200)
        self.assertEqual(self.client.post("/api/sync/upload", headers=self.headers("viewer"), json={"workspace_id":"one", "payload":{}}).status_code, 403)

    def test_weekly_close_filter_ignores_historical_and_deleted_expenses(self):
        for uid, state, deleted in [("history", "historico", None), ("deleted", "activo", utc_now())]:
            self.conn.execute("insert into gs_gastos(workspace_id,id,estado,data,updated_at,deleted_at) values (?,?,?,?,?,?)", ("one", uid, state, "{}", utc_now(), deleted))
        self.conn.commit()
        response = self.client.get("/api/rest/gs_gastos?workspace_id=eq.one&estado=neq.historico&deleted_at=is.null&limit=1", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_private_files_and_paths_outside_root_are_never_public(self):
        root = Path(self.directory.name) / "public"
        root.mkdir()
        (root / "index.html").write_text("App")
        (root / "backups").mkdir()
        (root / "backups" / "private.json").write_text("private fixture")
        (root / ".git").mkdir()
        (root / ".git" / "config").write_text("private fixture")
        (root.parent / "private.txt").write_text("outside fixture")
        with patch.object(api, "ROOT_DIR", root):
            for name in ["backups/private.json", ".git/config", "../private.txt"]:
                with self.subTest(name=name):
                    with self.assertRaises(api.HTTPException) as error:
                        api.static_frontend(name)
                    self.assertEqual(error.exception.status_code, 404)

    def test_movement_filter_module_is_public_but_other_javascript_is_private(self):
        root = Path(self.directory.name) / "frontend"
        root.mkdir()
        source = "globalThis.MovementFilters = {};"
        (root / "movement-filters.js").write_text(source)
        (root / "private.js").write_text("private fixture")
        with patch.object(api, "ROOT_DIR", root):
            response = self.client.get("/movement-filters.js?v=20261025c")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.text, source)
            self.assertEqual(self.client.get("/private.js").status_code, 404)

    def test_task_pagination_applies_offset_after_filtering_and_ordering(self):
        rows = [{"id":str(i), "workspace_id":"one", "data":{"id":str(i),"titulo":"Fixture"}, "updated_at":utc_now()} for i in range(3)]
        self.assertEqual(self.client.post("/api/rest/gs_tasks", headers=self.headers(), json=rows).status_code, 200)
        response = self.client.get("/api/rest/gs_tasks?workspace_id=eq.one&order=id.asc&limit=2&offset=2", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json()], ["2"])
        self.assertEqual(self.client.get("/api/rest/gs_tasks?workspace_id=eq.one&offset=-1", headers=self.headers()).status_code, 400)


if __name__ == "__main__":
    unittest.main()
