use crate::lyrics::{
    models::{
        LyricDocument, LyricLine, LyricSegment, LyricTimingGranularity, LyricWarning,
        LYRIC_DOCUMENT_SCHEMA_VERSION,
    },
    timing::parse_time_expression,
};
use roxmltree::{Document, Node};

pub(crate) fn parse_ttml(
    source_song_id: &str,
    contents: &str,
) -> Result<LyricDocument, LyricError> {
    let document = Document::parse(contents).map_err(|source| {
        eprintln!("Could not parse TTML document. {source}");
        LyricError::message("The lyric file is not valid XML.")
    })?;

    let root = document.root_element();
    if root.tag_name().name() != "tt" {
        return Err(LyricError::message(
            "The lyric file is not a supported TTML document.",
        ));
    }

    let body = root
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "body")
        .ok_or_else(|| {
            LyricError::message("The lyric file does not contain a usable lyric body.")
        })?;

    let language = attribute_local(root, "lang").map(str::to_string);
    let mut warnings = Vec::new();
    let mut lines = Vec::new();

    for p in body
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "p")
    {
        if let Some(line) = parse_line(source_song_id, p, lines.len(), &mut warnings) {
            lines.push(line);
        }
    }

    if lines.is_empty() {
        return Err(LyricError::message(
            "The lyric file does not contain usable timed lyrics.",
        ));
    }

    lines.sort_by(|left, right| {
        left.begin_ms
            .cmp(&right.begin_ms)
            .then_with(|| left.end_ms.cmp(&right.end_ms))
            .then_with(|| left.text.cmp(&right.text))
    });
    warn_overlaps(&lines, &mut warnings);

    Ok(LyricDocument {
        schema_version: LYRIC_DOCUMENT_SCHEMA_VERSION,
        source_song_id: source_song_id.to_string(),
        language,
        lines,
        warnings,
    })
}

fn parse_line(
    source_song_id: &str,
    node: Node<'_, '_>,
    index: usize,
    warnings: &mut Vec<LyricWarning>,
) -> Option<LyricLine> {
    let context = node_context(node);
    let begin = match parse_optional_time(node, "begin", warnings, &context) {
        Some(begin) => begin,
        None => {
            warnings.push(warning(
                "missing-line-timing",
                "A lyric line is missing begin timing.",
                Some(context),
            ));
            return None;
        }
    };
    let end = resolve_end(node, begin, None, warnings, &context)?;
    if end < begin {
        warnings.push(warning(
            "invalid-line-timing",
            "A lyric line ends before it begins.",
            Some(context),
        ));
        return None;
    }

    let mut segments = parse_segments(source_song_id, node, index, begin, end, warnings);
    let text = if segments.is_empty() {
        normalize_text(&collect_visible_text(node))
    } else {
        segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>()
    };
    if text.is_empty() {
        warnings.push(warning(
            "empty-line",
            "A timed lyric line has no text.",
            Some(context),
        ));
        return None;
    }

    let role = nearest_div_role(node);
    let region = attribute_local(node, "region").map(str::to_string);
    let style_refs = style_refs(node);
    if segments.is_empty() {
        segments.push(LyricSegment {
            id: stable_id(&format!(
                "{source_song_id}|line:{index}|segment:0|{begin}|{end}|{text}"
            )),
            text: text.clone(),
            begin_ms: begin,
            end_ms: end,
            timing_granularity: LyricTimingGranularity::Text,
            style_refs: style_refs.clone(),
        });
    }

    Some(LyricLine {
        id: stable_id(&format!(
            "{source_song_id}|line:{index}|{begin}|{end}|{text}"
        )),
        begin_ms: begin,
        end_ms: end,
        text,
        segments,
        role,
        region,
        style_refs,
    })
}

fn parse_segments(
    source_song_id: &str,
    line: Node<'_, '_>,
    line_index: usize,
    line_begin: u64,
    line_end: u64,
    warnings: &mut Vec<LyricWarning>,
) -> Vec<LyricSegment> {
    let mut segments = Vec::new();
    for child in line.children() {
        if child.is_text() {
            if let Some(value) = child.text() {
                if let Some(text) = normalized_segment_text(value) {
                    push_segment(
                        &mut segments,
                        source_song_id,
                        line_index,
                        text,
                        line_begin,
                        line_begin,
                        Vec::new(),
                    );
                }
            }
            continue;
        }

        if child.is_element() && child.tag_name().name() == "span" {
            parse_span_segment(
                source_song_id,
                line_index,
                line_begin,
                line_end,
                warnings,
                &mut segments,
                child,
            );
        }
    }

    normalize_inline_separators(&mut segments);
    segments
}

