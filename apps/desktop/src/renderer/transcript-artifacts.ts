import type { TranscriptItem } from './desktop-types';
import {
  desktopToolActivitySurface,
  flattenedToolActivityItems,
  toolItemDone,
} from './transcript-tool-core';
import { toolActivityFirstText } from './transcript-tool-format';

export interface TranscriptArtifact {
  key: string;
  kind: 'image' | 'video' | 'document';
  name: string;
  path: string;
  /** Width/height ratio known before the image decodes; sizes the card. */
  aspect?: number;
}

const SVG = /\.svg$/i;

/** Files a successful edit/apply_patch call wrote: its own write targets, not
 *  paths guessed from prose. Deleted files and move sources are excluded. */
function writtenFiles(normalizedName: string, args: Record<string, unknown>): string[] {
  if (normalizedName === 'edit') {
    const path = toolActivityFirstText(args, 'file_path', 'filePath', 'path');
    return path ? [path] : [];
  }
  if (normalizedName !== 'apply_patch' || typeof args.patch !== 'string') return [];
  const paths: string[] = [];
  for (const line of args.patch.split(/\r?\n/)) {
    const header = /^\*\*\* (Add File|Update File|Move to): (.+)$/.exec(line);
    if (!header) continue;
    if (header[1] === 'Move to') paths.pop();
    paths.push(header[2].trim());
  }
  return paths;
}

export function transcriptArtifacts(items: readonly TranscriptItem[]): TranscriptArtifact[] {
  const artifacts = new Map<string, TranscriptArtifact>();
  for (const item of flattenedToolActivityItems(items)) {
    if (
      !toolItemDone(item) ||
      item.isError ||
      Number(item.errorCount || 0) > 0 ||
      Number(item.callErrorCount || 0) > 0 ||
      Number(item.exitErrorCount || 0) > 0
    )
      continue;
    const surface = desktopToolActivitySurface(item.name, item.args);
    for (const path of writtenFiles(surface.normalizedName, surface.args)) {
      if (!SVG.test(path)) continue;
      const key = `file:${path.replace(/\\/g, '/')}`;
      artifacts.set(key, { key, kind: 'image', path, name: path.split(/[\\/]/).pop() || path });
    }
  }
  return [...artifacts.values()];
}
