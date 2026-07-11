use super::{
    discovery::{
        discover_local_sources, discover_sources_with, map_platform_sources, DiscoveryError,
        PlatformDiscovery, PlatformMicrophoneSource,
    },
    models::MicrophoneSourceAvailability,
};

fn endpoint(platform_id: &str, display_name: &str, available: bool) -> PlatformMicrophoneSource {
    PlatformMicrophoneSource {
        platform_id: platform_id.to_string(),
        display_name: display_name.to_string(),
        available,
    }
}

#[test]
fn discovered_device_mapping_is_stable_and_marks_default() {
    let snapshot = PlatformDiscovery {
        sources: vec![endpoint("endpoint-b", "USB Microphone", false)],
        default_platform_id: Some("endpoint-b".to_string()),
    };

    let first = map_platform_sources(snapshot.clone());
    let second = map_platform_sources(snapshot);

    assert_eq!(first, second);
    assert_eq!(first[0].id, "windows-mic-571de40382487073");
    assert_eq!(first[0].display_name, "USB Microphone");
    assert_eq!(
        first[0].availability,
        MicrophoneSourceAvailability::Unavailable
    );
    assert!(first[0].is_default);
}

#[test]
fn duplicate_display_names_remain_distinct_sources() {
    let sources = map_platform_sources(PlatformDiscovery {
        sources: vec![
            endpoint("endpoint-a", "Microphone", true),
            endpoint("endpoint-b", "Microphone", true),
        ],
        default_platform_id: Some("endpoint-a".to_string()),
    });

    assert_eq!(sources.len(), 2);
    assert_ne!(sources[0].id, sources[1].id);
    assert_eq!(sources.iter().filter(|source| source.is_default).count(), 1);
}

#[test]
fn empty_platform_device_list_maps_to_empty_sources() {
    let sources = map_platform_sources(PlatformDiscovery {
        sources: Vec::new(),
        default_platform_id: None,
    });

    assert!(sources.is_empty());
}

#[test]
fn backend_discovery_failure_is_returned_without_sources() {
    let result = discover_sources_with(|| {
        Err(DiscoveryError::message(
            "Could not discover local microphone inputs.",
        ))
    });

    assert_eq!(
        result.unwrap_err().to_string(),
        "Could not discover local microphone inputs."
    );
}

#[cfg(target_os = "windows")]
#[test]
#[ignore = "requires the Windows audio endpoint service"]
fn windows_endpoint_discovery_smoke() {
    let sources = discover_local_sources().expect("Windows microphone discovery should complete");

    for source in &sources {
        eprintln!(
            "{} | {} | default={} | {:?}",
            source.id, source.display_name, source.is_default, source.availability
        );
        assert!(source.id.starts_with("windows-mic-"));
    }
}
