use crate::media_library::{
    models::{LibraryIndexLoadStatus, MediaSong},
    persistence::{load_library_index_for_root, read_library_settings, SettingsError},
    scanner::{path_to_string, song_id},
};
use std::path::{Path, PathBuf};

#[cfg(test)]
use crate::media_library::models::ResolvedAudioSource;

#[derive(Debug)]
pub(crate) struct IndexedPlaybackSong {
    pub(crate) song: MediaSong,
    pub(crate) audio_path: PathBuf,
    pub(crate) lyric_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IndexedSongLookupErrorCode {
    LibraryNotSelected,
    IndexUnavailable,
    SongNotFound,
    SongUnavailable,
}

#[derive(Debug)]
pub(crate) struct IndexedSongLookupError {
    pub(crate) reason_code: IndexedSongLookupErrorCode,
    pub(crate) message: String,
}

impl IndexedSongLookupError {
    fn new(reason_code: IndexedSongLookupErrorCode, message: impl Into<String>) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}

pub(crate) fn resolve_indexed_song_for_paths(
    settings_path: &Path,
    index_path: &Path,
    song_id: &str,
) -> Result<IndexedPlaybackSong, IndexedSongLookupError> {
    let settings = read_library_settings(settings_path).map_err(|_| {
        IndexedSongLookupError::new(
            IndexedSongLookupErrorCode::IndexUnavailable,
            "Could not read the selected library.",
        )
    })?;
    let root_path = settings.library_root.ok_or_else(|| {
        IndexedSongLookupError::new(
            IndexedSongLookupErrorCode::LibraryNotSelected,
            "Choose a library location before starting playback.",
        )
    })?;
    let loaded = load_library_index_for_root(index_path, &root_path).map_err(|_| {
        IndexedSongLookupError::new(
            IndexedSongLookupErrorCode::IndexUnavailable,
            "The current library index could not be read.",
        )
    })?;
    if loaded.status != LibraryIndexLoadStatus::Hit {
        return Err(IndexedSongLookupError::new(
            IndexedSongLookupErrorCode::IndexUnavailable,
            "Refresh the library before starting playback.",
        ));
    }
    let song = loaded
        .scan_result
        .and_then(|result| result.songs.into_iter().find(|song| song.id == song_id))
        .ok_or_else(|| {
            IndexedSongLookupError::new(
                IndexedSongLookupErrorCode::SongNotFound,
                "This song is no longer in the current library.",
            )
        })?;
    let (song, _root_path, audio_path, lyric_path) = validate_song_paths(settings_path, song)
        .map_err(|_| {
            IndexedSongLookupError::new(
                IndexedSongLookupErrorCode::SongUnavailable,
                "This song's accepted media files are no longer available.",
            )
        })?;
    Ok(IndexedPlaybackSong {
        song,
        audio_path,
        lyric_path,
    })
}

#[cfg(test)]
pub(crate) fn resolve_audio_source_for_song(
    settings_path: &Path,
    song: MediaSong,
) -> Result<ResolvedAudioSource, PlaybackSourceError> {
    let (song, _root_path, audio_path, _lyric_path) = validate_song_paths(settings_path, song)?;

    Ok(ResolvedAudioSource {
        song_id: song.id,
        audio_path: path_to_string(&audio_path),
    })
}

#[cfg(test)]
pub(crate) fn resolve_lyric_source_for_song(
    settings_path: &Path,
    song: MediaSong,
) -> Result<PathBuf, PlaybackSourceError> {
    let (_song, _root_path, _audio_path, lyric_path) = validate_song_paths(settings_path, song)?;
    Ok(lyric_path)
}

fn validate_song_paths(
    settings_path: &Path,
    song: MediaSong,
) -> Result<(MediaSong, PathBuf, PathBuf, PathBuf), PlaybackSourceError> {
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

    Ok((song, root_path, audio_path, lyric_path))
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
pub(crate) struct PlaybackSourceError {
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
