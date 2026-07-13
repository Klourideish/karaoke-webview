use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use crate::{
    capture::{backend::CaptureEnd, levels::normalized_levels, MicrophoneLevelSnapshot},
    microphones::{DiscoveredMicrophoneSource, MicrophoneSourceAvailability, MicrophoneSourceKind},
};

use super::{
    jitter::{JitterBuffer, JitterOutput, JitterReject},
    models::{
        ClientControlMessage, DevelopmentListenerState, DevelopmentProtocolProjection,
        DevelopmentProtocolStatus, DevelopmentSourceHealth, DevelopmentStreamDiagnostics,
        HostControlMessage, StartDevelopmentProtocolRequest, DEFAULT_TCP_PORT, DEFAULT_UDP_PORT,
    },
    packet::{parse_audio_packet, AudioPacket},
};

const HEARTBEAT_INTERVAL_MS: u64 = 1_000;
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(3);
const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1";
const JITTER_TARGET_MS: u64 = 30;
const JITTER_MAX_MS: u64 = 60;
const JITTER_MAX_PACKETS: usize = 6;

struct ListenerWorkers {
    stop_tcp: mpsc::Sender<()>,
    stop_udp: mpsc::Sender<()>,
    tcp_worker: JoinHandle<()>,
    udp_worker: JoinHandle<()>,
}

#[derive(Default)]
struct ProtocolCounters {
    malformed_control_messages: u64,
    rejected_control_messages: u64,
    packets_received: u64,
    valid_packets: u64,
    malformed_packets: u64,
    unauthorized_packets: u64,
    duplicate_packets: u64,
    stale_packets: u64,
    late_packets: u64,
    sequence_gaps: u64,
}

struct ActiveConnection {
    connection_id: String,
    session_id: String,
    source_id: String,
    client_name: String,
    last_heartbeat: Instant,
}

struct ActiveStream {
    stream_id: u32,
    last_valid_packet: Option<Instant>,
}

struct MeterSubscriber {
    source_id: String,
    sender: mpsc::Sender<Vec<i16>>,
}

struct ManagerInner {
    listener_state: DevelopmentListenerState,
    bind_address: String,
    tcp_port: u16,
    udp_port: u16,
    error: Option<String>,
    closure_reason: Option<String>,
    connection: Option<ActiveConnection>,
    stream: Option<ActiveStream>,
    counters: ProtocolCounters,
    jitter: JitterBuffer,
    level: MicrophoneLevelSnapshot,
    meter: Option<MeterSubscriber>,
    next_connection: u64,
    next_session: u64,
    next_stream: u32,
}

pub(crate) struct DevelopmentProtocolManager {
    operations: Mutex<()>,
    inner: Arc<Mutex<ManagerInner>>,
    workers: Mutex<Option<ListenerWorkers>>,
}

