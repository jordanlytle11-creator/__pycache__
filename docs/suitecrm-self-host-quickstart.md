# SuiteCRM Self-Host Quickstart

This project can integrate with a self-hosted SuiteCRM instance (open source, no paid SuiteCRM hosting required).

## 1) Provision a Linux host
- Create an Ubuntu VPS with a public IP.
- Ensure ports 80 and 443 are reachable.

## 2) Copy scripts from this repo
- Directory: `scripts/suitecrm`

## 3) Install Docker on VPS
- Run as root on VPS:

```bash
bash scripts/suitecrm/setup-ubuntu.sh
```

## 4) Configure and start SuiteCRM
- On VPS:

```bash
mkdir -p /opt/local-erp-suitecrm
cd /opt/local-erp-suitecrm
cp /path/to/repo/scripts/suitecrm/docker-compose.yml .
cp /path/to/repo/scripts/suitecrm/.env.example .env
nano .env
docker compose up -d
```

## 5) Verify SuiteCRM REST endpoint
- From your local PowerShell:

```powershell
& "C:\Users\JordanLytle\local-erp\scripts\suitecrm\verify-suitecrm-endpoint.ps1" -SuiteCrmBaseUrl "https://your-suitecrm-host"
```

The endpoint should resolve at:
- `https://your-suitecrm-host/service/v4_1/rest.php`

## 6) Set Render environment variables
Set these on your Render web service:
- `LOCAL_ERP_SUITECRM_BASE_URL=https://your-suitecrm-host`
- `LOCAL_ERP_SUITECRM_USERNAME=<suitecrm-username>`
- `LOCAL_ERP_SUITECRM_PASSWORD=<suitecrm-password>`

Do not include `/service/v4_1/rest.php` in `LOCAL_ERP_SUITECRM_BASE_URL`.

## 7) Redeploy and verify integration
- Redeploy your app.
- Run:

```powershell
& "C:\Users\JordanLytle\local-erp\scripts\suitecrm\verify-live-integration.ps1" -ApiBase "https://www.vaquerocrm.com" -Username "admin@localerp.com" -Password "admin"
```

## Troubleshooting
- `SuiteCRM HTTP error 404`:
  - Base URL is wrong (host/path mismatch).
- `SuiteCRM HTTP error 307`:
  - SuiteCRM is redirecting; ensure canonical URL and redeploy latest branch.
- `configured=true, connected=false`:
  - Credentials or SuiteCRM URL still incorrect.