from __future__ import annotations

import csv
import hashlib
import json
import logging
from datetime import date, datetime, time, timezone
from decimal import Decimal
from io import BytesIO, StringIO
from typing import Any
from uuid import UUID
from zipfile import ZIP_DEFLATED, ZipFile

from googleapiclient.http import MediaIoBaseUpload
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from src.config import config
from src.core.services.storage_service import storage_service
from src.data.models.postgres.system_setting import SystemSetting

logger = logging.getLogger(__name__)

BACKUP_CONFIG_KEY = "backup_config"
BACKUP_LAST_STATUS_KEY = "backup_last_status"


def _json_serial(obj: Any) -> Any:
    if isinstance(obj, (datetime, date, time)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, bytes):
        return obj.hex()
    if hasattr(obj, "value"):
        return obj.value
    return str(obj)


class BackupService:
    @property
    def DEFAULT_CONFIG(self) -> dict[str, Any]:
        return {
            "enabled": config.BACKUP_AUTO_ENABLED,
            "frequency": config.BACKUP_FREQUENCY,  # daily | weekly | monthly
            "time": config.BACKUP_TIME,
            "retention": config.BACKUP_RETENTION_COUNT,
            "destination": config.BACKUP_DESTINATION,  # gdrive | local
            "gdrive_folder_id": config.GDRIVE_BACKUP_FOLDER_ID,  # custom folder if set, else uses root/Backups
            "include_database": config.BACKUP_INCLUDE_DATABASE,
            "include_financials": config.BACKUP_INCLUDE_FINANCIALS,
            "include_manifest": config.BACKUP_INCLUDE_MANIFEST,
        }

    def get_config(self, db: Session) -> dict[str, Any]:
        setting = db.query(SystemSetting).filter(SystemSetting.key == BACKUP_CONFIG_KEY).first()
        res = dict(self.DEFAULT_CONFIG)
        if setting and isinstance(setting.value, dict):
            res.update(setting.value)
        return res

    def update_config(self, db: Session, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.get_config(db)
        current.update({k: v for k, v in payload.items() if v is not None})
        setting = db.query(SystemSetting).filter(SystemSetting.key == BACKUP_CONFIG_KEY).first()
        if not setting:
            setting = SystemSetting(key=BACKUP_CONFIG_KEY, value=current)
            db.add(setting)
        else:
            setting.value = current
        db.commit()
        return current

    def get_last_status(self, db: Session) -> dict[str, Any] | None:
        setting = db.query(SystemSetting).filter(SystemSetting.key == BACKUP_LAST_STATUS_KEY).first()
        if setting and isinstance(setting.value, dict):
            return setting.value
        return None

    def _set_last_status(self, db: Session, status_data: dict[str, Any]) -> None:
        setting = db.query(SystemSetting).filter(SystemSetting.key == BACKUP_LAST_STATUS_KEY).first()
        if not setting:
            setting = SystemSetting(key=BACKUP_LAST_STATUS_KEY, value=status_data)
            db.add(setting)
        else:
            setting.value = status_data
        db.commit()

    def _export_database(self, db: Session) -> tuple[dict[str, list[dict[str, Any]]], str]:
        engine = db.get_bind()
        inspector = inspect(engine)
        table_names = sorted(inspector.get_table_names())
        
        db_export: dict[str, list[dict[str, Any]]] = {}
        sql_buffer = StringIO()
        sql_buffer.write("-- ========================================================\n")
        sql_buffer.write(f"-- KKR ERP DATABASE DUMP\n")
        sql_buffer.write(f"-- Generated: {datetime.now(timezone.utc).isoformat()}\n")
        sql_buffer.write("-- ========================================================\n\n")

        for table in table_names:
            try:
                rows = db.execute(text(f'SELECT * FROM "{table}"')).mappings().all()
                serialized_rows = []
                for row in rows:
                    clean_row = {k: _json_serial(v) if v is not None else None for k, v in row.items()}
                    serialized_rows.append(clean_row)
                db_export[table] = serialized_rows

                # Generate SQL INSERT statements
                if serialized_rows:
                    sql_buffer.write(f"-- Table: {table} ({len(serialized_rows)} rows)\n")
                    for r in serialized_rows:
                        cols = list(r.keys())
                        cols_sql = ", ".join(f'"{c}"' for c in cols)
                        vals = []
                        for c in cols:
                            val = r[c]
                            if val is None:
                                vals.append("NULL")
                            elif isinstance(val, (int, float)):
                                vals.append(str(val))
                            elif isinstance(val, bool):
                                vals.append("TRUE" if val else "FALSE")
                            else:
                                escaped = str(val).replace("'", "''")
                                vals.append(f"'{escaped}'")
                        vals_sql = ", ".join(vals)
                        sql_buffer.write(f'INSERT INTO "{table}" ({cols_sql}) VALUES ({vals_sql}) ON CONFLICT DO NOTHING;\n')
                    sql_buffer.write("\n")
            except Exception as e:
                logger.warning(f"Error dumping table {table}: {e}")

        return db_export, sql_buffer.getvalue()

    def _export_financials_csv(self, db_export: dict[str, list[dict[str, Any]]]) -> dict[str, str]:
        financial_tables = [
            "expense_logs",
            "payment_logs",
            "vendor_transactions",
            "office_expenses",
            "site_expenses",
            "material_logs",
            "shareholder_payments",
        ]
        csv_files: dict[str, str] = {}
        for tbl in financial_tables:
            rows = db_export.get(tbl, [])
            if not rows:
                continue
            out = StringIO()
            writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            for r in rows:
                writer.writerow(r)
            csv_files[f"financials/{tbl}.csv"] = out.getvalue()
        return csv_files

    def _export_storage_manifest(self, db: Session) -> dict[str, Any]:
        manifest: dict[str, Any] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "projects_count": 0,
            "files_count": 0,
            "total_original_bytes": 0,
            "total_compressed_bytes": 0,
            "files": [],
        }

        try:
            files_rows = db.execute(text("""
                SELECT 
                    pf.id,
                    p.id as project_id,
                    p.project_name,
                    COALESCE(pff.name, 'Root') as folder_name,
                    pf.original_filename,
                    pf.stored_filename,
                    pf.storage_bucket,
                    pf.storage_path,
                    pf.original_size,
                    pf.compressed_size,
                    pf.created_at
                FROM project_files pf
                JOIN projects p ON pf.project_id = p.id
                LEFT JOIN project_file_folders pff ON pf.folder_id = pff.id
                ORDER BY p.id, pf.id
            """)).mappings().all()

            seen_projects = set()
            for r in files_rows:
                seen_projects.add(r["project_id"])
                orig_size = r["original_size"] or 0
                comp_size = r["compressed_size"] or 0
                manifest["total_original_bytes"] += orig_size
                manifest["total_compressed_bytes"] += comp_size
                
                gdrive_link = ""
                if r["storage_bucket"] == "gdrive" and r["storage_path"]:
                    gdrive_link = f"https://drive.google.com/file/d/{r['storage_path']}/view"

                manifest["files"].append({
                    "file_id": r["id"],
                    "project_id": r["project_id"],
                    "project_name": r["project_name"],
                    "folder": r["folder_name"],
                    "original_filename": r["original_filename"],
                    "storage_provider": r["storage_bucket"],
                    "storage_identifier": r["storage_path"],
                    "gdrive_url": gdrive_link,
                    "original_size_bytes": orig_size,
                    "compressed_size_bytes": comp_size,
                    "created_at": _json_serial(r["created_at"]),
                })

            manifest["projects_count"] = len(seen_projects)
            manifest["files_count"] = len(files_rows)
        except Exception as e:
            logger.error(f"Error creating storage manifest: {e}")

        return manifest

    def create_backup_archive(
        self,
        db: Session,
        include_database: bool = True,
        include_financials: bool = True,
        include_manifest: bool = True,
        creator_name: str = "Administrator",
    ) -> tuple[str, bytes]:
        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        archive_name = f"KKR_ERP_Backup_{timestamp_str}.zip"
        
        buffer = BytesIO()
        db_export: dict[str, list[dict[str, Any]]] = {}

        with ZipFile(buffer, "w", compression=ZIP_DEFLATED, compresslevel=6) as zip_out:
            if include_database:
                db_export, sql_dump = self._export_database(db)
                # 1. JSON Database dump
                zip_out.writestr("database/data_export.json", json.dumps(db_export, indent=2, default=_json_serial))
                # 2. SQL Schema + Insert dump
                zip_out.writestr("database/database_dump.sql", sql_dump)

            if include_financials:
                if not db_export:
                    db_export, _ = self._export_database(db)
                csvs = self._export_financials_csv(db_export)
                for file_path, content in csvs.items():
                    zip_out.writestr(file_path, content)

            if include_manifest:
                manifest = self._export_storage_manifest(db)
                zip_out.writestr("storage_manifest/files_catalog.json", json.dumps(manifest, indent=2, default=_json_serial))

            # Backup Metadata
            total_records = sum(len(rows) for rows in db_export.values()) if db_export else 0
            metadata = {
                "system": "KKR ERP",
                "archive_filename": archive_name,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "creator": creator_name,
                "included_modules": {
                    "database": include_database,
                    "financials": include_financials,
                    "storage_manifest": include_manifest,
                },
                "total_tables_exported": len(db_export),
                "total_records_exported": total_records,
                "database_engine": "PostgreSQL",
            }
            zip_out.writestr("backup_metadata.json", json.dumps(metadata, indent=2))

        zip_bytes = buffer.getvalue()
        return archive_name, zip_bytes

    def _resolve_gdrive_backup_folder(self, custom_folder_id: str | None = None) -> str:
        if custom_folder_id and custom_folder_id.strip():
            return custom_folder_id.strip()
        root_id = config.GDRIVE_ROOT_FOLDER_ID
        return storage_service._get_or_create_gdrive_folder("Backups", root_id)

    def backup_to_gdrive(
        self,
        db: Session,
        custom_folder_id: str | None = None,
        options: dict[str, Any] | None = None,
        creator_name: str = "System Automated",
    ) -> dict[str, Any]:
        cfg = self.get_config(db)
        if options:
            cfg.update(options)

        folder_id = self._resolve_gdrive_backup_folder(custom_folder_id or cfg.get("gdrive_folder_id"))
        filename, zip_bytes = self.create_backup_archive(
            db,
            include_database=cfg.get("include_database", True),
            include_financials=cfg.get("include_financials", True),
            include_manifest=cfg.get("include_manifest", True),
            creator_name=creator_name,
        )

        file_metadata = {
            "name": filename,
            "parents": [folder_id],
            "description": f"KKR ERP Full System Backup ({len(zip_bytes)/(1024*1024):.2f} MB)",
        }
        media = MediaIoBaseUpload(BytesIO(zip_bytes), mimetype="application/zip", resumable=False)
        gdrive_file = storage_service.gdrive_service.files().create(
            body=file_metadata, media_body=media, fields="id, name, size, createdTime, webViewLink"
        ).execute()

        # Enforce retention policy
        retention_count = int(cfg.get("retention", 7))
        self._enforce_gdrive_retention(folder_id, retention_count)

        status_result = {
            "status": "success",
            "last_backup_time": datetime.now(timezone.utc).isoformat(),
            "file_id": gdrive_file.get("id"),
            "filename": filename,
            "size_bytes": len(zip_bytes),
            "size_mb": round(len(zip_bytes) / (1024 * 1024), 2),
            "destination": "gdrive",
            "folder_id": folder_id,
            "view_url": gdrive_file.get("webViewLink"),
            "creator": creator_name,
        }
        self._set_last_status(db, status_result)
        return status_result

    def _enforce_gdrive_retention(self, folder_id: str, max_backups: int) -> None:
        try:
            if max_backups <= 0:
                return
            query = f"'{folder_id}' in parents and name contains 'KKR_ERP_Backup_' and trashed = false"
            results = storage_service.gdrive_service.files().list(
                q=query, orderBy="createdTime desc", spaces="drive", fields="files(id, name, createdTime)"
            ).execute()
            files = results.get("files", [])
            if len(files) > max_backups:
                to_delete = files[max_backups:]
                for f in to_delete:
                    try:
                        storage_service.gdrive_service.files().delete(fileId=f["id"]).execute()
                        logger.info(f"Deleted expired backup from Google Drive: {f.get('name')} ({f.get('id')})")
                    except Exception as e:
                        logger.warning(f"Failed to delete expired backup {f.get('id')}: {e}")
        except Exception as e:
            logger.error(f"Error enforcing retention on Google Drive backups: {e}")

    def list_gdrive_backups(self, custom_folder_id: str | None = None) -> list[dict[str, Any]]:
        try:
            folder_id = self._resolve_gdrive_backup_folder(custom_folder_id)
            query = f"'{folder_id}' in parents and name contains 'KKR_ERP_Backup_' and trashed = false"
            results = storage_service.gdrive_service.files().list(
                q=query, orderBy="createdTime desc", spaces="drive", fields="files(id, name, size, createdTime, webViewLink)"
            ).execute()
            
            backups = []
            for f in results.get("files", []):
                size_int = int(f.get("size", 0)) if f.get("size") else 0
                backups.append({
                    "id": f["id"],
                    "name": f["name"],
                    "size_bytes": size_int,
                    "size_formatted": f"{size_int / (1024 * 1024):.2f} MB" if size_int else "N/A",
                    "created_at": f.get("createdTime"),
                    "view_url": f.get("webViewLink"),
                    "destination": "Google Drive",
                })
            return backups
        except Exception as e:
            logger.error(f"Failed to list Google Drive backups: {e}")
            return []

    def download_gdrive_backup(self, file_id: str) -> tuple[str, bytes]:
        file_meta = storage_service.gdrive_service.files().get(fileId=file_id, fields="name").execute()
        filename = file_meta.get("name", f"backup_{file_id}.zip")
        content = storage_service.gdrive_service.files().get_media(fileId=file_id).execute()
        return filename, content

    def delete_gdrive_backup(self, file_id: str) -> bool:
        try:
            storage_service.gdrive_service.files().delete(fileId=file_id).execute()
            return True
        except Exception as e:
            logger.error(f"Failed to delete backup file {file_id}: {e}")
            return False

    async def run_scheduler_tick(self, db_session_factory) -> None:
        try:
            with db_session_factory() as db:
                cfg = self.get_config(db)
                if not cfg.get("enabled", False):
                    return
                
                if not storage_service.has_gdrive_storage and cfg.get("destination") == "gdrive":
                    return

                last_status = self.get_last_status(db)
                now = datetime.now(timezone.utc)
                target_time_str = cfg.get("time", "02:00")
                try:
                    target_h, target_m = map(int, target_time_str.split(":"))
                except Exception:
                    target_h, target_m = 2, 0

                # Check if last run was done in current cycle
                frequency = cfg.get("frequency", "daily")
                should_run = False
                
                if not last_status or not last_status.get("last_backup_time"):
                    should_run = True
                else:
                    try:
                        last_run_dt = datetime.fromisoformat(last_status["last_backup_time"])
                        elapsed_seconds = (now - last_run_dt).total_seconds()

                        if frequency == "daily" and elapsed_seconds > 82800:  # ~23 hours
                            # Run if current hour >= target hour
                            if now.hour >= target_h:
                                should_run = True
                        elif frequency == "weekly" and elapsed_seconds > (6 * 86400):  # 6 days
                            should_run = True
                        elif frequency == "monthly" and elapsed_seconds > (27 * 86400):  # 27 days
                            should_run = True
                    except Exception:
                        should_run = True

                if should_run:
                    logger.info("Executing automated scheduled backup...")
                    self.backup_to_gdrive(db, creator_name="Automated Scheduler")
        except Exception as e:
            logger.error(f"Error in backup scheduler tick: {e}")


backup_service = BackupService()


async def backup_scheduler_worker(db_session_factory):
    import asyncio
    logger.info("Backup scheduler background worker started.")
    while True:
        try:
            await asyncio.sleep(60)
            await backup_service.run_scheduler_tick(db_session_factory)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Backup scheduler worker encountered an error: {e}")
            await asyncio.sleep(60)