impl Default for DevelopmentProtocolManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DevelopmentProtocolManager {
    pub(crate) fn new() -> Self {
        Self {
            operations: Mutex::new(()),
            inner: Arc::new(Mutex::new(ManagerInner {
                listener_state: DevelopmentListenerState::Stopped,
                bind_address: DEFAULT_BIND_ADDRESS.to_string(),
                tcp_port: DEFAULT_TCP_PORT,
                udp_port: DEFAULT_UDP_PORT,
                error: None,
                closure_reason: None,
                connection: None,
                stream: None,
                counters: ProtocolCounters::default(),
                jitter: JitterBuffer::new(JITTER_MAX_PACKETS),
                level: MicrophoneLevelSnapshot::idle(),
                meter: None,
                next_connection: 1,
                next_session: 1,
                next_stream: 1,
            })),
            workers: Mutex::new(None),
        }
    }
    pub(crate) fn start(
        &self,
        request: StartDevelopmentProtocolRequest,
    ) -> Result<DevelopmentProtocolProjection, String> {
        let _operation = lock(&self.operations);
        if lock(&self.workers).is_some() {
            return Ok(self.projection());
        }
        let bind_address = request
            .bind_address
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_BIND_ADDRESS.to_string());
        let tcp_port = request.tcp_port.unwrap_or(DEFAULT_TCP_PORT);
        let udp_port = request.udp_port.unwrap_or(DEFAULT_UDP_PORT);
        {
            let mut inner = lock(&self.inner);
            inner.listener_state = DevelopmentListenerState::Starting;
            inner.bind_address = bind_address.clone();
            inner.tcp_port = tcp_port;
            inner.udp_port = udp_port;
            inner.error = None;
            inner.closure_reason = None;
        }
        let tcp_listener =
            TcpListener::bind((bind_address.as_str(), tcp_port)).map_err(|error| {
                let message = format!("Could not start insecure development TCP listener: {error}");
                self.mark_failed(message.clone());
                message
            })?;
        let udp_socket = UdpSocket::bind((bind_address.as_str(), udp_port)).map_err(|error| {
            let message = format!("Could not start insecure development UDP listener: {error}");
            self.mark_failed(message.clone());
            message
        })?;
        tcp_listener
            .set_nonblocking(true)
            .map_err(|error| format!("Could not configure development TCP listener: {error}"))?;
        udp_socket
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|error| format!("Could not configure development UDP listener: {error}"))?;
        let (stop_tcp, stop_tcp_rx) = mpsc::channel();
        let (stop_udp, stop_udp_rx) = mpsc::channel();
        let tcp_inner = Arc::clone(&self.inner);
        let tcp_worker =
            thread::spawn(move || run_tcp_listener(tcp_listener, tcp_inner, stop_tcp_rx));
        let udp_inner = Arc::clone(&self.inner);
        let udp_worker =
            thread::spawn(move || run_udp_listener(udp_socket, udp_inner, stop_udp_rx));
        *lock(&self.workers) = Some(ListenerWorkers {
            stop_tcp,
            stop_udp,
            tcp_worker,
            udp_worker,
        });
        lock(&self.inner).listener_state = DevelopmentListenerState::Listening;
        Ok(self.projection())
    }

    pub(crate) fn stop(&self) -> DevelopmentProtocolProjection {
        let _operation = lock(&self.operations);
        self.stop_workers();
        {
            let mut inner = lock(&self.inner);
            inner.listener_state = DevelopmentListenerState::Stopped;
            inner.connection = None;
            inner.stream = None;
            inner.meter = None;
            inner.jitter.clear();
            inner.closure_reason = Some("development-listener-stopped".to_string());
            inner.level = MicrophoneLevelSnapshot::idle();
        }
        self.projection()
    }

    pub(crate) fn projection(&self) -> DevelopmentProtocolProjection {
        let inner = lock(&self.inner);
        DevelopmentProtocolProjection {
            status: status_from_inner(&inner),
            diagnostics: diagnostics_from_inner(&inner),
            sources: source_from_inner(&inner).into_iter().collect(),
        }
    }

    pub(crate) fn sources(&self) -> Vec<DiscoveredMicrophoneSource> {
        source_from_inner(&lock(&self.inner)).into_iter().collect()
    }

    pub(crate) fn is_source_available(&self, source_id: &str) -> bool {
        self.sources().iter().any(|source| {
            source.id == source_id && source.availability == MicrophoneSourceAvailability::Available
        })
    }

    pub(crate) fn run_capture(
        &self,
        source_id: &str,
        stop: mpsc::Receiver<()>,
        ready: mpsc::Sender<Result<(), String>>,
        levels: Box<dyn Fn(MicrophoneLevelSnapshot) + Send>,
        timeout: Duration,
    ) -> Result<CaptureEnd, String> {
        if !self.is_source_available(source_id) {
            let message =
                "The selected development network microphone is not available.".to_string();
            let _ = ready.send(Err(message.clone()));
            return Err(message);
        }
        let (tx, rx) = mpsc::channel::<Vec<i16>>();
        lock(&self.inner).meter = Some(MeterSubscriber {
            source_id: source_id.to_string(),
            sender: tx,
        });
        let _ = ready.send(Ok(()));
        let started = Instant::now();
        let mut sequence = 0u64;
        loop {
            if stop.try_recv().is_ok() {
                self.clear_meter(source_id);
                return Ok(CaptureEnd::Stopped);
            }
            if started.elapsed() >= timeout {
                self.clear_meter(source_id);
                return Ok(CaptureEnd::TimedOut);
            }
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(samples) => {
                    let normalized = samples
                        .iter()
                        .map(|sample| f32::from(*sample) / 32768.0)
                        .collect::<Vec<_>>();
                    sequence += 1;
                    let level = normalized_levels(&normalized, sequence);
                    lock(&self.inner).level = level;
                    levels(level);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    self.clear_meter(source_id);
                    return Err("Development network microphone stream ended.".to_string());
                }
            }
        }
    }

    fn clear_meter(&self, source_id: &str) {
        let mut inner = lock(&self.inner);
        if inner
            .meter
            .as_ref()
            .is_some_and(|meter| meter.source_id == source_id)
        {
            inner.meter = None;
        }
    }

    fn mark_failed(&self, message: String) {
        let mut inner = lock(&self.inner);
        inner.listener_state = DevelopmentListenerState::Failed;
        inner.error = Some(message);
    }

    fn stop_workers(&self) {
        if let Some(workers) = lock(&self.workers).take() {
            let _ = workers.stop_tcp.send(());
            let _ = workers.stop_udp.send(());
            let _ = workers.tcp_worker.join();
            let _ = workers.udp_worker.join();
        }
    }

    #[cfg(test)]
    pub(crate) fn handle_control_line_for_test(&self, line: &str) -> Option<HostControlMessage> {
        handle_control_line(&self.inner, line)
    }

    #[cfg(test)]
    pub(crate) fn handle_udp_for_test(&self, datagram: &[u8]) {
        handle_udp_datagram(&self.inner, datagram);
    }
}

