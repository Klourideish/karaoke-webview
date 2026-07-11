#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TimingWarning {
    pub code: &'static str,
    pub message: String,
}

pub(crate) fn parse_time_expression(expression: &str) -> Result<u64, TimingWarning> {
    let value = expression.trim();
    if value.is_empty() || value.starts_with('-') {
        return Err(warning(
            "invalid-timing",
            format!("Unsupported timing expression: {value}"),
        ));
    }

    if let Some(milliseconds) = parse_offset_time(value)? {
        return Ok(milliseconds);
    }

    parse_clock_time(value)
}

fn parse_offset_time(value: &str) -> Result<Option<u64>, TimingWarning> {
    for unit in ["ms", "s", "m", "h"] {
        if let Some(number) = value.strip_suffix(unit) {
            let parsed = number.trim().parse::<f64>().map_err(|_| {
                warning(
                    "invalid-timing",
                    format!("Unsupported timing expression: {value}"),
                )
            })?;
            if !parsed.is_finite() || parsed < 0.0 {
                return Err(warning(
                    "invalid-timing",
                    format!("Unsupported timing expression: {value}"),
                ));
            }

            let multiplier = match unit {
                "ms" => 1.0,
                "s" => 1_000.0,
                "m" => 60_000.0,
                "h" => 3_600_000.0,
                _ => unreachable!(),
            };
            return Ok(Some((parsed * multiplier).round() as u64));
        }
    }

    Ok(None)
}

fn parse_clock_time(value: &str) -> Result<u64, TimingWarning> {
    if value.contains('f') {
        return Err(warning(
            "unsupported-timing",
            format!("Frame timing is not supported: {value}"),
        ));
    }

    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() != 3 {
        return Err(warning(
            "unsupported-timing",
            format!("Unsupported timing expression: {value}"),
        ));
    }

    let hours = parse_integer_part(parts[0], value)?;
    let minutes = parse_integer_part(parts[1], value)?;
    let seconds = parse_second_part(parts[2], value)?;
    if minutes >= 60 || seconds >= 60_000 {
        return Err(warning(
            "invalid-timing",
            format!("Invalid clock timing expression: {value}"),
        ));
    }

    hours
        .checked_mul(3_600_000)
        .and_then(|time| time.checked_add(minutes * 60_000))
        .and_then(|time| time.checked_add(seconds))
        .ok_or_else(|| {
            warning(
                "invalid-timing",
                format!("Timing expression is too large: {value}"),
            )
        })
}

fn parse_integer_part(part: &str, original: &str) -> Result<u64, TimingWarning> {
    part.parse::<u64>().map_err(|_| {
        warning(
            "invalid-timing",
            format!("Invalid timing expression: {original}"),
        )
    })
}

fn parse_second_part(part: &str, original: &str) -> Result<u64, TimingWarning> {
    let (seconds, fraction) = part.split_once('.').unwrap_or((part, ""));
    let seconds = parse_integer_part(seconds, original)?;
    let milliseconds = if fraction.is_empty() {
        0
    } else {
        let mut fraction = fraction.chars().take(3).collect::<String>();
        while fraction.len() < 3 {
            fraction.push('0');
        }
        fraction.parse::<u64>().map_err(|_| {
            warning(
                "invalid-timing",
                format!("Invalid timing expression: {original}"),
            )
        })?
    };

    seconds
        .checked_mul(1_000)
        .and_then(|time| time.checked_add(milliseconds))
        .ok_or_else(|| {
            warning(
                "invalid-timing",
                format!("Timing expression is too large: {original}"),
            )
        })
}

fn warning(code: &'static str, message: String) -> TimingWarning {
    TimingWarning { code, message }
}
