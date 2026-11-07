// Attachments for tasks: images, PDFs and small text files. Bytes live in a
// folder next to the world save (or in memory for tests), never inside the
// JSON save itself; tasks only keep the metadata.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, truncate } from './util.mjs';

export const MAX_ATTACHMENTS = 5;
const MB = 1024 * 1024;

// Kinds Claude reads natively. SVG and HTML are refused on purpose: they could
// carry script when served back to the browser.
const TYPES = {
  'image/png': { kind: 'image', max: 5 * MB },
  'image/jpeg': { kind: 'image', max: 5 * MB },
  'image/gif': { kind: 'image', max: 5 * MB },
  'image/webp': { kind: 'image', max: 5 * MB },
  'application/pdf': { kind: 'pdf', max: 20 * MB },
  'text/plain': { kind: 'text', max: 1 * MB },
  'text/markdown': { kind: 'text', max: 1 * MB },
  'text/csv': { kind: 'text', max: 1 * MB },
  'application/json': { kind: 'text', max: 1 * MB },
};
const BY_EXTENSION = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', tsv: 'text/plain', json: 'application/json', log: 'text/plain',
};
export const MAX_UPLOAD = 20 * MB;
export const ACCEPT = Object.keys(BY_EXTENSION).map((ext) => `.${ext}`).join(',');

const ID_PATTERN = /^f_[0-9a-f]{10}$/;

// Browsers report text files inconsistently (or as octet-stream); the file
// extension decides when the declared type is not one we know.
export function resolveType(declared, name) {
  const type = String(declared ?? '').split(';')[0].trim().toLowerCase();
  if (TYPES[type]) return type;
  const ext = String(name ?? '').toLowerCase().split('.').pop();
  return BY_EXTENSION[ext] ?? null;
}

const MAGIC = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/gif': [0x47, 0x49, 0x46],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

// A file must really be what it claims, so a renamed file cannot reach the
// API (or the browser) under the wrong type.
function looksLike(type, buffer) {
  if (type === 'image/webp') return buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  const magic = MAGIC[type];
  if (magic) return magic.every((byte, index) => buffer[index] === byte);
  // Text kinds: valid UTF-8 without NUL bytes.
  if (buffer.includes(0)) return false;
  return !buffer.toString('utf8').includes('�');
}

export class FileStore {
  // dir = null keeps everything in memory (tests, throwaway towns).
  constructor(dir = null) {
    this.dir = dir;
    this.memory = new Map();
    if (dir) mkdirSync(dir, { recursive: true });
  }

  put(buffer, { name, type }) {
    const resolved = resolveType(type, name);
    if (!resolved) throw new Error('이미지(PNG·JPG·GIF·WebP), PDF, 텍스트(TXT·MD·CSV·JSON) 파일만 첨부할 수 있어요.');
    const rule = TYPES[resolved];
    if (!buffer.length) throw new Error('빈 파일은 첨부할 수 없어요.');
    if (buffer.length > rule.max) throw new Error(`${rule.kind === 'image' ? '이미지' : rule.kind === 'pdf' ? 'PDF' : '텍스트 파일'}는 ${Math.round(rule.max / MB)}MB까지 첨부할 수 있어요.`);
    if (!looksLike(resolved, buffer)) throw new Error('파일 내용이 확장자와 맞지 않아요.');
    const meta = {
      id: newId('f'),
      name: truncate(String(name ?? '').replace(/[\\/\0]/g, '_').trim() || '첨부 파일', 80),
      type: resolved,
      kind: rule.kind,
      size: buffer.length,
    };
    if (this.dir) {
      writeFileSync(join(this.dir, meta.id), buffer);
      writeFileSync(join(this.dir, `${meta.id}.json`), JSON.stringify(meta));
    } else {
      this.memory.set(meta.id, { meta, buffer });
    }
    return meta;
  }

  meta(id) {
    if (!ID_PATTERN.test(String(id))) return null;
    if (!this.dir) return this.memory.get(id)?.meta ?? null;
    try {
      return JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  read(id) {
    if (!this.meta(id)) return null;
    if (!this.dir) return this.memory.get(id).buffer;
    try {
      return readFileSync(join(this.dir, id));
    } catch {
      return null;
    }
  }
}

// Claude content blocks for a task's attachments (images, PDFs, text docs).
export function attachmentBlocks(files, attachments = []) {
  const blocks = [];
  for (const meta of attachments) {
    const buffer = files.read(meta.id);
    if (!buffer) continue;
    if (meta.kind === 'image') blocks.push({ type: 'image', source: { type: 'base64', media_type: meta.type, data: buffer.toString('base64') } });
    else if (meta.kind === 'pdf') blocks.push({ type: 'document', title: meta.name, source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } });
    else blocks.push({ type: 'document', title: meta.name, source: { type: 'text', media_type: 'text/plain', data: buffer.toString('utf8') } });
  }
  return blocks;
}

// What the offline brain may know: names, kinds and the text of text files.
export function attachmentDigest(files, attachments = []) {
  return attachments.map((meta) => ({
    name: meta.name,
    kind: meta.kind,
    size: meta.size,
    text: meta.kind === 'text' ? truncate(files.read(meta.id)?.toString('utf8') ?? '', 4000) : null,
  }));
}
