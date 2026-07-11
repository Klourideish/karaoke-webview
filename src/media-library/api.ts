import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LibraryIndexLoadResult, LibraryScanResult, LibrarySettings } from "./types";

export function loadLibrarySettings(): Promise<LibrarySettings> {
  return invoke<LibrarySettings>("load_library_settings");
}

export function saveLibraryRoot(rootPath: string): Promise<LibrarySettings> {
  return invoke<LibrarySettings>("save_library_root", { rootPath });
}

export function loadLibraryIndex(rootPath: string): Promise<LibraryIndexLoadResult> {
  return invoke<LibraryIndexLoadResult>("load_library_index", { rootPath });
}

export function saveLibraryIndex(scanResult: LibraryScanResult): Promise<void> {
  return invoke("save_library_index", { scanResult });
}

export function clearLibraryIndex(rootPath: string): Promise<void> {
  return invoke("clear_library_index", { rootPath });
}

export function scanMediaLibrary(rootPath: string): Promise<LibraryScanResult> {
  return invoke<LibraryScanResult>("scan_media_library", { rootPath });
}

export async function chooseLibraryFolder(): Promise<string | null> {
  const selection = await open({
    directory: true,
    multiple: false,
    title: "Choose music folder",
  });

  return typeof selection === "string" ? selection : null;
}
