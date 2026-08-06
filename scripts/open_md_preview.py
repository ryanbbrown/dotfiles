#!/usr/bin/env python3

from __future__ import annotations

import html
import pathlib
import subprocess
import sys
import tempfile

try:
    from markdown_it import MarkdownIt
except ImportError:
    MarkdownIt = None

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
blockquote {
  background: color-mix(in srgb, var(--code-bg) 78%, transparent);
  border: 1px solid var(--border);
  border-left: 4px solid var(--link);
  border-radius: 6px;
  color: var(--fg);
  margin: 0 0 1em;
  padding: 12px 16px;
}
blockquote > :last-child {
  margin-bottom: 0;
}
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


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: open_md_preview.py PATH.md", file=sys.stderr)
        return 2

    if MarkdownIt is None:
        script = pathlib.Path(__file__).resolve()
        print(
            "missing markdown-it-py; run with: "
            f"uv run --with markdown-it-py {script} PATH.md",
            file=sys.stderr,
        )
        return 2

    source = pathlib.Path(sys.argv[1]).expanduser().resolve()
    if not source.exists():
        print(f"not found: {source}", file=sys.stderr)
        return 1

    rendered = MarkdownIt("commonmark", {"html": False}).enable("table").render(source.read_text())
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
