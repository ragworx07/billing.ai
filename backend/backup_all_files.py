import os
import sys
import zipfile
from io import BytesIO
from datetime import datetime
from pathlib import Path
from sqlalchemy import create_engine, text
from src.config import config
from src.core.services.storage_service import storage_service

def create_backup_zip():
    print("=== KKR ERP: SUPABASE STORAGE FULL BACKUP SCRIPT ===")
    engine = create_engine(config.DATABASE_URL)
    
    output_zip_path = Path("/Users/raghavsomasundaram/Downloads/CIDO/KKR_ERP_Full_Backup.zip")
    temp_dir = Path("/Users/raghavsomasundaram/Downloads/CIDO/storage_backup_temp")
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    with engine.connect() as conn:
        files = conn.execute(text("""
            SELECT 
                p.id as project_id,
                p.project_name,
                COALESCE(pff.name, 'Root') as folder_name,
                pf.id as file_id,
                pf.original_filename,
                pf.stored_filename,
                pf.storage_bucket,
                pf.storage_path,
                pf.compressed_size
            FROM project_files pf
            JOIN projects p ON pf.project_id = p.id
            LEFT JOIN project_file_folders pff ON pf.folder_id = pff.id
            ORDER BY p.id, folder_name, pf.id
        """)).fetchall()

        media_files = conn.execute(text("""
            SELECT name, (metadata->>'size')::bigint as size
            FROM storage.objects
            WHERE bucket_id = 'media'
        """)).fetchall()

    print(f"Found {len(files)} project documents and {len(media_files)} media images to backup.")
    
    success_count = 0
    failed_count = 0
    
    with zipfile.ZipFile(output_zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zip_out:
        # 1. Download Project Files
        for idx, row in enumerate(files, 1):
            pid, pname, fname, fid, orig_name, stored_name, bucket, path, comp_size = row
            clean_pname = "".join(c for c in pname if c.isalnum() or c in (' ', '_', '-')).strip()
            clean_fname = "".join(c for c in fname if c.isalnum() or c in (' ', '_', '-')).strip()
            
            archive_path = f"Projects/{clean_pname} (ID {pid})/{clean_fname}/{orig_name}"
            print(f"[{idx}/{len(files)}] Downloading: {pname} -> {fname}/{orig_name}...")
            
            try:
                filename, content = storage_service.download_project_file(bucket, path)
                zip_out.writestr(archive_path, content)
                success_count += 1
            except Exception as e:
                print(f"  [!] Failed to download {path}: {e}")
                failed_count += 1
        
        # 2. Download Media / Profile Images
        for m in media_files:
            m_path = m[0]
            try:
                content = storage_service.supabase.storage.from_("media").download(m_path)
                zip_out.writestr(f"Media/{m_path}", content)
                success_count += 1
            except Exception as e:
                print(f"  [!] Failed to download media {m_path}: {e}")
                failed_count += 1

    print("\n=== BACKUP SUMMARY ===")
    print(f"Total files processed: {len(files) + len(media_files)}")
    print(f"Successfully downloaded: {success_count}")
    print(f"Failed / Restricted: {failed_count}")
    if output_zip_path.exists():
        print(f"Backup archive created at: {output_zip_path} ({output_zip_path.stat().st_size / (1024*1024):.2f} MB)")

if __name__ == '__main__':
    create_backup_zip()
