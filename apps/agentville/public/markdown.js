// Minimal, safe Markdown → HTML. Everything is escaped first; only a known
// set of constructs is turned back into tags. Links must be http(s).
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(source) {
  const lines = esc(source).replace(/\r/g, '').split('\n');
  const out = [];
  let index = 0;
  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  while (index < lines.length) {
    const line = lines[index];
    if (/^```/.test(line)) {
      const body = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index])) body.push(lines[index++]);
      index++;
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + 1);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr>');
      index++;
      continue;
    }
    if (/^&gt;\s?/.test(line)) {
      const body = [];
      while (index < lines.length && /^&gt;\s?/.test(lines[index])) body.push(lines[index++].replace(/^&gt;\s?/, ''));
      out.push(`<blockquote>${inline(body.join('<br>'))}</blockquote>`);
      continue;
    }
    if (isTableRow(line) && index + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1])) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell.trim()));
      const head = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && isTableRow(lines[index])) rows.push(cells(lines[index++]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (index < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[index])) {
        items.push(lines[index++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (!line.trim()) {
      index++;
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|&gt;|\s*([-*•]|\d+[.)])\s+)/.test(lines[index]) && !isTableRow(lines[index])) {
      paragraph.push(lines[index++]);
    }
    if (paragraph.length) out.push(`<p>${inline(paragraph.join('<br>'))}</p>`);
    else index++;
  }
  return out.join('\n');
}
