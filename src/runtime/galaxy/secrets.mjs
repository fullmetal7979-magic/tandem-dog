// Secret hygiene for everything COSMOS writes into the Galaxy repository (은하수).
//
// The Galaxy is a private GitHub repository, but private is not secret: it is
// cloned onto every PC the user owns. So credentials never travel there.
// Two layers keep them out:
//  - structured config: any value under a credential-shaped key becomes the
//    placeholder `${secret}`; applying it back keeps the local real value.
//  - free text (skills, conversations): token-shaped strings are redacted.
// A file whose NAME says it holds credentials is refused outright.

export const SECRET_PLACEHOLDER = '${secret}';
export const REDACTED = '[redacted secret]';

// Provider tokens and keys with distinctive prefixes or shapes.
const TOKEN_PATTERNS = [
  /\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{20,}/g,
  /\bxai-[A-Za-z0-9]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bya29\.[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const SECRET_KEY = /(?:^|[_-])(?:api[_-]?key|apikey|token|secret|password|passwd|credential|credentials|authorization|auth|cookie|session[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?key|refresh[_-]?token)$/i;

// Files that exist only to hold credentials; they are never synced, whatever
// directory they sit in.
const SECRET_FILE = /(?:^|[\\/])(?:\.env(?:\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|credentials(?:\.json)?|.*-oauth(?:-credentials)?\.json|.*oauth.*\.json|provider-accounts(?:\.json)?|relay-e2ee\.json|\.npmrc|\.netrc|\.pypirc)$/i;

export function isSecretKey(key) {
  return SECRET_KEY.test(String(key ?? ''));
}

export function isSecretFile(path) {
  return SECRET_FILE.test(String(path ?? ''));
}

/** True when free text carries something token-shaped. */
export function containsSecret(text) {
  const value = String(text ?? '');
  return TOKEN_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

/** Replace token-shaped substrings; returns { text, count }. */
export function redactText(text) {
  let value = String(text ?? '');
  let count = 0;
  for (const pattern of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    value = value.replace(pattern, () => {
      count += 1;
      return REDACTED;
    });
  }
  return { text: value, count };
}

/**
 * Deep copy with every credential-shaped key's value replaced by the
 * placeholder and every token-shaped string redacted. Returns { value, count }.
 */
export function redactJson(input) {
  let count = 0;
  const walk = (value, key) => {
    if (key !== undefined && isSecretKey(key) && value !== null && value !== undefined && value !== '') {
      if (typeof value === 'string' || typeof value === 'number') {
        count += 1;
        return SECRET_PLACEHOLDER;
      }
    }
    if (Array.isArray(value)) return value.map((item) => walk(item));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
      return out;
    }
    if (typeof value === 'string') {
      const redacted = redactText(value);
      count += redacted.count;
      return redacted.text;
    }
    return value;
  };
  return { value: walk(input), count };
}

/**
 * Fill placeholders back in from the local copy: a synced value that is the
 * placeholder keeps whatever this PC already had at the same path.
 */
export function restoreSecrets(incoming, local) {
  if (incoming === SECRET_PLACEHOLDER) return local === undefined ? undefined : local;
  if (Array.isArray(incoming)) {
    return incoming.map((item, index) => restoreSecrets(item, Array.isArray(local) ? local[index] : undefined));
  }
  if (incoming && typeof incoming === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(incoming)) {
      const restored = restoreSecrets(v, local && typeof local === 'object' ? local[k] : undefined);
      if (restored !== undefined) out[k] = restored;
    }
    return out;
  }
  return incoming;
}
