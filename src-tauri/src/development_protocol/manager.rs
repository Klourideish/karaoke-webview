use std::{
    collections::VecDeque,
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use crate::{
    capture::{
        backend::{AudioFrameConsumer, CaptureEnd, LevelConsumer},
        levels::normalized_levels,
        CaptureAudioFrame, MicrophoneLevelSnapshot, MonitorSampleEncoding,
    },
    development_pairing::{
        DevelopmentPairingCoordinator, PairingClaim, PairingConnectionContext, PairingError,
        PairingErrorCode, PairingOutboundMessage, ParticipantSetupProposal,
    },
    microphones::{DiscoveredMicrophoneSource, MicrophoneSourceAvailability, MicrophoneSourceKind},
};

use super::{
    address::{discover_phone_pairing_candidates, is_phone_reachable_ipv4},
    audio_handoff::{AudioHandoff, PushResult, ReceiveResult},
    jitter::{JitterBuffer, JitterOutput, JitterReject},
    models::{
        ClientControlMessage, DevelopmentListenerState, DevelopmentProtocolProjection,
        DevelopmentProtocolStatus, DevelopmentSourceHealth, DevelopmentStreamDiagnostics,
        HostControlMessage, PhonePairingAddressCandidate, PhonePairingListenerError,
        PhonePairingListenerErrorCode, PhonePairingListenerProjection,
        SelectPhonePairingAddressRequest, StartDevelopmentProtocolRequest, DEFAULT_TCP_PORT,
        DEFAULT_UDP_PORT,
    },
    packet::{parse_audio_packet, AudioPacket},
};

const HEARTBEAT_INTERVAL_MS: u64 = 1_000;
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(3);
const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1";
const PHONE_PAIRING_BIND_ADDRESS: &str = "0.0.0.0";
const JITTER_TARGET_MS: u64 = 30;
const JITTER_MAX_MS: u64 = 60;
const JITTER_MAX_PACKETS: usize = 6;
// Development Profile V0 frames are 10 ms; four frames bound the capture handoff to 40 ms.
const AUDIO_HANDOFF_CAPACITY_FRAMES: usize = 4;

struct ListenerWorkers {
    shutdown: Arc<AtomicBool>,
    active_control: Arc<Mutex<Option<TcpStream>>>,
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
    audio_handoff_dropped_frames: u64,
}

struct ActiveConnection {
    connection_id: String,
    session_id: String,
    source_id: String,
    client_name: String,
    client_device_id: String,
    last_heartbeat: Instant,
}

struct ActiveStream {
    stream_id: u32,
    last_valid_packet: Option<Instant>,
}

struct MeterSubscriber {
    source_id: String,
    handoff: Arc<AudioHandoff>,
}

struct ManagerInner {
    listener_state: DevelopmentListenerState,
    bind_address: String,
    advertised_address: Option<String>,
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
    outbound_control: VecDeque<HostControlMessage>,
}

pub(crate) struct DevelopmentProtocolManager {
    operations: Mutex<()>,
    inner: Arc<Mutex<ManagerInner>>,
    workers: Mutex<Option<ListenerWorkers>>,
    pairing: Arc<DevelopmentPairingCoordinator>,
}

impl Default for DevelopmentProtocolManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DevelopmentProtocolManager {
    pub(crate) fn new() -> Self {
        Self::with_pairing(Arc::new(DevelopmentPairingCoordinator::default()))
    }

    pub(crate) fn with_pairing(pairing: Arc<DevelopmentPairingCoordinator>) -> Self {
        Self {
            operations: Mutex::new(()),
            inner: Arc::new(Mutex::new(ManagerInner {
                listener_state: DevelopmentListenerState::Stopped,
                bind_address: DEFAULT_BIND_ADDRESS.to_string(),
                advertised_address: None,
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
                outbound_control: VecDeque::new(),
            })),
            workers: Mutex::new(None),
            pairing,
        }
    }
    pub(crate) fn start(
        &self,
        request: StartDevelopmentProtocolRequest,
    ) -> Result<DevelopmentProtocolProjection, String> {
        let _operation = lock(&self.operations);
        self.start_locked(request, None)
    }

    pub(crate) fn start_for_phone_pairing(
        &self,
    ) -> Result<PhonePairingListenerProjection, PhonePairingListenerError> {
        self.start_for_phone_pairing_with(
            None,
            discover_phone_pairing_candidates,
            phone_pairing_start_request(),
        )
    }

    pub(crate) fn select_phone_pairing_address(
        &self,
        request: SelectPhonePairingAddressRequest,
    ) -> Result<PhonePairingListenerProjection, PhonePairingListenerError> {
        self.start_for_phone_pairing_with(
            Some(request.candidate_id.as_str()),
            discover_phone_pairing_candidates,
            phone_pairing_start_request(),
        )
    }

    fn start_for_phone_pairing_with<F>(
        &self,
        selected_candidate_id: Option<&str>,
        discover: F,
        start_request: StartDevelopmentProtocolRequest,
    ) -> Result<PhonePairingListenerProjection, PhonePairingListenerError>
    where
        F: FnOnce() -> Result<Vec<PhonePairingAddressCandidate>, PhonePairingListenerError>,
    {
        let _operation = lock(&self.operations);
        let listener_is_active = lock(&self.workers).is_some();
        if listener_is_active {
            let mut inner = lock(&self.inner);
            if inner.listener_state != DevelopmentListenerState::Listening {
                return Err(PhonePairingListenerError::new(
                    PhonePairingListenerErrorCode::ListenerAlreadyActive,
                    "The development listener is already starting or stopping.",
                ));
            }
            if inner
                .advertised_address
                .as_deref()
                .is_some_and(is_phone_reachable_ipv4)
            {
                drop(inner);
                return self.phone_pairing_listener_projection();
            }
            if is_phone_reachable_ipv4(&inner.bind_address) {
                inner.advertised_address = Some(inner.bind_address.clone());
                drop(inner);
                return self.phone_pairing_listener_projection();
            }
            if inner.bind_address != PHONE_PAIRING_BIND_ADDRESS {
                return Err(PhonePairingListenerError::new(
                    PhonePairingListenerErrorCode::ListenerAlreadyActive,
                    "The active development listener is not reachable from a phone. Stop it before starting phone pairing.",
                ));
            }
        }

        let candidates = discover()?;
        let selected = select_candidate(candidates, selected_candidate_id)?;
        if listener_is_active {
            lock(&self.inner).advertised_address = Some(selected.address);
            return self.phone_pairing_listener_projection();
        }

        self.start_locked(start_request, Some(selected.address))
            .map_err(phone_pairing_start_error)?;
        self.phone_pairing_listener_projection()
    }

    fn start_locked(
        &self,
        request: StartDevelopmentProtocolRequest,
        advertised_address: Option<String>,
    ) -> Result<DevelopmentProtocolProjection, String> {
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
            inner.advertised_address = advertised_address
                .or_else(|| is_phone_reachable_ipv4(&bind_address).then(|| bind_address.clone()));
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
        let actual_tcp_port = tcp_listener
            .local_addr()
            .map(|addr| addr.port())
            .unwrap_or(tcp_port);
        let actual_udp_port = udp_socket
            .local_addr()
            .map(|addr| addr.port())
            .unwrap_or(udp_port);
        {
            let mut inner = lock(&self.inner);
            inner.tcp_port = actual_tcp_port;
            inner.udp_port = actual_udp_port;
        }
        let (stop_tcp, stop_tcp_rx) = mpsc::channel();
        let (stop_udp, stop_udp_rx) = mpsc::channel();
        let shutdown = Arc::new(AtomicBool::new(false));
        let active_control = Arc::new(Mutex::new(None));
        let tcp_inner = Arc::clone(&self.inner);
        let tcp_shutdown = Arc::clone(&shutdown);
        let tcp_active_control = Arc::clone(&active_control);
        let tcp_pairing = Arc::clone(&self.pairing);
        let tcp_worker = thread::spawn(move || {
            run_tcp_listener(
                tcp_listener,
                tcp_inner,
                stop_tcp_rx,
                tcp_shutdown,
                tcp_active_control,
                tcp_pairing,
            )
        });
        let udp_inner = Arc::clone(&self.inner);
        let udp_shutdown = Arc::clone(&shutdown);
        let udp_worker = thread::spawn(move || {
            run_udp_listener(udp_socket, udp_inner, stop_udp_rx, udp_shutdown)
        });
        *lock(&self.workers) = Some(ListenerWorkers {
            shutdown,
            active_control,
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
        self.clear_runtime_state("development-listener-stopped");
        self.stop_workers();
        self.pairing.listener_stopped();
        let mut inner = lock(&self.inner);
        inner.listener_state = DevelopmentListenerState::Stopped;
        inner.advertised_address = None;
        drop(inner);
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

    fn phone_pairing_listener_projection(
        &self,
    ) -> Result<PhonePairingListenerProjection, PhonePairingListenerError> {
        let listener = self.projection();
        let advertised_address = listener.status.advertised_address.clone().ok_or_else(|| {
            PhonePairingListenerError::new(
                PhonePairingListenerErrorCode::InternalError,
                "The listener started without a phone-reachable endpoint.",
            )
        })?;
        Ok(PhonePairingListenerProjection {
            control_port: listener.status.tcp_port,
            audio_port: listener.status.udp_port,
            advertised_address,
            listener,
        })
    }

    pub(crate) fn sources(&self) -> Vec<DiscoveredMicrophoneSource> {
        source_from_inner(&lock(&self.inner)).into_iter().collect()
    }

    pub(crate) fn is_source_available(&self, source_id: &str) -> bool {
        self.sources().iter().any(|source| {
            source.id == source_id && source.availability == MicrophoneSourceAvailability::Available
        })
    }

    pub(crate) fn pairing_endpoint(&self) -> Result<(String, u16), PairingError> {
        let inner = lock(&self.inner);
        if inner.listener_state != DevelopmentListenerState::Listening {
            return Err(PairingError::new(
                PairingErrorCode::ListenerNotActive,
                "Start the insecure development listener before pairing a phone.",
            ));
        }
        let advertised_address = inner.advertised_address.clone().ok_or_else(|| {
            PairingError::new(
                PairingErrorCode::UnreachableHostAddress,
                "The development listener has no concrete phone-reachable LAN address.",
            )
        })?;
        Ok((advertised_address, inner.tcp_port))
    }

    pub(crate) fn queue_pairing_outbound(&self, outbound: PairingOutboundMessage) {
        lock(&self.inner)
            .outbound_control
            .push_back(host_message_from_pairing(outbound));
    }

    pub(crate) fn revoke_participant(
        &self,
        revocation: crate::development_pairing::ParticipantRevocation,
    ) {
        let handoff = {
            let mut state = lock(&self.inner);
            let matches_connection = revocation.connection_id.as_deref().is_some_and(|id| {
                state
                    .connection
                    .as_ref()
                    .is_some_and(|connection| connection.connection_id == id)
            });
            if !matches_connection {
                return;
            }
            if let Some(stream) = state.stream.take() {
                state
                    .outbound_control
                    .push_back(HostControlMessage::StreamStopped {
                        profile_version: 0,
                        audio_stream_id: stream.stream_id,
                    });
            }
            state.jitter.clear();
            state
                .outbound_control
                .push_back(host_message_from_pairing(revocation.outbound));
            state.meter.as_ref().map(|meter| Arc::clone(&meter.handoff))
        };
        if let Some(handoff) = handoff {
            handoff.clear();
        }
    }

    pub(crate) fn run_capture(
        &self,
        source_id: &str,
        stop: mpsc::Receiver<()>,
        ready: mpsc::Sender<Result<(), String>>,
        levels: LevelConsumer,
        audio_frames: AudioFrameConsumer,
        timeout: Duration,
    ) -> Result<CaptureEnd, String> {
        if !self.is_source_available(source_id) {
            let message =
                "The selected development network microphone is not available.".to_string();
            let _ = ready.send(Err(message.clone()));
            return Err(message);
        }
        let handoff = Arc::new(AudioHandoff::new(AUDIO_HANDOFF_CAPACITY_FRAMES));
        let replaced = lock(&self.inner).meter.replace(MeterSubscriber {
            source_id: source_id.to_string(),
            handoff: Arc::clone(&handoff),
        });
        if let Some(replaced) = replaced {
            replaced.handoff.close_and_clear();
        }
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
            match handoff.receive_timeout(Duration::from_millis(50)) {
                ReceiveResult::Frame(samples) => {
                    let normalized = samples
                        .iter()
                        .map(|sample| f32::from(*sample) / 32768.0)
                        .collect::<Vec<_>>();
                    sequence += 1;
                    let level = normalized_levels(&normalized, sequence);
                    lock(&self.inner).level = level;
                    audio_frames(CaptureAudioFrame {
                        samples: normalized,
                        sample_rate_hz: 48_000,
                        channels: 1,
                        sequence,
                        encoding: MonitorSampleEncoding::Float32,
                    });
                    levels(level);
                }
                ReceiveResult::Timeout => {}
                ReceiveResult::Closed => {
                    self.clear_meter(source_id);
                    return Err("Development network microphone stream ended.".to_string());
                }
            }
        }
    }

    fn clear_meter(&self, source_id: &str) {
        let meter = {
            let mut inner = lock(&self.inner);
            if inner
                .meter
                .as_ref()
                .is_some_and(|meter| meter.source_id == source_id)
            {
                inner.meter.take()
            } else {
                None
            }
        };
        if let Some(meter) = meter {
            meter.handoff.close_and_clear();
        }
    }

    fn mark_failed(&self, message: String) {
        let mut inner = lock(&self.inner);
        inner.listener_state = DevelopmentListenerState::Failed;
        inner.advertised_address = None;
        inner.error = Some(message);
    }

    fn clear_runtime_state(&self, reason: &str) {
        let meter = {
            let mut inner = lock(&self.inner);
            inner.connection = None;
            inner.stream = None;
            let meter = inner.meter.take();
            inner.jitter.clear();
            inner.closure_reason = Some(reason.to_string());
            inner.level = MicrophoneLevelSnapshot::idle();
            inner.outbound_control.clear();
            meter
        };
        if let Some(meter) = meter {
            meter.handoff.close_and_clear();
        }
    }

    fn stop_workers(&self) {
        if let Some(workers) = lock(&self.workers).take() {
            workers.shutdown.store(true, Ordering::SeqCst);
            if let Some(stream) = lock(&workers.active_control).take() {
                let _ = stream.shutdown(Shutdown::Both);
            }
            let _ = workers.stop_tcp.send(());
            let _ = workers.stop_udp.send(());
            let _ = workers.tcp_worker.join();
            let _ = workers.udp_worker.join();
        }
    }

    #[cfg(test)]
    pub(crate) fn handle_control_line_for_test(&self, line: &str) -> Option<HostControlMessage> {
        handle_control_line(&self.inner, &self.pairing, line)
    }

    #[cfg(test)]
    pub(crate) fn handle_udp_for_test(&self, datagram: &[u8]) {
        handle_udp_datagram(&self.inner, datagram);
    }

    #[cfg(test)]
    pub(crate) fn has_workers_for_test(&self) -> bool {
        lock(&self.workers).is_some()
    }
}

impl Drop for DevelopmentProtocolManager {
    fn drop(&mut self) {
        self.clear_runtime_state("development-listener-dropped");
        self.stop_workers();
    }
}
fn run_tcp_listener(
    listener: TcpListener,
    inner: Arc<Mutex<ManagerInner>>,
    stop: mpsc::Receiver<()>,
    shutdown: Arc<AtomicBool>,
    active_control: Arc<Mutex<Option<TcpStream>>>,
    pairing: Arc<DevelopmentPairingCoordinator>,
) {
    loop {
        if shutdown.load(Ordering::SeqCst) || stop.try_recv().is_ok() {
            break;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if shutdown.load(Ordering::SeqCst) {
                    let _ = stream.shutdown(Shutdown::Both);
                    break;
                }
                handle_stream(stream, &inner, &shutdown, &active_control, &pairing);
            }
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

fn handle_stream(
    mut stream: TcpStream,
    inner: &Arc<Mutex<ManagerInner>>,
    shutdown: &Arc<AtomicBool>,
    active_control: &Arc<Mutex<Option<TcpStream>>>,
    pairing: &Arc<DevelopmentPairingCoordinator>,
) {
    let _ = stream.set_nonblocking(true);
    if let Ok(active_stream) = stream.try_clone() {
        *lock(active_control) = Some(active_stream);
    }
    let mut pending = Vec::with_capacity(1024);
    let mut buffer = [0u8; 1024];
    loop {
        if shutdown.load(Ordering::SeqCst) {
            revoke_connection(inner, pairing, "development-listener-stopped");
            break;
        }
        if let Some(outbound) = pairing.expire_due() {
            lock(inner)
                .outbound_control
                .push_back(host_message_from_pairing(outbound));
        }
        flush_outbound_responses(inner, &mut stream);
        match stream.read(&mut buffer) {
            Ok(0) => {
                revoke_connection(inner, pairing, "control-connection-closed");
                break;
            }
            Ok(size) => {
                pending.extend_from_slice(&buffer[..size]);
                while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                    let mut line = pending.drain(..=newline).collect::<Vec<_>>();
                    while matches!(line.last(), Some(b'\n' | b'\r')) {
                        line.pop();
                    }
                    if line.is_empty() {
                        continue;
                    }
                    let Ok(line) = std::str::from_utf8(&line) else {
                        lock(inner).counters.malformed_control_messages += 1;
                        let response = HostControlMessage::DevelopmentError {
                            profile_version: 0,
                            reason_code: "malformed-json".to_string(),
                            message: "Malformed development control message.".to_string(),
                        };
                        write_host_response(&mut stream, &response);
                        continue;
                    };
                    if let Some(response) = handle_control_line(inner, pairing, line) {
                        write_host_response(&mut stream, &response);
                    }
                }
                if pending.len() > 16 * 1024 {
                    lock(inner).counters.malformed_control_messages += 1;
                    pending.clear();
                    let response = HostControlMessage::DevelopmentError {
                        profile_version: 0,
                        reason_code: "control-line-too-large".to_string(),
                        message: "Development control message is too large.".to_string(),
                    };
                    write_host_response(&mut stream, &response);
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
                    revoke_connection(inner, pairing, "heartbeat-timeout");
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => {
                revoke_connection(inner, pairing, "control-read-error");
                break;
            }
        }
    }
    *lock(active_control) = None;
}

fn write_host_response(stream: &mut TcpStream, response: &HostControlMessage) {
    if let Ok(serialized) = serde_json::to_string(response) {
        let _ = writeln!(stream, "{serialized}");
    }
}

fn flush_outbound_responses(inner: &Arc<Mutex<ManagerInner>>, stream: &mut TcpStream) {
    let responses = {
        let mut state = lock(inner);
        state.outbound_control.drain(..).collect::<Vec<_>>()
    };
    for response in responses {
        write_host_response(stream, &response);
    }
}

fn pairing_context(
    inner: &Arc<Mutex<ManagerInner>>,
) -> Result<PairingConnectionContext, PairingError> {
    let state = lock(inner);
    let connection = state.connection.as_ref().ok_or_else(|| {
        PairingError::new(
            PairingErrorCode::InvalidState,
            "Complete the development client hello before pairing.",
        )
    })?;
    Ok(PairingConnectionContext {
        connection_id: connection.connection_id.clone(),
        client_device_id: connection.client_device_id.clone(),
        source_id: connection.source_id.clone(),
    })
}

fn pairing_error_message(request_id: Option<String>, error: PairingError) -> HostControlMessage {
    HostControlMessage::DevelopmentPairingError {
        profile_version: 0,
        request_id,
        reason_code: error.reason_code,
        message: error.message,
    }
}

fn host_message_from_pairing(outbound: PairingOutboundMessage) -> HostControlMessage {
    match outbound {
        PairingOutboundMessage::AcceptedForSetup {
            request_id,
            offer_id,
            participant_setup_token,
            host_display_name,
        } => HostControlMessage::PairingAcceptedForSetup {
            profile_version: 0,
            request_id,
            offer_id,
            participant_setup_token,
            host_display_name,
            pairing_scope: crate::development_pairing::PairingScopeProjection::Generic,
            participant_setup_required: true,
        },
        PairingOutboundMessage::ParticipantAccepted {
            request_id,
            participant,
        } => HostControlMessage::ParticipantAccepted {
            profile_version: 0,
            request_id,
            participant,
        },
        PairingOutboundMessage::ParticipantRejected {
            request_id,
            reason_code,
            message,
        } => HostControlMessage::ParticipantRejected {
            profile_version: 0,
            request_id,
            status: "rejected".to_string(),
            reason_code,
            message,
        },
        PairingOutboundMessage::ParticipantRevoked {
            session_singer_id,
            reason_code,
            message,
        } => HostControlMessage::ParticipantRevoked {
            profile_version: 0,
            status: "revoked".to_string(),
            session_singer_id,
            reason_code,
            message,
        },
        PairingOutboundMessage::OfferExpired { offer_id } => {
            HostControlMessage::PairingOfferExpired {
                profile_version: 0,
                offer_id,
                reason_code: "offer-expired".to_string(),
                message: "This pairing code expired.".to_string(),
            }
        }
        PairingOutboundMessage::OfferCancelled { offer_id } => {
            HostControlMessage::PairingOfferCancelled {
                profile_version: 0,
                offer_id,
                reason_code: "offer-cancelled".to_string(),
                message: "The Host cancelled this pairing code.".to_string(),
            }
        }
    }
}

fn handle_control_line(
    inner: &Arc<Mutex<ManagerInner>>,
    pairing: &Arc<DevelopmentPairingCoordinator>,
    line: &str,
) -> Option<HostControlMessage> {
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
            let (connection_id, session_id, source_id, udp_port, handoff) = {
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
                    client_device_id,
                    last_heartbeat: Instant::now(),
                });
                state.stream = None;
                state.jitter.clear();
                (
                    connection_id,
                    session_id,
                    source_id,
                    state.udp_port,
                    state.meter.as_ref().map(|meter| Arc::clone(&meter.handoff)),
                )
            };
            if let Some(handoff) = handoff {
                handoff.clear();
            }
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
            let handoff = state.meter.as_ref().map(|meter| Arc::clone(&meter.handoff));
            drop(state);
            if let Some(handoff) = handoff {
                handoff.clear();
            }
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
            let Some(active_stream_id) = state.stream.as_ref().map(|stream| stream.stream_id)
            else {
                state.counters.rejected_control_messages += 1;
                return Some(HostControlMessage::DevelopmentError {
                    profile_version: 0,
                    reason_code: "stream-not-active".to_string(),
                    message: "No development audio stream is active.".to_string(),
                });
            };
            if active_stream_id != audio_stream_id {
                state.counters.rejected_control_messages += 1;
                return Some(HostControlMessage::DevelopmentError {
                    profile_version: 0,
                    reason_code: "audio-stream-id-mismatch".to_string(),
                    message: "The requested development audio stream is not active.".to_string(),
                });
            }
            state.stream = None;
            state.jitter.clear();
            let handoff = state.meter.as_ref().map(|meter| Arc::clone(&meter.handoff));
            drop(state);
            if let Some(handoff) = handoff {
                handoff.clear();
            }
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
        ClientControlMessage::PairingClaim {
            profile_version,
            request_id,
            offer_id,
            pairing_token,
            client_device_id,
            client_name,
        } => {
            let context = match pairing_context(inner) {
                Ok(context) => context,
                Err(error) => return Some(pairing_error_message(Some(request_id), error)),
            };
            match pairing.claim(
                context,
                PairingClaim {
                    profile_version,
                    request_id: request_id.clone(),
                    offer_id,
                    pairing_token,
                    client_device_id,
                    client_name,
                },
            ) {
                Ok(outbound) => Some(host_message_from_pairing(outbound)),
                Err(error) => {
                    lock(inner).counters.rejected_control_messages += 1;
                    Some(pairing_error_message(Some(request_id), error))
                }
            }
        }
        ClientControlMessage::ParticipantSetupProposal {
            profile_version,
            request_id,
            offer_id,
            participant_setup_token,
            client_device_id,
            local_participant_profile_id,
            preferred_display_name,
            previous_host_participant_reference,
        } => {
            let context = match pairing_context(inner) {
                Ok(context) => context,
                Err(error) => return Some(pairing_error_message(Some(request_id), error)),
            };
            match pairing.submit_proposal(
                context,
                ParticipantSetupProposal {
                    profile_version,
                    request_id: request_id.clone(),
                    offer_id,
                    participant_setup_token,
                    client_device_id,
                    local_participant_profile_id,
                    preferred_display_name,
                    previous_host_participant_reference,
                },
            ) {
                Ok(()) => None,
                Err(error) => {
                    lock(inner).counters.rejected_control_messages += 1;
                    Some(pairing_error_message(Some(request_id), error))
                }
            }
        }
    }
}
fn run_udp_listener(
    socket: UdpSocket,
    inner: Arc<Mutex<ManagerInner>>,
    stop: mpsc::Receiver<()>,
    shutdown: Arc<AtomicBool>,
) {
    let mut buffer = [0u8; 1500];
    loop {
        if shutdown.load(Ordering::SeqCst) || stop.try_recv().is_ok() {
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
    let handoff = {
        let mut state = lock(inner);
        state.counters.valid_packets += 1;
        if let Some(stream) = &mut state.stream {
            stream.last_valid_packet = Some(Instant::now());
        }
        state.meter.as_ref().map(|meter| Arc::clone(&meter.handoff))
    };
    if let Some(handoff) = handoff {
        if matches!(
            handoff.push(packet.samples),
            PushResult::Enqueued {
                dropped_oldest: true
            }
        ) {
            lock(inner).counters.audio_handoff_dropped_frames += 1;
        }
    }
}

fn revoke_connection(
    inner: &Arc<Mutex<ManagerInner>>,
    pairing: &Arc<DevelopmentPairingCoordinator>,
    reason: &str,
) {
    let connection_id = lock(inner)
        .connection
        .as_ref()
        .map(|connection| connection.connection_id.clone());
    if let Some(connection_id) = connection_id {
        pairing.connection_lost(&connection_id);
    }
    let meter = {
        let mut state = lock(inner);
        state.connection = None;
        state.stream = None;
        let meter = state.meter.take();
        state.jitter.clear();
        state.closure_reason = Some(reason.to_string());
        state.level = MicrophoneLevelSnapshot::idle();
        state.outbound_control.clear();
        meter
    };
    if let Some(meter) = meter {
        meter.handoff.close_and_clear();
    }
}

fn status_from_inner(inner: &ManagerInner) -> DevelopmentProtocolStatus {
    let connection = inner.connection.as_ref();
    DevelopmentProtocolStatus {
        listener_state: inner.listener_state,
        bind_address: inner.bind_address.clone(),
        advertised_address: inner.advertised_address.clone(),
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

fn select_candidate(
    candidates: Vec<PhonePairingAddressCandidate>,
    selected_candidate_id: Option<&str>,
) -> Result<PhonePairingAddressCandidate, PhonePairingListenerError> {
    if candidates.is_empty() {
        return Err(PhonePairingListenerError::new(
            PhonePairingListenerErrorCode::NoReachableLanAddress,
            "No phone-reachable IPv4 address is available on this Host.",
        ));
    }
    if let Some(selected_candidate_id) = selected_candidate_id {
        return candidates
            .iter()
            .find(|candidate| candidate.id == selected_candidate_id)
            .cloned()
            .ok_or_else(|| {
                PhonePairingListenerError::with_candidates(
                    PhonePairingListenerErrorCode::InvalidSelectedAddress,
                    "The selected LAN address is no longer available.",
                    candidates,
                )
            });
    }
    if candidates.len() > 1 {
        return Err(PhonePairingListenerError::with_candidates(
            PhonePairingListenerErrorCode::AmbiguousLanAddress,
            "More than one phone-reachable LAN address is available. Choose the trusted network.",
            candidates,
        ));
    }
    Ok(candidates.into_iter().next().expect("candidate is present"))
}

fn phone_pairing_start_error(message: String) -> PhonePairingListenerError {
    let reason_code = if message.contains("Could not start insecure development") {
        PhonePairingListenerErrorCode::ListenerBindFailed
    } else {
        PhonePairingListenerErrorCode::InternalError
    };
    PhonePairingListenerError::new(reason_code, message)
}

fn phone_pairing_start_request() -> StartDevelopmentProtocolRequest {
    StartDevelopmentProtocolRequest {
        bind_address: Some(PHONE_PAIRING_BIND_ADDRESS.to_string()),
        tcp_port: Some(DEFAULT_TCP_PORT),
        udp_port: Some(DEFAULT_UDP_PORT),
    }
}

fn diagnostics_from_inner(inner: &ManagerInner) -> DevelopmentStreamDiagnostics {
    let total_loss_basis = inner.counters.valid_packets + inner.counters.sequence_gaps;
    let estimated_packet_loss = if total_loss_basis == 0 {
        0.0
    } else {
        inner.counters.sequence_gaps as f32 / total_loss_basis as f32
    };
    let handoff = inner
        .meter
        .as_ref()
        .map(|meter| meter.handoff.snapshot())
        .unwrap_or_default();
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
        audio_handoff_capacity_frames: AUDIO_HANDOFF_CAPACITY_FRAMES,
        audio_handoff_queue_depth: handoff.depth,
        audio_handoff_maximum_queue_depth: handoff.maximum_depth,
        audio_handoff_dropped_frames: inner.counters.audio_handoff_dropped_frames,
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
    use std::{
        io::{BufRead, BufReader, Write},
        net::{TcpStream, UdpSocket},
        time::{Duration, Instant},
    };

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

    fn test_request() -> StartDevelopmentProtocolRequest {
        StartDevelopmentProtocolRequest {
            bind_address: Some("127.0.0.1".to_string()),
            tcp_port: Some(0),
            udp_port: Some(0),
        }
    }

    fn phone_test_request() -> StartDevelopmentProtocolRequest {
        StartDevelopmentProtocolRequest {
            bind_address: Some(PHONE_PAIRING_BIND_ADDRESS.to_string()),
            tcp_port: Some(0),
            udp_port: Some(0),
        }
    }

    fn phone_candidate(id: &str, address: &str) -> PhonePairingAddressCandidate {
        PhonePairingAddressCandidate {
            id: id.to_string(),
            address: address.to_string(),
            interface_name: "Wi-Fi".to_string(),
        }
    }

    struct TestControlClient {
        reader: BufReader<TcpStream>,
        writer: TcpStream,
    }

    impl TestControlClient {
        fn write(&mut self, message: &str) {
            writeln!(self.writer, "{message}").unwrap();
            self.writer.flush().unwrap();
        }

        fn read_line(&mut self) -> String {
            let mut line = String::new();
            self.reader.read_line(&mut line).unwrap();
            line
        }
    }

    fn connect_to_listener(manager: &DevelopmentProtocolManager) -> TestControlClient {
        let projection = manager.projection();
        let stream = TcpStream::connect(("127.0.0.1", projection.status.tcp_port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let reader_stream = stream.try_clone().unwrap();
        TestControlClient {
            reader: BufReader::new(reader_stream),
            writer: stream,
        }
    }

    fn wait_until(timeout: Duration, condition: impl Fn() -> bool) -> bool {
        let started = Instant::now();
        while started.elapsed() < timeout {
            if condition() {
                return true;
            }
            thread::sleep(Duration::from_millis(10));
        }
        condition()
    }

    fn stop_within(
        manager: &DevelopmentProtocolManager,
        timeout: Duration,
    ) -> DevelopmentProtocolProjection {
        let started = Instant::now();
        let projection = manager.stop();
        assert!(
            started.elapsed() < timeout,
            "development protocol stop exceeded {:?}",
            timeout
        );
        projection
    }

    fn connect_and_authorize(manager: &DevelopmentProtocolManager) -> TestControlClient {
        let mut stream = connect_to_listener(manager);
        stream.write(hello());
        let hello_response = stream.read_line();
        assert!(hello_response.contains("host_hello_accepted"));
        stream.write(
            r#"{"type":"request_stream_authorization","profileVersion":0,"captureAttemptId":"attempt-1"}"#,
        );
        let authorize_response = stream.read_line();
        assert!(
            authorize_response.contains("stream_authorized"),
            "unexpected stream authorization response: {authorize_response}"
        );
        assert!(wait_until(Duration::from_secs(1), || manager
            .projection()
            .status
            .stream_authorized));
        stream
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
    fn development_pairing_messages_use_the_existing_control_connection() {
        let manager = DevelopmentProtocolManager::new();
        let offer = manager
            .pairing
            .create_offer(
                crate::development_pairing::CreatePairingOfferRequest {
                    request_id: "host-offer-1".to_string(),
                },
                "192.168.1.78".to_string(),
                45_820,
            )
            .unwrap();
        manager.handle_control_line_for_test(hello());

        let claim = serde_json::json!({
            "type": "pairing_claim",
            "profileVersion": 0,
            "requestId": "claim-1",
            "offerId": offer.offer_id,
            "pairingToken": offer.pairing_token,
            "clientDeviceId": "dev-1",
            "clientName": "Synthetic Android"
        });
        let response = manager
            .handle_control_line_for_test(&claim.to_string())
            .unwrap();
        let setup_token = match &response {
            HostControlMessage::PairingAcceptedForSetup {
                participant_setup_token,
                ..
            } => participant_setup_token.clone(),
            _ => panic!("unexpected pairing claim response"),
        };
        let serialized = serde_json::to_value(response).unwrap();
        assert_eq!(serialized["type"], "pairing_accepted_for_setup");
        assert_eq!(serialized["participantSetupRequired"], true);

        let proposal = serde_json::json!({
            "type": "participant_setup_proposal",
            "profileVersion": 0,
            "requestId": "proposal-1",
            "offerId": claim["offerId"],
            "participantSetupToken": setup_token,
            "clientDeviceId": "dev-1",
            "localParticipantProfileId": "profile-1",
            "preferredDisplayName": "Kyle",
            "previousHostParticipantReference": "stale-hint"
        });
        assert!(manager
            .handle_control_line_for_test(&proposal.to_string())
            .is_none());
        assert_eq!(
            manager.pairing.projection().status.lifecycle_state,
            Some(crate::development_pairing::PairingOfferState::AwaitingOperatorApproval)
        );
    }

    #[test]
    fn development_pairing_endpoint_requires_an_active_listener() {
        let manager = DevelopmentProtocolManager::new();
        let error = manager.pairing_endpoint().unwrap_err();

        assert_eq!(
            error.reason_code,
            crate::development_pairing::PairingErrorCode::ListenerNotActive
        );
        assert!(error
            .message
            .contains("Start the insecure development listener"));
    }

    #[test]
    fn phone_pairing_single_candidate_binds_wildcard_and_advertises_concrete_address() {
        let manager = DevelopmentProtocolManager::new();
        let projection = manager
            .start_for_phone_pairing_with(
                None,
                || Ok(vec![phone_candidate("wifi", "192.168.1.42")]),
                phone_test_request(),
            )
            .unwrap();

        assert_eq!(projection.listener.status.bind_address, "0.0.0.0");
        assert_eq!(projection.advertised_address, "192.168.1.42");
        assert_ne!(
            projection.advertised_address,
            projection.listener.status.bind_address
        );
        assert_eq!(
            manager.pairing_endpoint().unwrap(),
            ("192.168.1.42".to_string(), projection.control_port)
        );
        manager.stop();
    }

    #[test]
    fn phone_pairing_reports_no_candidate_and_ambiguity_without_starting() {
        let manager = DevelopmentProtocolManager::new();
        let error = manager
            .start_for_phone_pairing_with(None, || Ok(Vec::new()), phone_test_request())
            .unwrap_err();
        assert_eq!(
            error.reason_code,
            PhonePairingListenerErrorCode::NoReachableLanAddress
        );

        let error = manager
            .start_for_phone_pairing_with(
                None,
                || {
                    Ok(vec![
                        phone_candidate("ethernet", "10.0.0.8"),
                        phone_candidate("wifi", "192.168.1.42"),
                    ])
                },
                phone_test_request(),
            )
            .unwrap_err();
        assert_eq!(
            error.reason_code,
            PhonePairingListenerErrorCode::AmbiguousLanAddress
        );
        assert_eq!(error.candidates.len(), 2);
        assert!(!manager.has_workers_for_test());
    }

    #[test]
    fn phone_pairing_selected_candidate_is_revalidated() {
        let manager = DevelopmentProtocolManager::new();
        let error = manager
            .start_for_phone_pairing_with(
                Some("stale-candidate"),
                || Ok(vec![phone_candidate("wifi", "192.168.1.42")]),
                phone_test_request(),
            )
            .unwrap_err();
        assert_eq!(
            error.reason_code,
            PhonePairingListenerErrorCode::InvalidSelectedAddress
        );
        assert!(!manager.has_workers_for_test());

        let projection = manager
            .start_for_phone_pairing_with(
                Some("wifi"),
                || Ok(vec![phone_candidate("wifi", "192.168.1.42")]),
                phone_test_request(),
            )
            .unwrap();
        assert_eq!(projection.advertised_address, "192.168.1.42");
        manager.stop();
    }

    #[test]
    fn phone_pairing_reuses_an_active_wildcard_listener() {
        let manager = DevelopmentProtocolManager::new();
        let existing = manager.start(phone_test_request()).unwrap();
        assert_eq!(existing.status.advertised_address, None);

        let projection = manager
            .start_for_phone_pairing_with(
                None,
                || Ok(vec![phone_candidate("wifi", "192.168.1.42")]),
                phone_test_request(),
            )
            .unwrap();

        assert_eq!(projection.control_port, existing.status.tcp_port);
        assert_eq!(projection.audio_port, existing.status.udp_port);
        assert_eq!(projection.advertised_address, "192.168.1.42");
        manager.stop();
    }

    #[test]
    fn active_loopback_listener_is_not_restarted_for_phone_pairing() {
        let manager = DevelopmentProtocolManager::new();
        manager.start(test_request()).unwrap();

        let error = manager
            .start_for_phone_pairing_with(
                None,
                || Ok(vec![phone_candidate("wifi", "192.168.1.42")]),
                phone_test_request(),
            )
            .unwrap_err();
        assert_eq!(
            error.reason_code,
            PhonePairingListenerErrorCode::ListenerAlreadyActive
        );
        assert_eq!(manager.projection().status.bind_address, "127.0.0.1");
        manager.stop();
    }

    #[test]
    fn endpoint_discovery_and_bind_failures_are_typed() {
        let manager = DevelopmentProtocolManager::new();
        let error = manager
            .start_for_phone_pairing_with(
                None,
                || {
                    Err(PhonePairingListenerError::new(
                        PhonePairingListenerErrorCode::EndpointResolutionFailed,
                        "Interface query failed.",
                    ))
                },
                phone_test_request(),
            )
            .unwrap_err();
        assert_eq!(
            error.reason_code,
            PhonePairingListenerErrorCode::EndpointResolutionFailed
        );

        let occupied = TcpListener::bind((PHONE_PAIRING_BIND_ADDRESS, 0)).unwrap();
        let port = occupied.local_addr().unwrap().port();
        let error = manager
            .start_for_phone_pairing_with(
                None,
                || Ok(vec![phone_candidate("wifi", "192.168.1.42")]),
                StartDevelopmentProtocolRequest {
                    bind_address: Some(PHONE_PAIRING_BIND_ADDRESS.to_string()),
                    tcp_port: Some(port),
                    udp_port: Some(0),
                },
            )
            .unwrap_err();
        assert_eq!(
            error.reason_code,
            PhonePairingListenerErrorCode::ListenerBindFailed
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
        let response = manager.handle_control_line_for_test(
            r#"{"type":"stop_stream","profileVersion":0,"audioStreamId":1,"reasonCode":"local_user_stop"}"#,
        );
        assert!(matches!(
            response,
            Some(HostControlMessage::StreamStopped {
                audio_stream_id: 1,
                ..
            })
        ));
        assert!(!manager.projection().status.stream_authorized);
    }

    #[test]
    fn participant_revocation_stops_stream_and_queues_authoritative_lifecycle_outcome() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        let connection_id = manager.projection().status.current_connection_id.unwrap();

        manager.revoke_participant(crate::development_pairing::ParticipantRevocation {
            connection_id: Some(connection_id),
            outbound: PairingOutboundMessage::ParticipantRevoked {
                session_singer_id: "singer-1".to_string(),
                reason_code: "session-singer-removed".to_string(),
                message: "The Host removed this participant from the karaoke session.".to_string(),
            },
        });

        assert!(!manager.projection().status.stream_authorized);
        let state = lock(&manager.inner);
        assert!(matches!(
            state.outbound_control.front(),
            Some(HostControlMessage::StreamStopped {
                audio_stream_id: 1,
                ..
            })
        ));
        assert!(matches!(
            state.outbound_control.get(1),
            Some(HostControlMessage::ParticipantRevoked {
                session_singer_id,
                reason_code,
                ..
            }) if session_singer_id == "singer-1" && reason_code == "session-singer-removed"
        ));
        let serialized = serde_json::to_value(&state.outbound_control[1]).unwrap();
        assert_eq!(serialized["type"], "participant_revoked");
        assert_eq!(serialized["status"], "revoked");
    }

    #[test]
    fn stale_stop_stream_id_is_rejected_without_stopping_newer_stream() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        manager.handle_control_line_for_test(
            r#"{"type":"stop_stream","profileVersion":0,"audioStreamId":1,"reasonCode":"local_user_stop"}"#,
        );
        manager.handle_control_line_for_test(
            r#"{"type":"request_stream_authorization","profileVersion":0,"captureAttemptId":"attempt-2"}"#,
        );

        let response = manager.handle_control_line_for_test(
            r#"{"type":"stop_stream","profileVersion":0,"audioStreamId":1,"reasonCode":"stale_stop"}"#,
        );

        assert!(matches!(
            response,
            Some(HostControlMessage::DevelopmentError { reason_code, .. })
                if reason_code == "audio-stream-id-mismatch"
        ));
        assert_eq!(manager.projection().status.active_stream_id, Some(2));
    }

    #[test]
    fn repeated_or_inactive_stop_stream_is_rejected() {
        let manager = DevelopmentProtocolManager::new();
        manager.handle_control_line_for_test(hello());
        let inactive = manager.handle_control_line_for_test(
            r#"{"type":"stop_stream","profileVersion":0,"audioStreamId":1,"reasonCode":"local_user_stop"}"#,
        );
        assert!(matches!(
            inactive,
            Some(HostControlMessage::DevelopmentError { reason_code, .. })
                if reason_code == "stream-not-active"
        ));

        authorize(&manager);
        manager.handle_control_line_for_test(
            r#"{"type":"stop_stream","profileVersion":0,"audioStreamId":1,"reasonCode":"local_user_stop"}"#,
        );
        let repeated = manager.handle_control_line_for_test(
            r#"{"type":"stop_stream","profileVersion":0,"audioStreamId":1,"reasonCode":"duplicate_stop"}"#,
        );
        assert!(matches!(
            repeated,
            Some(HostControlMessage::DevelopmentError { reason_code, .. })
                if reason_code == "stream-not-active"
        ));
    }

    #[test]
    fn malformed_stop_stream_id_is_handled_as_malformed_control() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        let response = manager.handle_control_line_for_test(
            r#"{"type":"stop_stream","profileVersion":0,"audioStreamId":"one","reasonCode":"local_user_stop"}"#,
        );
        assert!(matches!(
            response,
            Some(HostControlMessage::DevelopmentError { reason_code, .. })
                if reason_code == "malformed-json"
        ));
        assert_eq!(manager.projection().status.active_stream_id, Some(1));
    }

    #[test]
    fn audio_handoff_drops_oldest_frames_and_reports_bounded_diagnostics() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        let source_id = manager.projection().sources[0].id.clone();
        let handoff = Arc::new(AudioHandoff::new(AUDIO_HANDOFF_CAPACITY_FRAMES));
        lock(&manager.inner).meter = Some(MeterSubscriber {
            source_id,
            handoff: Arc::clone(&handoff),
        });

        for value in 0..10 {
            deliver_packet(
                &manager.inner,
                AudioPacket {
                    stream_id: 1,
                    sequence_number: value as u64,
                    first_sample_index: value as u64 * 480,
                    capture_timestamp_nanos: 0,
                    samples: vec![value; 480],
                },
            );
        }

        let diagnostics = manager.projection().diagnostics;
        assert_eq!(diagnostics.audio_handoff_capacity_frames, 4);
        assert_eq!(diagnostics.audio_handoff_queue_depth, 4);
        assert_eq!(diagnostics.audio_handoff_maximum_queue_depth, 4);
        assert_eq!(diagnostics.audio_handoff_dropped_frames, 6);
        for value in 6..10 {
            assert_eq!(
                handoff.receive_timeout(Duration::ZERO),
                ReceiveResult::Frame(vec![value; 480])
            );
        }
    }

    #[test]
    fn stopping_stream_clears_handoff_without_stale_replay() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        let source_id = manager.projection().sources[0].id.clone();
        let handoff = Arc::new(AudioHandoff::new(AUDIO_HANDOFF_CAPACITY_FRAMES));
        lock(&manager.inner).meter = Some(MeterSubscriber {
            source_id,
            handoff: Arc::clone(&handoff),
        });
        handoff.push(vec![1; 480]);

        manager.handle_control_line_for_test(
            r#"{"type":"stop_stream","profileVersion":0,"audioStreamId":1,"reasonCode":"local_user_stop"}"#,
        );

        assert_eq!(handoff.snapshot().depth, 0);
        assert_eq!(
            handoff.receive_timeout(Duration::ZERO),
            ReceiveResult::Timeout
        );
        manager.handle_control_line_for_test(
            r#"{"type":"request_stream_authorization","profileVersion":0,"captureAttemptId":"attempt-2"}"#,
        );
        handoff.push(vec![2; 480]);
        assert_eq!(
            handoff.receive_timeout(Duration::ZERO),
            ReceiveResult::Frame(vec![2; 480])
        );
    }

    #[test]
    fn capture_stop_and_disconnect_close_and_clear_the_handoff() {
        let manager = DevelopmentProtocolManager::new();
        authorize(&manager);
        let source_id = manager.projection().sources[0].id.clone();
        let capture_handoff = Arc::new(AudioHandoff::new(AUDIO_HANDOFF_CAPACITY_FRAMES));
        lock(&manager.inner).meter = Some(MeterSubscriber {
            source_id: source_id.clone(),
            handoff: Arc::clone(&capture_handoff),
        });
        capture_handoff.push(vec![1; 480]);

        manager.clear_meter(&source_id);

        assert_eq!(capture_handoff.snapshot().depth, 0);
        assert_eq!(capture_handoff.push(vec![2; 480]), PushResult::Closed);

        let disconnect_handoff = Arc::new(AudioHandoff::new(AUDIO_HANDOFF_CAPACITY_FRAMES));
        lock(&manager.inner).meter = Some(MeterSubscriber {
            source_id,
            handoff: Arc::clone(&disconnect_handoff),
        });
        disconnect_handoff.push(vec![3; 480]);

        revoke_connection(
            &manager.inner,
            &manager.pairing,
            "control-connection-closed",
        );

        assert_eq!(disconnect_handoff.snapshot().depth, 0);
        assert_eq!(disconnect_handoff.push(vec![4; 480]), PushResult::Closed);
        assert!(manager.projection().sources.is_empty());
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
                Box::new(|_frame| {}),
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

    #[test]
    fn listener_shutdown_start_stop_is_idempotent() {
        let manager = DevelopmentProtocolManager::new();
        let projection = manager.start(test_request()).unwrap();
        assert_eq!(
            projection.status.listener_state,
            DevelopmentListenerState::Listening
        );
        assert!(manager.has_workers_for_test());

        let projection = stop_within(&manager, Duration::from_secs(1));
        assert_eq!(
            projection.status.listener_state,
            DevelopmentListenerState::Stopped
        );
        assert_eq!(
            projection.status.closure_reason.as_deref(),
            Some("development-listener-stopped")
        );
        assert!(!manager.has_workers_for_test());

        let projection = stop_within(&manager, Duration::from_secs(1));
        assert_eq!(
            projection.status.listener_state,
            DevelopmentListenerState::Stopped
        );
        assert!(!manager.has_workers_for_test());
    }

    #[test]
    fn listener_shutdown_start_stop_start_stop_releases_workers() {
        let manager = DevelopmentProtocolManager::new();
        for _ in 0..2 {
            manager.start(test_request()).unwrap();
            assert!(manager.has_workers_for_test());
            stop_within(&manager, Duration::from_secs(1));
            assert!(!manager.has_workers_for_test());
        }
    }

    #[test]
    fn listener_shutdown_with_no_client_connected_stops_cleanly() {
        let manager = DevelopmentProtocolManager::new();
        manager.start(test_request()).unwrap();
        let projection = stop_within(&manager, Duration::from_secs(1));
        assert_eq!(projection.status.connected_client_count, 0);
        assert_eq!(
            projection.status.source_health,
            DevelopmentSourceHealth::Disconnected
        );
        assert!(projection.sources.is_empty());
    }

    #[test]
    fn listener_shutdown_connected_client_revokes_source_and_joins_reader() {
        let manager = DevelopmentProtocolManager::new();
        manager.start(test_request()).unwrap();
        let mut stream = connect_to_listener(&manager);
        stream.write(hello());
        assert!(stream.read_line().contains("host_hello_accepted"));
        assert!(wait_until(Duration::from_secs(1), || manager
            .projection()
            .status
            .connected_client_count
            == 1));

        let projection = stop_within(&manager, Duration::from_secs(1));
        assert_eq!(projection.status.connected_client_count, 0);
        assert!(!projection.status.stream_authorized);
        assert_eq!(
            projection.status.source_health,
            DevelopmentSourceHealth::Disconnected
        );
        assert!(projection.sources.is_empty());
        assert!(!manager.has_workers_for_test());
    }

    #[test]
    fn listener_shutdown_authorized_stream_and_active_udp_stop_safely() {
        let manager = DevelopmentProtocolManager::new();
        let projection = manager.start(test_request()).unwrap();
        let udp_port = projection.status.udp_port;
        let _stream = connect_and_authorize(&manager);
        let udp = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        for sequence in 0..3 {
            udp.send_to(
                &build_test_packet(1, sequence, 1_000),
                ("127.0.0.1", udp_port),
            )
            .unwrap();
        }
        assert!(wait_until(Duration::from_secs(1), || manager
            .projection()
            .diagnostics
            .valid_packets
            > 0));

        let projection = stop_within(&manager, Duration::from_secs(1));
        assert!(!projection.status.stream_authorized);
        assert_eq!(projection.diagnostics.receiver_queue_depth, 0);
        assert_eq!(
            projection.diagnostics.current_source_health,
            DevelopmentSourceHealth::Disconnected
        );
        assert!(!manager.has_workers_for_test());
    }

    #[test]
    fn listener_shutdown_no_packets_are_accepted_after_stop() {
        let manager = DevelopmentProtocolManager::new();
        let projection = manager.start(test_request()).unwrap();
        let udp_port = projection.status.udp_port;
        let _stream = connect_and_authorize(&manager);
        let udp = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        udp.send_to(&build_test_packet(1, 0, 1_000), ("127.0.0.1", udp_port))
            .unwrap();
        assert!(wait_until(Duration::from_secs(1), || manager
            .projection()
            .diagnostics
            .valid_packets
            == 1));

        stop_within(&manager, Duration::from_secs(1));
        udp.send_to(&build_test_packet(1, 1, 1_000), ("127.0.0.1", udp_port))
            .unwrap();
        thread::sleep(Duration::from_millis(150));
        assert_eq!(manager.projection().diagnostics.valid_packets, 1);
    }

    #[test]
    fn listener_shutdown_during_heartbeat_wait_returns_promptly() {
        let manager = DevelopmentProtocolManager::new();
        manager.start(test_request()).unwrap();
        let mut stream = connect_to_listener(&manager);
        stream.write(hello());
        assert!(stream.read_line().contains("host_hello_accepted"));

        let projection = stop_within(&manager, Duration::from_secs(1));
        assert_eq!(
            projection.status.listener_state,
            DevelopmentListenerState::Stopped
        );
        assert!(!manager.has_workers_for_test());
    }

    #[test]
    fn listener_shutdown_stress_start_stop_twenty_five_times() {
        let manager = DevelopmentProtocolManager::new();
        for _ in 0..25 {
            manager.start(test_request()).unwrap();
            assert!(manager.has_workers_for_test());
            stop_within(&manager, Duration::from_secs(1));
            assert!(!manager.has_workers_for_test());
            assert!(manager.projection().sources.is_empty());
            assert!(!manager.projection().status.stream_authorized);
        }
    }
}
