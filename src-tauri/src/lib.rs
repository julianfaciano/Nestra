mod design_import;
mod historical_import;
mod native_png;
mod pdf_prototype;
mod png_export;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(png_export::ExportService::default())
        .manage(pdf_prototype::PdfPrototype::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::include_image!("./icons/32x32.png"))?;
            }

            Ok(())
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                native_png::cancel_abandoned(&webview.state::<png_export::ExportService>());
                pdf_prototype::clear(&webview.state::<pdf_prototype::PdfPrototype>());
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                native_png::cancel_abandoned(&window.state::<png_export::ExportService>());
                pdf_prototype::clear(&window.state::<pdf_prototype::PdfPrototype>());
            }
        })
        .invoke_handler(tauri::generate_handler![
            design_import::choose_design_folder,
            design_import::choose_free_png,
            design_import::read_design_folder_from_path,
            historical_import::choose_historical_jobs,
            historical_import::load_historical_thumbnail,
            historical_import::delete_historical_thumbnail,
            png_export::choose_export_folder,
            png_export::resolve_export_destination,
            png_export::choose_export_file,
            png_export::begin_png,
            png_export::write_png_strip,
            png_export::finish_png,
            png_export::abort_png,
            native_png::begin_native_export,
            native_png::upload_png_source,
            native_png::render_native_png,
            native_png::close_native_export,
            pdf_prototype::begin_pdf_prototype,
            pdf_prototype::upload_pdf_source,
            pdf_prototype::finish_pdf_prototype,
            pdf_prototype::close_pdf_prototype
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Nestra");
}