impl Drop for DevelopmentProtocolManager {
    fn drop(&mut self) {
        self.stop_workers();
    }
}
fn run_tcp_listener(
    listener: TcpListener,
    inner: Arc<Mutex<ManagerInner>>,
    stop: mpsc::Receiver<()>,
) {
    loop {
        if stop.try_recv().is_ok() {
            break;
        }
        match listener.accept() {
            Ok((stream, _)) => handle_stream(stream, &inner),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                let mut state = lock(&inner);
                state.listener_state = DevelopmentListenerState::Failed;
                state.error = Some(format!("Development TCP listener failed: {error}"));
                break;
            }
        }
    }
}

fn handle_stream(mut stream: TcpStream, inner: &Arc<Mutex<ManagerInner>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let Ok(reader_stream) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(reader_stream);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                revoke_connection(inner, "control-connection-closed");
                break;
            }
            Ok(_) => {
                if let Some(response) = handle_control_line(inner, line.trim_end()) {
                    if let Ok(serialized) = serde_json::to_string(&response) {
                        let _ = writeln!(stream, "{serialized}");
                    }
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                let timed_out = lock(inner).connection.as_ref().is_some_and(|connection| {
                    connection.last_heartbeat.elapsed() > HEARTBEAT_TIMEOUT
                });
                if timed_out {
                    revoke_connection(inner, "heartbeat-timeout");
                    break;
                }
            }
            Err(_) => {
                revoke_connection(inner, "control-read-error");
                break;
            }
        }
    }
}

