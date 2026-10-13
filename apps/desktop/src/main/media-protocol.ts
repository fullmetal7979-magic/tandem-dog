// Desktop byte lane for local file previews: `mixdog-media://preview/<token>/…`.
//
// A protocol handler makes previews ordinary cacheable resources: Chromium
// fetches them in parallel, keeps them in its own cache, and asks for byte
// ranges when a <video> seeks.
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

import { protocol } from 'electron';

import { mediaResponsePlan } from '../../../relay/lib/media-http.mjs';
import { FILE_PREVIEW_SCHEME, resolveFilePreview } from './file-preview';

export const MEDIA_SCHEME = FILE_PREVIEW_SCHEME;

/** Must run before app ready: a non-privileged scheme cannot stream or be
 *  fetched, so ranges (video seeking) would never reach the handler. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function headerStrings(headers: Record<string, string | number>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return textResponse(400, 'Bad request.');
    }
    const previewToken = url.hostname === 'preview' ? url.pathname.replace(/^\/+/, '').split('/', 1)[0] || '' : '';
    const preview = previewToken && /^[0-9a-f-]{36}$/i.test(previewToken) ? resolveFilePreview(previewToken) : null;
    if (!preview) return textResponse(404, 'Not found.');
    const target = { path: preview.path, mime: preview.mime };
    let size: number;
    try {
      size = statSync(target.path).size;
    } catch {
      return textResponse(404, 'Not found.');
    }
    const plan = mediaResponsePlan({
      size,
      mime: target.mime,
      assetId: previewToken,
      variant: 'original',
      rangeHeader: request.headers.get('range'),
      ifNoneMatch: request.headers.get('if-none-match'),
    });
    const headers = {
      ...headerStrings(plan.headers),
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    };
    if (plan.status >= 300 || request.method === 'HEAD' || size === 0) {
      return new Response(null, { status: plan.status, headers });
    }
    const stream = createReadStream(target.path, { start: plan.start, end: plan.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: plan.status,
      headers,
    });
  });
}
