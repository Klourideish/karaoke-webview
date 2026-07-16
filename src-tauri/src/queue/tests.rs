use std::sync::{Arc, Barrier, Mutex};

use crate::performance::{
    HostPerformanceCoordinator, PerformanceError, PerformanceErrorCode, PerformanceLifecycleState,
};

use super::{
    AddSongToQueueRequest, HostQueueCoordinator, MoveQueueEntryRequest, QueueError, QueueErrorCode,
    QueueMutationRequest, RemoveQueueEntryRequest, RetryFailedQueueEntryRequest,
    ValidatedQueueEntry, VoteForQueueEntryRequest,
};

fn add(
    queue: &HostQueueCoordinator,
    request_id: &str,
    song_id: &str,
    singer_id: &str,
) -> Result<(), QueueError> {
    queue.add_song(
        AddSongToQueueRequest {
            request_id: request_id.to_string(),
            song_id: song_id.to_string(),
            singer_id: singer_id.to_string(),
        },
        || {
            Ok(ValidatedQueueEntry {
                song_title: format!("Title {song_id}"),
                song_artist: "Artist".to_string(),
            })
        },
    )
}

fn launch(queue: &HostQueueCoordinator, performance: &HostPerformanceCoordinator) -> bool {
    queue.tick_internal(
        performance,
        true,
        |request| performance.create_for_queue_test(request, true),
        |_| Ok(()),
    )
}

#[test]
fn host_owns_entry_identity_and_stable_references() {
    let queue = HostQueueCoordinator::default();
    add(&queue, "request-1", "song-1", "singer-1").unwrap();
    let projection = queue.projection_for_test();
    assert_eq!(projection.queued[0].id, "queue-entry-1");
    assert_eq!(projection.queued[0].song_id, "song-1");
    assert_eq!(projection.queued[0].requester_singer_id, "singer-1");
}

#[test]
fn queue_creates_performance_immediately_and_performance_owns_countdown() {
    let queue = HostQueueCoordinator::default();
    let performance = HostPerformanceCoordinator::default();
    add(&queue, "request-1", "song-1", "singer-1").unwrap();

    assert!(launch(&queue, &performance));
    let queue_projection = queue.projection_for_test();
    let performance_projection = performance.projection();
    let active = performance_projection
        .active
        .expect("Performance should be linked");

    assert_eq!(
        queue_projection.current.unwrap().performance_id,
        Some(active.id)
    );
    assert_eq!(active.state, PerformanceLifecycleState::Countdown);
    assert!(active.countdown_remaining_ms.is_some());
}

#[test]
fn active_unowned_playback_defers_queue_performance_creation() {
    let queue = HostQueueCoordinator::default();
    let performance = HostPerformanceCoordinator::default();
    add(&queue, "request-1", "song-1", "singer-1").unwrap();

    assert!(!queue.tick_internal(
        &performance,
        false,
        |_| unreachable!("Queue must wait while Playback is active"),
        |_| Ok(()),
    ));
    let waiting = queue.projection_for_test();
    assert!(waiting.current.is_none());
    assert_eq!(waiting.queued.len(), 1);
    assert!(waiting.failed.is_empty());

    assert!(launch(&queue, &performance));
    assert_eq!(
        queue.projection_for_test().current.unwrap().entry.song_id,
        "song-1"
    );
}

#[test]
fn successful_completion_advances_exactly_once() {
    let queue = HostQueueCoordinator::default();
    let performance = HostPerformanceCoordinator::default();
    add(&queue, "add-1", "song-1", "singer-1").unwrap();
    add(&queue, "add-2", "song-2", "singer-2").unwrap();
    launch(&queue, &performance);
    let first_id = performance.projection().active.unwrap().id;
    performance.set_terminal_for_queue_test(&first_id, PerformanceLifecycleState::Completed);

    assert!(launch(&queue, &performance));
    let projection = queue.projection_for_test();
    assert_eq!(projection.current.unwrap().entry.song_id, "song-2");
    assert!(projection.queued.is_empty());
    assert!(projection.failed.is_empty());

    assert!(!launch(&queue, &performance));
    assert_eq!(
        queue.projection_for_test().diagnostics.active_queue_count,
        1
    );
}

#[test]
fn skip_updates_queue_only_after_performance_stop_succeeds() {
    let queue = HostQueueCoordinator::default();
    let performance = HostPerformanceCoordinator::default();
    add(&queue, "add-1", "song-1", "singer-1").unwrap();
    launch(&queue, &performance);
    let expected_id = performance.projection().active.unwrap().id;
    let stopped = Mutex::new(Vec::new());

    queue
        .skip_current(
            QueueMutationRequest {
                request_id: "skip-1".to_string(),
            },
            |performance_id| {
                stopped.lock().unwrap().push(performance_id.to_string());
                Ok(())
            },
        )
        .unwrap();
    assert_eq!(*stopped.lock().unwrap(), vec![expected_id]);
    assert!(queue.projection_for_test().current.is_none());

    add(&queue, "add-2", "song-2", "singer-1").unwrap();
    let other_performance = HostPerformanceCoordinator::default();
    launch(&queue, &other_performance);
    let error = queue
        .skip_current(
            QueueMutationRequest {
                request_id: "skip-2".to_string(),
            },
            |_| {
                Err(QueueError::new(
                    QueueErrorCode::PerformanceFailed,
                    "stop failed",
                ))
            },
        )
        .unwrap_err();
    assert_eq!(error.reason_code, QueueErrorCode::PerformanceFailed);
    assert!(queue.projection_for_test().current.is_some());
}

