use std::collections::{BTreeMap, HashSet, VecDeque};

use super::packet::AudioPacket;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum JitterOutput {
    Packet(AudioPacket),
    Gap { sequence_number: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JitterReject {
    Duplicate,
    Stale,
    Late,
}

#[derive(Debug)]
pub(crate) struct JitterBuffer {
    pending: BTreeMap<u64, AudioPacket>,
    recent: VecDeque<u64>,
    recent_set: HashSet<u64>,
    expected: Option<u64>,
    hard_max_packets: usize,
    max_depth_seen: usize,
}

impl JitterBuffer {
    pub(crate) fn new(hard_max_packets: usize) -> Self {
        Self {
            pending: BTreeMap::new(),
            recent: VecDeque::new(),
            recent_set: HashSet::new(),
            expected: None,
            hard_max_packets: hard_max_packets.max(1),
            max_depth_seen: 0,
        }
    }

    pub(crate) fn push(&mut self, packet: AudioPacket) -> Result<Vec<JitterOutput>, JitterReject> {
        let sequence = packet.sequence_number;
        if self.recent_set.contains(&sequence) || self.pending.contains_key(&sequence) {
            return Err(JitterReject::Duplicate);
        }
        if let Some(expected) = self.expected {
            if sequence < expected {
                return Err(JitterReject::Stale);
            }
        } else {
            self.expected = Some(sequence);
        }

        self.pending.insert(sequence, packet);
        self.max_depth_seen = self.max_depth_seen.max(self.pending.len());
        if self.pending.len() > self.hard_max_packets {
            let Some(expected) = self.expected else {
                return Ok(Vec::new());
            };
            if self.pending.remove(&expected).is_some() {
                return Err(JitterReject::Late);
            }
        }
        Ok(self.drain_ready())
    }

    fn drain_ready(&mut self) -> Vec<JitterOutput> {
        let mut output = Vec::new();
        loop {
            let Some(expected) = self.expected else {
                break;
            };
            if let Some(packet) = self.pending.remove(&expected) {
                self.remember(expected);
                self.expected = Some(expected + 1);
                output.push(JitterOutput::Packet(packet));
                continue;
            }
            if self.pending.len() >= self.hard_max_packets {
                self.remember(expected);
                self.expected = Some(expected + 1);
                output.push(JitterOutput::Gap {
                    sequence_number: expected,
                });
                continue;
            }
            break;
        }
        output
    }

    fn remember(&mut self, sequence: u64) {
        self.recent.push_back(sequence);
        self.recent_set.insert(sequence);
        while self.recent.len() > self.hard_max_packets * 2 {
            if let Some(old) = self.recent.pop_front() {
                self.recent_set.remove(&old);
            }
        }
    }

    pub(crate) fn depth(&self) -> usize {
        self.pending.len()
    }

    pub(crate) fn max_depth_seen(&self) -> usize {
        self.max_depth_seen
    }

    pub(crate) fn clear(&mut self) {
        self.pending.clear();
        self.recent.clear();
        self.recent_set.clear();
        self.expected = None;
        self.max_depth_seen = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::development_protocol::packet::build_test_packet;
    use crate::development_protocol::packet::parse_audio_packet;

    fn packet(sequence: u64) -> AudioPacket {
        parse_audio_packet(&build_test_packet(1, sequence, sequence as i16)).unwrap()
    }

    #[test]
    fn small_reordering_is_corrected() {
        let mut buffer = JitterBuffer::new(3);
        assert_eq!(
            buffer.push(packet(1)).unwrap(),
            vec![JitterOutput::Packet(packet(1))]
        );
        assert_eq!(buffer.push(packet(3)).unwrap(), Vec::new());
        assert_eq!(
            buffer.push(packet(2)).unwrap(),
            vec![
                JitterOutput::Packet(packet(2)),
                JitterOutput::Packet(packet(3))
            ]
        );
    }

    #[test]
    fn duplicate_and_stale_packets_are_rejected() {
        let mut buffer = JitterBuffer::new(3);
        buffer.push(packet(1)).unwrap();
        assert_eq!(buffer.push(packet(1)), Err(JitterReject::Duplicate));
        assert_eq!(buffer.push(packet(0)), Err(JitterReject::Stale));
    }

    #[test]
    fn missing_packets_become_explicit_gaps_without_unbounded_depth() {
        let mut buffer = JitterBuffer::new(2);
        buffer.push(packet(1)).unwrap();
        assert_eq!(buffer.push(packet(3)).unwrap(), Vec::new());
        assert_eq!(
            buffer.push(packet(4)).unwrap(),
            vec![
                JitterOutput::Gap { sequence_number: 2 },
                JitterOutput::Packet(packet(3)),
                JitterOutput::Packet(packet(4)),
            ]
        );
        assert!(buffer.depth() <= 2);
    }
}
