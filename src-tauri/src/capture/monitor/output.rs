#[cfg(any(test, not(target_os = "windows")))]
use crate::capture::CaptureAudioFrame;

use super::models::DiagnosticOutputDevice;

#[cfg(test)]
pub(crate) struct MonitorOutputWorker;

#[cfg(test)]
impl MonitorOutputWorker {
    pub(crate) fn start(_output_device_id: &str) -> Result<Self, String> {
        Ok(Self)
    }

    pub(crate) fn send_frame(&self, _frame: CaptureAudioFrame, _gain: f32) -> Result<(), ()> {
        Ok(())
    }

    pub(crate) fn stop(self) {}
}

#[cfg(test)]
pub(crate) fn list_output_devices() -> Vec<DiagnosticOutputDevice> {
    vec![DiagnosticOutputDevice::default_output()]
}

#[cfg(all(target_os = "windows", not(test)))]
mod platform {
    use std::{
        ffi::c_void,
        sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError},
        thread::{self, JoinHandle},
        time::Duration,
    };

    use windows::{
        core::GUID,
        Win32::{
            Media::Audio::{
                eConsole, eRender, IAudioClient, IAudioRenderClient, IMMDevice,
                IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED, WAVEFORMATEX,
                WAVEFORMATEXTENSIBLE,
            },
            System::Com::{CoTaskMemFree, CLSCTX_ALL},
        },
    };

    use crate::{capture::CaptureAudioFrame, microphones::windows::ComApartment};

    use super::DiagnosticOutputDevice;

    const BUFFER_DURATION_100NS: i64 = 1_000_000;
    const WORKER_QUEUE_CAPACITY: usize = 8;
    const OUTPUT_WAIT_INTERVAL: Duration = Duration::from_millis(2);
    const WAVE_FORMAT_PCM: u16 = 1;
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
    const PCM_SUBFORMAT: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
    const FLOAT_SUBFORMAT: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

    enum OutputCommand {
        Frame(CaptureAudioFrame, f32),
        Stop,
    }

    pub(crate) struct MonitorOutputWorker {
        sender: SyncSender<OutputCommand>,
        handle: Option<JoinHandle<()>>,
    }

    impl MonitorOutputWorker {
        pub(crate) fn start(output_device_id: &str) -> Result<Self, String> {
            if output_device_id != "default" {
                return Err("Only the default Windows output device is available for diagnostic monitoring right now.".to_string());
            }
            let (sender, receiver) = sync_channel(WORKER_QUEUE_CAPACITY);
            let (ready_sender, ready_receiver) = std::sync::mpsc::channel();
            let handle = thread::Builder::new()
                .name("diagnostic-audio-monitor".to_string())
                .spawn(move || run_output_loop(receiver, ready_sender))
                .map_err(|error| format!("Could not start diagnostic monitor worker. {error}"))?;

            match ready_receiver.recv_timeout(Duration::from_secs(3)) {
                Ok(Ok(())) => Ok(Self {
                    sender,
                    handle: Some(handle),
                }),
                Ok(Err(error)) => {
                    let _ = handle.join();
                    Err(error)
                }
                Err(_) => {
                    let _ = sender.send(OutputCommand::Stop);
                    let _ = handle.join();
                    Err("Diagnostic monitor output did not start in time.".to_string())
                }
            }
        }

        pub(crate) fn send_frame(&self, frame: CaptureAudioFrame, gain: f32) -> Result<(), ()> {
            match self.sender.try_send(OutputCommand::Frame(frame, gain)) {
                Ok(()) => Ok(()),
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => Err(()),
            }
        }

        pub(crate) fn stop(mut self) {
            let _ = self.sender.send(OutputCommand::Stop);
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    impl Drop for MonitorOutputWorker {
        fn drop(&mut self) {
            let _ = self.sender.send(OutputCommand::Stop);
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    pub(crate) fn list_output_devices() -> Vec<DiagnosticOutputDevice> {
        vec![DiagnosticOutputDevice::default_output()]
    }

    fn run_output_loop(
        receiver: Receiver<OutputCommand>,
        ready: std::sync::mpsc::Sender<Result<(), String>>,
    ) {
        let prepared = prepare_default_output();
        let (audio_client, render_client, format, buffer_frames, _apartment) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                let _ = ready.send(Err(error));
                return;
            }
        };

        if let Err(error) = unsafe { audio_client.Start() } {
            let _ = ready.send(Err(output_error(
                "Could not start diagnostic audio output.",
                error,
            )));
            return;
        }
        if ready.send(Ok(())).is_err() {
            let _ = unsafe { audio_client.Stop() };
            return;
        }

        while let Ok(command) = receiver.recv() {
            match command {
                OutputCommand::Frame(frame, gain) => {
                    if let Err(error) = write_frame(
                        &audio_client,
                        &render_client,
                        format,
                        buffer_frames,
                        &frame,
                        gain,
                    ) {
                        eprintln!("Diagnostic monitor output dropped a frame. {error}");
                    }
                }
                OutputCommand::Stop => break,
            }
        }

        let _ = unsafe { audio_client.Stop() };
    }

    fn prepare_default_output() -> Result<
        (
            IAudioClient,
            IAudioRenderClient,
            AudioFormat,
            u32,
            ComApartment,
        ),
        String,
    > {
        let apartment = ComApartment::initialize().map_err(|error| error.to_string())?;
        let device = default_render_device()?;
        let audio_client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
            .map_err(|error| output_error("Could not open the Windows output device.", error))?;
        let mix_format =
            MixFormat::new(unsafe { audio_client.GetMixFormat() }.map_err(|error| {
                output_error("Could not read the Windows output format.", error)
            })?)?;
        let format = AudioFormat::from_mix_format(mix_format.0)?;
        unsafe {
            audio_client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                0,
                BUFFER_DURATION_100NS,
                0,
                mix_format.0,
                None,
            )
        }
        .map_err(|error| output_error("Could not initialize diagnostic audio output.", error))?;
        let buffer_frames = unsafe { audio_client.GetBufferSize() }.map_err(|error| {
            output_error("Could not read diagnostic output buffer size.", error)
        })?;
        let render_client: IAudioRenderClient = unsafe { audio_client.GetService() }
            .map_err(|error| output_error("Could not access diagnostic output buffers.", error))?;
        Ok((
            audio_client,
            render_client,
            format,
            buffer_frames,
            apartment,
        ))
    }

    fn default_render_device() -> Result<IMMDevice, String> {
        let enumerator: IMMDeviceEnumerator = unsafe {
            windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|error| {
                    output_error("Could not create the Windows output enumerator.", error)
                })?
        };
        unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
            .map_err(|error| output_error("Could not find a default Windows output device.", error))
    }

    fn write_frame(
        audio_client: &IAudioClient,
        render_client: &IAudioRenderClient,
        format: AudioFormat,
        buffer_frames: u32,
        frame: &CaptureAudioFrame,
        gain: f32,
    ) -> Result<(), String> {
        if frame.samples.is_empty() || frame.sample_rate_hz == 0 || frame.channels == 0 {
            return Ok(());
        }
        let padding = unsafe { audio_client.GetCurrentPadding() }
            .map_err(|error| output_error("Could not read diagnostic output padding.", error))?;
        let available_frames = buffer_frames.saturating_sub(padding);
        if available_frames == 0 {
            std::thread::sleep(OUTPUT_WAIT_INTERVAL);
            return Ok(());
        }
        let source_frames = frame.samples.len() / usize::from(frame.channels);
        if source_frames == 0 {
            return Ok(());
        }
        let desired_frames =
            resampled_frame_count(source_frames, frame.sample_rate_hz, format.sample_rate_hz);
        let frames_to_write = desired_frames.min(available_frames as usize).max(1) as u32;

        let data = unsafe { render_client.GetBuffer(frames_to_write) }
            .map_err(|error| output_error("Could not acquire diagnostic output buffer.", error))?;
        let write_result = write_samples(data, frames_to_write, format, frame, gain);
        let release_result = unsafe { render_client.ReleaseBuffer(frames_to_write, 0) }
            .map_err(|error| output_error("Could not release diagnostic output buffer.", error));
        write_result?;
        release_result?;
        Ok(())
    }

    fn resampled_frame_count(source_frames: usize, input_rate: u32, output_rate: u32) -> usize {
        if input_rate == 0 || output_rate == 0 {
            return source_frames;
        }
        ((source_frames as u64 * u64::from(output_rate)) / u64::from(input_rate)).max(1) as usize
    }

    fn write_samples(
        data: *mut u8,
        output_frames: u32,
        format: AudioFormat,
        frame: &CaptureAudioFrame,
        gain: f32,
    ) -> Result<(), String> {
        if data.is_null() {
            return Err("Diagnostic output returned an invalid sample buffer.".to_string());
        }
        let bytes_len = output_frames as usize * usize::from(format.block_align);
        let bytes = unsafe { std::slice::from_raw_parts_mut(data, bytes_len) };
        let output_channels = usize::from(format.channels);
        let bytes_per_sample = usize::from(format.bits_per_sample / 8);
        let input_channels = usize::from(frame.channels);
        let input_frames = frame.samples.len() / input_channels;
        if output_channels == 0 || bytes_per_sample == 0 || input_channels == 0 || input_frames == 0
        {
            return Ok(());
        }

        for output_frame in 0..output_frames as usize {
            let input_frame = ((output_frame as u64 * u64::from(frame.sample_rate_hz))
                / u64::from(format.sample_rate_hz)) as usize;
            let input_frame = input_frame.min(input_frames - 1);
            for output_channel in 0..output_channels {
                let input_channel = output_channel.min(input_channels - 1);
                let sample = frame.samples[input_frame * input_channels + input_channel];
                let sample = (sample * gain).clamp(-1.0, 1.0);
                let byte_offset =
                    (output_frame * output_channels + output_channel) * bytes_per_sample;
                write_one_sample(
                    &mut bytes[byte_offset..byte_offset + bytes_per_sample],
                    sample,
                    format,
                )?;
            }
        }
        Ok(())
    }

    fn write_one_sample(bytes: &mut [u8], sample: f32, format: AudioFormat) -> Result<(), String> {
        match (format.encoding, format.bits_per_sample) {
            (SampleEncoding::Float, 32) => bytes.copy_from_slice(&sample.to_le_bytes()),
            (SampleEncoding::Pcm, 16) => {
                let value = (sample * i16::MAX as f32).round() as i16;
                bytes.copy_from_slice(&value.to_le_bytes());
            }
            (SampleEncoding::Pcm, 24) => {
                let value = (sample * 8_388_607.0).round() as i32;
                let raw = value.to_le_bytes();
                bytes.copy_from_slice(&raw[..3]);
            }
            (SampleEncoding::Pcm, 32) => {
                let value = (sample * i32::MAX as f32).round() as i32;
                bytes.copy_from_slice(&value.to_le_bytes());
            }
            _ => return Err("The Windows output sample format is not supported yet.".to_string()),
        }
        Ok(())
    }

    #[derive(Debug, Clone, Copy)]
    struct AudioFormat {
        channels: u16,
        sample_rate_hz: u32,
        block_align: u16,
        bits_per_sample: u16,
        encoding: SampleEncoding,
    }

    impl AudioFormat {
        fn from_mix_format(format: *const WAVEFORMATEX) -> Result<Self, String> {
            if format.is_null() {
                return Err("Windows returned an invalid output format.".to_string());
            }
            let basic = unsafe { std::ptr::read_unaligned(format) };
            let encoding = match basic.wFormatTag {
                WAVE_FORMAT_PCM => SampleEncoding::Pcm,
                WAVE_FORMAT_IEEE_FLOAT => SampleEncoding::Float,
                WAVE_FORMAT_EXTENSIBLE if usize::from(basic.cbSize) >= 22 => {
                    let extended =
                        unsafe { std::ptr::read_unaligned(format.cast::<WAVEFORMATEXTENSIBLE>()) };
                    let sub_format =
                        unsafe { std::ptr::addr_of!(extended.SubFormat).read_unaligned() };
                    if sub_format == PCM_SUBFORMAT {
                        SampleEncoding::Pcm
                    } else if sub_format == FLOAT_SUBFORMAT {
                        SampleEncoding::Float
                    } else {
                        return Err(
                            "The Windows output mix format is not supported yet.".to_string()
                        );
                    }
                }
                _ => return Err("The Windows output mix format is not supported yet.".to_string()),
            };
            let format = Self {
                channels: basic.nChannels,
                sample_rate_hz: basic.nSamplesPerSec,
                block_align: basic.nBlockAlign,
                bits_per_sample: basic.wBitsPerSample,
                encoding,
            };
            format.validate()?;
            Ok(format)
        }

        fn validate(self) -> Result<(), String> {
            let supported_bits = matches!(
                (self.encoding, self.bits_per_sample),
                (SampleEncoding::Float, 32) | (SampleEncoding::Pcm, 16 | 24 | 32)
            );
            let bytes_per_sample = self.bits_per_sample.checked_div(8).unwrap_or(0);
            let expected_block_align = self.channels.checked_mul(bytes_per_sample);
            if self.channels == 0
                || self.sample_rate_hz == 0
                || self.bits_per_sample % 8 != 0
                || !supported_bits
                || expected_block_align != Some(self.block_align)
            {
                return Err("The Windows output uses an unsupported sample layout.".to_string());
            }
            Ok(())
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum SampleEncoding {
        Float,
        Pcm,
    }

    struct MixFormat(*mut WAVEFORMATEX);

    impl MixFormat {
        fn new(format: *mut WAVEFORMATEX) -> Result<Self, String> {
            if format.is_null() {
                Err("Windows returned an invalid output format.".to_string())
            } else {
                Ok(Self(format))
            }
        }
    }

    impl Drop for MixFormat {
        fn drop(&mut self) {
            unsafe { CoTaskMemFree(Some(self.0.cast::<c_void>())) };
        }
    }

    fn output_error(context: &'static str, error: impl std::fmt::Display) -> String {
        eprintln!("{context} {error}");
        context.to_string()
    }
}

#[cfg(all(target_os = "windows", not(test)))]
pub(crate) use platform::{list_output_devices, MonitorOutputWorker};

#[cfg(all(not(target_os = "windows"), not(test)))]
pub(crate) struct MonitorOutputWorker;

#[cfg(all(not(target_os = "windows"), not(test)))]
impl MonitorOutputWorker {
    pub(crate) fn start(_output_device_id: &str) -> Result<Self, String> {
        Err("Diagnostic audio monitoring is available only on Windows.".to_string())
    }

    pub(crate) fn send_frame(&self, _frame: CaptureAudioFrame, _gain: f32) -> Result<(), ()> {
        Err(())
    }

    pub(crate) fn stop(self) {}
}

#[cfg(all(not(target_os = "windows"), not(test)))]
pub(crate) fn list_output_devices() -> Vec<DiagnosticOutputDevice> {
    vec![DiagnosticOutputDevice::default_output()]
}
