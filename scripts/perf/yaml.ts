interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

interface ParserState {
  readonly lines: readonly YamlLine[];
  index: number;
}

export function parseYaml(raw: string): unknown {
  const bunYaml = (
    globalThis as unknown as {
      Bun?: { YAML?: { parse?: (input: string) => unknown } };
    }
  ).Bun?.YAML?.parse;
  if (bunYaml) {
    return bunYaml(raw);
  }
  const lines = raw
    .split(/\r?\n/)
    .map((line): YamlLine | null => {
      const withoutComment = stripComment(line);
      if (withoutComment.trim().length === 0) {
        return null;
      }
      return {
        indent: withoutComment.length - withoutComment.trimStart().length,
        text: withoutComment.trim(),
      };
    })
    .filter((line): line is YamlLine => line !== null);
  return parseBlock({ lines, index: 0 }, 0);
}

function stripComment(line: string): string {
  const commentIndex = line.indexOf("#");
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

function parseBlock(state: ParserState, indent: number): unknown {
  const line = state.lines[state.index];
  if (!line || line.indent < indent) {
    return {};
  }
  return line.text.startsWith("- ") ? parseArray(state, indent) : parseObject(state, indent);
}

function parseObject(state: ParserState, indent: number): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (!line || line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      break;
    }
    const separatorIndex = line.text.indexOf(":");
    if (separatorIndex === -1) {
      state.index += 1;
      continue;
    }
    const key = line.text.slice(0, separatorIndex).trim();
    const rest = line.text.slice(separatorIndex + 1).trim();
    state.index += 1;
    if (rest.length > 0) {
      output[key] = parseScalar(rest);
      continue;
    }
    const nextLine = state.lines[state.index];
    output[key] = nextLine && nextLine.indent > indent ? parseBlock(state, nextLine.indent) : {};
  }
  return output;
}

function parseArray(state: ParserState, indent: number): unknown[] {
  const output: unknown[] = [];
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (!line || line.indent !== indent || !line.text.startsWith("- ")) {
      break;
    }
    const rest = line.text.slice(2).trim();
    state.index += 1;
    if (rest.length > 0) {
      output.push(parseScalar(rest));
      continue;
    }
    const nextLine = state.lines[state.index];
    output.push(nextLine && nextLine.indent > indent ? parseBlock(state, nextLine.indent) : null);
  }
  return output;
}

function parseScalar(value: string): unknown {
  if (value === "{}") {
    return {};
  }
  if (value === "[]") {
    return [];
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner.length === 0 ? [] : inner.split(",").map((entry) => parseScalar(entry.trim()));
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(value) ? numeric : value;
}
