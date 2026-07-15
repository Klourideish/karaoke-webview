use super::{
    models::{
        LibraryIndex, LibraryIndexLoadStatus, LibraryIssue, LibraryIssueKind, LibraryScanResult,
        LibrarySettings, MediaSong,
    },
    persistence::{
        load_library_index_for_root, write_library_index_atomically, write_library_settings,
        LIBRARY_INDEX_SCHEMA_VERSION,
    },
    playback::{resolve_audio_source_for_song, resolve_indexed_song_for_paths},
    scanner::{
        build_scan_result, path_to_string, scan_media_library_path, song_id, CandidateFile,
        CandidateKind, ScanAccumulator,
    },
};
use std::{fs, path::Path};
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

#[test]
fn authoritative_song_id_lookup_resolves_the_current_accepted_index() {
    let temp_dir = TempDir::new().unwrap();
    let root = temp_dir.path().join("Music");
    let settings = temp_dir.path().join("settings.json");
    let index = temp_dir.path().join("library-index.json");
    write_empty_file(&root.join("Artist").join("Artist - Song.opus"));
    write_empty_file(&root.join("Artist").join("Artist - Song.ttml"));
    let canonical_root = root.canonicalize().unwrap();
    let scan_result = sample_scan_result(&canonical_root);
    let expected_id = scan_result.songs[0].id.clone();
    write_settings(&settings, &canonical_root);
    write_library_index_atomically(&index, &LibraryIndex::from(scan_result)).unwrap();

    let resolved = resolve_indexed_song_for_paths(&settings, &index, &expected_id).unwrap();

    assert_eq!(resolved.song.id, expected_id);
    assert!(resolved.audio_path.ends_with("Artist - Song.opus"));
    assert!(resolved.lyric_path.ends_with("Artist - Song.ttml"));
}

#[test]
fn authoritative_song_id_lookup_rejects_missing_and_stale_songs() {
    let temp_dir = TempDir::new().unwrap();
    let root = temp_dir.path().join("Music");
    let settings = temp_dir.path().join("settings.json");
    let index = temp_dir.path().join("library-index.json");
    write_empty_file(&root.join("Artist").join("Artist - Song.opus"));
    write_empty_file(&root.join("Artist").join("Artist - Song.ttml"));
    let canonical_root = root.canonicalize().unwrap();
    let scan_result = sample_scan_result(&canonical_root);
    let indexed_id = scan_result.songs[0].id.clone();
    write_settings(&settings, &canonical_root);
    write_library_index_atomically(&index, &LibraryIndex::from(scan_result)).unwrap();

    let missing = resolve_indexed_song_for_paths(&settings, &index, "missing-song").unwrap_err();
    assert_eq!(
        missing.reason_code,
        super::playback::IndexedSongLookupErrorCode::SongNotFound
    );

    fs::remove_file(root.join("Artist").join("Artist - Song.opus")).unwrap();
    let stale = resolve_indexed_song_for_paths(&settings, &index, &indexed_id).unwrap_err();
    assert_eq!(
        stale.reason_code,
        super::playback::IndexedSongLookupErrorCode::SongUnavailable
    );
}

#[test]
fn authoritative_song_lookup_preserves_identity_after_equivalent_rescan() {
    let temp_dir = TempDir::new().unwrap();
    let root = temp_dir.path().join("Music");
    let settings = temp_dir.path().join("settings.json");
    let index = temp_dir.path().join("library-index.json");
    write_empty_file(&root.join("Artist").join("Artist - Song.opus"));
    write_empty_file(&root.join("Artist").join("Artist - Song.ttml"));
    let canonical_root = root.canonicalize().unwrap();
    write_settings(&settings, &canonical_root);
    let first = scan_media_library_path(root.clone()).unwrap();
    let song_id = first.songs[0].id.clone();
    write_library_index_atomically(&index, &LibraryIndex::from(first)).unwrap();
    let rescanned = scan_media_library_path(root.clone()).unwrap();
    write_library_index_atomically(&index, &LibraryIndex::from(rescanned)).unwrap();

    let resolved = resolve_indexed_song_for_paths(&settings, &index, &song_id).unwrap();
    assert_eq!(resolved.song.id, song_id);
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

    let error =
        resolve_audio_source_for_song(&settings_path, sample_song(&outside_path, "Artist - Song"))
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

    write_library_index_atomically(&index_path, &LibraryIndex::from(scan_result.clone())).unwrap();
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

    let loaded =
        load_library_index_for_root(&index_path, &path_to_string(&temp_dir.path().join("RootB")))
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
        load_library_index_for_root(&temp_dir.path().join("missing.json"), "C:\\Music").unwrap();

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

    write_library_index_atomically(&index_path, &LibraryIndex::from(scan_result.clone())).unwrap();
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
