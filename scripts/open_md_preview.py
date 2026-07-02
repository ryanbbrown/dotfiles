#!/usr/bin/env python3

from __future__ import annotations

import html
import pathlib
import re
import subprocess
import sys
import tempfile

STYLE = """
:root {
  color-scheme: light dark;
  --bg: #fafafa;
  --fg: #1f2328;
  --muted: #667085;
  --border: #d0d7de;
  --code-bg: #f6f8fa;
  --link: #0969da;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #8b949e;
    --border: #30363d;
    --code-bg: #161b22;
    --link: #58a6ff;
  }
}
body {
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0;
}
main {
  box-sizing: border-box;
  margin: 0 auto;
  max-width: 1180px;
  padding: 32px 40px 64px;
}
h1, h2, h3, h4, h5, h6 {
  line-height: 1.25;
  margin: 1.35em 0 0.55em;
}
h1 {
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.35em;
}
a { color: var(--link); }
p, ul, ol, table, pre { margin: 0 0 1em; }
ul, ol { padding-left: 1.5em; }
code {
  background: var(--code-bg);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  padding: 0.15em 0.3em;
}
pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow-x: auto;
  padding: 14px 16px;
}
pre code {
  background: transparent;
  padding: 0;
}
table {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
  width: max-content;
  max-width: 100%;
}
th, td {
  border: 1px solid var(--border);
  padding: 6px 10px;
  vertical-align: top;
}
th {
  background: var(--code-bg);
  font-weight: 600;
}
.source-path {
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 24px;
}
"""


def inline_markdown(text: str) -> str:
    escaped = html.escape(text, quote=False)
    escaped = re.sub(r"`([^`]+)`", lambda m: f"<code>{m.group(1)}</code>", escaped)
    return re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: f'<a href="{html.escape(m.group(2), quote=True)}">{m.group(1)}</a>',
        escaped,
    )


def table_cells(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def is_table_separator(line: str) -> bool:
    cells = table_cells(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def render_table(lines: list[str], start: int) -> tuple[str, int]:
    header = table_cells(lines[start])
    rows: list[list[str]] = []
    index = start + 2
    while index < len(lines) and lines[index].strip().startswith("|"):
        rows.append(table_cells(lines[index]))
        index += 1

    parts = ["<table><thead><tr>"]
    parts.extend(f"<th>{inline_markdown(cell)}</th>" for cell in header)
    parts.append("</tr></thead><tbody>")
    for row in rows:
        parts.append("<tr>")
        parts.extend(f"<td>{inline_markdown(cell)}</td>" for cell in row)
        parts.append("</tr>")
    parts.append("</tbody></table>")
    return "".join(parts), index


def render_markdown(markdown: str) -> str:
    lines = markdown.splitlines()
    output: list[str] = []
    paragraph: list[str] = []
    list_stack: list[str] = []
    index = 0

    def close_paragraph() -> None:
        if paragraph:
            output.append(f"<p>{inline_markdown(' '.join(paragraph))}</p>")
            paragraph.clear()

    def close_lists() -> None:
        while list_stack:
            output.append(f"</{list_stack.pop()}>")

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if stripped.startswith("```"):
            close_paragraph()
            close_lists()
            fence_lines: list[str] = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                fence_lines.append(lines[index])
                index += 1
            output.append(f"<pre><code>{html.escape(chr(10).join(fence_lines))}</code></pre>")
            index += 1
            continue

        if not stripped:
            close_paragraph()
            close_lists()
            index += 1
            continue

        if index + 1 < len(lines) and stripped.startswith("|") and is_table_separator(lines[index + 1]):
            close_paragraph()
            close_lists()
            table_html, index = render_table(lines, index)
            output.append(table_html)
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            close_paragraph()
            close_lists()
            level = len(heading.group(1))
            output.append(f"<h{level}>{inline_markdown(heading.group(2))}</h{level}>")
            index += 1
            continue

        unordered = re.match(r"^[-*]\s+(.+)$", stripped)
        ordered = re.match(r"^\d+\.\s+(.+)$", stripped)
        if unordered or ordered:
            close_paragraph()
            tag = "ul" if unordered else "ol"
            if not list_stack or list_stack[-1] != tag:
                close_lists()
                output.append(f"<{tag}>")
                list_stack.append(tag)
            item = (unordered or ordered).group(1)
            output.append(f"<li>{inline_markdown(item)}</li>")
            index += 1
            continue

        close_lists()
        paragraph.append(stripped)
        index += 1

    close_paragraph()
    close_lists()
    return "\n".join(output)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: open_md_preview.py PATH.md", file=sys.stderr)
        return 2

    source = pathlib.Path(sys.argv[1]).expanduser().resolve()
    if not source.exists():
        print(f"not found: {source}", file=sys.stderr)
        return 1

    rendered = render_markdown(source.read_text())
    html_doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(source.name)}</title>
<style>{STYLE}</style>
</head>
<body>
<main>
<div class="source-path">{html.escape(str(source))}</div>
{rendered}
</main>
</body>
</html>
"""

    out_dir = pathlib.Path(tempfile.gettempdir()) / "agent-md-preview"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{source.stem}.html"
    out_path.write_text(html_doc)
    subprocess.run(["open", str(out_path)], check=True)
    print(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
