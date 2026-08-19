// Masking of secret-looking values before they leave the process.
//
// The dashboard parses compose files that routinely contain passwords, tokens
// and API keys. Anyone who can reach the dashboard can call the REST API, so
// values are masked here rather than shipped verbatim.
//
// A key-name denylist alone is fail-open: a secret under an unrecognised key
// (e.g. `ADMIN_PW`, `MY_APP_MASTER=…`) would leak. So masking triggers on
// EITHER a sensitive-looking key OR a secret-looking value (a long, random,
// high-entropy token). Known-safe keys (`*_FILE`, `*_PATH`, `AUTH_METHOD`, …)
// opt out of both checks, since their values are paths/enums we want to show.

export const MASK = '••••••';

// Key names whose value is treated as a secret.
const SENSITIVE_KEY = /(pass|passwd|password|pwd|pw\b|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credential|auth|salt|cipher|encryption|dsn|conn(ection)?[-_]?string)/i;

// Keys that merely *look* sensitive but are safe and useful to show. These opt
// out of value-based masking too — their values are paths/enums, not secrets.
const ALLOWED_KEY = /^(.*_)?(auth_?(enabled|method|type|mode|url|host|port|provider)|password_?(file|path)|secret_?(file|path)|token_?(file|path)|.*_file|.*_path)$/i;

// `scheme://user:password@host` — credentials embedded in a URL.
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s@/]+)@/gi;

/** True for keys explicitly considered safe to show verbatim. */
export function isAllowedKey(key) {
  return ALLOWED_KEY.test(String(key || ''));
}

/** True when a key's *name* marks its value as a secret. */
export function isSensitiveKey(key) {
  const k = String(key || '');
  if (!k) return false;
  if (isAllowedKey(k)) return false;
  return SENSITIVE_KEY.test(k);
}

// Shannon entropy (bits per character) of a string — high for random tokens,
// low for words and structured text.
function entropy(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let bits = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// Number of distinct character classes present (lower/upper/digit/symbol).
function charClasses(s) {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
}

/**
 * True when a value looks like a credential regardless of its key: a JWT, a
 * long hex digest, or a long, mixed, high-entropy token. Deliberately
 * conservative — short values, words, and anything with whitespace (paths,
 * sentences, hostnames) are left visible so the dashboard stays useful.
 */
export function looksLikeSecretValue(value) {
  const v = String(value ?? '').trim();
  if (v.length < 16 || /\s/.test(v)) return false;
  // JWT: three base64url segments.
  if (/^ey[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}$/.test(v)) return true;
  // Long hex digest (SHA/API hash).
  if (/^[0-9a-f]{32,}$/i.test(v)) return true;
  // Long, token-charset string that is random enough and mixes character
  // classes — rules out URLs (contain `:` `/`) and plain words (low entropy).
  if (v.length >= 20 && /^[A-Za-z0-9+/=_.-]+$/.test(v) && charClasses(v) >= 3 && entropy(v) >= 3.5) {
    return true;
  }
  return false;
}

/** True when a (key, value) pair should be masked. */
export function shouldMask(key, value) {
  if (isAllowedKey(key)) return false;
  return SENSITIVE_KEY.test(String(key || '')) || looksLikeSecretValue(value);
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
    out[k] = shouldMask(k, v) ? maskValue(v) : redactUrlCredentials(String(v ?? ''));
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
    if (shouldMask(key, body.trim())) return `${indent}${key}${eq}${maskValue(body.trim())}${comment}`;
    return `${indent}${key}${eq}${redactUrlCredentials(body)}${comment}`;
  }

  // `KEY: value` (mapping form)
  const mapForm = line.match(/^(\s*)([A-Za-z_][\w.-]*)(:\s*)(.*)$/);
  if (mapForm) {
    const [, indent, key, sep, value] = mapForm;
    const { body, comment } = splitTrailingComment(value);
    if (body.trim() === '') return line; // a nested block, nothing to mask
    if (shouldMask(key, body.trim())) return `${indent}${key}${sep}${maskValue(body.trim())}${comment}`;
    return `${indent}${key}${sep}${redactUrlCredentials(body)}${comment}`;
  }

  return redactUrlCredentials(line);
}

// Split ` value # trailing comment` so the comment survives masking untouched.
function splitTrailingComment(value) {
  const m = String(value).match(/^(.*?)(\s+#.*)$/);
  return m ? { body: m[1], comment: m[2] } : { body: String(value), comment: '' };
}