fn parse_span_segment(
    source_song_id: &str,
    line_index: usize,
    line_begin: u64,
    line_end: u64,
    warnings: &mut Vec<LyricWarning>,
    segments: &mut Vec<LyricSegment>,
    span: Node<'_, '_>,
) {
    let context = node_context(span);
    let has_explicit_timing = attribute_local(span, "begin").is_some()
        || attribute_local(span, "end").is_some()
        || attribute_local(span, "dur").is_some();
    let begin = parse_optional_time(span, "begin", warnings, &context).unwrap_or(line_begin);
    let end = if has_explicit_timing {
        match resolve_end(span, begin, Some(line_end), warnings, &context) {
            Some(end) => end,
            None => line_end,
        }
    } else {
        line_begin
    };
    let Some((clipped_begin, clipped_end)) =
        clip_segment_timing(begin, end, line_begin, line_end, context.clone(), warnings)
    else {
        return;
    };

    let has_child_spans = span
        .children()
        .any(|child| child.is_element() && child.tag_name().name() == "span");
    if has_child_spans {
        parse_span_children(
            source_song_id,
            line_index,
            clipped_begin,
            clipped_end,
            warnings,
            segments,
            span,
            has_explicit_timing,
        );
        return;
    }

    let Some(text) = normalized_segment_text(&collect_fragment_text(span)) else {
        return;
    };

    push_segment(
        segments,
        source_song_id,
        line_index,
        text,
        clipped_begin,
        clipped_end,
        style_refs(span),
    );
}

fn parse_span_children(
    source_song_id: &str,
    line_index: usize,
    parent_begin: u64,
    parent_end: u64,
    warnings: &mut Vec<LyricWarning>,
    segments: &mut Vec<LyricSegment>,
    span: Node<'_, '_>,
    parent_has_explicit_timing: bool,
) {
    for child in span.children() {
        if child.is_text() {
            if let Some(value) = child.text() {
                let Some(text) = normalized_segment_text(value) else {
                    continue;
                };
                if parent_has_explicit_timing && !text.chars().all(char::is_whitespace) {
                    warnings.push(warning(
                        "mixed-timed-wrapper-text",
                        "A timed lyric wrapper contains direct text around timed fragments.",
                        Some(node_context(span)),
                    ));
                }
                push_segment(
                    segments,
                    source_song_id,
                    line_index,
                    text,
                    parent_begin,
                    parent_end,
                    style_refs(span),
                );
            }
            continue;
        }

        if child.is_element() && child.tag_name().name() == "span" {
            parse_span_segment(
                source_song_id,
                line_index,
                parent_begin,
                parent_end,
                warnings,
                segments,
                child,
            );
        }
    }
}

fn clip_segment_timing(
    begin: u64,
    end: u64,
    line_begin: u64,
    line_end: u64,
    context: String,
    warnings: &mut Vec<LyricWarning>,
) -> Option<(u64, u64)> {
    if end < begin {
        warnings.push(warning(
            "invalid-segment-timing",
            "A lyric segment ends before it begins.",
            Some(context),
        ));
        return None;
    }

    let clipped_begin = begin.max(line_begin);
    let clipped_end = end.min(line_end);
    if clipped_begin != begin || clipped_end != end {
        warnings.push(warning(
            "segment-outside-line",
            "A lyric segment timing was outside its parent line and was clamped.",
            Some(context),
        ));
    }

    Some((clipped_begin, clipped_end))
}

fn push_segment(
    segments: &mut Vec<LyricSegment>,
    source_song_id: &str,
    line_index: usize,
    text: String,
    begin_ms: u64,
    end_ms: u64,
    style_refs: Vec<String>,
) {
    segments.push(LyricSegment {
        id: stable_id(&format!(
            "{source_song_id}|line:{line_index}|segment:{}|{}|{}|{}",
            segments.len(),
            begin_ms,
            end_ms,
            text
        )),
        text,
        begin_ms,
        end_ms,
        timing_granularity: LyricTimingGranularity::Text,
        style_refs,
    });
}

fn parse_optional_time(
    node: Node<'_, '_>,
    name: &str,
    warnings: &mut Vec<LyricWarning>,
    context: &str,
) -> Option<u64> {
    let value = attribute_local(node, name)?;
    match parse_time_expression(value) {
        Ok(time) => Some(time),
        Err(error) => {
            warnings.push(warning(
                error.code,
                &error.message,
                Some(context.to_string()),
            ));
            None
        }
    }
}

