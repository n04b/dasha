// Masking of secret-looking values before they leave the process.
//
// The dashboard parses compose files that routinely contain passwords, tokens
// and API keys. Anyone who can reach the dashboard can call the REST API, so
// values are masked here rather than shipped verbatim.

export const MASK = '••••••';

// Key names whose value is treated as a secret.
const SENSITIVE_KEY = /(pass|passwd|password|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credential|auth|salt|cipher|encryption|dsn|conn(ection)?[-_]?string)/i;

// Keys that merely *look* sensitive but are safe and useful to show.
const ALLOWED_KEY = /^(.*_)?(auth_?(enabled|method|type|mode|url|host|port|provider)|password_?(file|path)|secret_?(file|path)|token_?(file|path)|.*_file|.*_path)$/i;

// `scheme://user:password@host` — credentials embedded in a URL.
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s@/]+)@/gi;

/** True when a key's value should be masked. */
export function isSensitiveKey(key) {
  const k = String(key || '');
  if (!k) return false;
  if (ALLOWED_KEY.test(k)) return false;
  return SENSITIVE_KEY.test(k);
}

/** Mask a value, keeping empty values empty so the UI can tell them apart. */
function maskValue(value) {
  const v = value == null ? '' : String(value);
  return v === '' ? '' : MASK;
}

/** Return a copy of an environment/label map with secret values masked. */
export function redactMap(map) {
  if (!map || typeof map !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = isSensitiveKey(k) ? maskValue(v) : redactUrlCredentials(String(v ?? ''));
  }
  return out;
}

/** Replace passwords embedded in URLs: postgres://user:pw@host -> user:••••••@host */
export function redactUrlCredentials(text) {
  return String(text).replace(URL_CREDENTIALS, `$1:${MASK}@`);
}

/**
 * Mask secrets in the raw text of a compose file, preserving its structure and
 * line numbers so it stays readable (and TODO line references stay valid).
 *
 * Handles the two ways compose expresses values:
 *   KEY: value          (mapping)
 *   - KEY=value         (list item)
 * plus credentials embedded in URLs anywhere in the line.
 *
 * This is a best-effort textual pass: a secret passed positionally (e.g. inside
 * a `command:` string) is not recognised by key name and is left alone.
 */
export function redactComposeText(raw) {
  if (!raw) return '';
  return String(raw)
    .split('\n')
    .map(redactLine)
    .join('\n');
}

function redactLine(line) {
  // Never touch comments — they hold the TODO/FIXME text.
  if (/^\s*#/.test(line)) return line;

  // `- KEY=value` (env/label list form)
  const listForm = line.match(/^(\s*-\s*)([A-Za-z_][\w.-]*)(=)(.*)$/);
  if (listForm) {
    const [, indent, key, eq, value] = listForm;
    const { body, comment } = splitTrailingComment(value);
    if (isSensitiveKey(key)) return `${indent}${key}${eq}${maskValue(body.trim())}${comment}`;
    return `${indent}${key}${eq}${redactUrlCredentials(body)}${comment}`;
  }

  // `KEY: value` (mapping form)
  const mapForm = line.match(/^(\s*)([A-Za-z_][\w.-]*)(:\s*)(.*)$/);
  if (mapForm) {
    const [, indent, key, sep, value] = mapForm;
    const { body, comment } = splitTrailingComment(value);
    if (body.trim() === '') return line; // a nested block, nothing to mask
    if (isSensitiveKey(key)) return `${indent}${key}${sep}${maskValue(body.trim())}${comment}`;
    return `${indent}${key}${sep}${redactUrlCredentials(body)}${comment}`;
  }

  return redactUrlCredentials(line);
}

// Split ` value # trailing comment` so the comment survives masking untouched.
function splitTrailingComment(value) {
  const m = String(value).match(/^(.*?)(\s+#.*)$/);
  return m ? { body: m[1], comment: m[2] } : { body: String(value), comment: '' };
}
