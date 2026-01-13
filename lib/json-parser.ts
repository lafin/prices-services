/* eslint-disable @typescript-eslint/no-explicit-any */

export function extractJsonVar(html: string, name: string): string | null {
  const patterns = [`var ${name} =`, `${name} =`];
  let idx = -1;
  for (const pattern of patterns) {
    idx = html.indexOf(pattern);
    if (idx !== -1) break;
  }
  if (idx === -1) return null;

  idx = html.indexOf('=', idx) + 1;
  while (idx < html.length && /\s/.test(html[idx])) idx++;
  if (html[idx] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = idx; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(idx, i + 1);
  }
  return null;
}

export function walkJson(node: unknown, visit: (value: unknown) => void): void {
  if (!node || typeof node !== 'object') return;
  visit(node);
  const values = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
  for (const value of values) walkJson(value, visit);
}

export function readText(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(readText).join('');
  if (typeof node === 'object') {
    const obj = node as Record<string, any>;
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.simpleText === 'string') return obj.simpleText;
    if (Array.isArray(obj.runs)) return obj.runs.map((r: any) => r?.text ?? '').join('');
  }
  return '';
}
