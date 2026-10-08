#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use tauri::{
    menu::{Menu, SubmenuBuilder},
    path::BaseDirectory,
    Manager,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const BACKEND_HEALTH_URL: &str = "127.0.0.1:8000";
const DESKTOP_CORS_ORIGINS: &str = "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173,http://tauri.localhost,https://tauri.localhost,tauri://localhost";

fn runtime_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("KKR ERP")
}

fn log_dir() -> PathBuf {
    runtime_dir().join("logs")
}

fn backend_log_path(filename: &str) -> PathBuf {
    log_dir().join(filename)
}

fn log_backend_event(message: &str) {
    let path = backend_log_path("backend-launch.log");
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

fn open_backend_log(filename: &str) -> Option<fs::File> {
    let path = backend_log_path(filename);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    OpenOptions::new().create(true).append(true).open(path).ok()
}

fn backend_health_ok() -> bool {
    let Ok(mut stream) = TcpStream::connect(BACKEND_HEALTH_URL) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    if stream
        .write_all(b"GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    response.contains("200 OK") && response.contains("\"status\":\"ok\"")
}

fn spawn_backend(app: &tauri::App) -> Result<Option<Child>, String> {
    if backend_health_ok() {
        log_backend_event("Backend health check passed before spawn; reusing existing backend.");
        return Ok(None);
    }

    #[cfg(windows)]
    let exe_name = "backend/kkr-backend.exe";
    #[cfg(not(windows))]
    let exe_name = "backend/kkr-backend";

    let backend_exe = app
        .path()
        .resolve(exe_name, BaseDirectory::Resource)
        .map_err(|error| format!("Unable to resolve backend executable: {error}"))?;
    if !backend_exe.exists() {
        return Err(format!(
            "Backend executable is missing: {}",
            backend_exe.display()
        ));
    }
    let backend_dir = backend_exe
        .parent()
        .ok_or_else(|| "Backend executable has no parent directory.".to_string())?
        .to_path_buf();
    let uploads_dir = runtime_dir().join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|error| format!("Unable to create backend uploads directory: {error}"))?;

    log_backend_event(&format!("Starting backend from {}", backend_exe.display()));
    log_backend_event(&format!(
        "Backend working directory {}",
        backend_dir.display()
    ));
    log_backend_event(&format!(
        "Backend uploads directory {}",
        uploads_dir.display()
    ));

    let mut command = Command::new(backend_exe);
    command
        .current_dir(backend_dir)
        .env("APP_HOST", "127.0.0.1")
        .env("APP_PORT", "8000")
        .env("APP_LOG_LEVEL", "info")
        .env("CORS_ORIGINS", DESKTOP_CORS_ORIGINS)
        .env("CORS_ALLOW_METHODS", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        .env("CORS_ALLOW_HEADERS", "*")
        .env("CORS_ALLOW_CREDENTIALS", "true")
        .env("LOCAL_STORAGE_DIR", uploads_dir);

    if let Some(stdout) = open_backend_log("backend-stdout.log") {
        command.stdout(Stdio::from(stdout));
    }
    if let Some(stderr) = open_backend_log("backend-stderr.log") {
        command.stderr(Stdio::from(stderr));
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .spawn()
        .map(Some)
        .map_err(|error| format!("Unable to start backend process: {error}"))
}

fn wait_for_backend() -> bool {
    for _ in 0..120 {
        if backend_health_ok() {
            log_backend_event("Backend health check passed.");
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    log_backend_event("Backend health check timed out after 60 seconds.");
    false
}

fn sanitize_filename(filename: &str) -> String {
    let cleaned: String = filename
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed
    }
}

fn downloads_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME");

    home.map(PathBuf::from)
        .map(|path| path.join("Downloads"))
        .filter(|path| path.exists())
        .ok_or_else(|| "Unable to find the Downloads folder.".to_string())
}

fn unique_path(mut path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let parent = path.parent().map(PathBuf::from).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download")
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_string);

    for index in 1..1000 {
        let filename = match &extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        path = parent.join(filename);
        if !path.exists() {
            break;
        }
    }
    path
}

fn write_bytes(path: PathBuf, bytes: Vec<u8>) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = fs::File::create(&path).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_file_to_downloads(filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let filename = sanitize_filename(&filename);
    let path = unique_path(downloads_dir()?.join(filename));
    write_bytes(path, bytes)
}

#[tauri::command]
fn save_file_to_temp(filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let filename = sanitize_filename(&filename);
    let path = unique_path(std::env::temp_dir().join("kkr-erp-preview").join(filename));
    write_bytes(path, bytes)
}

#[tauri::command]
fn open_file_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("File does not exist.".to_string());
    }

    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        let open_cmd = "open";
        #[cfg(not(target_os = "macos"))]
        let open_cmd = "xdg-open";

        Command::new(open_cmd)
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn read_clipboard_image_png() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $image) { exit 2 }
$stream = New-Object System.IO.MemoryStream
try {
  $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  'data:image/png;base64,' + [Convert]::ToBase64String($stream.ToArray())
} finally {
  $stream.Dispose()
  $image.Dispose()
}
"#;

        let output = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-STA",
                "-Command",
                script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| format!("Unable to read clipboard image: {error}"))?;

        if output.status.code() == Some(2) {
            return Ok(None);
        }
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if error.is_empty() {
                "Unable to read clipboard image.".to_string()
            } else {
                error
            });
        }

        let data_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if data_url.is_empty() {
            Ok(None)
        } else {
            Ok(Some(data_url))
        }
    }

    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

