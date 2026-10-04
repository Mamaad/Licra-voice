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
fn main() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            identity_public,
            identity_sign,
            identity_export,
            identity_import
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("Licra startup failed: {e}");
        std::process::exit(1)
    }
}
