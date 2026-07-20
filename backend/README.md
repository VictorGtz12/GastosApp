# GastosApp Backend SQLite

Backend FastAPI para correr GastosApp en tu servidor usando SQLite.

## Archivos Importantes

- DB local generada: `backend/data/gastosapp.sqlite`
- App FastAPI: `backend/app/main.py`
- Cambiar contraseña: `backend/scripts/set_admin_password.py`
- Service systemd ejemplo: `backend/gastosapp-api.service.example`

`backend/data/*.sqlite` está en `.gitignore`, así que al hacer `git pull` en el servidor la DB no viaja por git. Hay que subirla aparte.

## Cambiar Contraseña Admin

```bash
python3 backend/scripts/set_admin_password.py \
  --db backend/data/gastosapp.sqlite \
  --email vedu.gutierrez@gmail.com
```

## Comandos Para Vultr

Conéctate:

```bash
ssh root@45.76.0.95
```

Crea carpeta y baja el repo:

```bash
sudo mkdir -p /opt/gastosapp
sudo chown -R $USER:$USER /opt/gastosapp
cd /opt/gastosapp
git clone TU_REPO_GIT .
```

Si ya existe:

```bash
cd /opt/gastosapp
git pull
```

Instala dependencias:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
mkdir -p backend/data
```

Sube la DB desde tu PC Windows, en otra terminal:

```powershell
scp C:\Users\victo\OneDrive\Victor\Proyectos\GastosApp\backend\data\gastosapp.sqlite root@45.76.0.95:/opt/gastosapp/backend/data/gastosapp.sqlite
```

De vuelta en el servidor, da permiso de escritura al usuario del servicio:

```bash
sudo chown -R www-data:www-data /opt/gastosapp/backend/data
sudo chmod 750 /opt/gastosapp/backend/data
sudo chmod 640 /opt/gastosapp/backend/data/gastosapp.sqlite
```

Prueba manual:

```bash
cd /opt/gastosapp
source backend/.venv/bin/activate
uvicorn backend.app.main:app --host 0.0.0.0 --port 8010
```

Abre:

```text
http://45.76.0.95:8010
```

Si usas `ufw`:

```bash
sudo ufw allow 8010/tcp
```

En Vultr Firewall, agrega inbound TCP `8010` desde `0.0.0.0/0`.

## Systemd

```bash
sudo cp /opt/gastosapp/backend/gastosapp-api.service.example /etc/systemd/system/gastosapp-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now gastosapp-api
sudo systemctl status gastosapp-api
```

Logs:

```bash
journalctl -u gastosapp-api -f
```

## Sync

La app principal usa:

- `GET /api/sync/download?workspace_id=...`
- `POST /api/sync/upload`

Recordatorios usa el endpoint compatible:

- `/api/rest/gs_tasks`
- `/api/rest/gs_task_projects`

La app detecta automáticamente SQLite si se abre desde el puerto `8010`. Si la sirves desde otro lugar, en Ajustes pon:

```text
http://45.76.0.95:8010/api
```
