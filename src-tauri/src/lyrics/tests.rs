use super::{parse_song_lyrics_for_settings, parse_song_lyrics_path, parser::parse_ttml};
use crate::media_library::{models::LibrarySettings, scan_media_library};
use std::{fs, path::Path};
use tempfile::TempDir;

fn fixture(body: &str) -> String {
    format!(
        r#"<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div>{body}</div></body></tt>"#
    )
}

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, contents).unwrap();
}

#[test]
fn parses_one_timed_line() {
    let document = parse_ttml(
        "song-a",
        &fixture(r#"<p begin="00:00:01.000" end="00:00:03.250">Hello world</p>"#),
    )
    .unwrap();

    assert_eq!(document.schema_version, 1);
    assert_eq!(document.language.as_deref(), Some("en"));
    assert_eq!(document.lines.len(), 1);
    assert_eq!(document.lines[0].begin_ms, 1_000);
    assert_eq!(document.lines[0].end_ms, 3_250);
    assert_eq!(document.lines[0].segments[0].text, "Hello world");
}

#[test]
fn parses_multiple_ordered_lines() {
    let document = parse_ttml(
        "song-a",
        &fixture(r#"<p begin="3s" end="4s">Second</p><p begin="1s" end="2s">First</p>"#),
    )
    .unwrap();

    assert_eq!(document.lines[0].text, "First");
    assert_eq!(document.lines[1].text, "Second");
}

#[test]
fn calculates_line_end_from_duration() {
    let document =
        parse_ttml("song-a", &fixture(r#"<p begin="1500ms" dur="2s">Held</p>"#)).unwrap();

    assert_eq!(document.lines[0].begin_ms, 1_500);
    assert_eq!(document.lines[0].end_ms, 3_500);
}

#[test]
fn parses_nested_timed_spans() {
    let document = parse_ttml(
        "song-a",
        &fixture(
            r#"<p begin="00:00:01.000" end="00:00:03.000"><span begin="00:00:01.000" end="00:00:02.000">Hel</span><span begin="00:00:02.000" end="00:00:03.000">lo</span></p>"#,
        ),
    )
    .unwrap();

    assert_eq!(document.lines[0].text, "Hello");
    assert_eq!(document.lines[0].segments.len(), 2);
    assert_eq!(document.lines[0].segments[0].begin_ms, 1_000);
    assert_eq!(document.lines[0].segments[1].text, "lo");
}

#[test]
fn preserves_timed_fragment_text_and_spacing() {
    let document = parse_ttml(
        "song-a",
        &fixture(
            r#"<p begin="1s" end="3s"><span begin="1s" end="1.5s">Time </span><span begin="1.5s" end="2s">to </span><span begin="2s" end="2.5s">cele</span><span begin="2.5s" end="3s">brate</span></p>"#,
        ),
    )
    .unwrap();

    let segments = &document.lines[0].segments;
    assert_eq!(document.lines[0].text, "Time to celebrate");
    assert_eq!(segments[0].text, "Time ");
    assert_eq!(segments[1].text, "to ");
    assert_eq!(segments[2].text, "cele");
    assert_eq!(segments[3].text, "brate");
}

#[test]
fn nested_timed_wrapper_with_timed_children_uses_leaf_fragments() {
    let document = parse_ttml(
        "song-a",
        &fixture(
            r#"<p begin="1s" end="2s"><span begin="1s" end="2s"><span begin="1s" end="1.25s">La-</span><span begin="1.25s" end="1.5s">la-</span><span begin="1.5s" end="2s">la</span></span></p>"#,
        ),
    )
    .unwrap();

    let segments = &document.lines[0].segments;
    assert_eq!(document.lines[0].text, "La-la-la");
    assert_eq!(segments.len(), 3);
    assert_eq!(segments[0].text, "La-");
    assert_eq!(segments[1].text, "la-");
    assert_eq!(segments[2].text, "la");
}

#[test]
fn direct_text_around_nested_spans_preserves_order() {
    let document = parse_ttml(
        "song-a",
        &fixture(
            r#"<p begin="1s" end="3s"><span begin="1s" end="3s">Say <span begin="1.5s" end="2s">안녕</span> now.</span></p>"#,
        ),
    )
    .unwrap();

    let segments = &document.lines[0].segments;
    assert_eq!(document.lines[0].text, "Say 안녕 now.");
    assert_eq!(
        segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>(),
        ["Say ", "안녕", " now."]
    );
    assert!(document
        .warnings
        .iter()
        .any(|warning| warning.code == "mixed-timed-wrapper-text"));
}

#[test]
fn preserves_unicode_and_decodes_entities() {
    let document = parse_ttml(
        "song-a",
        &fixture(r#"<p begin="1s" end="2s">Björk &amp; Jóga</p>"#),
    )
    .unwrap();

    assert_eq!(document.lines[0].text, "Björk & Jóga");
}

#[test]
fn normalizes_meaningful_whitespace() {
    let document = parse_ttml(
        "song-a",
        &fixture(
            r#"
            <p begin="1s" end="2s">
              hello
              <span> wide </span>
              world
            </p>
            "#,
        ),
    )
    .unwrap();

    assert_eq!(document.lines[0].text, "hello wide world");
}

#[test]
fn malformed_xml_is_fatal() {
    let error = parse_ttml("song-a", "<tt><body>").unwrap_err();
    assert_eq!(error.to_string(), "The lyric file is not valid XML.");
}

#[test]
fn unsupported_timing_expression_warns_and_skips_line() {
    let error = parse_ttml(
        "song-a",
        &fixture(r#"<p begin="75f" end="2s">Frame timed</p>"#),
    )
    .unwrap_err();

    assert_eq!(
        error.to_string(),
        "The lyric file does not contain usable timed lyrics."
    );
}

#[test]
fn negative_timing_warns_and_skips_line() {
    let error = parse_ttml("song-a", &fixture(r#"<p begin="-1s" end="2s">Nope</p>"#)).unwrap_err();

    assert_eq!(
        error.to_string(),
        "The lyric file does not contain usable timed lyrics."
    );
}

#[test]
fn missing_timing_is_not_faked() {
    let error = parse_ttml("song-a", &fixture(r#"<p>Untimed</p>"#)).unwrap_err();
    assert_eq!(
        error.to_string(),
        "The lyric file does not contain usable timed lyrics."
    );
}

#[test]
fn child_outside_parent_bounds_is_clamped_with_warning() {
    let document = parse_ttml(
        "song-a",
        &fixture(r#"<p begin="1s" end="2s"><span begin="0s" end="3s">wide</span></p>"#),
    )
    .unwrap();

    assert_eq!(document.lines[0].segments[0].begin_ms, 1_000);
    assert_eq!(document.lines[0].segments[0].end_ms, 2_000);
    assert!(document
        .warnings
        .iter()
        .any(|warning| warning.code == "segment-outside-line"));
}

#[test]
fn line_and_segment_ids_are_deterministic() {
    let source = fixture(r#"<p begin="1s" end="2s"><span begin="1s" end="2s">Stable</span></p>"#);
    let first = parse_ttml("song-a", &source).unwrap();
    let second = parse_ttml("song-a", &source).unwrap();

    assert_eq!(first.lines[0].id, second.lines[0].id);
    assert_eq!(
        first.lines[0].segments[0].id,
        second.lines[0].segments[0].id
    );
}

#[test]
fn overlapping_lines_emit_warning() {
    let document = parse_ttml(
        "song-a",
        &fixture(r#"<p begin="1s" end="3s">One</p><p begin="2s" end="4s">Two</p>"#),
    )
    .unwrap();

    assert!(document
        .warnings
        .iter()
        .any(|warning| warning.code == "overlapping-lines"));
}

#[test]
fn empty_lyric_document_is_fatal() {
    let error = parse_ttml("song-a", &fixture("")).unwrap_err();
    assert_eq!(
        error.to_string(),
        "The lyric file does not contain usable timed lyrics."
    );
}

#[test]
fn file_size_guard_rejects_large_files() {
    let temp_dir = TempDir::new().unwrap();
    let lyric_path = temp_dir.path().join("large.ttml");
    fs::write(&lyric_path, "x".repeat(2 * 1024 * 1024 + 1)).unwrap();

    let error = parse_song_lyrics_path("song-a", &lyric_path).unwrap_err();
    assert_eq!(
        error.to_string(),
        "The lyric file is too large to parse safely."
    );
}

#[test]
fn command_boundary_rejects_outside_root_path() {
    let temp_dir = TempDir::new().unwrap();
    let root = temp_dir.path().join("Root");
    let outside = temp_dir.path().join("Outside");
    write_file(&root.join("Artist - Song.opus"), "");
    write_file(
        &root.join("Artist - Song.ttml"),
        &fixture(r#"<p begin="1s" end="2s">Ok</p>"#),
    );
    write_file(
        &outside.join("Artist - Song.ttml"),
        &fixture(r#"<p begin="1s" end="2s">No</p>"#),
    );
    let mut song = scan_media_library(root.to_string_lossy().to_string())
        .unwrap()
        .songs
        .remove(0);
    song.lyric_path = outside
        .join("Artist - Song.ttml")
        .to_string_lossy()
        .to_string();
    let settings_path = temp_dir.path().join("settings.json");
    write_file(
        &settings_path,
        &serde_json::to_string(&LibrarySettings {
            library_root: Some(root.to_string_lossy().to_string()),
        })
        .unwrap(),
    );

    let error = parse_song_lyrics_for_settings(&settings_path, &song.id.clone(), song).unwrap_err();
    assert_eq!(
        error.to_string(),
        "Could not validate the lyric file for this song."
    );
}

#[test]
fn command_boundary_rejects_wrong_extension() {
    let temp_dir = TempDir::new().unwrap();
    let root = temp_dir.path().join("Root");
    write_file(&root.join("Artist - Song.opus"), "");
    write_file(
        &root.join("Artist - Song.ttml"),
        &fixture(r#"<p begin="1s" end="2s">Ok</p>"#),
    );
    write_file(
        &root.join("Artist - Song.txt"),
        &fixture(r#"<p begin="1s" end="2s">No</p>"#),
    );
    let mut song = scan_media_library(root.to_string_lossy().to_string())
        .unwrap()
        .songs
        .remove(0);
    song.lyric_path = root.join("Artist - Song.txt").to_string_lossy().to_string();
    let settings_path = temp_dir.path().join("settings.json");
    write_file(
        &settings_path,
        &serde_json::to_string(&LibrarySettings {
            library_root: Some(root.to_string_lossy().to_string()),
        })
        .unwrap(),
    );

    let error = parse_song_lyrics_for_settings(&settings_path, &song.id.clone(), song).unwrap_err();
    assert_eq!(
        error.to_string(),
        "Could not validate the lyric file for this song."
    );
}

#[test]
fn command_boundary_rejects_stale_mismatched_identity() {
    let temp_dir = TempDir::new().unwrap();
    let root = temp_dir.path().join("Root");
    write_file(&root.join("Artist - Song.opus"), "");
    write_file(
        &root.join("Artist - Song.ttml"),
        &fixture(r#"<p begin="1s" end="2s">Ok</p>"#),
    );
    let mut song = scan_media_library(root.to_string_lossy().to_string())
        .unwrap()
        .songs
        .remove(0);
    song.id = "song-stale".to_string();
    let settings_path = temp_dir.path().join("settings.json");
    write_file(
        &settings_path,
        &serde_json::to_string(&LibrarySettings {
            library_root: Some(root.to_string_lossy().to_string()),
        })
        .unwrap(),
    );

    let error = parse_song_lyrics_for_settings(&settings_path, &song.id.clone(), song).unwrap_err();
    assert_eq!(
        error.to_string(),
        "Could not validate the lyric file for this song."
    );
}
