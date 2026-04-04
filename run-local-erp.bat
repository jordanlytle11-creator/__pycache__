@echo off
cd /d C:\Users\JordanLytle\local-erp
if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
) else (
    echo Create venv first: python -m venv .venv
    goto :eof
)
start "" http://127.0.0.1:8000
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