fn resolve_end(
    node: Node<'_, '_>,
    begin: u64,
    inherited_end: Option<u64>,
    warnings: &mut Vec<LyricWarning>,
    context: &str,
) -> Option<u64> {
    if let Some(end) = parse_optional_time(node, "end", warnings, context) {
        return Some(end);
    }

    if let Some(duration) = parse_optional_time(node, "dur", warnings, context) {
        return begin.checked_add(duration).or_else(|| {
            warnings.push(warning(
                "invalid-duration",
                "A lyric timing duration is too large.",
                Some(context.to_string()),
            ));
            None
        });
    }

    inherited_end.or_else(|| {
        warnings.push(warning(
            "missing-line-end",
            "A lyric line is missing end or duration timing.",
            Some(context.to_string()),
        ));
        None
    })
}

fn collect_visible_text(node: Node<'_, '_>) -> String {
    let mut text = String::new();
    for descendant in node.descendants().filter(|descendant| descendant.is_text()) {
        if let Some(value) = descendant.text() {
            if value.trim().is_empty() {
                continue;
            }
            text.push_str(value);
        }
    }
    text
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<&str>>().join(" ")
}

fn normalize_source_text_node(text: &str) -> String {
    if text.contains('\n') || text.contains('\r') {
        normalize_text(text)
    } else {
        text.to_string()
    }
}

fn normalized_segment_text(text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }

    if text.chars().all(char::is_whitespace) {
        if text.contains('\n') || text.contains('\r') {
            return None;
        }
        return Some(if text.contains('\u{00a0}') {
            "\u{00a0}".to_string()
        } else {
            " ".to_string()
        });
    }

    let normalized = normalize_source_text_node(text);
    (!normalized.is_empty()).then_some(normalized)
}

fn normalize_inline_separators(segments: &mut Vec<LyricSegment>) {
    let mut index = 0;
    while index < segments.len() {
        if !segments[index].text.chars().all(char::is_whitespace) {
            index += 1;
            continue;
        }

        let keep = index > 0
            && index + 1 < segments.len()
            && !segments[index - 1]
                .text
                .chars()
                .last()
                .is_some_and(char::is_whitespace)
            && !segments[index + 1]
                .text
                .chars()
                .next()
                .is_some_and(char::is_whitespace);
        if keep {
            index += 1;
        } else {
            segments.remove(index);
        }
    }
}

fn collect_fragment_text(node: Node<'_, '_>) -> String {
    let mut text = String::new();
    for descendant in node.descendants().filter(|descendant| descendant.is_text()) {
        if let Some(value) = descendant.text() {
            text.push_str(value);
        }
    }
    text
}

fn nearest_div_role(node: Node<'_, '_>) -> Option<String> {
    node.ancestors()
        .find(|ancestor| ancestor.is_element() && ancestor.tag_name().name() == "div")
        .and_then(|div| attribute_local(div, "song-part").or_else(|| attribute_local(div, "role")))
        .map(str::to_string)
}

fn style_refs(node: Node<'_, '_>) -> Vec<String> {
    attribute_local(node, "style")
        .map(|style| style.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default()
}

fn attribute_local<'a>(node: Node<'a, 'a>, name: &str) -> Option<&'a str> {
    node.attributes()
        .find(|attribute| attribute.name().rsplit(':').next() == Some(name))
        .map(|attribute| attribute.value())
}

fn node_context(node: Node<'_, '_>) -> String {
    let text = normalize_text(&collect_visible_text(node));
    if text.is_empty() {
        format!("<{}>", node.tag_name().name())
    } else {
        format!("<{}> {text}", node.tag_name().name())
    }
}

fn warn_overlaps(lines: &[LyricLine], warnings: &mut Vec<LyricWarning>) {
    for pair in lines.windows(2) {
        if pair[0].end_ms > pair[1].begin_ms {
            warnings.push(warning(
                "overlapping-lines",
                "Two lyric lines overlap in time.",
                Some(pair[1].text.clone()),
            ));
        }
    }
}

fn warning(code: &str, message: &str, source_context: Option<String>) -> LyricWarning {
    LyricWarning {
        code: code.to_string(),
        message: message.to_string(),
        source_context,
    }
}

fn stable_id(input: &str) -> String {
    format!("lyric-{:016x}", fnv1a64(input.as_bytes()))
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[derive(Debug)]
pub(crate) struct LyricError {
    message: String,
}

impl LyricError {
    pub(crate) fn message(message: &'static str) -> Self {
        Self {
            message: message.to_string(),
        }
    }

    pub(crate) fn with_source(message: &'static str, source: impl std::fmt::Display) -> Self {
        eprintln!("{message} {source}");
        Self {
            message: message.to_string(),
        }
    }
}

impl std::fmt::Display for LyricError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}
