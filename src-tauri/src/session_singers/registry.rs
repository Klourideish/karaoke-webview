use std::sync::Mutex;

use super::models::{SessionSingerError, SessionSingerErrorCode, SessionSingerProjection};

const MAX_DISPLAY_NAME_CHARS: usize = 40;

#[derive(Default)]
struct RegistryInner {
    singers: Vec<SessionSingerProjection>,
    next_singer_number: u64,
    next_created_order: u64,
}

#[derive(Default)]
pub(crate) struct SessionSingerRegistry {
    inner: Mutex<RegistryInner>,
}

impl SessionSingerRegistry {
    pub(crate) fn list(&self) -> Vec<SessionSingerProjection> {
        lock(&self.inner).singers.clone()
    }

    pub(crate) fn contains(&self, singer_id: &str) -> bool {
        lock(&self.inner)
            .singers
            .iter()
            .any(|singer| singer.id == singer_id)
    }

    pub(crate) fn get(&self, singer_id: &str) -> Option<SessionSingerProjection> {
        lock(&self.inner)
            .singers
            .iter()
            .find(|singer| singer.id == singer_id)
            .cloned()
    }

    pub(crate) fn create(
        &self,
        requested_display_name: Option<String>,
    ) -> Result<SessionSingerProjection, SessionSingerError> {
        let mut inner = lock(&self.inner);
        let singer_number = inner.next_singer_number + 1;
        let display_name = match requested_display_name {
            Some(value) => normalize_display_name(&value)?,
            None => format!("Singer {singer_number}"),
        };

        inner.next_singer_number = singer_number;
        inner.next_created_order += 1;
        let singer = SessionSingerProjection {
            id: format!("singer-{singer_number}"),
            display_name,
            created_order: inner.next_created_order,
        };
        inner.singers.push(singer.clone());
        Ok(singer)
    }

    pub(crate) fn rename(
        &self,
        singer_id: &str,
        requested_display_name: &str,
    ) -> Result<SessionSingerProjection, SessionSingerError> {
        let display_name = normalize_display_name(requested_display_name)?;
        let mut inner = lock(&self.inner);
        let singer = inner
            .singers
            .iter_mut()
            .find(|singer| singer.id == singer_id)
            .ok_or_else(singer_not_found)?;
        singer.display_name = display_name;
        Ok(singer.clone())
    }

    pub(crate) fn remove(
        &self,
        singer_id: &str,
        in_use: bool,
    ) -> Result<SessionSingerProjection, SessionSingerError> {
        if in_use {
            return Err(SessionSingerError::new(
                SessionSingerErrorCode::SingerInUse,
                "Unassign this singer's microphone before removing the singer.",
            ));
        }
        self.remove_transaction_created(singer_id)
    }

    pub(crate) fn remove_transaction_created(
        &self,
        singer_id: &str,
    ) -> Result<SessionSingerProjection, SessionSingerError> {
        let mut inner = lock(&self.inner);
        let index = inner
            .singers
            .iter()
            .position(|singer| singer.id == singer_id)
            .ok_or_else(singer_not_found)?;
        Ok(inner.singers.remove(index))
    }

    pub(crate) fn validate_display_name(
        requested_display_name: &str,
    ) -> Result<String, SessionSingerError> {
        normalize_display_name(requested_display_name)
    }
}

fn normalize_display_name(value: &str) -> Result<String, SessionSingerError> {
    if value.chars().any(char::is_control) {
        return Err(SessionSingerError::new(
            SessionSingerErrorCode::DisplayNameControlCharacters,
            "Singer names cannot contain control characters.",
        ));
    }
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err(SessionSingerError::new(
            SessionSingerErrorCode::DisplayNameEmpty,
            "Enter a singer name.",
        ));
    }
    if normalized.chars().count() > MAX_DISPLAY_NAME_CHARS {
        return Err(SessionSingerError::new(
            SessionSingerErrorCode::DisplayNameTooLong,
            "Singer names must be 40 characters or fewer.",
        ));
    }
    Ok(normalized)
}

fn singer_not_found() -> SessionSingerError {
    SessionSingerError::new(
        SessionSingerErrorCode::SingerNotFound,
        "The selected session singer no longer exists.",
    )
}

fn lock(inner: &Mutex<RegistryInner>) -> std::sync::MutexGuard<'_, RegistryInner> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
