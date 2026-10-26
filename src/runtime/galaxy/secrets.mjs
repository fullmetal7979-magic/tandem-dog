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

// ------------------------------------------------------------------ URLs

export const URL_SECRET_MARK = 'redacted-secret';
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#@'"]*)@/gi;
// Query parameters that carry credentials, matched by their WHOLE name (any
// case): `?token=` goes, `?keyword=` or `?monkey=` stays.
export const URL_SECRET_PARAM_NAMES = Object.freeze([
  'token', 'access_token', 'refresh_token', 'id_token', 'auth_token', 'oauth_token', 'private_token', 'bearer_token',
  'sas_token', 'session_token', 'security_token', 'api_token',
  'key', 'apikey', 'api_key', 'api-key', 'access_key', 'secret_key', 'private_key', 'account_key',
  'secret', 'client_secret', 'password', 'passwd', 'pwd',
  'auth', 'authorization', 'sig', 'signature', 'credential', 'credentials', 'code',
  'session', 'session_id', 'sessionid', 'sid', 'jwt',
  'x-amz-signature', 'x-amz-credential', 'x-amz-security-token', 'x-goog-signature', 'x-goog-credential',
]);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const URL_SECRET_PARAM = new RegExp(`([?&;](?:${URL_SECRET_PARAM_NAMES.map(escapeRegExp).join('|')})=)[^&#\\s'"]*`, 'gi');
const SSH_SCHEME = /^(?:git\+)?ssh:\/\/$/i;

/**
 * Remove credentials from every URL inside `text`: `user:pass@` (or a bare
 * token as user name) and token-shaped query parameters. Pure text work, so a
 * plain URL keeps its exact spelling; idempotent. With `mark`, what was
 * removed leaves a visible marker (`redacted-secret`) so a synced copy can be
 * told apart from a real value; without it (display) the credential is just gone.
 */
export function scrubUrlsInText(text, { mark = false } = {}) {
  return String(text ?? '')
    .replace(URL_USERINFO, (match, scheme, userinfo) => {
      if (SSH_SCHEME.test(scheme) && !userinfo.includes(':')) return match;
      return mark ? `${scheme}${URL_SECRET_MARK}@` : scheme;
    })
    .replace(URL_SECRET_PARAM, `$1${URL_SECRET_MARK}`);
}

/** A remote URL that is safe to show or return. */
export function scrubUrl(url) {
  return scrubUrlsInText(url);
}

/** True when `text` carries a marker left by this module's redaction (a placeholder, not real content). */
export function hasRedactionMark(text) {
  const value = String(text ?? '');
  return value.includes(REDACTED) || value.includes(URL_SECRET_MARK);
}
