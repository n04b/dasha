// Compose-style variable interpolation.
//
// Compose substitutes `$VAR` / `${VAR}` in a compose file before parsing it,
// drawing values from the shell environment and from a `.env` file sitting next
// to the file. Without this a service whose port is written as
// `"${APP_PORT}:80"` yields no usable port, so no URL and no card.
//
// Supported forms (same as Compose):
//   $VAR  ${VAR}          value, or empty when unset
//   ${VAR:-default}       default when unset *or* empty
//   ${VAR-default}        default only when unset
//   ${VAR:+alt}           alt when set *and* non-empty
//   ${VAR+alt}            alt when set
//   ${VAR:?msg} ${VAR?msg}  required; reported and left empty when missing
//   $$                    a literal `$`

const TOKEN = /\$(\$|\{([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/**
 * Substitute variables in `text`.
 * Returns { text, missing } where `missing` lists variables that resolved to
 * nothing so the caller can warn about them.
 */
export function interpolate(text, vars = {}) {
  const missing = new Set();
  if (!text) return { text: '', missing: [] };

  const out = String(text).replace(TOKEN, (match, kind, braced, bare) => {
    if (kind === '$') return '$'; // `$$` escapes a literal dollar
    const expr = braced != null ? braced : bare;
    if (!expr) return match; // `${}` — leave as written
    return resolve(expr, vars, missing, match);
  });

  return { text: out, missing: [...missing] };
}

function resolve(expr, vars, missing, original) {
  const m = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-+?])([\s\S]*))?$/);
  if (!m) return original; // not a form we understand — leave it alone

  const [, name, operator, operand = ''] = m;
  const raw = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
  const isSet = raw !== undefined && raw !== null;
  const value = isSet ? String(raw) : '';
  // A leading `:` makes the operator treat an empty value as unset.
  const emptyCountsAsUnset = operator?.startsWith(':');
  const present = emptyCountsAsUnset ? isSet && value !== '' : isSet;

  switch (operator?.replace(':', '')) {
    case '-':
      return present ? value : operand;
    case '+':
      return present ? operand : '';
    case '?':
      if (present) return value;
      missing.add(name);
      return '';
    default:
      if (!present) missing.add(name);
      return value;
  }
}

/**
 * Parse the contents of a `.env` file into a plain object.
 * Handles `export` prefixes, quoted values, inline comments and blank lines.
 */
export function parseEnvFile(text) {
  const out = {};
  if (!text) return out;

  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
    if (!m) continue;

    const [, key, rawValue] = m;
    out[key] = unquote(rawValue);
  }
  return out;
}

function unquote(raw) {
  const value = raw.trim();

  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    // Double quotes: honour the common escapes, keep everything else verbatim.
    return value
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\(["\\])/g, '$1');
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1); // single quotes are literal
  }
  // Unquoted: an inline comment starts at ` #`.
  return value.replace(/\s+#.*$/, '').trim();
}