fn handle_control_line(inner: &Arc<Mutex<ManagerInner>>, line: &str) -> Option<HostControlMessage> {
    let parsed = serde_json::from_str::<ClientControlMessage>(line);
    let message = match parsed {
        Ok(message) => message,
        Err(_) => {
            lock(inner).counters.malformed_control_messages += 1;
            return Some(HostControlMessage::DevelopmentError {
                profile_version: 0,
                reason_code: "malformed-json".to_string(),
                message: "Malformed development control message.".to_string(),
            });
        }
    };

    match message {
        ClientControlMessage::ClientHello {
            profile_version,
            client_device_id,
            client_name,
            audio_profile,
        } => {
            if profile_version != 0 || !audio_profile.is_v0_exact() {
                lock(inner).counters.rejected_control_messages += 1;
                return Some(HostControlMessage::HostHelloRejected {
                    profile_version: 0,
                    reason_code: if profile_version != 0 {
                        "unsupported-profile-version".to_string()
                    } else {
                        "unsupported-audio-profile".to_string()
                    },
                    message: "Development Profile V0 requires mono 48 kHz PCM16.".to_string(),
                });
            }
            let (connection_id, session_id, source_id, udp_port) = {
                let mut state = lock(inner);
                let connection_id = format!("development-connection-{}", state.next_connection);
                let session_id = format!("development-session-{}", state.next_session);
                let source_id = format!("network-mic-development-{}", state.next_connection);
                state.next_connection += 1;
                state.next_session += 1;
                state.connection = Some(ActiveConnection {
                    connection_id: connection_id.clone(),
                    session_id: session_id.clone(),
                    source_id: source_id.clone(),
                    client_name,
                    last_heartbeat: Instant::now(),
                });
                let _ = client_device_id;
                state.stream = None;
                state.jitter.clear();
                (connection_id, session_id, source_id, state.udp_port)
            };
            Some(HostControlMessage::HostHelloAccepted {
                profile_version: 0,
                client_connection_id: connection_id,
                protocol_session_id: session_id,
                network_microphone_source_id: source_id,
                audio_udp_port: udp_port,
                heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
            })
        }
        ClientControlMessage::RequestStreamAuthorization {
            profile_version,
            capture_attempt_id,
        } => {
            let _ = capture_attempt_id;
            if profile_version != 0 {
                lock(inner).counters.rejected_control_messages += 1;
                return Some(HostControlMessage::StreamRejected {
                    profile_version: 0,
                    reason_code: "unsupported-profile-version".to_string(),
                    message: "Development Profile V0 is required.".to_string(),
                });
            }
            let mut state = lock(inner);
            if state.connection.is_none() {
                state.counters.rejected_control_messages += 1;
                return Some(HostControlMessage::StreamRejected {
                    profile_version: 0,
                    reason_code: "no-active-connection".to_string(),
                    message: "Connect before requesting a development stream.".to_string(),
                });
            }
            if state.stream.is_some() {
                state.counters.rejected_control_messages += 1;
                return Some(HostControlMessage::StreamRejected {
                    profile_version: 0,
                    reason_code: "stream-already-active".to_string(),
                    message: "A development stream is already active.".to_string(),
                });
            }
            let stream_id = state.next_stream;
            state.next_stream += 1;
            let udp_port = state.udp_port;
            state.stream = Some(ActiveStream {
                stream_id,
                last_valid_packet: None,
            });
            state.jitter.clear();
            Some(HostControlMessage::StreamAuthorized {
                profile_version: 0,
                audio_stream_id: stream_id,
                audio_udp_port: udp_port,
            })
        }
        ClientControlMessage::StopStream {
            profile_version,
            audio_stream_id,
            reason_code,
        } => {
            if profile_version != 0 {
                lock(inner).counters.rejected_control_messages += 1;
                return Some(HostControlMessage::DevelopmentError {
                    profile_version: 0,
                    reason_code: "unsupported-profile-version".to_string(),
                    message: "Development Profile V0 is required.".to_string(),
                });
            }
            let _ = reason_code;
            let mut state = lock(inner);
            state.stream = None;
            state.jitter.clear();
            Some(HostControlMessage::StreamStopped {
                profile_version: 0,
                audio_stream_id,
            })
        }
        ClientControlMessage::Heartbeat {
            profile_version,
            sent_at_monotonic_ms,
        } => {
            if profile_version != 0 {
                lock(inner).counters.rejected_control_messages += 1;
                return Some(HostControlMessage::DevelopmentError {
                    profile_version: 0,
                    reason_code: "unsupported-profile-version".to_string(),
                    message: "Development Profile V0 is required.".to_string(),
                });
            }
            let _ = sent_at_monotonic_ms;
            if let Some(connection) = &mut lock(inner).connection {
                connection.last_heartbeat = Instant::now();
            }
            Some(HostControlMessage::Heartbeat {
                profile_version,
                sent_at_monotonic_ms: 0,
            })
        }
    }
}
fn run_udp_listener(socket: UdpSocket, inner: Arc<Mutex<ManagerInner>>, stop: mpsc::Receiver<()>) {
    let mut buffer = [0u8; 1500];
    loop {
        if stop.try_recv().is_ok() {
            break;
        }
        match socket.recv_from(&mut buffer) {
            Ok((size, _)) => handle_udp_datagram(&inner, &buffer[..size]),
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => {
                let mut state = lock(&inner);
                state.listener_state = DevelopmentListenerState::Failed;
                state.error = Some(format!("Development UDP listener failed: {error}"));
                break;
            }
        }
    }
}