#[test]
fn stale_launch_token_cannot_link_after_pause_remove_or_skip() {
    for supersede in ["pause", "remove", "skip"] {
        let queue = HostQueueCoordinator::default();
        let performance = HostPerformanceCoordinator::default();
        add(&queue, "add", "song-1", "singer-1").unwrap();
        let cancelled = Mutex::new(Vec::new());
        queue.tick_internal(
            &performance,
            true,
            |request| {
                match supersede {
                    "pause" => queue
                        .pause_progression(QueueMutationRequest {
                            request_id: "pause".to_string(),
                        })
                        .unwrap(),
                    "remove" => queue
                        .remove_entry(RemoveQueueEntryRequest {
                            request_id: "remove".to_string(),
                            entry_id: "queue-entry-1".to_string(),
                        })
                        .unwrap(),
                    _ => queue
                        .skip_current(
                            QueueMutationRequest {
                                request_id: "skip".to_string(),
                            },
                            |_| unreachable!("launching entry has no Performance yet"),
                        )
                        .unwrap(),
                }
                performance.create_for_queue_test(request, true)
            },
            |performance_id| {
                cancelled.lock().unwrap().push(performance_id.to_string());
                Ok(())
            },
        );
        assert!(queue.projection_for_test().current.is_none());
        assert_eq!(cancelled.lock().unwrap().len(), 1);
    }
}

#[test]
fn stale_performance_cancel_failure_pauses_progression_and_is_observable() {
    let queue = HostQueueCoordinator::default();
    let performance = HostPerformanceCoordinator::default();
    add(&queue, "add", "song-1", "singer-1").unwrap();
    queue.tick_internal(
        &performance,
        true,
        |request| {
            queue
                .pause_progression(QueueMutationRequest {
                    request_id: "pause".to_string(),
                })
                .unwrap();
            performance.create_for_queue_test(request, true)
        },
        |_| {
            Err(PerformanceError::new(
                PerformanceErrorCode::InternalError,
                "cancel failed",
            ))
        },
    );

    let projection = queue.projection_for_test();
    assert!(projection.progression_paused);
    assert!(projection.current.is_none());
    assert_eq!(
        projection.diagnostics.last_transition.as_deref(),
        Some("stale-performance-cancel-failed")
    );
    assert!(projection
        .diagnostics
        .last_failure
        .is_some_and(|message| message.contains("cancel failed")));
}

#[test]
fn playback_failure_pauses_and_retry_uses_same_entry_with_new_performance() {
    let queue = HostQueueCoordinator::default();
    let performance = HostPerformanceCoordinator::default();
    add(&queue, "add", "song-1", "singer-1").unwrap();
    launch(&queue, &performance);
    let first_id = performance.projection().active.unwrap().id;
    performance.set_terminal_for_queue_test(&first_id, PerformanceLifecycleState::Failed);
    queue.tick_internal(
        &performance,
        true,
        |_| unreachable!("failed Queue must pause"),
        |_| Ok(()),
    );
    let failed = queue.projection_for_test();
    let entry_id = failed.failed[0].entry.id.clone();
    assert!(failed.progression_paused);

    queue
        .retry_failed(RetryFailedQueueEntryRequest {
            request_id: "retry".to_string(),
            entry_id: entry_id.clone(),
        })
        .unwrap();
    launch(&queue, &performance);
    let retried = queue.projection_for_test();
    assert_eq!(retried.current.unwrap().entry.id, entry_id);
    assert_ne!(performance.projection().active.unwrap().id, first_id);
}

#[test]
fn failed_entry_can_be_removed_without_history() {
    let queue = HostQueueCoordinator::default();
    let performance = HostPerformanceCoordinator::default();
    add(&queue, "add", "song-1", "singer-1").unwrap();
    queue.tick_internal(
        &performance,
        true,
        |_| {
            Err(PerformanceError::new(
                PerformanceErrorCode::InternalError,
                "cannot prepare",
            ))
        },
        |_| Ok(()),
    );
    assert_eq!(queue.projection_for_test().failed.len(), 1);
    queue
        .remove_entry(RemoveQueueEntryRequest {
            request_id: "remove".to_string(),
            entry_id: "queue-entry-1".to_string(),
        })
        .unwrap();
    let projection = queue.projection_for_test();
    assert!(projection.failed.is_empty());
    assert_eq!(projection.diagnostics.active_queue_count, 0);
}

