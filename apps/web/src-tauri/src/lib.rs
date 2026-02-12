use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Enable auto-update support for desktop builds.
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Ensure release desktop builds open in a maximized window state.
      // Some environments ignore the static "maximized" config at first launch.
      if !cfg!(debug_assertions) {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.maximize();
        }
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