fn handle_udp_datagram(inner: &Arc<Mutex<ManagerInner>>, datagram: &[u8]) {
    let packet = match parse_audio_packet(datagram) {
        Ok(packet) => packet,
        Err(_) => {
            let mut state = lock(inner);
            state.counters.packets_received += 1;
            state.counters.malformed_packets += 1;
            return;
        }
    };
    let outputs = {
        let mut state = lock(inner);
        state.counters.packets_received += 1;
        let Some(stream) = &state.stream else {
            state.counters.unauthorized_packets += 1;
            return;
        };
        if stream.stream_id != packet.stream_id {
            state.counters.unauthorized_packets += 1;
            return;
        }
        match state.jitter.push(packet) {
            Ok(outputs) => outputs,
            Err(JitterReject::Duplicate) => {
                state.counters.duplicate_packets += 1;
                return;
            }
            Err(JitterReject::Stale) => {
                state.counters.stale_packets += 1;
                return;
            }
            Err(JitterReject::Late) => {
                state.counters.late_packets += 1;
                return;
            }
        }
    };
    for output in outputs {
        match output {
            JitterOutput::Packet(packet) => deliver_packet(inner, packet),
            JitterOutput::Gap { sequence_number: _ } => lock(inner).counters.sequence_gaps += 1,
        }
    }
}

fn deliver_packet(inner: &Arc<Mutex<ManagerInner>>, packet: AudioPacket) {
    let meter = {
        let mut state = lock(inner);
        state.counters.valid_packets += 1;
        if let Some(stream) = &mut state.stream {
            stream.last_valid_packet = Some(Instant::now());
        }
        state.meter.as_ref().map(|meter| meter.sender.clone())
    };
    if let Some(meter) = meter {
        let _ = meter.send(packet.samples);
    }
}

fn revoke_connection(inner: &Arc<Mutex<ManagerInner>>, reason: &str) {
    let mut state = lock(inner);
    state.connection = None;
    state.stream = None;
    state.meter = None;
    state.jitter.clear();
    state.closure_reason = Some(reason.to_string());
    state.level = MicrophoneLevelSnapshot::idle();
}

fn status_from_inner(inner: &ManagerInner) -> DevelopmentProtocolStatus {
    let connection = inner.connection.as_ref();
    DevelopmentProtocolStatus {
        listener_state: inner.listener_state,
        bind_address: inner.bind_address.clone(),
        tcp_port: inner.tcp_port,
        udp_port: inner.udp_port,
        connected_client_count: u8::from(connection.is_some()),
        current_connection_id: connection.map(|value| value.connection_id.clone()),
        current_session_id: connection.map(|value| value.session_id.clone()),
        connected_client_name: connection.map(|value| value.client_name.clone()),
        source_id: connection.map(|value| value.source_id.clone()),
        stream_authorized: inner.stream.is_some(),
        active_stream_id: inner.stream.as_ref().map(|stream| stream.stream_id),
        source_health: source_health(inner),
        last_heartbeat_age_ms: connection
            .map(|value| value.last_heartbeat.elapsed().as_millis() as u64),
        malformed_control_messages: inner.counters.malformed_control_messages,
        rejected_control_messages: inner.counters.rejected_control_messages,
        closure_reason: inner.closure_reason.clone(),
        error: inner.error.clone(),
    }
}

fn diagnostics_from_inner(inner: &ManagerInner) -> DevelopmentStreamDiagnostics {
    let total_loss_basis = inner.counters.valid_packets + inner.counters.sequence_gaps;
    let estimated_packet_loss = if total_loss_basis == 0 {
        0.0
    } else {
        inner.counters.sequence_gaps as f32 / total_loss_basis as f32
    };
    DevelopmentStreamDiagnostics {
        active_stream_id: inner.stream.as_ref().map(|stream| stream.stream_id),
        packets_received: inner.counters.packets_received,
        valid_packets: inner.counters.valid_packets,
        malformed_packets: inner.counters.malformed_packets,
        unauthorized_packets: inner.counters.unauthorized_packets,
        duplicate_packets: inner.counters.duplicate_packets,
        stale_packets: inner.counters.stale_packets,
        late_packets: inner.counters.late_packets,
        sequence_gaps: inner.counters.sequence_gaps,
        estimated_packet_loss,
        receiver_queue_depth: inner.jitter.depth(),
        maximum_queue_depth: inner.jitter.max_depth_seen(),
        jitter_window_depth: inner.jitter.depth(),
        jitter_target_ms: JITTER_TARGET_MS,
        jitter_max_ms: JITTER_MAX_MS,
        current_source_health: source_health(inner),
        last_valid_packet_age_ms: inner
            .stream
            .as_ref()
            .and_then(|stream| stream.last_valid_packet)
            .map(|instant| instant.elapsed().as_millis() as u64),
        level: inner.level,
    }
}

