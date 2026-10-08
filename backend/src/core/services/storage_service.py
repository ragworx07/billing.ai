import base64
import logging
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import UploadFile
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from supabase import Client, create_client

from src.config import config

logger = logging.getLogger(__name__)


class StorageService:
    LOCAL_PROJECT_FILES_BUCKET = "__local_project_files__"
    LOCAL_NOTE_FILES_BUCKET = "__local_note_files__"
    GDRIVE_BUCKET = "gdrive"
    NOTE_SIGNED_URL_SECONDS = 86_400

    def __init__(self) -> None:
        self._supabase: Client | None = None
        self._gdrive_service = None
        self._folder_cache: dict[tuple[str, str], str] = {}

    @property
    def supabase(self) -> Client:
        if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase Storage uploads.")
        if self._supabase is None:
            self._supabase = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
        return self._supabase

    @property
    def has_supabase_storage(self) -> bool:
        return bool(config.SUPABASE_URL and config.SUPABASE_SERVICE_ROLE_KEY)

    @property
    def has_gdrive_storage(self) -> bool:
        if not config.GDRIVE_ROOT_FOLDER_ID:
            return False
        token_path = Path(config.GDRIVE_TOKEN_PATH)
        if token_path.exists():
            return True
        cred_path = Path(config.GDRIVE_CREDENTIALS_PATH)
        return cred_path.exists()

    @property
    def gdrive_service(self):
        if self._gdrive_service is not None:
            return self._gdrive_service

        scopes = ["https://www.googleapis.com/auth/drive"]
        token_path = Path(config.GDRIVE_TOKEN_PATH)

        if token_path.exists():
            creds = Credentials.from_authorized_user_file(str(token_path), scopes)
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                    with open(token_path, "w") as token_file:
                        token_file.write(creds.to_json())
                except Exception as e:
                    logger.warning(f"Failed to refresh Google Drive token: {e}")
            self._gdrive_service = build("drive", "v3", credentials=creds)
            return self._gdrive_service

        cred_path = Path(config.GDRIVE_CREDENTIALS_PATH)
        if cred_path.exists():
            creds = service_account.Credentials.from_service_account_file(str(cred_path), scopes=scopes)
            self._gdrive_service = build("drive", "v3", credentials=creds)
            return self._gdrive_service

        raise RuntimeError("No valid Google Drive credentials or token found.")

    def _get_or_create_gdrive_folder(self, folder_name: str, parent_id: str) -> str:
        cache_key = (folder_name, parent_id)
        if cache_key in self._folder_cache:
            return self._folder_cache[cache_key]

        escaped_name = folder_name.replace("'", "\\'")
        query = f"'{parent_id}' in parents and name = '{escaped_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        results = self.gdrive_service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
        files = results.get("files", [])
        if files:
            folder_id = files[0]["id"]
            self._folder_cache[cache_key] = folder_id
            return folder_id

        file_metadata = {
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        created = self.gdrive_service.files().create(body=file_metadata, fields="id").execute()
        folder_id = created["id"]
        self._folder_cache[cache_key] = folder_id
        return folder_id

    def _resolve_project_gdrive_folder(self, project_id: int, folder_id: int | None) -> str:
        root_id = config.GDRIVE_ROOT_FOLDER_ID
        projects_root = self._get_or_create_gdrive_folder("Projects", root_id)
        project_folder = self._get_or_create_gdrive_folder(f"Project_{project_id}", projects_root)
        if folder_id:
            return self._get_or_create_gdrive_folder(f"Folder_{folder_id}", project_folder)
        return project_folder

    async def upload_bill(self, file: UploadFile, folder: str) -> str:
        """Upload images/bills and return a URL suitable for direct browser display."""
        extension = Path(file.filename or "upload").suffix
        object_name = f"{folder}/{uuid4().hex}{extension}"
        content = await file.read()
        content_type = file.content_type or "application/octet-stream"

        if config.STORAGE_PROVIDER == "gdrive" and self.has_gdrive_storage:
            try:
                root_id = config.GDRIVE_ROOT_FOLDER_ID
                media_root = self._get_or_create_gdrive_folder("Media", root_id)
                target_folder = self._get_or_create_gdrive_folder(folder, media_root)
                file_metadata = {
                    "name": f"{uuid4().hex}{extension}",
                    "parents": [target_folder],
                }
                media = MediaIoBaseUpload(BytesIO(content), mimetype=content_type, resumable=False)
                drive_file = self.gdrive_service.files().create(body=file_metadata, media_body=media, fields="id").execute()
                file_id = drive_file["id"]
                try:
                    self.gdrive_service.permissions().create(fileId=file_id, body={"role": "reader", "type": "anyone"}).execute()
                except Exception:
                    pass
                return f"https://lh3.googleusercontent.com/d/{file_id}"
            except Exception as e:
                logger.error(f"Google Drive bill upload failed: {e}", exc_info=True)

        if self.has_supabase_storage:
            bucket = config.SUPABASE_MEDIA_BUCKET
            self.ensure_public_bucket(bucket)
            self.supabase.storage.from_(bucket).upload(
                object_name,
                content,
                {"content-type": content_type, "upsert": "false"},
            )
            return self.supabase.storage.from_(bucket).get_public_url(object_name)

        base_dir = Path(config.LOCAL_STORAGE_DIR)
        file_path = base_dir / object_name
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(content)
        return f"/uploads/{object_name}"

    def ensure_bucket(self, bucket: str) -> None:
        try:
            self.supabase.storage.get_bucket(bucket)
        except Exception:
            self.supabase.storage.create_bucket(bucket, options={"public": False})

    def ensure_public_bucket(self, bucket: str) -> None:
        try:
            existing = self.supabase.storage.get_bucket(bucket)
            if not existing.public:
                self.supabase.storage.update_bucket(bucket, options={"public": True})
        except Exception:
            self.supabase.storage.create_bucket(bucket, options={"public": True})

    @staticmethod
    def _safe_filename(filename: str | None) -> str:
        raw_name = Path(filename or "upload").name.strip()
        return raw_name or "upload"

    @staticmethod
    def compress_file(filename: str, content: bytes) -> bytes:
        buffer = BytesIO()
        with ZipFile(buffer, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
            archive.writestr(filename, content)
        return buffer.getvalue()

    @staticmethod
    def decompress_file(compressed_content: bytes) -> tuple[str, bytes]:
        with ZipFile(BytesIO(compressed_content), "r") as archive:
            names = archive.namelist()
            if not names:
                raise RuntimeError("Stored archive is empty.")
            filename = names[0]
            return filename, archive.read(filename)

    @staticmethod
    def _local_project_file_path(storage_path: str) -> Path:
        base_dir = (Path(config.LOCAL_STORAGE_DIR) / "project-files").resolve()
        file_path = (base_dir / storage_path).resolve()
        if base_dir not in file_path.parents:
            raise RuntimeError("Invalid project file storage path.")
        return file_path

    @staticmethod
    def _local_note_file_path(storage_path: str) -> Path:
        base_dir = (Path(config.LOCAL_STORAGE_DIR) / "note-attachments").resolve()
        file_path = (base_dir / storage_path).resolve()
        if base_dir not in file_path.parents:
            raise RuntimeError("Invalid note attachment storage path.")
        return file_path

    def upload_note_attachment_bytes(
        self,
        user_id: int,
        attachment_id: str,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> dict[str, object]:
        original_filename = self._safe_filename(filename)
        extension = Path(original_filename).suffix

        if config.STORAGE_PROVIDER == "gdrive" and self.has_gdrive_storage:
            try:
                root_id = config.GDRIVE_ROOT_FOLDER_ID
                notes_root = self._get_or_create_gdrive_folder("Notes", root_id)
                user_folder = self._get_or_create_gdrive_folder(f"User_{user_id}", notes_root)
                file_metadata = {
                    "name": f"{attachment_id}-{uuid4().hex}{extension}",
                    "parents": [user_folder],
                    "description": f"Original: {original_filename}",
                }
                media = MediaIoBaseUpload(BytesIO(content), mimetype=content_type, resumable=False)
                drive_file = self.gdrive_service.files().create(body=file_metadata, media_body=media, fields="id").execute()
                file_id = drive_file["id"]
                return {
                    "bucket": self.GDRIVE_BUCKET,
                    "storage_path": file_id,
                    "data_url": f"data:{content_type};base64,{base64.b64encode(content).decode('ascii')}",
                }
            except Exception as e:
                logger.error(f"Google Drive note attachment upload failed: {e}", exc_info=True)

        storage_path = f"notes/{user_id}/{attachment_id}-{uuid4().hex}{extension}"
        bucket = config.SUPABASE_NOTES_BUCKET

        if not self.has_supabase_storage:
            file_path = self._local_note_file_path(storage_path)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(content)
            bucket = self.LOCAL_NOTE_FILES_BUCKET
        else:
            self.ensure_bucket(bucket)
            self.supabase.storage.from_(bucket).upload(
                storage_path,
                content,
                {"content-type": content_type, "x-upsert": "false"},
            )

        return {
            "bucket": bucket,
            "storage_path": storage_path,
            "data_url": self.note_attachment_url(bucket, storage_path, content_type),
        }

    def note_attachment_url(self, bucket: str, storage_path: str, content_type: str) -> str:
        if bucket == self.GDRIVE_BUCKET:
            try:
                file_id = storage_path.removeprefix("gdrive:")
                content = self.gdrive_service.files().get_media(fileId=file_id).execute()
                return f"data:{content_type};base64,{base64.b64encode(content).decode('ascii')}"
            except Exception as e:
                logger.error(f"Failed to fetch note attachment from Google Drive: {e}")
                return ""

        if bucket == self.LOCAL_NOTE_FILES_BUCKET:
            content = self._local_note_file_path(storage_path).read_bytes()
            return f"data:{content_type};base64,{base64.b64encode(content).decode('ascii')}"
        signed = self.supabase.storage.from_(bucket).create_signed_url(storage_path, self.NOTE_SIGNED_URL_SECONDS)
        return str(signed.get("signedUrl") or signed.get("signedURL") or "")

    def delete_note_files(self, bucket_paths: set[tuple[str, str]]) -> None:
        grouped: dict[str, list[str]] = {}
        for bucket, storage_path in bucket_paths:
            grouped.setdefault(bucket, []).append(storage_path)
        for bucket, paths in grouped.items():
            if bucket == self.GDRIVE_BUCKET:
                for storage_path in paths:
                    try:
                        file_id = storage_path.removeprefix("gdrive:")
                        self.gdrive_service.files().delete(fileId=file_id).execute()
                    except Exception as e:
                        logger.warning(f"Failed to delete Google Drive note file {storage_path}: {e}")
            elif bucket == self.LOCAL_NOTE_FILES_BUCKET:
                for storage_path in paths:
                    file_path = self._local_note_file_path(storage_path)
                    if file_path.exists():
                        file_path.unlink()
            else:
                self.supabase.storage.from_(bucket).remove(paths)

    async def upload_project_file(self, project_id: int, folder_id: int | None, file: UploadFile) -> dict[str, object]:
        original_filename = self._safe_filename(file.filename)
        content = await file.read()
        compressed_content = self.compress_file(original_filename, content)
        stored_filename = f"{uuid4().hex}.zip"

        if config.STORAGE_PROVIDER == "gdrive" and self.has_gdrive_storage:
            try:
                target_folder_id = self._resolve_project_gdrive_folder(project_id, folder_id)
                file_metadata = {
                    "name": stored_filename,
                    "parents": [target_folder_id],
                    "description": f"Project: {project_id} | Original: {original_filename}",
                }
                media = MediaIoBaseUpload(BytesIO(compressed_content), mimetype="application/zip", resumable=False)
                drive_file = self.gdrive_service.files().create(
                    body=file_metadata, media_body=media, fields="id, name"
                ).execute()
                file_id = drive_file["id"]
                return {
                    "bucket": self.GDRIVE_BUCKET,
                    "storage_path": file_id,
                    "stored_filename": stored_filename,
                    "original_filename": original_filename,
                    "content_type": file.content_type or "application/octet-stream",
                    "original_size": len(content),
                    "compressed_size": len(compressed_content),
                }
            except Exception as e:
                logger.error(f"Google Drive project file upload failed: {e}", exc_info=True)
                # Fallback to local or supabase if configured

        bucket = config.SUPABASE_PROJECT_FILES_BUCKET
        folder_segment = str(folder_id) if folder_id else "root"
        storage_path = f"projects/{project_id}/{folder_segment}/{stored_filename}"

        if not self.has_supabase_storage:
            file_path = self._local_project_file_path(storage_path)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(compressed_content)
            bucket = self.LOCAL_PROJECT_FILES_BUCKET
        else:
            self.ensure_bucket(bucket)
            self.supabase.storage.from_(bucket).upload(
                storage_path,
                compressed_content,
                {"content-type": "application/zip", "x-upsert": "false"},
            )

        return {
            "bucket": bucket,
            "storage_path": storage_path,
            "stored_filename": stored_filename,
            "original_filename": original_filename,
            "content_type": file.content_type or "application/octet-stream",
            "original_size": len(content),
            "compressed_size": len(compressed_content),
        }

    def download_project_file(self, bucket: str, storage_path: str) -> tuple[str, bytes]:
        if bucket == self.GDRIVE_BUCKET or storage_path.startswith("gdrive:"):
            file_id = storage_path.removeprefix("gdrive:")
            compressed_content = self.gdrive_service.files().get_media(fileId=file_id).execute()
        elif bucket == self.LOCAL_PROJECT_FILES_BUCKET:
            file_path = self._local_project_file_path(storage_path)
            compressed_content = file_path.read_bytes()
        else:
            compressed_content = self.supabase.storage.from_(bucket).download(storage_path)
        return self.decompress_file(compressed_content)

    def delete_project_files(self, bucket: str, storage_paths: list[str]) -> None:
        if not storage_paths:
            return
        if bucket == self.GDRIVE_BUCKET:
            for storage_path in storage_paths:
                try:
                    file_id = storage_path.removeprefix("gdrive:")
                    self.gdrive_service.files().delete(fileId=file_id).execute()
                except Exception as e:
                    logger.warning(f"Failed to delete Google Drive file {storage_path}: {e}")
            return

        if bucket == self.LOCAL_PROJECT_FILES_BUCKET:
            for storage_path in storage_paths:
                file_path = self._local_project_file_path(storage_path)
                if file_path.exists():
                    file_path.unlink()
            return

        self.supabase.storage.from_(bucket).remove(storage_paths)


storage_service = StorageService()
