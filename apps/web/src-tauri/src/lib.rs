use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Register kompose:// deep link handler for OAuth callbacks.
    .plugin(tauri_plugin_deep_link::init())
    // Allow opening external URLs/files in the system handlers.
    .plugin(tauri_plugin_opener::init())
    // Persistent key-value store for auth tokens and app settings.
    .plugin(tauri_plugin_store::Builder::new().build())
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

      // Log deep link URLs received on startup (e.g. kompose://auth/callback?token=...).
      // The frontend DeepLinkHandler component listens via the JS API for runtime events.
      if let Some(urls) = app.deep_link().get_current()? {
        log::info!("App opened via deep link: {:?}", urls);
      }

      // Listen for deep link events while the app is running.
      app.deep_link().on_open_url(|event| {
        log::info!("Deep link received: {:?}", event.urls());
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
