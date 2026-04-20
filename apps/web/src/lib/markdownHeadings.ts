export interface ParsedMarkdownHeading {
  id: string;
  level: number;
  text: string;
}

export interface MarkdownHeadingNode extends ParsedMarkdownHeading {
  children: readonly MarkdownHeadingNode[];
}

const HEADING_LINE_RE = /^(?<indent>\s{0,3})(?<marker>#{1,6})\s+(?<text>.*)$/;
const HEADING_FENCE_RE = /^\s{0,3}(?<fence>`{3,}|~{3,})(?:\s|$)/;
const TRAILING_HEADING_MARKER_RE = /\s+#+\s*$/;

function stripMarkdownSyntax(input: string): string {
  const withoutImageLinks = input.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const withoutLinks = withoutImageLinks.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const withoutInlineCode = withoutLinks.replace(/`([^`]+)`/g, "$1");
  const withoutEmphasis = withoutInlineCode
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$2")
    .replace(/`(.*?)`/g, "$1");
  return withoutEmphasis.replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1").trim();
}

function normalizeToSlug(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "section";
}

export function slugifyMarkdownHeading(input: string, counts: Map<string, number>): string {
  const base = normalizeToSlug(input);
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function isCodeFence(line: string): { marker: string; length: number } | null {
  const match = HEADING_FENCE_RE.exec(line);
  if (!match?.groups?.fence) return null;
  const marker = match.groups.fence[0]!;
  return { marker, length: match.groups.fence.length };
}

export function extractMarkdownHeadings(input: string): ParsedMarkdownHeading[] {
  const headings: ParsedMarkdownHeading[] = [];
  const counts = new Map<string, number>();
  let inCodeBlock = false;
  let codeFenceMarker: string | null = null;
  let codeFenceLength = 0;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine;

    const fence = isCodeFence(line);
    if (fence) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeFenceMarker = fence.marker;
        codeFenceLength = fence.length;
      } else if (fence.marker === codeFenceMarker && fence.length >= codeFenceLength) {
        inCodeBlock = false;
        codeFenceMarker = null;
        codeFenceLength = 0;
      }
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    const match = HEADING_LINE_RE.exec(line);
    if (match?.groups == null) continue;
    const { indent, marker, text } = match.groups;
    if (indent == null || marker == null || text == null) {
      continue;
    }

    if (indent.length > 3) continue;

    const level = marker.length;
    const matchedText = text.replace(TRAILING_HEADING_MARKER_RE, "");
    const cleanText = stripMarkdownSyntax(matchedText);

    if (!cleanText) continue;

    const id = slugifyMarkdownHeading(cleanText, counts);
    headings.push({
      id,
      level,
      text: cleanText,
    });
  }

  return headings;
}

export function buildMarkdownHeadingTree(
  headings: readonly ParsedMarkdownHeading[],
): MarkdownHeadingNode[] {
  const root: MarkdownHeadingNode[] = [];
  const stack: MarkdownHeadingNode[] = [];

  for (const heading of headings) {
    const node: MarkdownHeadingNode = { ...heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      const parent = stack[stack.length - 1];
      if (!parent) continue;
      parent.children = [...parent.children, node];
    }

    stack.push(node);
  }

  return root;
}

export function markdownHeadingIds(headings: readonly ParsedMarkdownHeading[]): readonly string[] {
  return headings.map((heading) => heading.id);
}
