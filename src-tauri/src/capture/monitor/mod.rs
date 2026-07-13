mod manager;
mod models;
mod output;
mod queue;

#[cfg(test)]
mod tests;

pub(crate) use manager::DiagnosticAudioMonitorManager;
pub(crate) use models::{
    DiagnosticMonitorCommandError, DiagnosticMonitorDiagnostics, DiagnosticMonitorStatus,
    DiagnosticOutputDevice, StartDiagnosticMonitorRequest,
};

pub(crate) fn list_output_devices() -> Vec<DiagnosticOutputDevice> {
    output::list_output_devices()
}
