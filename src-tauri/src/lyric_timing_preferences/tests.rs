use super::{
    LyricTimingPersistenceStatus, LyricTimingPreferenceCoordinator, LyricTimingPreferenceErrorCode,
};
use std::fs;

#[test]
fn saves_loads_after_recreation_and_removes_by_stable_song_id() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("lyric-timing-preferences.json");
    let coordinator = LyricTimingPreferenceCoordinator::default();

    let saved = coordinator.save(&path, "song-a", -700).unwrap();
    assert_eq!(saved.saved_offset_ms, Some(-700));
    assert_eq!(
        saved.persistence_status,
        LyricTimingPersistenceStatus::Saved
    );

    let restarted = LyricTimingPreferenceCoordinator::default();
    let loaded = restarted.get(&path, "song-a").unwrap();
    assert_eq!(loaded.saved_offset_ms, Some(-700));
    assert_eq!(
        loaded.persistence_status,
        LyricTimingPersistenceStatus::Loaded
    );

    let removed = restarted.remove(&path, "song-a").unwrap();
    assert_eq!(removed.saved_offset_ms, None);
    assert_eq!(
        removed.persistence_status,
        LyricTimingPersistenceStatus::Removed
    );
}

#[test]
fn validates_range_without_mutating_verified_preferences() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("lyric-timing-preferences.json");
    let coordinator = LyricTimingPreferenceCoordinator::default();
    coordinator.save(&path, "song-a", 300).unwrap();

    let error = coordinator.save(&path, "song-a", 3_001).unwrap_err();
    assert_eq!(
        error.reason_code,
        LyricTimingPreferenceErrorCode::OffsetOutOfRange
    );
    assert_eq!(
        coordinator.get(&path, "song-a").unwrap().saved_offset_ms,
        Some(300)
    );
    assert_eq!(
        coordinator
            .save(&path, "song-a", -3_001)
            .unwrap_err()
            .reason_code,
        LyricTimingPreferenceErrorCode::OffsetOutOfRange
    );
}

#[test]
fn one_song_never_applies_to_another_or_to_a_missing_stable_id() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("lyric-timing-preferences.json");
    let coordinator = LyricTimingPreferenceCoordinator::default();
    coordinator.save(&path, "song-a", -500).unwrap();
    coordinator.save(&path, "song-b", 800).unwrap();

    assert_eq!(
        coordinator.get(&path, "song-a").unwrap().saved_offset_ms,
        Some(-500)
    );
    assert_eq!(
        coordinator.get(&path, "song-b").unwrap().saved_offset_ms,
        Some(800)
    );
    assert_eq!(
        coordinator
            .get(&path, "removed-song")
            .unwrap()
            .saved_offset_ms,
        None
    );
    assert_eq!(
        coordinator.get(&path, "song-a").unwrap().saved_offset_ms,
        Some(-500)
    );
}

#[test]
fn equivalent_rescan_keeps_the_same_stable_song_preference() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("lyric-timing-preferences.json");
    let coordinator = LyricTimingPreferenceCoordinator::default();
    let stable_song_id = "stable-song-id-after-rescan";
    coordinator.save(&path, stable_song_id, -900).unwrap();

    let after_rescan = LyricTimingPreferenceCoordinator::default();
    assert_eq!(
        after_rescan
            .get(&path, stable_song_id)
            .unwrap()
            .saved_offset_ms,
        Some(-900)
    );
}

#[test]
fn failed_persistence_preserves_the_last_verified_value() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("lyric-timing-preferences.json");
    let coordinator = LyricTimingPreferenceCoordinator::default();
    coordinator.save(&path, "song-a", -700).unwrap();
    fs::create_dir(path.with_extension("json.tmp")).unwrap();

    let error = coordinator.save(&path, "song-a", 400).unwrap_err();
    assert_eq!(
        error.reason_code,
        LyricTimingPreferenceErrorCode::PersistenceFailed
    );
    let verified = coordinator.get(&path, "song-a").unwrap();
    assert_eq!(verified.saved_offset_ms, Some(-700));
    assert_eq!(
        verified.persistence_status,
        LyricTimingPersistenceStatus::Failed
    );
    assert_eq!(
        verified.last_error.as_deref(),
        Some("Could not save lyric timing.")
    );
}

#[test]
fn invalid_persisted_offset_is_never_projected() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("lyric-timing-preferences.json");
    fs::write(
        &path,
        r#"{"schemaVersion":1,"offsetsBySongId":{"song-a":4000}}"#,
    )
    .unwrap();

    let error = LyricTimingPreferenceCoordinator::default()
        .get(&path, "song-a")
        .unwrap_err();
    assert_eq!(
        error.reason_code,
        LyricTimingPreferenceErrorCode::PersistenceFailed
    );
}
