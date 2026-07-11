use crate::media_library::{
    models::{MediaSong, ResolvedAudioSource},
    persistence::{read_library_settings, SettingsError},
    scanner::{path_to_string, song_id},
};
use std::path::{Path, PathBuf};

pub(crate) fn resolve_audio_source_for_song(
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
