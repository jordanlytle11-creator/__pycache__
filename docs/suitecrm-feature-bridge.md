# SuiteCRM Feature Bridge into Local ERP Schema

This project now supports a stronger SuiteCRM integration model so SuiteCRM functionality can be used as an extension of the Local ERP CRM schema.

## What is now integrated

- Admin UI page: `SuiteCRM Hub` (in the main app sidebar)
- Embedded SuiteCRM UI view in-app (iframe)
- SuiteCRM connection/config introspection endpoint
- Batch sync endpoint to push multiple selected CRM rows at once
- Automatic SuiteCRM 8 fallback handling:
  - Tries `/service/v4_1/rest.php`
  - Falls back to `/legacy/service/v4_1/rest.php` when needed

## New API endpoints

- `GET /admin/suitecrm/config`
  - Returns `configured`, `connected`, `ui_url`, `rest_url`, `mapping_path`, `suggested_modules`
- `POST /admin/suitecrm/sync-batch`
  - Request body:
    - `record_ids`: list of Local ERP CRM record IDs
    - `module`: target SuiteCRM module (default `Leads`)
  - Response includes per-record success/error details

## How this maps to your overall schema

Your Local ERP `crm_records` remains the source model. SuiteCRM receives transformed records through mapping templates.

Recommended layering:

1. Keep Local ERP as canonical schema for internal workflows.
2. Use module-level sync in SuiteCRM for outbound feature expansion:
   - `Leads` for top-of-funnel
   - `Contacts` + `Accounts` for relationship management
   - `Opportunities` for pipeline
   - `Cases`/`Tasks` for service and work management
3. Extend mapping JSON (`app/suitecrm_field_mapping.json`) per target module.
4. Run batch sync from SuiteCRM Hub after selecting records in CRM Records view.

## UI workflow

1. Open `CRM Records` and select rows.
2. Open `SuiteCRM Hub`.
3. Pick module and run:
   - `Refresh Health`
   - `Sample Read`
   - `Sync Selected CRM Rows`
4. Use `Open SuiteCRM UI` or embedded frame for immediate verification.

## Next feature expansion (recommended)

- Add module-specific mapping profiles (per module instead of one global map).
- Add inbound sync endpoints (SuiteCRM -> Local ERP) for selected modules.
- Add conflict-resolution policy (`local_wins`, `suitecrm_wins`, `timestamp_wins`).
- Add scheduled sync jobs with retry queue and dead-letter handling.
