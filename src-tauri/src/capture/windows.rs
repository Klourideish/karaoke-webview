use std::{
    ffi::c_void,
    sync::mpsc::{Receiver, Sender},
    time::{Duration, Instant},
};

use windows::{
    core::GUID,
    Win32::{
        Media::Audio::{
            IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT,
            AUDCLNT_SHAREMODE_SHARED, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
        },
        System::Com::{CoTaskMemFree, CLSCTX_ALL},
    },
};

use crate::microphones::windows::{active_capture_device, ComApartment};

use super::{
    backend::{AudioFrameConsumer, CaptureEnd, LevelConsumer},
    levels::normalized_levels,
    models::{CaptureAudioFrame, MonitorSampleEncoding},
};

const BUFFER_DURATION_100NS: i64 = 1_000_000;
const LEVEL_INTERVAL: Duration = Duration::from_millis(50);
const CAPTURE_POLL_INTERVAL: Duration = Duration::from_millis(5);
const WAVE_FORMAT_PCM: u16 = 1;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
const PCM_SUBFORMAT: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const FLOAT_SUBFORMAT: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

pub(super) fn run_shared_capture(
    source_id: &str,
    stop: Receiver<()>,
    ready: Sender<Result<(), String>>,
    levels: LevelConsumer,
    audio_frames: AudioFrameConsumer,
    timeout: Duration,
) -> Result<CaptureEnd, String> {
    let prepared = prepare_capture(source_id);
    let (audio_client, capture_client, format, _apartment) = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            let _ = ready.send(Err(error.clone()));
            return Err(error);
        }
    };

    // SAFETY: The shared-mode client is fully initialized and owns the selected capture endpoint.
    if let Err(error) = unsafe { audio_client.Start() } {
        let message = capture_error("Could not start shared microphone capture.", error);
        let _ = ready.send(Err(message.clone()));
        return Err(message);
    }
    if ready.send(Ok(())).is_err() {
        // SAFETY: The client was started above and is stopped before returning.
        let _ = unsafe { audio_client.Stop() };
        return Ok(CaptureEnd::Stopped);
    }

    let started_at = Instant::now();
    let mut last_level_at = Instant::now();
    let mut pending_samples = Vec::new();
    let mut sequence = 0u64;

    let outcome = loop {
        if stop.try_recv().is_ok() {
            break Ok(CaptureEnd::Stopped);
        }
        if started_at.elapsed() >= timeout {
            break Ok(CaptureEnd::TimedOut);
        }

        if let Err(error) = drain_packets(
            &capture_client,
            format,
            &mut pending_samples,
            &audio_frames,
            &mut sequence,
        ) {
            break Err(error);
        }

        if last_level_at.elapsed() >= LEVEL_INTERVAL {
            sequence = sequence.wrapping_add(1);
            levels(normalized_levels(&pending_samples, sequence));
            pending_samples.clear();
            last_level_at = Instant::now();
        }

        std::thread::sleep(CAPTURE_POLL_INTERVAL);
    };

    // SAFETY: Stop balances the successful Start call for this audio client.
    let stop_result = unsafe { audio_client.Stop() }
        .map_err(|error| capture_error("Could not stop microphone capture cleanly.", error));
    match (outcome, stop_result) {
        (Err(error), _) | (Ok(_), Err(error)) => Err(error),
        (Ok(end), Ok(())) => Ok(end),
    }
}

fn prepare_capture(
    source_id: &str,
) -> Result<(IAudioClient, IAudioCaptureClient, AudioFormat, ComApartment), String> {
    let apartment = ComApartment::initialize().map_err(|error| error.to_string())?;
    let device = active_capture_device(source_id).map_err(|error| error.to_string())?;
    // SAFETY: The endpoint was resolved from the authoritative source registry and COM is active.
    let audio_client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
        .map_err(|error| capture_error("Could not open the selected microphone.", error))?;
    // SAFETY: The client owns the returned COM-allocated mix format.
    let mix_format = MixFormat::new(
        unsafe { audio_client.GetMixFormat() }
            .map_err(|error| capture_error("Could not read the microphone mix format.", error))?,
    )?;
    let format = AudioFormat::from_mix_format(mix_format.0)?;
    // SAFETY: Shared mode uses the device mix format and does not request exclusive ownership.
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
    .map_err(|error| capture_error("Could not initialize shared microphone capture.", error))?;
    // SAFETY: The initialized audio client provides the capture service for this endpoint.
    let capture_client: IAudioCaptureClient = unsafe { audio_client.GetService() }
        .map_err(|error| capture_error("Could not access microphone capture buffers.", error))?;

    Ok((audio_client, capture_client, format, apartment))
}

fn drain_packets(
    capture_client: &IAudioCaptureClient,
    format: AudioFormat,
    samples: &mut Vec<f32>,
    audio_frames: &AudioFrameConsumer,
    sequence: &mut u64,
) -> Result<(), String> {
    loop {
        // SAFETY: The capture service is valid while its owning audio client remains active.
        let packet_size = unsafe { capture_client.GetNextPacketSize() }
            .map_err(|error| capture_error("Microphone capture was interrupted.", error))?;
        if packet_size == 0 {
            return Ok(());
        }

        let mut data = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut flags = 0u32;
        // SAFETY: WASAPI supplies a buffer valid until the matching ReleaseBuffer call below.
        unsafe { capture_client.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }
            .map_err(|error| capture_error("Could not read microphone samples.", error))?;

        let before = samples.len();
        let decoded = if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
            let sample_count = frames as usize * format.channels as usize;
            samples.resize(samples.len() + sample_count, 0.0);
            Ok(())
        } else {
            decode_samples(data, frames, format, samples)
        };
        // SAFETY: Releases exactly the frame count obtained from GetBuffer.
        let released = unsafe { capture_client.ReleaseBuffer(frames) }
            .map_err(|error| capture_error("Could not release microphone samples.", error));
        decoded?;
        let new_samples = samples[before..].to_vec();
        if !new_samples.is_empty() {
            *sequence = sequence.wrapping_add(1);
            audio_frames(CaptureAudioFrame {
                samples: new_samples,
                sample_rate_hz: format.sample_rate_hz,
                channels: format.channels,
                sequence: *sequence,
                encoding: MonitorSampleEncoding::Float32,
            });
        }
        released?;
    }
}

