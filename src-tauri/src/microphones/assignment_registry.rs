use std::{collections::HashSet, sync::Mutex};

use super::models::{MicrophoneAssignment, MicrophoneAssignmentMethod};

#[derive(Default)]
struct AssignmentInner {
    assignments: Vec<MicrophoneAssignment>,
    session_singer_ids: HashSet<String>,
    next_sequence: u64,
}

#[derive(Default)]
pub(crate) struct MicrophoneAssignmentRegistry {
    inner: Mutex<AssignmentInner>,
}

impl MicrophoneAssignmentRegistry {
    pub(crate) fn sync_session_singers(
        &self,
        singer_ids: Vec<String>,
    ) -> Vec<MicrophoneAssignment> {
        let mut inner = lock(&self.inner);
        inner.session_singer_ids = singer_ids.into_iter().collect();
        let known_singers = inner.session_singer_ids.clone();
        inner
            .assignments
            .retain(|assignment| known_singers.contains(&assignment.singer_id));
        inner.assignments.clone()
    }

    pub(crate) fn list(&self) -> Vec<MicrophoneAssignment> {
        lock(&self.inner).assignments.clone()
    }

    pub(crate) fn assign(
        &self,
        channel_id: &str,
        singer_id: &str,
    ) -> Result<MicrophoneAssignment, String> {
        let mut inner = lock(&self.inner);
        if !inner.session_singer_ids.contains(singer_id) {
            return Err("The selected session singer no longer exists.".to_string());
        }
        if let Some(existing) = inner.assignments.iter().find(|assignment| {
            assignment.channel_id == channel_id && assignment.singer_id == singer_id
        }) {
            return Ok(existing.clone());
        }
        if inner
            .assignments
            .iter()
            .any(|assignment| assignment.singer_id == singer_id)
        {
            return Err("This session singer already has a microphone channel.".to_string());
        }

        inner.next_sequence += 1;
        let sequence = inner.next_sequence;
        if let Some(existing) = inner
            .assignments
            .iter_mut()
            .find(|assignment| assignment.channel_id == channel_id)
        {
            existing.singer_id = singer_id.to_string();
            existing.method = MicrophoneAssignmentMethod::Manual;
            existing.sequence = sequence;
            return Ok(existing.clone());
        }

        let assignment = MicrophoneAssignment {
            channel_id: channel_id.to_string(),
            singer_id: singer_id.to_string(),
            method: MicrophoneAssignmentMethod::Manual,
            sequence,
        };
        inner.assignments.push(assignment.clone());
        Ok(assignment)
    }

    pub(crate) fn unassign(&self, channel_id: &str) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        let Some(index) = inner
            .assignments
            .iter()
            .position(|assignment| assignment.channel_id == channel_id)
        else {
            return Err("The microphone channel is not assigned.".to_string());
        };
        inner.assignments.remove(index);
        Ok(())
    }

    pub(crate) fn is_channel_assigned(&self, channel_id: &str) -> bool {
        lock(&self.inner)
            .assignments
            .iter()
            .any(|assignment| assignment.channel_id == channel_id)
    }
}

fn lock(inner: &Mutex<AssignmentInner>) -> std::sync::MutexGuard<'_, AssignmentInner> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> MicrophoneAssignmentRegistry {
        let registry = MicrophoneAssignmentRegistry::default();
        registry.sync_session_singers(vec!["singer-1".to_string(), "singer-2".to_string()]);
        registry
    }

    #[test]
    fn manual_assignment_and_duplicate_request_are_deterministic() {
        let registry = registry();
        let assignment = registry.assign("microphone-channel-1", "singer-1").unwrap();
        let duplicate = registry.assign("microphone-channel-1", "singer-1").unwrap();

        assert_eq!(assignment, duplicate);
        assert_eq!(assignment.method, MicrophoneAssignmentMethod::Manual);
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn one_singer_cannot_receive_two_channels() {
        let registry = registry();
        registry.assign("microphone-channel-1", "singer-1").unwrap();

        assert_eq!(
            registry
                .assign("microphone-channel-2", "singer-1")
                .unwrap_err(),
            "This session singer already has a microphone channel."
        );
    }

    #[test]
    fn reassignment_replaces_the_singer_atomically() {
        let registry = registry();
        let first = registry.assign("microphone-channel-1", "singer-1").unwrap();
        let reassigned = registry.assign("microphone-channel-1", "singer-2").unwrap();

        assert_eq!(registry.list(), vec![reassigned.clone()]);
        assert_eq!(reassigned.singer_id, "singer-2");
        assert!(reassigned.sequence > first.sequence);
    }

    #[test]
    fn unassignment_removes_only_the_relationship() {
        let registry = registry();
        registry.assign("microphone-channel-1", "singer-1").unwrap();

        registry.unassign("microphone-channel-1").unwrap();

        assert!(registry.list().is_empty());
    }

    #[test]
    fn unknown_singer_and_unassigned_channel_are_rejected() {
        let registry = registry();

        assert_eq!(
            registry
                .assign("microphone-channel-1", "missing-singer")
                .unwrap_err(),
            "The selected session singer no longer exists."
        );
        assert_eq!(
            registry.unassign("microphone-channel-1").unwrap_err(),
            "The microphone channel is not assigned."
        );
    }

    #[test]
    fn removing_a_session_singer_clears_only_the_stale_assignment() {
        let registry = registry();
        registry.assign("microphone-channel-1", "singer-1").unwrap();

        registry.sync_session_singers(vec!["singer-2".to_string()]);

        assert!(registry.list().is_empty());
    }
}
