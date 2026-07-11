pub mod models;
mod parser;
mod timing;

use crate::media_library::{models::MediaSong, resolve_lyric_source_for_song};
use models::LyricDocument;
use parser::{parse_ttml, LyricError};
use std::{fs, path::Path};

const MAX_TTML_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[tauri::command]
pub fn parse_song_lyrics(app: tauri::AppHandle, song: MediaSong) -> Result<LyricDocument, String> {
    let source_song_id = song.id.clone();
    parse_song_lyrics_for_settings(
        &crate::media_library::settings_path(&app)?,
        &source_song_id,
        song,
    )
    .map_err(|error| error.to_string())
}

fn parse_song_lyrics_for_settings(
    settings_path: &Path,
    source_song_id: &str,
    song: MediaSong,
) -> Result<LyricDocument, LyricError> {
    let lyric_path = resolve_lyric_source_for_song(settings_path, song).map_err(|error| {
        LyricError::with_source("Could not validate the lyric file for this song.", error)
    })?;
    parse_song_lyrics_path(source_song_id, &lyric_path)
}

fn parse_song_lyrics_path(
    source_song_id: &str,
    lyric_path: &Path,
) -> Result<LyricDocument, LyricError> {
    let metadata = fs::metadata(lyric_path).map_err(|source| {
        LyricError::with_source("The lyric file is no longer available.", source)
    })?;
    if metadata.len() > MAX_TTML_FILE_BYTES {
        return Err(LyricError::message(
            "The lyric file is too large to parse safely.",
        ));
    }

    let contents = fs::read_to_string(lyric_path)
        .map_err(|source| LyricError::with_source("Could not read the lyric file.", source))?;
    parse_ttml(source_song_id, &contents)
}

#[cfg(test)]
mod tests;
