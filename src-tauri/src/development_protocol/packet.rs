use std::convert::TryInto;

pub(crate) const DATAGRAM_SIZE: usize = 1_000;
pub(crate) const HEADER_SIZE: usize = 40;
pub(crate) const SAMPLE_COUNT: usize = 480;
pub(crate) const PAYLOAD_SIZE: usize = 960;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AudioPacket {
    pub stream_id: u32,
    pub sequence_number: u64,
    pub first_sample_index: u64,
    pub capture_timestamp_nanos: u64,
    pub samples: Vec<i16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PacketValidationError {
    InvalidSize,
    InvalidMagic,
    UnsupportedVersion,
    InvalidFlags,
    InvalidHeaderLength,
    InvalidSampleCount,
    NonzeroReserved,
}

pub(crate) fn parse_audio_packet(datagram: &[u8]) -> Result<AudioPacket, PacketValidationError> {
    if datagram.len() != DATAGRAM_SIZE {
        return Err(PacketValidationError::InvalidSize);
    }
    if &datagram[0..4] != b"KWAV" {
        return Err(PacketValidationError::InvalidMagic);
    }
    if datagram[4] != 0 {
        return Err(PacketValidationError::UnsupportedVersion);
    }
    if datagram[5] != 0 {
        return Err(PacketValidationError::InvalidFlags);
    }
    let header_len = u16::from_le_bytes(datagram[6..8].try_into().unwrap());
    if header_len != HEADER_SIZE as u16 {
        return Err(PacketValidationError::InvalidHeaderLength);
    }
    let stream_id = u32::from_le_bytes(datagram[8..12].try_into().unwrap());
    let sequence_number = u64::from_le_bytes(datagram[12..20].try_into().unwrap());
    let first_sample_index = u64::from_le_bytes(datagram[20..28].try_into().unwrap());
    let capture_timestamp_nanos = u64::from_le_bytes(datagram[28..36].try_into().unwrap());
    let sample_count = u16::from_le_bytes(datagram[36..38].try_into().unwrap());
    if sample_count != SAMPLE_COUNT as u16 {
        return Err(PacketValidationError::InvalidSampleCount);
    }
    let reserved = u16::from_le_bytes(datagram[38..40].try_into().unwrap());
    if reserved != 0 {
        return Err(PacketValidationError::NonzeroReserved);
    }

    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    for chunk in datagram[HEADER_SIZE..HEADER_SIZE + PAYLOAD_SIZE].chunks_exact(2) {
        samples.push(i16::from_le_bytes([chunk[0], chunk[1]]));
    }

    Ok(AudioPacket {
        stream_id,
        sequence_number,
        first_sample_index,
        capture_timestamp_nanos,
        samples,
    })
}

#[cfg(test)]
pub(crate) fn build_test_packet(
    stream_id: u32,
    sequence_number: u64,
    sample: i16,
) -> [u8; DATAGRAM_SIZE] {
    let mut datagram = [0u8; DATAGRAM_SIZE];
    datagram[0..4].copy_from_slice(b"KWAV");
    datagram[4] = 0;
    datagram[5] = 0;
    datagram[6..8].copy_from_slice(&(HEADER_SIZE as u16).to_le_bytes());
    datagram[8..12].copy_from_slice(&stream_id.to_le_bytes());
    datagram[12..20].copy_from_slice(&sequence_number.to_le_bytes());
    datagram[20..28].copy_from_slice(&(sequence_number * SAMPLE_COUNT as u64).to_le_bytes());
    datagram[28..36].copy_from_slice(&(sequence_number * 10_000_000).to_le_bytes());
    datagram[36..38].copy_from_slice(&(SAMPLE_COUNT as u16).to_le_bytes());
    datagram[38..40].copy_from_slice(&0u16.to_le_bytes());
    for index in 0..SAMPLE_COUNT {
        let offset = HEADER_SIZE + index * 2;
        datagram[offset..offset + 2].copy_from_slice(&sample.to_le_bytes());
    }
    datagram
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_packet_is_decoded_exactly() {
        let datagram = build_test_packet(7, 42, -1234);
        let packet = parse_audio_packet(&datagram).unwrap();
        assert_eq!(packet.stream_id, 7);
        assert_eq!(packet.sequence_number, 42);
        assert_eq!(packet.first_sample_index, 42 * 480);
        assert_eq!(packet.capture_timestamp_nanos, 42 * 10_000_000);
        assert_eq!(packet.samples.len(), 480);
        assert_eq!(packet.samples[0], -1234);
    }

    #[test]
    fn rejects_invalid_header_fields() {
        let mut packet = build_test_packet(1, 0, 0);
        packet[0] = b'X';
        assert_eq!(
            parse_audio_packet(&packet),
            Err(PacketValidationError::InvalidMagic)
        );

        let mut packet = build_test_packet(1, 0, 0);
        packet[4] = 1;
        assert_eq!(
            parse_audio_packet(&packet),
            Err(PacketValidationError::UnsupportedVersion)
        );

        let mut packet = build_test_packet(1, 0, 0);
        packet[5] = 1;
        assert_eq!(
            parse_audio_packet(&packet),
            Err(PacketValidationError::InvalidFlags)
        );

        let mut packet = build_test_packet(1, 0, 0);
        packet[6..8].copy_from_slice(&41u16.to_le_bytes());
        assert_eq!(
            parse_audio_packet(&packet),
            Err(PacketValidationError::InvalidHeaderLength)
        );

        let mut packet = build_test_packet(1, 0, 0);
        packet[36..38].copy_from_slice(&479u16.to_le_bytes());
        assert_eq!(
            parse_audio_packet(&packet),
            Err(PacketValidationError::InvalidSampleCount)
        );

        let mut packet = build_test_packet(1, 0, 0);
        packet[38..40].copy_from_slice(&1u16.to_le_bytes());
        assert_eq!(
            parse_audio_packet(&packet),
            Err(PacketValidationError::NonzeroReserved)
        );
    }

    #[test]
    fn rejects_invalid_datagram_size_without_panic() {
        assert_eq!(
            parse_audio_packet(&[]),
            Err(PacketValidationError::InvalidSize)
        );
        assert_eq!(
            parse_audio_packet(&[0; 999]),
            Err(PacketValidationError::InvalidSize)
        );
        assert_eq!(
            parse_audio_packet(&[0; 1001]),
            Err(PacketValidationError::InvalidSize)
        );
    }
}
