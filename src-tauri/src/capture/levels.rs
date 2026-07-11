use super::models::MicrophoneLevelSnapshot;

pub(crate) fn normalized_levels(samples: &[f32], sequence: u64) -> MicrophoneLevelSnapshot {
    let mut sum_squares = 0.0f64;
    let mut peak = 0.0f32;
    let mut count = 0usize;

    for sample in samples.iter().copied().filter(|sample| sample.is_finite()) {
        let normalized = sample.clamp(-1.0, 1.0);
        let magnitude = normalized.abs();
        peak = peak.max(magnitude);
        sum_squares += f64::from(normalized) * f64::from(normalized);
        count += 1;
    }

    if count == 0 {
        return MicrophoneLevelSnapshot {
            sequence,
            ..MicrophoneLevelSnapshot::idle()
        };
    }

    MicrophoneLevelSnapshot {
        rms: (sum_squares / count as f64).sqrt().clamp(0.0, 1.0) as f32,
        peak: peak.clamp(0.0, 1.0),
        clipping: peak >= 0.99,
        sequence,
    }
}