fn decode_samples(
    data: *const u8,
    frames: u32,
    format: AudioFormat,
    output: &mut Vec<f32>,
) -> Result<(), String> {
    if data.is_null() {
        return Err("Microphone capture returned an invalid sample buffer.".to_string());
    }
    let byte_count = frames as usize * format.block_align as usize;
    // SAFETY: WASAPI guarantees byte_count readable bytes for the acquired frame count.
    let bytes = unsafe { std::slice::from_raw_parts(data, byte_count) };
    let sample_count = frames as usize * format.channels as usize;
    let bytes_per_sample = usize::from(format.bits_per_sample / 8);
    if bytes_per_sample == 0 || sample_count.saturating_mul(bytes_per_sample) > bytes.len() {
        return Err("The microphone uses an unsupported sample layout.".to_string());
    }

    output.reserve(sample_count);
    for chunk in bytes.chunks_exact(bytes_per_sample).take(sample_count) {
        let sample = match (format.encoding, format.bits_per_sample) {
            (SampleEncoding::Float, 32) => {
                f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])
            }
            (SampleEncoding::Pcm, 16) => {
                f32::from(i16::from_le_bytes([chunk[0], chunk[1]])) / 32768.0
            }
            (SampleEncoding::Pcm, 24) => {
                let value = ((i32::from(chunk[2]) << 24)
                    | (i32::from(chunk[1]) << 16)
                    | (i32::from(chunk[0]) << 8))
                    >> 8;
                value as f32 / 8_388_608.0
            }
            (SampleEncoding::Pcm, 32) => {
                i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as f32
                    / 2_147_483_648.0
            }
            _ => return Err("The microphone sample format is not supported yet.".to_string()),
        };
        output.push(sample);
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
            return Err("Windows returned an invalid microphone format.".to_string());
        }
        // SAFETY: The pointer references a WAVEFORMATEX allocated by GetMixFormat.
        let basic = unsafe { std::ptr::read_unaligned(format) };
        let encoding = match basic.wFormatTag {
            WAVE_FORMAT_PCM => SampleEncoding::Pcm,
            WAVE_FORMAT_IEEE_FLOAT => SampleEncoding::Float,
            WAVE_FORMAT_EXTENSIBLE if usize::from(basic.cbSize) >= 22 => {
                // SAFETY: cbSize confirms the extended fields are present.
                let extended =
                    unsafe { std::ptr::read_unaligned(format.cast::<WAVEFORMATEXTENSIBLE>()) };
                // SAFETY: WAVEFORMATEXTENSIBLE is packed, so the GUID is copied unaligned.
                let sub_format = unsafe { std::ptr::addr_of!(extended.SubFormat).read_unaligned() };
                if sub_format == PCM_SUBFORMAT {
                    SampleEncoding::Pcm
                } else if sub_format == FLOAT_SUBFORMAT {
                    SampleEncoding::Float
                } else {
                    return Err("The microphone mix format is not supported yet.".to_string());
                }
            }
            _ => return Err("The microphone mix format is not supported yet.".to_string()),
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
            return Err("The microphone uses an unsupported sample layout.".to_string());
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
            Err("Windows returned an invalid microphone format.".to_string())
        } else {
            Ok(Self(format))
        }
    }
}

impl Drop for MixFormat {
    fn drop(&mut self) {
        // SAFETY: GetMixFormat allocated this pointer with COM task memory.
        unsafe { CoTaskMemFree(Some(self.0.cast::<c_void>())) };
    }
}

fn capture_error(context: &'static str, error: impl std::fmt::Display) -> String {
    eprintln!("{context} {error}");
    context.to_string()
}

#[cfg(test)]
mod tests {
    use super::{decode_samples, AudioFormat, SampleEncoding};

    #[test]
    fn rejects_inconsistent_native_sample_layouts() {
        let format = AudioFormat {
            channels: 2,
            sample_rate_hz: 48_000,
            block_align: 4,
            bits_per_sample: 24,
            encoding: SampleEncoding::Pcm,
        };

        assert_eq!(
            format.validate(),
            Err("The microphone uses an unsupported sample layout.".to_string())
        );
    }

    #[test]
    fn decodes_interleaved_pcm_channels_without_extra_copies() {
        let bytes = [0x00, 0x40, 0x00, 0xc0];
        let format = AudioFormat {
            channels: 2,
            sample_rate_hz: 48_000,
            block_align: 4,
            bits_per_sample: 16,
            encoding: SampleEncoding::Pcm,
        };
        let mut output = Vec::new();

        decode_samples(bytes.as_ptr(), 1, format, &mut output).unwrap();

        assert_eq!(output, vec![0.5, -0.5]);
    }
}
