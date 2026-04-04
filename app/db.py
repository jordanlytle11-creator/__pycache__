from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from pathlib import Path
import os

default_db_path = Path(__file__).resolve().parents[1] / "local_erp.db"
# On Render, prefer /var/data so SQLite can persist when a disk is attached.
if os.getenv("RENDER"):
	default_db_path = Path("/var/data/local_erp.db")

db_path = Path(os.getenv("LOCAL_ERP_DB_PATH", str(default_db_path)))
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{db_path}")

engine_kwargs = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
	engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(SQLALCHEMY_DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
