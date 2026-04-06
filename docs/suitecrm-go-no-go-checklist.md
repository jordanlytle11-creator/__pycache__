# SuiteCRM Go/No-Go Checklist

## Decision Gate
- Scope: Evaluate whether SuiteCRM should become the integration base for Local ERP CRM sync.
- Environment: Run all checks in spike branch only.
- Exit rule: Do not merge spike to main unless all required checks pass.

## Required Checks
- Authentication reliability: 10 consecutive `/admin/suitecrm/health` checks return connected=true.
- Read reliability: 10 consecutive `/admin/suitecrm/sample-read` calls return HTTP 200.
- Write reliability: 20 record sync attempts return >= 95% success.
- Idempotency: Re-syncing the same local record updates existing SuiteCRM record, no duplicate created.
- Mapping fidelity: Spot-check at least 10 records and verify key fields (last_name, title, description, source_description).
- Auditability: `/admin/suitecrm/sync-log-tail` includes success and error events with local_record_id.
- Rollback safety: Disabling SuiteCRM env vars fully disables the integration routes without breaking existing CRM routes.

## Optional Checks
- Throughput: 100 sync operations complete within acceptable timing for business usage.
- Permission boundary: Non-admin users cannot call suitecrm admin endpoints.
- Data hygiene: Missing optional fields do not cause sync failure.

## Final Decision
- GO: All required checks pass and no blocker defects remain.
- NO-GO: Any required check fails or unresolved blocker exists.

## Sign-Off Template
- Date:
- Evaluator:
- Branch:
- Result (GO/NO-GO):
- Notes:
