use std::{path::Path, path::PathBuf, sync::Mutex};

use serde::Serialize;

use super::{
    models::{LibraryIndex, LibraryScanResult, LibrarySettings},
    persistence::{
        read_library_settings, same_root, write_library_index_atomically, write_library_settings,
    },
    scanner::{path_to_string, scan_media_library_path},
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum LibraryRefreshErrorCode {
    FolderUnavailable,
    RootNotSelected,
    ScanFailed,
    SettingsFailed,
    IndexFailed,
    RollbackFailed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryRefreshError {
    pub reason_code: LibraryRefreshErrorCode,
    pub message: String,
}

impl LibraryRefreshError {
    pub(crate) fn new(reason_code: LibraryRefreshErrorCode, message: impl Into<String>) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}

#[derive(Default)]
pub(crate) struct MediaLibraryRefreshCoordinator {
    operations: Mutex<()>,
}

impl MediaLibraryRefreshCoordinator {
    pub(crate) fn select_and_refresh(
        &self,
        settings_path: &Path,
        index_path: &Path,
        root_path: String,
    ) -> Result<LibraryScanResult, LibraryRefreshError> {
        let _operation = lock(&self.operations);
        let root = available_root(root_path)?;
        let scan_result = scan(root)?;
        let previous_settings = read_library_settings(settings_path).map_err(|_| {
            LibraryRefreshError::new(
                LibraryRefreshErrorCode::SettingsFailed,
                "Could not read the current library location.",
            )
        })?;
        let selected_settings = LibrarySettings {
            library_root: Some(scan_result.root_path.clone()),
        };
        write_library_settings(settings_path, &selected_settings).map_err(|_| {
            LibraryRefreshError::new(
                LibraryRefreshErrorCode::SettingsFailed,
                "Could not save the selected library location.",
            )
        })?;
        if write_library_index_atomically(index_path, &LibraryIndex::from(scan_result.clone()))
            .is_err()
        {
            if write_library_settings(settings_path, &previous_settings).is_err() {
                return Err(LibraryRefreshError::new(
                    LibraryRefreshErrorCode::RollbackFailed,
                    "The library could not be updated and its previous location could not be restored.",
                ));
            }
            return Err(LibraryRefreshError::new(
                LibraryRefreshErrorCode::IndexFailed,
                "Could not save the refreshed library.",
            ));
        }
        Ok(scan_result)
    }

    pub(crate) fn rescan(
        &self,
        settings_path: &Path,
        index_path: &Path,
        root_path: String,
    ) -> Result<LibraryScanResult, LibraryRefreshError> {
        let _operation = lock(&self.operations);
        let root = available_root(root_path)?;
        let settings = read_library_settings(settings_path).map_err(|_| {
            LibraryRefreshError::new(
                LibraryRefreshErrorCode::SettingsFailed,
                "Could not read the selected library location.",
            )
        })?;
        if !settings
            .library_root
            .as_ref()
            .is_some_and(|selected| same_root(selected, &path_to_string(&root)))
        {
            return Err(LibraryRefreshError::new(
                LibraryRefreshErrorCode::RootNotSelected,
                "Choose this folder as the library location before rescanning it.",
            ));
        }
        let scan_result = scan(root)?;
        write_library_index_atomically(index_path, &LibraryIndex::from(scan_result.clone()))
            .map_err(|_| {
                LibraryRefreshError::new(
                    LibraryRefreshErrorCode::IndexFailed,
                    "Could not save the refreshed library.",
                )
            })?;
        Ok(scan_result)
    }
}

fn available_root(root_path: String) -> Result<PathBuf, LibraryRefreshError> {
    let path = PathBuf::from(root_path);
    if !path.is_dir() {
        return Err(LibraryRefreshError::new(
            LibraryRefreshErrorCode::FolderUnavailable,
            "The selected library folder is not available.",
        ));
    }
    path.canonicalize().map_err(|_| {
        LibraryRefreshError::new(
            LibraryRefreshErrorCode::FolderUnavailable,
            "The selected library folder is not available.",
        )
    })
}

fn scan(root: PathBuf) -> Result<LibraryScanResult, LibraryRefreshError> {
    scan_media_library_path(root).map_err(|_| {
        LibraryRefreshError::new(
            LibraryRefreshErrorCode::ScanFailed,
            "The selected library folder could not be scanned.",
        )
    })
}

fn lock(inner: &Mutex<()>) -> std::sync::MutexGuard<'_, ()> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc, thread};

    use tempfile::TempDir;

    use super::*;
    use crate::media_library::persistence::load_library_index_for_root;

    fn write_song(root: &Path, artist: &str, title: &str) {
        fs::create_dir_all(root).unwrap();
        let stem = format!("{artist} - {title}");
        fs::write(root.join(format!("{stem}.opus")), "").unwrap();
        fs::write(root.join(format!("{stem}.ttml")), "").unwrap();
    }

    #[test]
    fn selecting_location_scans_and_persists_one_complete_result() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("Music");
        let settings = temp.path().join("settings.json");
        let index = temp.path().join("index.json");
        write_song(&root, "Adele", "Hello");

        let result = MediaLibraryRefreshCoordinator::default()
            .select_and_refresh(&settings, &index, root.to_string_lossy().into_owned())
            .unwrap();

        assert_eq!(result.songs.len(), 1);
        assert!(read_library_settings(&settings)
            .unwrap()
            .library_root
            .is_some_and(|selected| same_root(&selected, &result.root_path)));
        assert_eq!(
            load_library_index_for_root(&index, &result.root_path)
                .unwrap()
                .scan_result
                .unwrap(),
            result
        );
    }

    #[test]
    fn rescan_replaces_index_without_duplicate_songs() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("Music");
        let settings = temp.path().join("settings.json");
        let index = temp.path().join("index.json");
        let coordinator = MediaLibraryRefreshCoordinator::default();
        write_song(&root, "Adele", "Hello");
        coordinator
            .select_and_refresh(&settings, &index, root.to_string_lossy().into_owned())
            .unwrap();
        write_song(&root, "Queen", "Radio Ga Ga");

        let first = coordinator
            .rescan(&settings, &index, root.to_string_lossy().into_owned())
            .unwrap();
        let repeated = coordinator
            .rescan(&settings, &index, root.to_string_lossy().into_owned())
            .unwrap();

        assert_eq!(first.songs.len(), 2);
        assert_eq!(repeated.songs.len(), 2);
        assert_eq!(first.songs, repeated.songs);
    }

    #[test]
    fn refresh_failure_preserves_previous_location_and_index() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("Music");
        let settings = temp.path().join("settings.json");
        let index = temp.path().join("index.json");
        let coordinator = MediaLibraryRefreshCoordinator::default();
        write_song(&root, "Adele", "Hello");
        let previous = coordinator
            .select_and_refresh(&settings, &index, root.to_string_lossy().into_owned())
            .unwrap();

        let error = coordinator
            .select_and_refresh(
                &settings,
                &index,
                temp.path().join("Missing").to_string_lossy().into_owned(),
            )
            .unwrap_err();

        assert_eq!(
            error.reason_code,
            LibraryRefreshErrorCode::FolderUnavailable
        );
        assert!(read_library_settings(&settings)
            .unwrap()
            .library_root
            .is_some_and(|selected| same_root(&selected, &previous.root_path)));
        assert_eq!(
            load_library_index_for_root(&index, &previous.root_path)
                .unwrap()
                .scan_result,
            Some(previous)
        );
    }

    #[test]
    fn index_failure_rolls_back_selected_location() {
        let temp = TempDir::new().unwrap();
        let old_root = temp.path().join("Old");
        let new_root = temp.path().join("New");
        let settings = temp.path().join("settings.json");
        let blocked_parent = temp.path().join("not-a-directory");
        fs::create_dir_all(&old_root).unwrap();
        write_song(&new_root, "Adele", "Hello");
        write_library_settings(
            &settings,
            &LibrarySettings {
                library_root: Some(path_to_string(&old_root)),
            },
        )
        .unwrap();
        fs::write(&blocked_parent, "blocked").unwrap();

        let error = MediaLibraryRefreshCoordinator::default()
            .select_and_refresh(
                &settings,
                &blocked_parent.join("index.json"),
                new_root.to_string_lossy().into_owned(),
            )
            .unwrap_err();

        assert_eq!(error.reason_code, LibraryRefreshErrorCode::IndexFailed);
        assert!(read_library_settings(&settings)
            .unwrap()
            .library_root
            .is_some_and(|selected| same_root(&selected, &path_to_string(&old_root))));
    }

    #[test]
    fn concurrent_rescans_are_serialized_and_leave_a_readable_index() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("Music");
        let settings = temp.path().join("settings.json");
        let index = temp.path().join("index.json");
        let coordinator = Arc::new(MediaLibraryRefreshCoordinator::default());
        write_song(&root, "Adele", "Hello");
        let selected = coordinator
            .select_and_refresh(&settings, &index, root.to_string_lossy().into_owned())
            .unwrap();

        let workers = (0..2)
            .map(|_| {
                let coordinator = Arc::clone(&coordinator);
                let settings = settings.clone();
                let index = index.clone();
                let root = root.clone();
                thread::spawn(move || {
                    coordinator.rescan(&settings, &index, root.to_string_lossy().into_owned())
                })
            })
            .collect::<Vec<_>>();

        for worker in workers {
            assert_eq!(worker.join().unwrap().unwrap().songs.len(), 1);
        }
        assert_eq!(
            load_library_index_for_root(&index, &selected.root_path)
                .unwrap()
                .scan_result
                .unwrap()
                .songs
                .len(),
            1
        );
    }
}
