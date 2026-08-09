// Find TODO / FIXME comments inside Docker Compose files.
//
// Compose files are YAML, so only `#` line comments exist. Multi-line TODOs —
// runs of consecutive `#` comment lines — are collapsed into a single entry.
// Each entry carries its absolute line number so the builder can attribute it
// to the service whose block it falls in.

// YAML comment syntax: `#` line comments, no block comments.
const YAML_SYNTAX = { line: ['#'], block: [] };

const KEYWORD_RE = /^[\s*]*(TODO|FIXME)\b:?\s*(.*)$/i;
const KEYWORD_TEST = /\b(TODO|FIXME)\b/i;
const CONT_PREFIX_RE = /^[\s*]+/;

const LIMITS = { maxItems: 500, maxTextLen: 240 };

/**
 * Extract TODO/FIXME entries from a compose file's raw text.
 * Returns [{ line, keyword, text }] with 1-based line numbers.
 */
export function scanComposeText(text) {
  if (!text || !KEYWORD_TEST.test(text)) return [];
  return extractTodos(text, YAML_SYNTAX);
}

/**
 * Generic extractor: TODO/FIXME from source text for the given comment syntax.
 * Multi-line comments (blocks and consecutive line comments) yield one entry
 * per keyword occurrence.
 */
export function extractTodos(text, syntax) {
  const { masked, tokens } = maskBlocks(text, syntax.block);
  collectLineRuns(masked, syntax.line, tokens);
  tokens.sort((a, b) => a.startLine - b.startLine);

  const entries = [];
  for (const token of tokens) {
    entriesFromCommentLines(token.lines, entries);
    if (entries.length >= LIMITS.maxItems) break;
  }
  return entries.slice(0, LIMITS.maxItems);
}

// Replace block comments with blanks (preserving line numbers) and record them
// as comment tokens carrying their inner lines.
function maskBlocks(text, blockDelims) {
  const tokens = [];
  let masked = text;
  for (const [open, close] of blockDelims) {
    const re = new RegExp(`${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`, 'g');
    masked = masked.replace(re, (match, offset) => {
      const startLine = lineAt(text, offset);
      const inner = match.slice(open.length, match.length - close.length);
      const lines = inner.split('\n').map((t, i) => ({ line: startLine + i, text: t }));
      tokens.push({ startLine, lines });
      return match.replace(/[^\n]/g, ' ');
    });
  }
  return { masked, tokens };
}

// Group runs of consecutive single-line comments into comment tokens.
function collectLineRuns(masked, lineMarkers, tokens) {
  if (!lineMarkers.length) return;
  const lines = masked.split('\n');
  let run = null;
  for (let i = 0; i < lines.length; i += 1) {
    const idx = firstLineComment(lines[i], lineMarkers);
    if (idx === -1) {
      run = null;
      continue;
    }
    const marker = lineMarkers.find((m) => lines[i].startsWith(m, idx));
    const commentText = lines[i].slice(idx + marker.length);
    if (!run) {
      run = { startLine: i + 1, lines: [] };
      tokens.push(run);
    }
    run.lines.push({ line: i + 1, text: commentText });
  }
}

// Turn a token's comment lines into entries: each keyword starts a new entry;
// following non-empty lines extend it until the next keyword or a blank line.
function entriesFromCommentLines(lines, entries) {
  let current = null;
  for (const { line, text } of lines) {
    const m = text.match(KEYWORD_RE);
    if (m) {
      current = { keyword: m[1].toUpperCase(), line, text: (m[2] || '').trim() };
      entries.push(current);
    } else if (current) {
      const t = text.replace(CONT_PREFIX_RE, '').trim();
      if (!t) {
        current = null; // blank line ends the multi-line TODO
      } else if (current.text.length < LIMITS.maxTextLen) {
        current.text = `${current.text} ${t}`.trim().slice(0, LIMITS.maxTextLen);
      }
    }
  }
}

// Index of the first line-comment marker that is not inside a string literal,
// so markers within e.g. "http://…" are ignored. -1 when there is none.
function firstLineComment(line, markers) {
  let inString = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    for (const m of markers) {
      if (line.startsWith(m, i)) return i;
    }
  }
  return -1;
}

function lineAt(text, index) {
  let count = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
