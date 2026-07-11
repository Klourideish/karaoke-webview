use serde::{Deserialize, Serialize};

pub const LYRIC_DOCUMENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricDocument {
    pub schema_version: u32,
    pub source_song_id: String,
    pub language: Option<String>,
    pub lines: Vec<LyricLine>,
    pub warnings: Vec<LyricWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub id: String,
    pub begin_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub segments: Vec<LyricSegment>,
    pub role: Option<String>,
    pub region: Option<String>,
    pub style_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricSegment {
    pub id: String,
    pub text: String,
    pub begin_ms: u64,
    pub end_ms: u64,
    pub timing_granularity: LyricTimingGranularity,
    pub style_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LyricTimingGranularity {
    Text,
    Word,
    Syllable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricWarning {
    pub code: String,
    pub message: String,
    pub source_context: Option<String>,
}