fn install_edit_menu(app: &tauri::App) -> tauri::Result<()> {
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let menu = Menu::with_items(app, &[&edit_menu])?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(windows)]
fn assign_process_to_job(child: &Child) {
    use std::os::windows::io::AsRawHandle;

    type HANDLE = *mut std::ffi::c_void;
    type BOOL = i32;
    type DWORD = u32;

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: DWORD = 0x2000;
    const JobObjectExtendedLimitInformation: i32 = 9;

    #[repr(C)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: DWORD,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: DWORD,
        affinity: usize,
        priority_class: DWORD,
        scheduling_class: DWORD,
    }

    #[repr(C)]
    struct IO_COUNTERS {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        io_info: IO_COUNTERS,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    extern "system" {
        fn CreateJobObjectW(lp_job_attributes: *mut std::ffi::c_void, lp_name: *const u16) -> HANDLE;
        fn SetInformationJobObject(
            h_job: HANDLE,
            job_object_information_class: i32,
            lp_job_object_information: *const std::ffi::c_void,
            cb_job_object_information_length: DWORD,
        ) -> BOOL;
        fn AssignProcessToJobObject(h_job: HANDLE, h_process: HANDLE) -> BOOL;
    }

    unsafe {
        let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
        if !job.is_null() {
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as DWORD,
            ) != 0 {
                AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE);
            }
            std::mem::forget(job);
        }
    }
}

fn main() {
    let backend_process: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let process_for_setup = Arc::clone(&backend_process);
    let process_for_exit = Arc::clone(&backend_process);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            save_file_to_downloads,
            save_file_to_temp,
            open_file_path,
            read_clipboard_image_png
        ])
        .setup(move |app| {
            install_edit_menu(app)?;
            match spawn_backend(app) {
                Ok(Some(child)) => {
                    #[cfg(windows)]
                    assign_process_to_job(&child);

                    if let Ok(mut process) = process_for_setup.lock() {
                        *process = Some(child);
                    }
                }
                Ok(None) => {}
                Err(error) => log_backend_event(&error),
            }
            if !wait_for_backend() {
                if let Ok(mut process) = process_for_setup.lock() {
                    if let Some(child) = process.as_mut() {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                log_backend_event(&format!("Backend exited early: {status}"))
                            }
                            Ok(None) => log_backend_event(
                                "Backend process is still running but health check failed.",
                            ),
                            Err(error) => log_backend_event(&format!(
                                "Unable to inspect backend process: {error}"
                            )),
                        }
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building KKR ERP desktop shell");

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(mut process) = process_for_exit.lock() {
                if let Some(child) = process.as_mut() {
                    log_backend_event("Terminating backend process on application exit.");
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}
