use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const COMMAND_BAR_WINDOW_LABEL: &str = "command-bar";
const COMMAND_BAR_WINDOW_ROUTE: &str = "/desktop/command-bar";
const DEFAULT_SHORTCUT_PRESET_ID: &str = "cmd_or_ctrl_shift_k";

struct CommandBarShortcutState {
    active_preset: Mutex<String>,
    /// PID of the app that was frontmost before the command bar opened.
    /// On dismiss we reactivate this app so focus returns there (e.g. browser)
    /// instead of falling through to the main Kompose window.
    #[cfg(target_os = "macos")]
    previous_frontmost_pid: Mutex<i32>,
}

impl Default for CommandBarShortcutState {
    fn default() -> Self {
        Self {
            active_preset: Mutex::new(DEFAULT_SHORTCUT_PRESET_ID.to_string()),
            #[cfg(target_os = "macos")]
            previous_frontmost_pid: Mutex::new(-1),
        }
    }
}

/// Returns the PID of the currently frontmost (active) application.
#[cfg(target_os = "macos")]
fn get_frontmost_app_pid() -> i32 {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: *mut Object = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return -1;
        }
        msg_send![app, processIdentifier]
    }
}

/// Hides the entire application and activates the previously active app.
/// This is the macOS equivalent of Cmd+H and is atomic — no intermediate
/// state where the main window is visible, so there's no flicker.
#[cfg(target_os = "macos")]
fn hide_app() {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let ns_app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![ns_app, hide: std::ptr::null::<Object>()];
    }
}

#[cfg(desktop)]
fn primary_modifier() -> Modifiers {
    #[cfg(target_os = "macos")]
    {
        return Modifiers::SUPER;
    }
    #[cfg(not(target_os = "macos"))]
    {
        return Modifiers::CONTROL;
    }
}

#[cfg(desktop)]
fn shortcut_for_preset(preset_id: &str) -> Option<Shortcut> {
    let primary = primary_modifier();

    let shortcut = match preset_id {
        "cmd_or_ctrl_shift_k" => Shortcut::new(Some(primary | Modifiers::SHIFT), Code::KeyK),
        "ctrl_space" => Shortcut::new(Some(Modifiers::CONTROL), Code::Space),
        "alt_space" => Shortcut::new(Some(Modifiers::ALT), Code::Space),
        _ => return None,
    };

    Some(shortcut)
}

#[cfg(desktop)]
fn register_shortcut_preset(app: &tauri::AppHandle, preset_id: &str) -> Result<(), String> {
    let shortcut = shortcut_for_preset(preset_id)
        .ok_or_else(|| format!("Unsupported command bar shortcut preset '{}'.", preset_id))?;
    app.global_shortcut().register(shortcut).map_err(|error| {
        format!(
            "Failed to register shortcut preset '{}': {}",
            preset_id, error
        )
    })?;
    Ok(())
}

#[cfg(desktop)]
fn unregister_shortcut_preset(app: &tauri::AppHandle, preset_id: &str) {
    let Some(shortcut) = shortcut_for_preset(preset_id) else {
        return;
    };
    if let Err(error) = app.global_shortcut().unregister(shortcut) {
        log::warn!(
            "Failed to unregister shortcut preset '{}': {}",
            preset_id,
            error
        );
    }
}

#[cfg(desktop)]
fn create_command_bar_window(app: &tauri::App) -> tauri::Result<()> {
    if app.get_webview_window(COMMAND_BAR_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let command_bar_window = tauri::WebviewWindowBuilder::new(
        app,
        COMMAND_BAR_WINDOW_LABEL,
        tauri::WebviewUrl::App(COMMAND_BAR_WINDOW_ROUTE.into()),
    )
    .title("Kompose Command Bar")
    .visible(false)
    .focused(false)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .inner_size(480.0, 56.0)
    .build()?;

    // Hide the popup when focus leaves the command bar window (e.g. user
    // clicks another app). For programmatic Esc-dismiss the frontend calls
    // the dismiss_command_bar command which activates the previous app first.
    let window_handle = command_bar_window.clone();
    command_bar_window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            let _ = window_handle.hide();
        }
    });

    Ok(())
}

