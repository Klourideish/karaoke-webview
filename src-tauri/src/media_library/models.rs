use serde::{Deserialize, Serialize};

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
