# SuiteCRM Live Spike Runbook

## Current Branch
- `spike/suitecrm-base-eval`

## What Is Already Ready
- Render deployment config exists in `render.yaml`.
- Local app boot succeeds with the current spike changes.
- SuiteCRM admin endpoints exist:
  - `GET /admin/suitecrm/health`
  - `GET /admin/suitecrm/sample-read`
  - `GET /admin/suitecrm/sync-record/{record_id}/dry-run`
  - `POST /admin/suitecrm/sync-record/{record_id}`
  - `GET /admin/suitecrm/sync-log-tail`
- Default startup admin exists if no admin user is present:
  - email: `admin@localerp.com`
  - password: `admin`

## Remaining Steps To Reach A Live Spike
1. Commit the spike changes on `spike/suitecrm-base-eval`.
2. Push the branch to the GitHub remote connected to Render.
3. In Render, deploy the branch or merge it into the branch Render is tracking.
4. Set the required Render environment variables:
   - `LOCAL_ERP_SECRET_KEY`
   - `DATABASE_URL` (already sourced from Render Postgres in `render.yaml`)
   - `LOCAL_ERP_DB_PATH` (already set in `render.yaml`)
   - `LOCAL_ERP_WORKBOOK_PATH` (already set in `render.yaml`)
   - `LOCAL_ERP_ADMIN_EMAIL`
   - `LOCAL_ERP_SUITECRM_BASE_URL`
   - `LOCAL_ERP_SUITECRM_USERNAME`
   - `LOCAL_ERP_SUITECRM_PASSWORD`
   - `LOCAL_ERP_APP_URL` set to the Render app base URL
5. Wait for the Render deploy to complete successfully.
6. Log in with an admin account and obtain a bearer token.
7. Run the smoke test script:
   - `docs/suitecrm-smoke-test.ps1`
8. Run the go/no-go validation script:
   - `docs/suitecrm-go-no-go.ps1`
9. Manually complete the two checks the script does not fully prove:
   - mapping fidelity for 10 records
   - rollback safety by disabling SuiteCRM env vars and re-checking route behavior
10. Fill in the sign-off section in `docs/suitecrm-go-no-go-checklist.md`.

## Login And Token Retrieval
Use the deployed base URL in place of `<APP_URL>`.

```powershell
$body = @{ username = 'admin@localerp.com'; password = 'admin' }
$tokenResponse = Invoke-RestMethod -Method Post -Uri '<APP_URL>/token' -Body $body
$tokenResponse.access_token
```

If you already have a real admin account in production data, use that instead of the default seeded credentials.

## Recommended Deploy Order
1. Push the spike branch as-is.
2. Deploy to Render with SuiteCRM env vars set.
3. Verify `/docs` loads.
4. Obtain an admin token.
5. Run `suitecrm-smoke-test.ps1`.
6. Run `suitecrm-go-no-go.ps1`.
7. Perform manual mapping and rollback checks.
8. Mark GO or NO-GO.

## Notes
- The bcrypt pin in `requirements.txt` is defensive for Render reproducibility. The local environment is already on a compatible bcrypt version.
- The current app emits a Pydantic v2 warning about `orm_mode`. That is not a spike blocker, but it should be cleaned up separately.
- If Render is tracking a different branch than the spike branch, either change the tracked branch or merge the spike after validation.