#[cfg(desktop)]
fn toggle_command_bar_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(command_bar_window) = app.get_webview_window(COMMAND_BAR_WINDOW_LABEL) else {
        return Ok(());
    };

    if command_bar_window.is_visible()? {
        command_bar_window.hide()?;
        return Ok(());
    }

    // Snapshot the frontmost app before we steal focus so we can
    // reactivate it when the command bar is dismissed.
    #[cfg(target_os = "macos")]
    {
        let pid = get_frontmost_app_pid();
        if let Ok(mut guard) = app
            .state::<CommandBarShortcutState>()
            .previous_frontmost_pid
            .lock()
        {
            *guard = pid;
        }
    }

    command_bar_window.show()?;
    let _ = command_bar_window.center();
    command_bar_window.set_focus()?;
    Ok(())
}

#[tauri::command]
fn set_command_bar_shortcut_preset(
    app: tauri::AppHandle,
    state: tauri::State<CommandBarShortcutState>,
    preset_id: String,
) -> Result<(), String> {
    #[cfg(not(desktop))]
    {
        let _ = app;
        let _ = state;
        let _ = preset_id;
        return Ok(());
    }

    #[cfg(desktop)]
    {
        let next_preset = preset_id.trim().to_string();
        if shortcut_for_preset(&next_preset).is_none() {
            return Err(format!(
                "Unsupported command bar shortcut preset '{}'.",
                next_preset
            ));
        }

        let previous_preset = {
            let guard = state
                .active_preset
                .lock()
                .map_err(|_| "Failed to lock command bar preset state.".to_string())?;
            guard.clone()
        };

        if previous_preset == next_preset {
            return Ok(());
        }

        unregister_shortcut_preset(&app, &previous_preset);
        register_shortcut_preset(&app, &next_preset)
            .map_err(|error| format!("Failed to register new shortcut: {}", error))?;

        {
            let mut guard = state
                .active_preset
                .lock()
                .map_err(|_| "Failed to lock command bar preset state.".to_string())?;
            *guard = next_preset;
        }
    }

    Ok(())
}

/// Dismiss the command bar window, restoring focus to whichever app was
/// frontmost before the command bar opened.
///
/// On macOS, if the previous app was external (browser, etc.) we use
/// `[NSApp hide:]` which atomically hides all Kompose windows and
/// activates the previous app — no flicker. The command bar is then
/// marked hidden in Tauri so it stays hidden when the user returns to
/// Kompose (the main window reappears normally on dock click / Cmd+Tab).
///
/// If the previous app was Kompose itself, we just hide the command bar
/// and let the main window keep focus.
#[tauri::command]
fn dismiss_command_bar(app: tauri::AppHandle) {
    #[cfg(desktop)]
    {
        #[cfg(target_os = "macos")]
        {
            let stored_pid = app
                .state::<CommandBarShortcutState>()
                .previous_frontmost_pid
                .lock()
                .map(|v| *v)
                .unwrap_or(-1);

            let our_pid = std::process::id() as i32;

            if stored_pid > 0 && stored_pid != our_pid {
                // Atomic hide + activate previous app — no flicker.
                hide_app();
                // Mark command bar as hidden so it doesn't reappear on unhide.
                if let Some(win) = app.get_webview_window(COMMAND_BAR_WINDOW_LABEL) {
                    let _ = win.hide();
                }
                return;
            }
        }

        // Same-app case (or non-macOS): just hide the command bar window.
        if let Some(win) = app.get_webview_window(COMMAND_BAR_WINDOW_LABEL) {
            let _ = win.hide();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(CommandBarShortcutState::default())
        // Register kompose:// deep link handler for OAuth callbacks.
        .plugin(tauri_plugin_deep_link::init())
        // Allow opening external URLs/files in the system handlers.
        .plugin(tauri_plugin_opener::init())
        // Persistent key-value store for auth tokens and app settings.
        .plugin(tauri_plugin_store::Builder::new().build())
        // Enable auto-update support for desktop builds.
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if let Err(error) = toggle_command_bar_window(app) {
                    log::warn!("Failed to toggle command bar window: {}", error);
                }
            })
            .build(),
    );

    builder
        .invoke_handler(tauri::generate_handler![
            set_command_bar_shortcut_preset,
            dismiss_command_bar
        ])
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

            #[cfg(desktop)]
            {
                create_command_bar_window(app)?;
                if let Err(error) =
                    register_shortcut_preset(app.handle(), DEFAULT_SHORTCUT_PRESET_ID)
                {
                    log::warn!("Failed to register default command bar shortcut: {}", error);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
