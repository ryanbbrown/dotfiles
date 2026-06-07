#!/usr/bin/env bash
set -eu

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

source_skill="drawio-mcp/skill-cli/drawio/SKILL.md"
source_shared="drawio-mcp/shared"
target_root="plugins/drawio/skills/drawio"
references_dir="$target_root/references"

if [ ! -f "$source_skill" ]; then
  echo "error: missing $source_skill; run git submodule update --init --recursive" >&2
  exit 1
fi

if [ ! -d "$source_shared" ]; then
  echo "error: missing $source_shared; run git submodule update --init --recursive" >&2
  exit 1
fi

rm -rf "$target_root"
mkdir -p "$references_dir"

cp "$source_skill" "$target_root/SKILL.md"
cp "$source_shared/xml-reference.md" "$references_dir/xml-reference.md"
cp "$source_shared/style-reference.md" "$references_dir/style-reference.md"
cp "$source_shared/mermaid-reference.md" "$references_dir/mermaid-reference.md"
cp "$source_shared/mxfile.xsd" "$references_dir/mxfile.xsd"

perl -0pi -e 's|For the complete draw\.io XML reference including common styles, edge routing, containers, layers, tags, metadata, dark mode colors, and XML well-formedness rules, fetch and follow the instructions at:\nhttps://raw\.githubusercontent\.com/jgraph/drawio-mcp/main/shared/xml-reference\.md|For nontrivial diagrams, read and follow the local references before writing XML:\n\n- `references/xml-reference.md` for mxGraphModel structure, edge routing, containers, layers, tags, metadata, dark mode colors, and XML well-formedness rules\n- `references/style-reference.md` for draw.io style strings, shapes, labels, connectors, and visual conventions\n- `references/mxfile.xsd` when schema-level validation would help debug generated XML\n\n`references/mermaid-reference.md` is included from upstream for comparison with the MCP variants, but this skill should still generate native draw.io XML directly.|s' "$target_root/SKILL.md"

echo "Generated $target_root"
