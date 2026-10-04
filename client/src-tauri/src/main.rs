#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use licra_client::identity;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
fn identity_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("identity.dpapi"))
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn identity_public(app: tauri::AppHandle) -> Result<String, String> {
    Ok(identity::public(&identity::load(&identity_path(&app)?)?))
}
#[tauri::command]
fn identity_sign(app: tauri::AppHandle, context: String) -> Result<String, String> {
    identity::sign(&identity::load(&identity_path(&app)?)?, &context)
}
#[tauri::command]
async fn identity_export(app: tauri::AppHandle, passphrase: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let passphrase = zeroize::Zeroizing::new(passphrase);
        let key = identity::load(&identity_path(&app)?)?;
        let data = identity::export(&key, &passphrase)?;
        if let Some(path) = app
            .dialog()
            .file()
            .add_filter("Licra identity", &["licra-identity"])
            .set_file_name("identity.licra-identity")
            .blocking_save_file()
        {
            let path = path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(path, data).map_err(|e| e.to_string())?
        };
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn identity_import(app: tauri::AppHandle, passphrase: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let passphrase = zeroize::Zeroizing::new(passphrase);
        if let Some(path) = app
            .dialog()
            .file()
            .add_filter("Licra identity", &["licra-identity"])
            .blocking_pick_file()
        {
            let path = path.into_path().map_err(|e| e.to_string())?;
            if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 4096 {
                return Err("Backup too large".into());
            };
            let data = std::fs::read(path).map_err(|e| e.to_string())?;
            let key = identity::import(&data, &passphrase)?;
            identity::store(&identity_path(&app)?, &key)?
        };
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if url.len() > 8192 {
        return Err("Link too long".into());
    }
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid URL")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only HTTP/HTTPS links are allowed".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let value: Vec<u16> = std::ffi::OsStr::new(parsed.as_str())
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                std::ptr::null_mut(),
                std::ptr::null(),
                value.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result as isize <= 32 {
            return Err("Could not open system browser".into());
        }
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn main() {
    let result = tauri::Builder::default()
        .on_permission_request(|webview, kind| {
            use tauri::webview::{PermissionKind, PermissionResponse};
            let trusted = webview.label() == "main"
                && webview
                    .url()
                    .map(|url| {
                        (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                            || (matches!(url.scheme(), "http" | "https")
                                && url.host_str() == Some("tauri.localhost"))
                            || (cfg!(debug_assertions)
                                && url.scheme() == "http"
                                && url.host_str() == Some("localhost")
                                && url.port() == Some(1420))
                    })
                    .unwrap_or(false);
            if trusted && matches!(kind, PermissionKind::Microphone) {
                PermissionResponse::Allow
            } else {
                PermissionResponse::Default
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            identity_public,
            identity_sign,
            identity_export,
            identity_import,
 open_external
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("Licra startup failed: {e}");
        std::process::exit(1)
    }
}
