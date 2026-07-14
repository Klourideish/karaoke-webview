use std::{collections::HashMap, sync::Mutex};

use super::models::{
    MicrophoneAssignment, MicrophoneAssignmentMethod, MicrophoneWaitingReason,
    MicrophoneWaitingState,
};

#[derive(Default)]
struct AssignmentInner {
    assignments: Vec<MicrophoneAssignment>,
    preferred_source_by_singer: HashMap<String, String>,
    waiting_states: Vec<MicrophoneWaitingState>,
    next_sequence: u64,
}

#[derive(Default)]
pub(crate) struct MicrophoneAssignmentRegistry {
    inner: Mutex<AssignmentInner>,
}

impl MicrophoneAssignmentRegistry {
    pub(crate) fn list(&self) -> Vec<MicrophoneAssignment> {
        lock(&self.inner).assignments.clone()
    }

    pub(crate) fn list_waiting(&self) -> Vec<MicrophoneWaitingState> {
        lock(&self.inner).waiting_states.clone()
    }

    pub(crate) fn assignment_for_singer(&self, singer_id: &str) -> Option<MicrophoneAssignment> {
        lock(&self.inner)
            .assignments
            .iter()
            .find(|assignment| assignment.singer_id == singer_id)
            .cloned()
    }

    pub(crate) fn preferred_source_for_singer(&self, singer_id: &str) -> Option<String> {
        lock(&self.inner)
            .preferred_source_by_singer
            .get(singer_id)
            .cloned()
    }

    pub(crate) fn waiting_for_singer(&self, singer_id: &str) -> Option<MicrophoneWaitingState> {
        lock(&self.inner)
            .waiting_states
            .iter()
            .find(|waiting| waiting.singer_id == singer_id)
            .cloned()
    }

    pub(crate) fn assign(
        &self,
        channel_id: &str,
        singer_id: &str,
    ) -> Result<MicrophoneAssignment, String> {
        self.assign_with_method(channel_id, singer_id, MicrophoneAssignmentMethod::Manual)
    }

    pub(crate) fn assign_automatically(
        &self,
        channel_id: &str,
        singer_id: &str,
    ) -> Result<MicrophoneAssignment, String> {
        self.assign_with_method(channel_id, singer_id, MicrophoneAssignmentMethod::Automatic)
    }

    fn assign_with_method(
        &self,
        channel_id: &str,
        singer_id: &str,
        method: MicrophoneAssignmentMethod,
    ) -> Result<MicrophoneAssignment, String> {
        let mut inner = lock(&self.inner);
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
            existing.method = method;
            existing.sequence = sequence;
            return Ok(existing.clone());
        }

        let assignment = MicrophoneAssignment {
            channel_id: channel_id.to_string(),
            singer_id: singer_id.to_string(),
            method,
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
        let assignment = inner.assignments.remove(index);
        inner
            .waiting_states
            .retain(|waiting| waiting.singer_id != assignment.singer_id);
        Ok(())
    }

    pub(crate) fn unassign_if_matches(
        &self,
        channel_id: &str,
        singer_id: &str,
        sequence: u64,
    ) -> bool {
        let mut inner = lock(&self.inner);
        let Some(index) = inner.assignments.iter().position(|assignment| {
            assignment.channel_id == channel_id
                && assignment.singer_id == singer_id
                && assignment.sequence == sequence
        }) else {
            return false;
        };
        inner.assignments.remove(index);
        true
    }

    pub(crate) fn is_channel_assigned(&self, channel_id: &str) -> bool {
        lock(&self.inner)
            .assignments
            .iter()
            .any(|assignment| assignment.channel_id == channel_id)
    }

    pub(crate) fn record_successful_source(&self, singer_id: &str, source_id: &str) {
        let mut inner = lock(&self.inner);
        inner
            .preferred_source_by_singer
            .insert(singer_id.to_string(), source_id.to_string());
        inner
            .waiting_states
            .retain(|waiting| waiting.singer_id != singer_id);
    }

    pub(crate) fn mark_waiting(&self, singer_id: &str) -> MicrophoneWaitingState {
        let mut inner = lock(&self.inner);
        if let Some(existing) = inner
            .waiting_states
            .iter()
            .find(|waiting| waiting.singer_id == singer_id)
        {
            return existing.clone();
        }
        inner.next_sequence += 1;
        let waiting = MicrophoneWaitingState {
            singer_id: singer_id.to_string(),
            reason: MicrophoneWaitingReason::NoEligibleMicrophone,
            message: "No available unassigned microphone channel or source was found.".to_string(),
            sequence: inner.next_sequence,
        };
        inner.waiting_states.push(waiting.clone());
        waiting
    }

    pub(crate) fn clear_waiting(&self, singer_id: &str) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        let original_len = inner.waiting_states.len();
        inner
            .waiting_states
            .retain(|waiting| waiting.singer_id != singer_id);
        if inner.waiting_states.len() == original_len {
            return Err("This session singer is not waiting for a microphone.".to_string());
        }
        Ok(())
    }

    pub(crate) fn clear_unassigned_singer_metadata(&self, singer_id: &str) -> bool {
        let mut inner = lock(&self.inner);
        if inner
            .assignments
            .iter()
            .any(|assignment| assignment.singer_id == singer_id)
        {
            return false;
        }
        inner.preferred_source_by_singer.remove(singer_id);
        inner
            .waiting_states
            .retain(|waiting| waiting.singer_id != singer_id);
        true
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
        MicrophoneAssignmentRegistry::default()
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
    fn unassigned_channel_is_rejected() {
        let registry = registry();
        assert_eq!(
            registry.unassign("microphone-channel-1").unwrap_err(),
            "The microphone channel is not assigned."
        );
    }
}