fn source_from_inner(inner: &ManagerInner) -> Option<DiscoveredMicrophoneSource> {
    inner
        .connection
        .as_ref()
        .map(|connection| DiscoveredMicrophoneSource {
            id: connection.source_id.clone(),
            display_name: format!(
                "Development network microphone ({})",
                connection.client_name
            ),
            kind: MicrophoneSourceKind::NetworkClient,
            availability: if matches!(
                source_health(inner),
                DevelopmentSourceHealth::Disconnected | DevelopmentSourceHealth::Failed
            ) {
                MicrophoneSourceAvailability::Unavailable
            } else {
                MicrophoneSourceAvailability::Available
            },
            is_default: false,
        })
}

fn source_health(inner: &ManagerInner) -> DevelopmentSourceHealth {
    if inner.listener_state == DevelopmentListenerState::Failed {
        return DevelopmentSourceHealth::Failed;
    }
    if inner.connection.is_none() {
        return DevelopmentSourceHealth::Disconnected;
    }
    let Some(stream) = &inner.stream else {
        return DevelopmentSourceHealth::ConnectedNotAuthorized;
    };
    match stream.last_valid_packet {
        None => DevelopmentSourceHealth::AuthorizedAwaitingAudio,
        Some(last) if last.elapsed() <= Duration::from_millis(500) => {
            DevelopmentSourceHealth::Healthy
        }
        Some(_) => DevelopmentSourceHealth::Degraded,
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::development_protocol::packet::build_test_packet;

    fn hello() -> &'static str {
        r#"{"type":"client_hello","profileVersion":0,"clientDeviceId":"dev-1","clientName":"Android Test","audioProfile":{"sampleRateHz":48000,"channelCount":1,"encoding":"pcm_s16le","frameDurationMs":10,"samplesPerFrame":480}}"#
    }

    fn authorize(manager: &DevelopmentProtocolManager) {
        manager.handle_control_line_for_test(hello());
        manager.handle_control_line_for_test(
            r#"{"type":"request_stream_authorization","profileVersion":0,"captureAttemptId":"attempt-1"}"#,
        );
    }

    #[test]
    fn valid_client_hello_exposes_source_without_authorizing_audio() {
        let manager = DevelopmentProtocolManager::new();
        let response = manager.handle_control_line_for_test(hello()).unwrap();
        assert!(matches!(
            response,
            HostControlMessage::HostHelloAccepted { .. }
        ));
        let projection = manager.projection();
        assert_eq!(projection.sources.len(), 1);
        assert!(!projection.status.stream_authorized);
        assert_eq!(
            projection.status.source_health,
            DevelopmentSourceHealth::ConnectedNotAuthorized
        );
    }

    #[test]
    fn invalid_profile_and_audio_profile_are_rejected() {
        let manager = DevelopmentProtocolManager::new();
        let rejected = manager
            .handle_control_line_for_test(r#"{"type":"client_hello","profileVersion":1,"clientDeviceId":"dev","clientName":"Bad","audioProfile":{"sampleRateHz":48000,"channelCount":1,"encoding":"pcm_s16le","frameDurationMs":10,"samplesPerFrame":480}}"#)
            .unwrap();
        assert!(matches!(
            rejected,
            HostControlMessage::HostHelloRejected { .. }
        ));
        let rejected = manager
            .handle_control_line_for_test(r#"{"type":"client_hello","profileVersion":0,"clientDeviceId":"dev","clientName":"Bad","audioProfile":{"sampleRateHz":44100,"channelCount":1,"encoding":"pcm_s16le","frameDurationMs":10,"samplesPerFrame":480}}"#)
            .unwrap();
        assert!(matches!(
            rejected,
            HostControlMessage::HostHelloRejected { .. }
        ));
    }

    #[test]
    fn malformed_json_is_counted_without_crashing() {
        let manager = DevelopmentProtocolManager::new();
        let response = manager.handle_control_line_for_test("not json").unwrap();
        assert!(matches!(
            response,
            HostControlMessage::DevelopmentError { .. }
        ));
        assert_eq!(manager.projection().status.malformed_control_messages, 1);
    }

    #[test]
    fn authorization_creates_one_stream_and_second_is_rejected() {
        let manager = DevelopmentProtocolManager::new();
        manager.handle_control_line_for_test(hello());
        let response = manager
            .handle_control_line_for_test(r#"{"type":"request_stream_authorization","profileVersion":0,"captureAttemptId":"attempt-1"}"#)
            .unwrap();
        assert!(matches!(
            response,
            HostControlMessage::StreamAuthorized {
                audio_stream_id: 1,
                ..
            }
        ));
        let response = manager
            .handle_control_line_for_test(r#"{"type":"request_stream_authorization","profileVersion":0,"captureAttemptId":"attempt-2"}"#)
            .unwrap();
        assert!(matches!(
            response,
            HostControlMessage::StreamRejected { .. }
        ));
    }

    #[test]
    fn stop_stream_revokes_authorization() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        manager.handle_control_line_for_test(
            r#"{"type":"stop_stream","profileVersion":0,"audioStreamId":1,"reasonCode":"local_user_stop"}"#,
        );
        assert!(!manager.projection().status.stream_authorized);
    }

    #[test]
    fn udp_packets_are_authorized_and_counted() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        manager.handle_udp_for_test(&build_test_packet(1, 0, 1000));
        let diagnostics = manager.projection().diagnostics;
        assert_eq!(diagnostics.packets_received, 1);
        assert_eq!(diagnostics.valid_packets, 1);
    }

    #[test]
    fn malformed_unauthorized_duplicate_and_stale_packets_are_diagnosed() {
        let manager = DevelopmentProtocolManager::new();
        manager.handle_udp_for_test(&[0; 12]);
        manager.handle_udp_for_test(&build_test_packet(1, 0, 0));
        assert_eq!(manager.projection().diagnostics.malformed_packets, 1);
        assert_eq!(manager.projection().diagnostics.unauthorized_packets, 1);

        authorize(&manager);
        manager.handle_udp_for_test(&build_test_packet(1, 0, 0));
        manager.handle_udp_for_test(&build_test_packet(1, 0, 0));
        manager.handle_udp_for_test(&build_test_packet(1, 0, 0));
        let diagnostics = manager.projection().diagnostics;
        assert_eq!(diagnostics.duplicate_packets, 2);
        assert_eq!(diagnostics.stale_packets, 0);
    }

    #[test]
    fn sequence_gaps_are_diagnosed() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        manager.handle_udp_for_test(&build_test_packet(1, 0, 0));
        for sequence in 2..=7 {
            manager.handle_udp_for_test(&build_test_packet(1, sequence, 0));
        }
        assert_eq!(manager.projection().diagnostics.sequence_gaps, 1);
    }

    #[test]
    fn synthetic_constant_pcm_drives_existing_level_processor() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        let source_id = manager.projection().sources[0].id.clone();
        let (stop_tx, stop_rx) = mpsc::channel();
        let (level_tx, level_rx) = mpsc::channel();
        let manager_for_thread = Arc::new(manager);
        let worker_manager = Arc::clone(&manager_for_thread);
        let source_for_thread = source_id.clone();
        let worker = thread::spawn(move || {
            let (ready_tx, ready_rx) = mpsc::channel();
            let _ = ready_rx;
            worker_manager.run_capture(
                &source_for_thread,
                stop_rx,
                ready_tx,
                Box::new(move |level| {
                    let _ = level_tx.send(level);
                }),
                Duration::from_secs(2),
            )
        });
        thread::sleep(Duration::from_millis(100));
        manager_for_thread.handle_udp_for_test(&build_test_packet(1, 0, 16_384));
        let level = level_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(level.rms > 0.49 && level.rms < 0.51);
        let _ = stop_tx.send(());
        assert_eq!(worker.join().unwrap().unwrap(), CaptureEnd::Stopped);
    }

    #[test]
    fn source_projection_does_not_create_channel_or_assignment() {
        let manager = DevelopmentProtocolManager::new();
        manager.handle_control_line_for_test(hello());
        assert_eq!(manager.sources().len(), 1);
    }
}
