use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::Manager;

const LIBRARY_INDEX_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MediaSong {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub display_name: String,
    pub directory_path: String,
    pub audio_path: String,
    pub lyric_path: String,
    pub file_stem: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LibraryIssueKind {
    MissingAudio,
    MissingLyrics,
    DuplicateAudio,
    DuplicateLyrics,
    InvalidName,
    UnreadableDirectory,
    UnsupportedEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIssue {
    pub id: String,
    pub kind: LibraryIssueKind,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScanResult {
    pub root_path: String,
    pub songs: Vec<MediaSong>,
    pub issues: Vec<LibraryIssue>,
    pub scanned_directory_count: usize,
    pub scanned_file_count: usize,
    pub supported_file_count: usize,
    pub audio_file_count: usize,
    pub lyric_file_count: usize,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
    pub library_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndex {
    pub schema_version: u32,
    pub root_path: String,
    pub songs: Vec<MediaSong>,
    pub issues: Vec<LibraryIssue>,
    pub scanned_directory_count: usize,
    pub scanned_file_count: usize,
    pub supported_file_count: usize,
    pub audio_file_count: usize,
    pub lyric_file_count: usize,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LibraryIndexLoadStatus {
    Hit,
    Miss,
    Corrupt,
    RootMismatch,
    UnsupportedSchema,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndexLoadResult {
    pub status: LibraryIndexLoadStatus,
    pub scan_result: Option<LibraryScanResult>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAudioSource {
    pub song_id: String,
    pub audio_path: String,
}

#[derive(Debug, Default)]
struct ScanAccumulator {
    candidates: Vec<CandidateFile>,
    issues: Vec<LibraryIssue>,
    scanned_directory_count: usize,
    scanned_file_count: usize,
    audio_file_count: usize,
    lyric_file_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CandidateKind {
    Audio,
    Lyrics,
}

#[derive(Debug, Clone)]
struct CandidateFile {
    directory_path: PathBuf,
    file_path: PathBuf,
    file_stem: String,
    stem_key: String,
    kind: CandidateKind,
}

#[tauri::command]
pub fn scan_media_library(root_path: String) -> Result<LibraryScanResult, String> {
    scan_media_library_path(PathBuf::from(root_path)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_library_settings(app: tauri::AppHandle) -> Result<LibrarySettings, String> {
    read_library_settings(&settings_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_library_root(
    app: tauri::AppHandle,
    root_path: String,
) -> Result<LibrarySettings, String> {
    let path = PathBuf::from(root_path);
    if !path.is_dir() {
        return Err("The selected library folder is not available.".to_string());
    }

    let settings = LibrarySettings {
        library_root: Some(path_to_string(&path)),
    };
    write_library_settings(&settings_path(&app)?, &settings).map_err(|error| error.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub fn load_library_index(
    app: tauri::AppHandle,
    root_path: String,
) -> Result<LibraryIndexLoadResult, String> {
    load_library_index_for_root(&library_index_path(&app)?, &root_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_library_index(
    app: tauri::AppHandle,
    scan_result: LibraryScanResult,
) -> Result<(), String> {
    let settings =
        read_library_settings(&settings_path(&app)?).map_err(|error| error.to_string())?;
    if !settings
        .library_root
        .as_ref()
        .is_some_and(|root_path| same_root(root_path, &scan_result.root_path))
    {
        return Err("The library folder changed before the index could be saved.".to_string());
    }

    write_library_index_atomically(&library_index_path(&app)?, &LibraryIndex::from(scan_result))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_library_index(app: tauri::AppHandle, root_path: String) -> Result<(), String> {
    clear_library_index_for_root(&library_index_path(&app)?, &root_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resolve_audio_source(
    app: tauri::AppHandle,
    song: MediaSong,
) -> Result<ResolvedAudioSource, String> {
    let resolved = resolve_audio_source_for_song(&settings_path(&app)?, song)
        .map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_file(&resolved.audio_path)
        .map_err(|error| {
            eprintln!("Could not allow audio file through asset protocol: {error}");
            "Could not access this audio file.".to_string()
        })?;
    Ok(resolved)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|_| "Could not locate the application settings folder.".to_string())?;
    Ok(config_dir.join("settings.json"))
}

fn library_index_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Could not locate the application data folder.".to_string())?;
    Ok(data_dir.join("library-index.json"))
}

fn read_library_settings(path: &Path) -> Result<LibrarySettings, SettingsError> {
    if !path.exists() {
        return Ok(LibrarySettings { library_root: None });
    }

    let contents = fs::read_to_string(path)
        .map_err(|source| SettingsError::new("Could not read library settings.", source))?;
    serde_json::from_str(&contents)
        .map_err(|source| SettingsError::new("Could not parse library settings.", source))
}

fn write_library_settings(path: &Path, settings: &LibrarySettings) -> Result<(), SettingsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| {
            SettingsError::new("Could not create the application settings folder.", source)
        })?;
    }

    let contents = serde_json::to_string_pretty(settings)
        .map_err(|source| SettingsError::new("Could not serialize library settings.", source))?;
    fs::write(path, contents)
        .map_err(|source| SettingsError::new("Could not save library settings.", source))
}

impl From<LibraryScanResult> for LibraryIndex {
    fn from(scan_result: LibraryScanResult) -> Self {
        Self {
            schema_version: LIBRARY_INDEX_SCHEMA_VERSION,
            root_path: scan_result.root_path,
            songs: scan_result.songs,
            issues: scan_result.issues,
            scanned_directory_count: scan_result.scanned_directory_count,
            scanned_file_count: scan_result.scanned_file_count,
            supported_file_count: scan_result.supported_file_count,
            audio_file_count: scan_result.audio_file_count,
            lyric_file_count: scan_result.lyric_file_count,
            completed_at: scan_result.completed_at,
        }
    }
}

impl From<LibraryIndex> for LibraryScanResult {
    fn from(index: LibraryIndex) -> Self {
        Self {
            root_path: index.root_path,
            songs: index.songs,
            issues: index.issues,
            scanned_directory_count: index.scanned_directory_count,
            scanned_file_count: index.scanned_file_count,
            supported_file_count: index.supported_file_count,
            audio_file_count: index.audio_file_count,
            lyric_file_count: index.lyric_file_count,
            completed_at: index.completed_at,
        }
    }
}

fn load_library_index_for_root(
    path: &Path,
    root_path: &str,
) -> Result<LibraryIndexLoadResult, IndexError> {
    if !path.exists() {
        return Ok(index_load_result(LibraryIndexLoadStatus::Miss, None, None));
    }

    let contents = fs::read_to_string(path)
        .map_err(|source| IndexError::new("Could not read the library index.", source))?;
    let index: LibraryIndex = match serde_json::from_str(&contents) {
        Ok(index) => index,
        Err(error) => {
            eprintln!("Could not parse the library index. {error}");
            return Ok(index_load_result(
                LibraryIndexLoadStatus::Corrupt,
                None,
                Some("The saved library index could not be read, so the library will be scanned again."),
            ));
        }
    };

    if index.schema_version != LIBRARY_INDEX_SCHEMA_VERSION {
        return Ok(index_load_result(
            LibraryIndexLoadStatus::UnsupportedSchema,
            None,
            Some("The saved library index uses an unsupported format and will be rebuilt."),
        ));
    }

    if !same_root(&index.root_path, root_path) {
        return Ok(index_load_result(
            LibraryIndexLoadStatus::RootMismatch,
            None,
            None,
        ));
    }

    Ok(index_load_result(
        LibraryIndexLoadStatus::Hit,
        Some(index.into()),
        None,
    ))
}

fn write_library_index_atomically(path: &Path, index: &LibraryIndex) -> Result<(), IndexError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| {
            IndexError::new("Could not create the application data folder.", source)
        })?;
    }

    let contents = serde_json::to_vec_pretty(index)
        .map_err(|source| IndexError::new("Could not serialize the library index.", source))?;
    let temporary_path = path.with_extension("json.tmp");

    {
        let mut file = File::create(&temporary_path).map_err(|source| {
            IndexError::new("Could not create a temporary library index.", source)
        })?;
        file.write_all(&contents)
            .map_err(|source| IndexError::new("Could not write the library index.", source))?;
        file.sync_all()
            .map_err(|source| IndexError::new("Could not flush the library index.", source))?;
    }

    if !path.exists() {
        return fs::rename(&temporary_path, path).map_err(|source| {
            let _ = fs::remove_file(&temporary_path);
            IndexError::new("Could not save the library index.", source)
        });
    }

    let backup_path = path.with_extension("json.bak");
    let _ = fs::remove_file(&backup_path);
    fs::rename(path, &backup_path).map_err(|source| {
        let _ = fs::remove_file(&temporary_path);
        IndexError::new(
            "Could not prepare the previous library index for replacement.",
            source,
        )
    })?;

    match fs::rename(&temporary_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup_path);
            Ok(())
        }
        Err(source) => {
            let _ = fs::rename(&backup_path, path);
            let _ = fs::remove_file(&temporary_path);
            Err(IndexError::new("Could not save the library index.", source))
        }
    }
}

fn clear_library_index_for_root(path: &Path, root_path: &str) -> Result<(), IndexError> {
    if !path.exists() {
        return Ok(());
    }

    match load_library_index_for_root(path, root_path)? {
        LibraryIndexLoadResult {
            status: LibraryIndexLoadStatus::Hit | LibraryIndexLoadStatus::Corrupt,
            ..
        } => fs::remove_file(path)
            .map_err(|source| IndexError::new("Could not clear the library index.", source)),
        _ => Ok(()),
    }
}

fn index_load_result(
    status: LibraryIndexLoadStatus,
    scan_result: Option<LibraryScanResult>,
    message: Option<&str>,
) -> LibraryIndexLoadResult {
    LibraryIndexLoadResult {
        status,
        scan_result,
        message: message.map(str::to_string),
    }
}

fn same_root(left: &str, right: &str) -> bool {
    normalize_root_for_cache(left) == normalize_root_for_cache(right)
}

fn normalize_root_for_cache(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn resolve_audio_source_for_song(
    settings_path: &Path,
    song: MediaSong,
) -> Result<ResolvedAudioSource, PlaybackSourceError> {
    let settings = read_library_settings(settings_path).map_err(PlaybackSourceError::settings)?;
    let root_path = settings
        .library_root
        .ok_or_else(|| PlaybackSourceError::message("Choose a music folder before playback."))?;
    let root_path = PathBuf::from(root_path).canonicalize().map_err(|source| {
        PlaybackSourceError::new("The selected library folder is not available.", source)
    })?;
    let audio_path = PathBuf::from(&song.audio_path)
        .canonicalize()
        .map_err(|source| {
            PlaybackSourceError::new("The audio file is no longer available.", source)
        })?;
    let lyric_path = PathBuf::from(&song.lyric_path)
        .canonicalize()
        .map_err(|source| {
            PlaybackSourceError::new("The matching lyric file is no longer available.", source)
        })?;

    validate_media_path(
        &root_path,
        &audio_path,
        "opus",
        "The audio file is no longer available.",
    )?;
    validate_media_path(
        &root_path,
        &lyric_path,
        "ttml",
        "The matching lyric file is no longer available.",
    )?;

    let expected_id = song_id(&audio_path, &lyric_path);
    if song.id != expected_id {
        return Err(PlaybackSourceError::message(
            "This song no longer matches the selected library.",
        ));
    }

    Ok(ResolvedAudioSource {
        song_id: song.id,
        audio_path: path_to_string(&audio_path),
    })
}

fn validate_media_path(
    root_path: &Path,
    media_path: &Path,
    expected_extension: &str,
    missing_message: &'static str,
) -> Result<(), PlaybackSourceError> {
    if !media_path.starts_with(root_path) {
        return Err(PlaybackSourceError::message(
            "This audio file is outside the selected library folder.",
        ));
    }

    if !media_path.is_file() {
        return Err(PlaybackSourceError::message(missing_message));
    }

    let extension = media_path
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase());
    if extension.as_deref() != Some(expected_extension) {
        return Err(PlaybackSourceError::message(
            "This audio format could not be played.",
        ));
    }

    Ok(())
}

#[derive(Debug)]
struct SettingsError {
    message: &'static str,
}

impl SettingsError {
    fn new(message: &'static str, source: impl std::fmt::Display) -> Self {
        eprintln!("{message} {source}");
        Self { message }
    }
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

#[derive(Debug)]
struct IndexError {
    message: &'static str,
}

impl IndexError {
    fn new(message: &'static str, source: impl std::fmt::Display) -> Self {
        eprintln!("{message} {source}");
        Self { message }
    }
}

impl std::fmt::Display for IndexError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

#[derive(Debug)]
struct PlaybackSourceError {
    message: String,
}

impl PlaybackSourceError {
    fn new(message: &'static str, source: impl std::fmt::Display) -> Self {
        eprintln!("{message} {source}");
        Self {
            message: message.to_string(),
        }
    }

    fn message(message: &'static str) -> Self {
        Self {
            message: message.to_string(),
        }
    }

    fn settings(error: SettingsError) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

impl std::fmt::Display for PlaybackSourceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

fn scan_media_library_path(root_path: PathBuf) -> Result<LibraryScanResult, ScanError> {
    let root_path = root_path.canonicalize().map_err(|source| {
        ScanError::new("The selected library folder is not available.", source)
    })?;

    if !root_path.is_dir() {
        return Err(ScanError::message(
            "The selected library path is not a folder.",
        ));
    }

    let mut accumulator = ScanAccumulator::default();
    scan_directory(&root_path, &root_path, &mut accumulator);
    Ok(build_scan_result(root_path, accumulator))
}

fn scan_directory(root_path: &Path, directory_path: &Path, accumulator: &mut ScanAccumulator) {
    accumulator.scanned_directory_count += 1;

    let entries = match fs::read_dir(directory_path) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!(
                "Could not read directory {}: {error}",
                directory_path.display()
            );
            accumulator.issues.push(make_issue(
                LibraryIssueKind::UnreadableDirectory,
                root_path,
                directory_path,
                "This folder could not be read.",
            ));
            return;
        }
    };

    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                eprintln!(
                    "Could not read a directory entry in {}: {error}",
                    directory_path.display()
                );
                accumulator.issues.push(make_issue(
                    LibraryIssueKind::UnreadableDirectory,
                    root_path,
                    directory_path,
                    "A folder entry could not be read.",
                ));
                continue;
            }
        };

        let entry_path = entry.path();
        let metadata = match fs::symlink_metadata(&entry_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                eprintln!("Could not inspect {}: {error}", entry_path.display());
                accumulator.issues.push(make_issue(
                    LibraryIssueKind::UnsupportedEntry,
                    root_path,
                    &entry_path,
                    "This entry could not be inspected.",
                ));
                continue;
            }
        };

        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            accumulator.issues.push(make_issue(
                LibraryIssueKind::UnsupportedEntry,
                root_path,
                &entry_path,
                "Symbolic links and junctions are skipped to avoid recursive loops.",
            ));
            continue;
        }

        if file_type.is_dir() {
            scan_directory(root_path, &entry_path, accumulator);
            continue;
        }

        if !file_type.is_file() {
            accumulator.issues.push(make_issue(
                LibraryIssueKind::UnsupportedEntry,
                root_path,
                &entry_path,
                "This filesystem entry is not a regular file.",
            ));
            continue;
        }

        accumulator.scanned_file_count += 1;
        if let Some(candidate) = candidate_from_path(directory_path, &entry_path) {
            match candidate.kind {
                CandidateKind::Audio => accumulator.audio_file_count += 1,
                CandidateKind::Lyrics => accumulator.lyric_file_count += 1,
            }
            accumulator.candidates.push(candidate);
        }
    }
}

fn candidate_from_path(directory_path: &Path, file_path: &Path) -> Option<CandidateFile> {
    let extension = file_path
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase();
    let kind = match extension.as_str() {
        "opus" => CandidateKind::Audio,
        "ttml" => CandidateKind::Lyrics,
        _ => return None,
    };
    let file_stem = file_path.file_stem()?.to_string_lossy().to_string();
    let stem_key = file_stem.to_lowercase();

    Some(CandidateFile {
        directory_path: directory_path.to_path_buf(),
        file_path: file_path.to_path_buf(),
        file_stem,
        stem_key,
        kind,
    })
}

fn build_scan_result(root_path: PathBuf, accumulator: ScanAccumulator) -> LibraryScanResult {
    let mut grouped: HashMap<(String, String), Vec<CandidateFile>> = HashMap::new();
    for candidate in accumulator.candidates {
        grouped
            .entry((
                path_key(&candidate.directory_path),
                candidate.stem_key.clone(),
            ))
            .or_default()
            .push(candidate);
    }

    let mut songs = Vec::new();
    let mut issues = accumulator.issues;

    for candidates in grouped.values() {
        let audio_files: Vec<&CandidateFile> = candidates
            .iter()
            .filter(|candidate| candidate.kind == CandidateKind::Audio)
            .collect();
        let lyric_files: Vec<&CandidateFile> = candidates
            .iter()
            .filter(|candidate| candidate.kind == CandidateKind::Lyrics)
            .collect();

        let primary = candidates
            .iter()
            .min_by(|left, right| path_key(&left.file_path).cmp(&path_key(&right.file_path)))
            .expect("candidate groups are never empty");

        if audio_files.len() > 1 {
            issues.push(make_issue(
                LibraryIssueKind::DuplicateAudio,
                &root_path,
                &primary.file_path,
                "More than one .opus file matches this filename stem in the same folder.",
            ));
        }

        if lyric_files.len() > 1 {
            issues.push(make_issue(
                LibraryIssueKind::DuplicateLyrics,
                &root_path,
                &primary.file_path,
                "More than one .ttml file matches this filename stem in the same folder.",
            ));
        }

        if audio_files.is_empty() {
            issues.push(make_issue(
                LibraryIssueKind::MissingAudio,
                &root_path,
                &primary.file_path,
                "This .ttml file has no matching .opus file in the same folder.",
            ));
        }

        if lyric_files.is_empty() {
            issues.push(make_issue(
                LibraryIssueKind::MissingLyrics,
                &root_path,
                &primary.file_path,
                "This .opus file has no matching .ttml file in the same folder.",
            ));
        }

        if audio_files.len() == 1 && lyric_files.len() == 1 {
            let audio_file = audio_files[0];
            let lyric_file = lyric_files[0];
            let (artist, title, valid_name) = parse_artist_title(&audio_file.file_stem);
            if !valid_name {
                issues.push(make_issue(
                    LibraryIssueKind::InvalidName,
                    &root_path,
                    &audio_file.file_path,
                    "The filename does not follow the Artist - Song naming convention.",
                ));
            }

            songs.push(MediaSong {
                id: song_id(&audio_file.file_path, &lyric_file.file_path),
                title,
                artist,
                display_name: audio_file.file_stem.clone(),
                directory_path: path_to_string(&audio_file.directory_path),
                audio_path: path_to_string(&audio_file.file_path),
                lyric_path: path_to_string(&lyric_file.file_path),
                file_stem: audio_file.file_stem.clone(),
            });
        }
    }

    songs.sort_by(compare_songs);
    issues.sort_by(|left, right| {
        left.path
            .to_lowercase()
            .cmp(&right.path.to_lowercase())
            .then_with(|| format!("{:?}", left.kind).cmp(&format!("{:?}", right.kind)))
    });

    LibraryScanResult {
        root_path: path_to_string(&root_path),
        songs,
        issues,
        scanned_directory_count: accumulator.scanned_directory_count,
        scanned_file_count: accumulator.scanned_file_count,
        supported_file_count: accumulator.audio_file_count + accumulator.lyric_file_count,
        audio_file_count: accumulator.audio_file_count,
        lyric_file_count: accumulator.lyric_file_count,
        completed_at: iso_like_timestamp(SystemTime::now()),
    }
}

fn compare_songs(left: &MediaSong, right: &MediaSong) -> std::cmp::Ordering {
    left.artist
        .to_lowercase()
        .cmp(&right.artist.to_lowercase())
        .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
        .then_with(|| {
            left.file_stem
                .to_lowercase()
                .cmp(&right.file_stem.to_lowercase())
        })
        .then_with(|| {
            left.directory_path
                .to_lowercase()
                .cmp(&right.directory_path.to_lowercase())
        })
}

fn parse_artist_title(stem: &str) -> (String, String, bool) {
    if let Some((artist, title)) = stem.split_once(" - ") {
        let artist = artist.trim().to_string();
        let title = title.trim().to_string();
        if !artist.is_empty() && !title.is_empty() {
            return (artist, title, true);
        }
    }

    ("".to_string(), fallback_title(stem), false)
}

fn fallback_title(stem: &str) -> String {
    let trimmed = stem.trim();
    if trimmed.is_empty() {
        "Untitled song".to_string()
    } else {
        trimmed.to_string()
    }
}

fn song_id(audio_path: &Path, lyric_path: &Path) -> String {
    let normalized = format!("{}|{}", path_key(audio_path), path_key(lyric_path));
    format!("song-{:016x}", fnv1a64(normalized.as_bytes()))
}

fn make_issue(
    kind: LibraryIssueKind,
    root_path: &Path,
    path: &Path,
    message: &'static str,
) -> LibraryIssue {
    let display_path = relative_or_absolute_path(root_path, path);
    let issue_key = format!("{kind:?}|{}", path_key(path));
    LibraryIssue {
        id: format!("issue-{:016x}", fnv1a64(issue_key.as_bytes())),
        kind,
        path: display_path,
        message: message.to_string(),
    }
}

fn relative_or_absolute_path(root_path: &Path, path: &Path) -> String {
    path.strip_prefix(root_path)
        .map(path_to_string)
        .unwrap_or_else(|_| path_to_string(path))
}

fn path_key(path: &Path) -> String {
    path_to_string(path).replace('\\', "/").to_lowercase()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn iso_like_timestamp(time: SystemTime) -> String {
    match time.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(duration) => format!("{}Z", duration.as_secs()),
        Err(_) => "0Z".to_string(),
    }
}

#[derive(Debug)]
struct ScanError {
    message: String,
}

impl ScanError {
    fn new(message: &'static str, source: impl std::fmt::Display) -> Self {
        eprintln!("{message} {source}");
        Self {
            message: message.to_string(),
        }
    }

    fn message(message: &'static str) -> Self {
        Self {
            message: message.to_string(),
        }
    }
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_empty_file(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, "").unwrap();
    }

    fn scan_temp(temp_dir: &TempDir) -> LibraryScanResult {
        scan_media_library_path(temp_dir.path().to_path_buf()).unwrap()
    }

    fn sample_scan_result(root_path: &Path) -> LibraryScanResult {
        let audio_path = root_path.join("Artist").join("Artist - Song.opus");
        let lyric_path = root_path.join("Artist").join("Artist - Song.ttml");
        LibraryScanResult {
            root_path: path_to_string(root_path),
            songs: vec![MediaSong {
                id: song_id(&audio_path, &lyric_path),
                title: "Song".to_string(),
                artist: "Artist".to_string(),
                display_name: "Artist - Song".to_string(),
                directory_path: path_to_string(&root_path.join("Artist")),
                audio_path: path_to_string(&audio_path),
                lyric_path: path_to_string(&lyric_path),
                file_stem: "Artist - Song".to_string(),
            }],
            issues: vec![LibraryIssue {
                id: "issue-test".to_string(),
                kind: LibraryIssueKind::InvalidName,
                path: "Loose Song.opus".to_string(),
                message: "The filename does not follow the Artist - Song naming convention."
                    .to_string(),
            }],
            scanned_directory_count: 2,
            scanned_file_count: 2,
            supported_file_count: 2,
            audio_file_count: 1,
            lyric_file_count: 1,
            completed_at: "1234Z".to_string(),
        }
    }

    fn write_settings(path: &Path, root_path: &Path) {
        write_library_settings(
            path,
            &LibrarySettings {
                library_root: Some(path_to_string(root_path)),
            },
        )
        .unwrap();
    }

    fn sample_song(root_path: &Path, stem: &str) -> MediaSong {
        let audio_path = root_path.join(format!("{stem}.opus"));
        let lyric_path = root_path.join(format!("{stem}.ttml"));
        let identity_audio_path = audio_path
            .canonicalize()
            .unwrap_or_else(|_| audio_path.clone());
        let identity_lyric_path = lyric_path
            .canonicalize()
            .unwrap_or_else(|_| lyric_path.clone());
        MediaSong {
            id: song_id(&identity_audio_path, &identity_lyric_path),
            title: stem.to_string(),
            artist: "".to_string(),
            display_name: stem.to_string(),
            directory_path: path_to_string(root_path),
            audio_path: path_to_string(&audio_path),
            lyric_path: path_to_string(&lyric_path),
            file_stem: stem.to_string(),
        }
    }

    #[test]
    fn resolves_valid_discovered_audio_path_under_selected_root() {
        let temp_dir = TempDir::new().unwrap();
        let settings_path = temp_dir.path().join("settings.json");
        let root_path = temp_dir.path().join("Music");
        fs::create_dir_all(&root_path).unwrap();
        write_empty_file(&root_path.join("Artist - Song.opus"));
        write_empty_file(&root_path.join("Artist - Song.ttml"));
        write_settings(&settings_path, &root_path);

        let resolved =
            resolve_audio_source_for_song(&settings_path, sample_song(&root_path, "Artist - Song"))
                .unwrap();

        assert!(resolved.audio_path.ends_with("Artist - Song.opus"));
    }

    #[test]
    fn rejects_audio_path_outside_selected_root() {
        let temp_dir = TempDir::new().unwrap();
        let settings_path = temp_dir.path().join("settings.json");
        let root_path = temp_dir.path().join("Music");
        let outside_path = temp_dir.path().join("Other");
        fs::create_dir_all(&root_path).unwrap();
        fs::create_dir_all(&outside_path).unwrap();
        write_empty_file(&outside_path.join("Artist - Song.opus"));
        write_empty_file(&outside_path.join("Artist - Song.ttml"));
        write_settings(&settings_path, &root_path);

        let error = resolve_audio_source_for_song(
            &settings_path,
            sample_song(&outside_path, "Artist - Song"),
        )
        .unwrap_err();

        assert_eq!(
            error.to_string(),
            "This audio file is outside the selected library folder."
        );
    }

    #[test]
    fn rejects_missing_audio_file() {
        let temp_dir = TempDir::new().unwrap();
        let settings_path = temp_dir.path().join("settings.json");
        let root_path = temp_dir.path().join("Music");
        fs::create_dir_all(&root_path).unwrap();
        write_empty_file(&root_path.join("Artist - Song.ttml"));
        write_settings(&settings_path, &root_path);

        let error =
            resolve_audio_source_for_song(&settings_path, sample_song(&root_path, "Artist - Song"))
                .unwrap_err();

        assert_eq!(error.to_string(), "The audio file is no longer available.");
    }

    #[test]
    fn rejects_directory_instead_of_audio_file() {
        let temp_dir = TempDir::new().unwrap();
        let settings_path = temp_dir.path().join("settings.json");
        let root_path = temp_dir.path().join("Music");
        fs::create_dir_all(root_path.join("Artist - Song.opus")).unwrap();
        write_empty_file(&root_path.join("Artist - Song.ttml"));
        write_settings(&settings_path, &root_path);

        let error =
            resolve_audio_source_for_song(&settings_path, sample_song(&root_path, "Artist - Song"))
                .unwrap_err();

        assert_eq!(error.to_string(), "The audio file is no longer available.");
    }

    #[test]
    fn rejects_wrong_audio_extension() {
        let temp_dir = TempDir::new().unwrap();
        let settings_path = temp_dir.path().join("settings.json");
        let root_path = temp_dir.path().join("Music");
        fs::create_dir_all(&root_path).unwrap();
        let audio_path = root_path.join("Artist - Song.mp3");
        let lyric_path = root_path.join("Artist - Song.ttml");
        write_empty_file(&audio_path);
        write_empty_file(&lyric_path);
        write_settings(&settings_path, &root_path);
        let song = MediaSong {
            id: song_id(&audio_path, &lyric_path),
            title: "Song".to_string(),
            artist: "Artist".to_string(),
            display_name: "Artist - Song".to_string(),
            directory_path: path_to_string(&root_path),
            audio_path: path_to_string(&audio_path),
            lyric_path: path_to_string(&lyric_path),
            file_stem: "Artist - Song".to_string(),
        };

        let error = resolve_audio_source_for_song(&settings_path, song).unwrap_err();

        assert_eq!(error.to_string(), "This audio format could not be played.");
    }

    #[test]
    fn resolves_unicode_audio_path() {
        let temp_dir = TempDir::new().unwrap();
        let settings_path = temp_dir.path().join("settings.json");
        let root_path = temp_dir.path().join("Música");
        fs::create_dir_all(&root_path).unwrap();
        write_empty_file(&root_path.join("Björk - Jóga.opus"));
        write_empty_file(&root_path.join("Björk - Jóga.ttml"));
        write_settings(&settings_path, &root_path);

        let resolved =
            resolve_audio_source_for_song(&settings_path, sample_song(&root_path, "Björk - Jóga"))
                .unwrap();

        assert!(resolved.audio_path.contains("Björk - Jóga.opus"));
    }

    #[test]
    fn rejects_normalized_path_traversal_outside_root() {
        let temp_dir = TempDir::new().unwrap();
        let settings_path = temp_dir.path().join("settings.json");
        let root_path = temp_dir.path().join("Music");
        let outside_path = temp_dir.path().join("Other");
        fs::create_dir_all(&root_path).unwrap();
        fs::create_dir_all(&outside_path).unwrap();
        let audio_path = root_path
            .join("..")
            .join("Other")
            .join("Artist - Song.opus");
        let lyric_path = root_path
            .join("..")
            .join("Other")
            .join("Artist - Song.ttml");
        write_empty_file(&outside_path.join("Artist - Song.opus"));
        write_empty_file(&outside_path.join("Artist - Song.ttml"));
        write_settings(&settings_path, &root_path);
        let song = MediaSong {
            id: song_id(&audio_path, &lyric_path),
            title: "Song".to_string(),
            artist: "Artist".to_string(),
            display_name: "Artist - Song".to_string(),
            directory_path: path_to_string(&outside_path),
            audio_path: path_to_string(&audio_path),
            lyric_path: path_to_string(&lyric_path),
            file_stem: "Artist - Song".to_string(),
        };

        let error = resolve_audio_source_for_song(&settings_path, song).unwrap_err();

        assert_eq!(
            error.to_string(),
            "This audio file is outside the selected library folder."
        );
    }

    #[test]
    fn library_index_round_trips_authoritative_scan_result() {
        let temp_dir = TempDir::new().unwrap();
        let index_path = temp_dir.path().join("library-index.json");
        let scan_result = sample_scan_result(temp_dir.path());

        write_library_index_atomically(&index_path, &LibraryIndex::from(scan_result.clone()))
            .unwrap();
        let loaded = load_library_index_for_root(&index_path, &scan_result.root_path).unwrap();

        assert_eq!(loaded.status, LibraryIndexLoadStatus::Hit);
        assert_eq!(loaded.scan_result, Some(scan_result));
    }

    #[test]
    fn library_index_rejects_unsupported_schema_version() {
        let temp_dir = TempDir::new().unwrap();
        let index_path = temp_dir.path().join("library-index.json");
        let mut index = LibraryIndex::from(sample_scan_result(temp_dir.path()));
        index.schema_version = LIBRARY_INDEX_SCHEMA_VERSION + 1;
        fs::write(&index_path, serde_json::to_string(&index).unwrap()).unwrap();

        let loaded = load_library_index_for_root(&index_path, &index.root_path).unwrap();

        assert_eq!(loaded.status, LibraryIndexLoadStatus::UnsupportedSchema);
        assert!(loaded.scan_result.is_none());
    }

    #[test]
    fn library_index_rejects_root_mismatch() {
        let temp_dir = TempDir::new().unwrap();
        let index_path = temp_dir.path().join("library-index.json");
        let scan_result = sample_scan_result(&temp_dir.path().join("RootA"));
        write_library_index_atomically(&index_path, &LibraryIndex::from(scan_result)).unwrap();

        let loaded = load_library_index_for_root(
            &index_path,
            &path_to_string(&temp_dir.path().join("RootB")),
        )
        .unwrap();

        assert_eq!(loaded.status, LibraryIndexLoadStatus::RootMismatch);
        assert!(loaded.scan_result.is_none());
    }

    #[test]
    fn library_index_treats_corrupt_json_as_recoverable() {
        let temp_dir = TempDir::new().unwrap();
        let index_path = temp_dir.path().join("library-index.json");
        fs::write(&index_path, "{not json").unwrap();

        let loaded =
            load_library_index_for_root(&index_path, &path_to_string(temp_dir.path())).unwrap();

        assert_eq!(loaded.status, LibraryIndexLoadStatus::Corrupt);
        assert!(loaded.scan_result.is_none());
    }

    #[test]
    fn missing_library_index_is_a_cache_miss() {
        let temp_dir = TempDir::new().unwrap();
        let loaded =
            load_library_index_for_root(&temp_dir.path().join("missing.json"), "C:\\Music")
                .unwrap();

        assert_eq!(loaded.status, LibraryIndexLoadStatus::Miss);
        assert!(loaded.scan_result.is_none());
    }

    #[test]
    fn library_index_replacement_writes_new_authoritative_result() {
        let temp_dir = TempDir::new().unwrap();
        let index_path = temp_dir.path().join("library-index.json");
        let first_result = sample_scan_result(&temp_dir.path().join("First"));
        let mut second_result = sample_scan_result(&temp_dir.path().join("Second"));
        second_result.songs[0].title = "Updated Song".to_string();

        write_library_index_atomically(&index_path, &LibraryIndex::from(first_result)).unwrap();
        write_library_index_atomically(&index_path, &LibraryIndex::from(second_result.clone()))
            .unwrap();

        let loaded = load_library_index_for_root(&index_path, &second_result.root_path).unwrap();
        assert_eq!(loaded.scan_result.unwrap().songs[0].title, "Updated Song");
    }

    #[test]
    fn library_index_supports_unicode_paths_and_preserves_song_ids() {
        let temp_dir = TempDir::new().unwrap();
        let root_path = temp_dir.path().join("Björk");
        let index_path = temp_dir.path().join("library-index.json");
        let audio_path = root_path.join("Álbum").join("Björk - Jóga.opus");
        let lyric_path = root_path.join("Álbum").join("Björk - Jóga.ttml");
        let scan_result = LibraryScanResult {
            root_path: path_to_string(&root_path),
            songs: vec![MediaSong {
                id: song_id(&audio_path, &lyric_path),
                title: "Jóga".to_string(),
                artist: "Björk".to_string(),
                display_name: "Björk - Jóga".to_string(),
                directory_path: path_to_string(&root_path.join("Álbum")),
                audio_path: path_to_string(&audio_path),
                lyric_path: path_to_string(&lyric_path),
                file_stem: "Björk - Jóga".to_string(),
            }],
            issues: vec![],
            scanned_directory_count: 2,
            scanned_file_count: 2,
            supported_file_count: 2,
            audio_file_count: 1,
            lyric_file_count: 1,
            completed_at: "1234Z".to_string(),
        };
        let expected_id = scan_result.songs[0].id.clone();

        write_library_index_atomically(&index_path, &LibraryIndex::from(scan_result.clone()))
            .unwrap();
        let loaded = load_library_index_for_root(&index_path, &scan_result.root_path)
            .unwrap()
            .scan_result
            .unwrap();

        assert_eq!(loaded.songs[0].id, expected_id);
        assert_eq!(loaded.songs[0].artist, "Björk");
    }

    #[test]
    fn library_index_does_not_store_media_or_lyric_contents() {
        let temp_dir = TempDir::new().unwrap();
        let index_path = temp_dir.path().join("library-index.json");
        let scan_result = sample_scan_result(temp_dir.path());

        write_library_index_atomically(&index_path, &LibraryIndex::from(scan_result)).unwrap();

        let contents = fs::read_to_string(index_path).unwrap();
        assert!(!contents.contains("secret lyric payload"));
        assert!(!contents.contains("decoded audio payload"));
        assert!(contents.contains("audioPath"));
        assert!(contents.contains("lyricPath"));
    }

    #[test]
    fn discovers_one_valid_pair() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("Artist - Song.ttml"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert_eq!(result.songs[0].artist, "Artist");
        assert_eq!(result.songs[0].title, "Song");
        assert!(result.issues.is_empty());
    }

    #[test]
    fn discovers_pairs_recursively() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Nested").join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("Nested").join("Artist - Song.ttml"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert_eq!(result.scanned_directory_count, 2);
    }

    #[test]
    fn discovers_valid_pair_one_directory_below_root() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(
            &temp_dir
                .path()
                .join("Sabrina Carpenter")
                .join("Sabrina Carpenter - Taste.opus"),
        );
        write_empty_file(
            &temp_dir
                .path()
                .join("Sabrina Carpenter")
                .join("Sabrina Carpenter - Taste.ttml"),
        );

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert_eq!(result.songs[0].artist, "Sabrina Carpenter");
        assert_eq!(result.songs[0].title, "Taste");
        assert_eq!(result.scanned_directory_count, 2);
        assert_eq!(result.supported_file_count, 2);
    }

    #[test]
    fn discovers_valid_pair_several_directories_below_root() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(
            &temp_dir
                .path()
                .join("Artist")
                .join("Album")
                .join("Artist - Song.opus"),
        );
        write_empty_file(
            &temp_dir
                .path()
                .join("Artist")
                .join("Album")
                .join("Artist - Song.ttml"),
        );

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert_eq!(result.scanned_directory_count, 3);
    }

    #[test]
    fn discovers_multiple_valid_pairs_across_sibling_directories() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("A").join("Artist A - Song A.opus"));
        write_empty_file(&temp_dir.path().join("A").join("Artist A - Song A.ttml"));
        write_empty_file(&temp_dir.path().join("B").join("Artist B - Song B.opus"));
        write_empty_file(&temp_dir.path().join("B").join("Artist B - Song B.ttml"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 2);
        assert_eq!(result.scanned_directory_count, 3);
    }

    #[test]
    fn same_stem_in_different_directories_produces_separate_songs() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("A").join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("A").join("Artist - Song.ttml"));
        write_empty_file(&temp_dir.path().join("B").join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("B").join("Artist - Song.ttml"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 2);
        assert_ne!(result.songs[0].id, result.songs[1].id);
    }

    #[test]
    fn reports_missing_lyrics() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.opus"));

        let result = scan_temp(&temp_dir);

        assert!(result.songs.is_empty());
        assert_eq!(result.issues[0].kind, LibraryIssueKind::MissingLyrics);
    }

    #[test]
    fn reports_missing_audio() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.ttml"));

        let result = scan_temp(&temp_dir);

        assert!(result.songs.is_empty());
        assert_eq!(result.issues[0].kind, LibraryIssueKind::MissingAudio);
    }

    #[test]
    fn reports_duplicate_audio_without_accepting_group() {
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path().canonicalize().unwrap();
        let candidate_dir = root.join("Music");
        let accumulator = ScanAccumulator {
            candidates: vec![
                CandidateFile {
                    directory_path: candidate_dir.clone(),
                    file_path: candidate_dir.join("Artist - Song.opus"),
                    file_stem: "Artist - Song".to_string(),
                    stem_key: "artist - song".to_string(),
                    kind: CandidateKind::Audio,
                },
                CandidateFile {
                    directory_path: candidate_dir.clone(),
                    file_path: candidate_dir.join("artist - song.OPUS"),
                    file_stem: "artist - song".to_string(),
                    stem_key: "artist - song".to_string(),
                    kind: CandidateKind::Audio,
                },
                CandidateFile {
                    directory_path: candidate_dir.clone(),
                    file_path: candidate_dir.join("Artist - Song.ttml"),
                    file_stem: "Artist - Song".to_string(),
                    stem_key: "artist - song".to_string(),
                    kind: CandidateKind::Lyrics,
                },
            ],
            scanned_directory_count: 1,
            scanned_file_count: 3,
            audio_file_count: 2,
            lyric_file_count: 1,
            issues: Vec::new(),
        };

        let result = build_scan_result(root, accumulator);

        assert!(result.songs.is_empty());
        assert_eq!(result.issues[0].kind, LibraryIssueKind::DuplicateAudio);
    }

    #[test]
    fn reports_duplicate_lyrics_without_accepting_group() {
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path().canonicalize().unwrap();
        let candidate_dir = root.join("Music");
        let accumulator = ScanAccumulator {
            candidates: vec![
                CandidateFile {
                    directory_path: candidate_dir.clone(),
                    file_path: candidate_dir.join("Artist - Song.opus"),
                    file_stem: "Artist - Song".to_string(),
                    stem_key: "artist - song".to_string(),
                    kind: CandidateKind::Audio,
                },
                CandidateFile {
                    directory_path: candidate_dir.clone(),
                    file_path: candidate_dir.join("Artist - Song.ttml"),
                    file_stem: "Artist - Song".to_string(),
                    stem_key: "artist - song".to_string(),
                    kind: CandidateKind::Lyrics,
                },
                CandidateFile {
                    directory_path: candidate_dir.clone(),
                    file_path: candidate_dir.join("artist - song.TTML"),
                    file_stem: "artist - song".to_string(),
                    stem_key: "artist - song".to_string(),
                    kind: CandidateKind::Lyrics,
                },
            ],
            scanned_directory_count: 1,
            scanned_file_count: 3,
            audio_file_count: 1,
            lyric_file_count: 2,
            issues: Vec::new(),
        };

        let result = build_scan_result(root, accumulator);

        assert!(result.songs.is_empty());
        assert_eq!(result.issues[0].kind, LibraryIssueKind::DuplicateLyrics);
    }

    #[test]
    fn ignores_unrelated_files() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("Artist - Song.ttml"));
        write_empty_file(&temp_dir.path().join("cover.jpg"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert!(result.issues.is_empty());
        assert_eq!(result.scanned_file_count, 3);
    }

    #[test]
    fn matches_extensions_case_insensitively() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.OPUS"));
        write_empty_file(&temp_dir.path().join("Artist - Song.TTML"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
    }

    #[test]
    fn matches_uppercase_extensions_in_nested_directories() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Nested").join("Artist - Song.OPUS"));
        write_empty_file(&temp_dir.path().join("Nested").join("Artist - Song.TTML"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert_eq!(result.audio_file_count, 1);
        assert_eq!(result.lyric_file_count, 1);
    }

    #[test]
    fn unrelated_files_in_nested_folders_do_not_create_diagnostics() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Nested").join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("Nested").join("Artist - Song.ttml"));
        write_empty_file(&temp_dir.path().join("Nested").join("cover.png"));
        write_empty_file(&temp_dir.path().join("Nested").join("notes.txt"));
        write_empty_file(&temp_dir.path().join("Nested").join("legacy.lrc"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert!(result.issues.is_empty());
        assert_eq!(result.scanned_file_count, 5);
        assert_eq!(result.supported_file_count, 2);
    }

    #[test]
    fn mismatched_stems_remain_unpaired() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("Artist - Other Song.ttml"));

        let result = scan_temp(&temp_dir);

        assert!(result.songs.is_empty());
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.kind == LibraryIssueKind::MissingLyrics));
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.kind == LibraryIssueKind::MissingAudio));
    }

    #[test]
    fn double_extension_mismatch_does_not_silently_pair() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("Artist - Song.ttml.ttml"));

        let result = scan_temp(&temp_dir);

        assert!(result.songs.is_empty());
        assert_eq!(result.supported_file_count, 2);
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.kind == LibraryIssueKind::MissingLyrics));
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.kind == LibraryIssueKind::MissingAudio));
    }

    #[test]
    fn supports_filename_with_multiple_dots() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.v2.opus"));
        write_empty_file(&temp_dir.path().join("Artist - Song.v2.ttml"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs[0].title, "Song.v2");
        assert_eq!(result.songs[0].file_stem, "Artist - Song.v2");
    }

    #[test]
    fn accepts_valid_pair_with_invalid_name_and_reports_issue() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Unknown Song.opus"));
        write_empty_file(&temp_dir.path().join("Unknown Song.ttml"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert_eq!(result.songs[0].artist, "");
        assert_eq!(result.songs[0].title, "Unknown Song");
        assert_eq!(result.issues[0].kind, LibraryIssueKind::InvalidName);
    }

    #[test]
    fn song_id_is_deterministic() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("Artist - Song.ttml"));

        let first = scan_temp(&temp_dir);
        let second = scan_temp(&temp_dir);

        assert_eq!(first.songs[0].id, second.songs[0].id);
    }

    #[test]
    fn sorts_by_artist_then_title_then_path() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("B Artist - A Song.opus"));
        write_empty_file(&temp_dir.path().join("B Artist - A Song.ttml"));
        write_empty_file(&temp_dir.path().join("A Artist - Z Song.opus"));
        write_empty_file(&temp_dir.path().join("A Artist - Z Song.ttml"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs[0].display_name, "A Artist - Z Song");
        assert_eq!(result.songs[1].display_name, "B Artist - A Song");
    }

    #[test]
    fn supports_unicode_filenames() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Björk - Jóga.opus"));
        write_empty_file(&temp_dir.path().join("Björk - Jóga.ttml"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert_eq!(result.songs[0].artist, "Björk");
        assert_eq!(result.songs[0].title, "Jóga");
    }

    #[test]
    fn supports_unicode_nested_folder_and_filename() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Björk").join("Björk - Jóga.opus"));
        write_empty_file(&temp_dir.path().join("Björk").join("Björk - Jóga.ttml"));

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        assert_eq!(result.songs[0].artist, "Björk");
        assert_eq!(result.scanned_directory_count, 2);
    }

    #[test]
    fn reports_skipped_symlink_and_continues_scanning() {
        let temp_dir = TempDir::new().unwrap();
        write_empty_file(&temp_dir.path().join("Artist - Song.opus"));
        write_empty_file(&temp_dir.path().join("Artist - Song.ttml"));
        let symlink_created: bool;

        #[cfg(windows)]
        {
            use std::os::windows::fs::symlink_dir;
            let target = temp_dir.path().join("target");
            fs::create_dir_all(&target).unwrap();
            symlink_created = symlink_dir(&target, temp_dir.path().join("linked")).is_ok();
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = temp_dir.path().join("target");
            fs::create_dir_all(&target).unwrap();
            symlink(&target, temp_dir.path().join("linked")).unwrap();
            symlink_created = true;
        }

        let result = scan_temp(&temp_dir);

        assert_eq!(result.songs.len(), 1);
        if symlink_created {
            assert!(result
                .issues
                .iter()
                .any(|issue| issue.kind == LibraryIssueKind::UnsupportedEntry));
        }
    }
}
