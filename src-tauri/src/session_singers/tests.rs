use std::{collections::HashSet, sync::Arc, thread};

use super::{SessionSingerErrorCode, SessionSingerRegistry};

#[test]
fn create_rename_and_remove_preserve_host_owned_identity() {
    let registry = SessionSingerRegistry::default();
    let singer = registry
        .create(Some("  Lead   Singer  ".to_string()))
        .unwrap();
    assert_eq!(singer.display_name, "Lead Singer");
    assert_eq!(singer.id, "singer-1");

    let renamed = registry.rename(&singer.id, "New Name").unwrap();
    assert_eq!(renamed.id, singer.id);
    assert_eq!(registry.remove(&singer.id, false).unwrap().id, singer.id);
    assert!(registry.list().is_empty());
}

#[test]
fn duplicate_display_names_are_allowed_but_ids_remain_distinct() {
    let registry = SessionSingerRegistry::default();
    let first = registry.create(Some("Alex".to_string())).unwrap();
    let second = registry.create(Some("Alex".to_string())).unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(first.display_name, second.display_name);
}

#[test]
fn display_name_validation_is_typed() {
    let registry = SessionSingerRegistry::default();
    assert_eq!(
        registry
            .create(Some("   ".to_string()))
            .unwrap_err()
            .reason_code,
        SessionSingerErrorCode::DisplayNameEmpty
    );
    assert_eq!(
        registry
            .create(Some("a".repeat(41)))
            .unwrap_err()
            .reason_code,
        SessionSingerErrorCode::DisplayNameTooLong
    );
    assert_eq!(
        registry
            .create(Some("Bad\nName".to_string()))
            .unwrap_err()
            .reason_code,
        SessionSingerErrorCode::DisplayNameControlCharacters
    );
}

#[test]
fn missing_and_in_use_singers_are_rejected() {
    let registry = SessionSingerRegistry::default();
    assert_eq!(
        registry.rename("missing", "Name").unwrap_err().reason_code,
        SessionSingerErrorCode::SingerNotFound
    );
    assert_eq!(
        registry.remove("missing", false).unwrap_err().reason_code,
        SessionSingerErrorCode::SingerNotFound
    );
    let singer = registry.create(Some("Alex".to_string())).unwrap();
    assert_eq!(
        registry.remove(&singer.id, true).unwrap_err().reason_code,
        SessionSingerErrorCode::SingerInUse
    );
}

#[test]
fn concurrent_creation_is_serialized_and_unique() {
    let registry = Arc::new(SessionSingerRegistry::default());
    let handles = (0..16)
        .map(|index| {
            let registry = Arc::clone(&registry);
            thread::spawn(move || registry.create(Some(format!("Singer {index}"))).unwrap().id)
        })
        .collect::<Vec<_>>();
    let ids = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<HashSet<_>>();
    assert_eq!(ids.len(), 16);
    assert_eq!(registry.list().len(), 16);
}
