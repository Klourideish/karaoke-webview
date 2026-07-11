use crate::media_library::models::{LibraryIssue, LibraryIssueKind, LibraryScanResult, MediaSong};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Debug, Default)]
pub(crate) struct ScanAccumulator {
    pub(crate) candidates: Vec<CandidateFile>,
    pub(crate) issues: Vec<LibraryIssue>,
    pub(crate) scanned_directory_count: usize,
    pub(crate) scanned_file_count: usize,
    pub(crate) audio_file_count: usize,
    pub(crate) lyric_file_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CandidateKind {
    Audio,
    Lyrics,
}

#[derive(Debug, Clone)]
pub(crate) struct CandidateFile {
    pub(crate) directory_path: PathBuf,
    pub(crate) file_path: PathBuf,
    pub(crate) file_stem: String,
    pub(crate) stem_key: String,
    pub(crate) kind: CandidateKind,
}

pub(crate) fn scan_media_library_path(root_path: PathBuf) -> Result<LibraryScanResult, ScanError> {
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

pub(crate) fn build_scan_result(
    root_path: PathBuf,
    accumulator: ScanAccumulator,
) -> LibraryScanResult {
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

pub(crate) fn song_id(audio_path: &Path, lyric_path: &Path) -> String {
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

pub(crate) fn path_to_string(path: &Path) -> String {
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
pub(crate) struct ScanError {
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