#[test]
fn singer_removal_serializes_with_insertion() {
    let queue = Arc::new(HostQueueCoordinator::default());
    let singers = Arc::new(crate::session_singers::SessionSingerRegistry::default());
    let singer = singers.create(Some("Kyle".to_string())).unwrap();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let remove_queue = Arc::clone(&queue);
    let remove_singers = Arc::clone(&singers);
    let remove_singer_id = singer.id.clone();
    let entered_thread = Arc::clone(&entered);
    let release_thread = Arc::clone(&release);
    let remover = std::thread::spawn(move || {
        remove_queue.with_singer_reference_guard(&remove_singer_id, |referenced| {
            assert!(!referenced);
            entered_thread.wait();
            release_thread.wait();
            remove_singers.remove(&remove_singer_id, false).unwrap();
        });
    });
    entered.wait();
    let add_queue = Arc::clone(&queue);
    let add_singers = Arc::clone(&singers);
    let add_singer_id = singer.id.clone();
    let inserter = std::thread::spawn(move || {
        add_queue.add_song(
            AddSongToQueueRequest {
                request_id: "add".to_string(),
                song_id: "song-1".to_string(),
                singer_id: add_singer_id.clone(),
            },
            || {
                if !add_singers.contains(&add_singer_id) {
                    return Err(QueueError::new(
                        QueueErrorCode::SingerNotFound,
                        "singer removed",
                    ));
                }
                Ok(ValidatedQueueEntry {
                    song_title: "Song".to_string(),
                    song_artist: "Artist".to_string(),
                })
            },
        )
    });
    release.wait();
    remover.join().unwrap();
    assert_eq!(
        inserter.join().unwrap().unwrap_err().reason_code,
        QueueErrorCode::SingerNotFound
    );
    assert!(queue.projection_for_test().queued.is_empty());
}

#[test]
fn singer_with_vote_is_reported_as_referenced() {
    let queue = HostQueueCoordinator::default();
    add(&queue, "add", "song-1", "singer-1").unwrap();
    queue
        .vote_for_entry(
            VoteForQueueEntryRequest {
                request_id: "vote".to_string(),
                entry_id: "queue-entry-1".to_string(),
                singer_id: "singer-2".to_string(),
            },
            || Ok(()),
        )
        .unwrap();
    assert!(queue.with_singer_reference_guard("singer-2", |referenced| referenced));
    assert_eq!(queue.projection_for_test().queued[0].vote_count, 1);
}

#[test]
fn successful_idempotent_retry_precedes_later_validation() {
    let queue = HostQueueCoordinator::default();
    add(&queue, "same", "song-1", "singer-1").unwrap();
    queue
        .add_song(
            AddSongToQueueRequest {
                request_id: "same".to_string(),
                song_id: "song-1".to_string(),
                singer_id: "singer-1".to_string(),
            },
            || panic!("validation must not run for a cached success"),
        )
        .unwrap();
    assert_eq!(queue.projection_for_test().queued.len(), 1);
}

#[test]
fn conflicting_request_id_and_bounded_vote_order_are_preserved() {
    let queue = HostQueueCoordinator::default();
    for index in 1..=8 {
        add(
            &queue,
            &format!("add-{index}"),
            &format!("song-{index}"),
            &format!("singer-{index}"),
        )
        .unwrap();
    }
    queue
        .vote_for_entry(
            VoteForQueueEntryRequest {
                request_id: "vote".to_string(),
                entry_id: "queue-entry-8".to_string(),
                singer_id: "singer-1".to_string(),
            },
            || Ok(()),
        )
        .unwrap();
    assert_eq!(queue.projection_for_test().queued[2].id, "queue-entry-8");
    let conflict = queue
        .move_entry(MoveQueueEntryRequest {
            request_id: "vote".to_string(),
            entry_id: "queue-entry-8".to_string(),
            target_index: 0,
        })
        .unwrap_err();
    assert_eq!(conflict.reason_code, QueueErrorCode::RequestIdConflict);
}

#[test]
fn terminal_outcome_survives_replaced_performance_projection() {
    let queue = HostQueueCoordinator::default();
    let performance = HostPerformanceCoordinator::default();
    add(&queue, "add", "song-1", "singer-1").unwrap();
    launch(&queue, &performance);
    let first_id = performance.projection().active.unwrap().id;
    performance.set_terminal_for_queue_test(&first_id, PerformanceLifecycleState::Completed);
    performance
        .create_for_queue_test(
            crate::performance::CreatePerformanceRequest {
                request_id: "direct".to_string(),
                singer_id: "singer-2".to_string(),
                song_id: "song-2".to_string(),
            },
            true,
        )
        .unwrap();
    queue.tick_internal(
        &performance,
        true,
        |_| unreachable!("unrelated Performance is active"),
        |_| Ok(()),
    );
    assert!(queue.projection_for_test().current.is_none());
}

#[test]
fn worker_join_failure_is_observable_and_pauses_progression() {
    let queue = HostQueueCoordinator::default();
    *queue.worker.lock().unwrap() = Some(std::thread::spawn(|| panic!("worker test panic")));
    queue.shutdown();
    let projection = queue.projection_for_test();
    assert!(projection.progression_paused);
    assert!(projection.diagnostics.worker_failure.is_some());
}
