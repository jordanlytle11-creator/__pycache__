import hashlib
import json
import os
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class SuiteCrmError(Exception):
    pass


DEFAULT_SUITECRM_FIELD_MAPPING = {
    'last_name': '{{contact_or_company_or_record}}',
    'account_name': '{{company_or_none}}',
    'title': 'TRS {{trscode}}',
    'status': 'New',
    'lead_source': 'ERP',
    'lead_source_description': '{{status_or_none}}',
    'description': 'Local ERP Record ID: {{record_id}}\nTRS: {{trscode}}\nProject: {{project_or_unassigned}}\nStatus: {{status_or_no_contact}}',
    'phone_work': '{{extra_phone_or_none}}',
}


class SuiteCrmClient:
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = (base_url or '').rstrip('/')
        self.username = (username or '').strip()
        self.password = password or ''
        self.rest_url = f'{self.base_url}/service/v4_1/rest.php'
        self._session_id: Optional[str] = None

    def is_configured(self) -> bool:
        return bool(self.base_url and self.username and self.password)

    def _post(self, payload: dict) -> dict:
        encoded = urlencode(payload).encode('utf-8')
        req = Request(self.rest_url, data=encoded, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        try:
            with urlopen(req, timeout=20) as resp:
                body = resp.read().decode('utf-8')
        except HTTPError as exc:
            raise SuiteCrmError(f'SuiteCRM HTTP error {exc.code}: {exc.reason}') from exc
        except URLError as exc:
            raise SuiteCrmError(f'SuiteCRM network error: {exc.reason}') from exc
        except Exception as exc:
            raise SuiteCrmError(f'SuiteCRM request failed: {exc}') from exc
        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            raise SuiteCrmError(f'Invalid SuiteCRM response: {exc}') from exc
        if isinstance(data, dict) and data.get('name') == 'Invalid Login':
            raise SuiteCrmError('SuiteCRM login failed')
        return data

    def login(self) -> str:
        if self._session_id:
            return self._session_id

        if not self.is_configured():
            raise SuiteCrmError('SuiteCRM is not configured')

        password_hash = hashlib.md5(self.password.encode('utf-8')).hexdigest()
        payload = {
            'method': 'login',
            'input_type': 'JSON',
            'response_type': 'JSON',
            'rest_data': json.dumps(
                {
                    'user_auth': {
                        'user_name': self.username,
                        'password': password_hash,
                        'version': '1',
                    },
                    'application_name': 'local-erp-suitecrm-spike',
                    'name_value_list': [],
                }
            ),
        }
        data = self._post(payload)
        session_id = (data or {}).get('id')
        if not session_id:
            raise SuiteCrmError(f'Login failed: {data}')
        self._session_id = session_id
        return session_id

    def get_entry_list(self, module: str, max_results: int = 10, query: str = '') -> dict:
        session_id = self.login()
        payload = {
            'method': 'get_entry_list',
            'input_type': 'JSON',
            'response_type': 'JSON',
            'rest_data': json.dumps(
                {
                    'session': session_id,
                    'module_name': module,
                    'query': query,
                    'order_by': 'date_modified DESC',
                    'offset': 0,
                    'select_fields': [],
                    'link_name_to_fields_array': [],
                    'max_results': max(1, min(max_results, 50)),
                    'deleted': 0,
                    'favorites': False,
                }
            ),
        }
        return self._post(payload)

    def set_entry(self, module: str, fields: dict) -> dict:
        session_id = self.login()
        name_value_list = [{'name': key, 'value': value} for key, value in fields.items() if value is not None]
        payload = {
            'method': 'set_entry',
            'input_type': 'JSON',
            'response_type': 'JSON',
            'rest_data': json.dumps(
                {
                    'session': session_id,
                    'module_name': module,
                    'name_value_list': name_value_list,
                }
            ),
        }
        return self._post(payload)


def load_suitecrm_field_mapping(mapping_path: Optional[str] = None) -> dict[str, Any]:
    candidate_path = mapping_path or os.getenv('LOCAL_ERP_SUITECRM_FIELD_MAPPING_PATH', '')
    if not candidate_path:
        return dict(DEFAULT_SUITECRM_FIELD_MAPPING)

    path = Path(candidate_path)
    if not path.exists() or not path.is_file():
        return dict(DEFAULT_SUITECRM_FIELD_MAPPING)

    try:
        raw = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return dict(DEFAULT_SUITECRM_FIELD_MAPPING)

    if not isinstance(raw, dict):
        return dict(DEFAULT_SUITECRM_FIELD_MAPPING)

    mapping = dict(DEFAULT_SUITECRM_FIELD_MAPPING)
    for key, value in raw.items():
        if isinstance(key, str) and isinstance(value, str):
            mapping[key.strip()] = value
    return mapping


def _template_tokens(record, project_key: Optional[str]) -> dict[str, Any]:
    contact_value = (record.contact or '').strip()
    company_value = (record.company or '').strip()
    status_value = (record.status or '').strip()

    last_name = contact_value or company_value or f'Record-{record.id}'
    project_value = (project_key or '').strip() or 'unassigned'
    extra = record.extra_data if isinstance(record.extra_data, dict) else {}

    return {
        'record_id': record.id,
        'company': company_value,
        'contact': contact_value,
        'trscode': record.trscode,
        'status': status_value,
        'project': project_value,
        'contact_or_company_or_record': last_name,
        'company_or_none': company_value or None,
        'status_or_none': status_value or None,
        'status_or_no_contact': status_value or 'No Contact',
        'project_or_unassigned': project_value,
        'extra_phone_or_none': extra.get('phone') or None,
    }


def _render_template(template: str, tokens: dict[str, Any]) -> Optional[str]:
    value = template
    for token_name, token_value in tokens.items():
        placeholder = '{{' + token_name + '}}'
        if placeholder in value:
            value = value.replace(placeholder, '' if token_value is None else str(token_value))
    normalized = value.strip()
    return normalized or None


def map_crm_record_to_suitecrm_fields(record, project_key: Optional[str], mapping: Optional[dict[str, Any]] = None) -> dict:
    tokens = _template_tokens(record, project_key)
    selected_mapping = mapping or DEFAULT_SUITECRM_FIELD_MAPPING

    resolved: dict[str, Any] = {}
    for field_name, template in selected_mapping.items():
        if not isinstance(field_name, str) or not isinstance(template, str):
            continue
        resolved[field_name] = _render_template(template, tokens)

    if 'source_description' not in resolved or not resolved.get('source_description'):
        resolved['source_description'] = f'local_erp_record_id={record.id}'

    return {
        key: value for key, value in resolved.items() if value is not None
    }