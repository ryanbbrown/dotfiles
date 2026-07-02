#!/bin/bash

# Link global-agent-context instructions and plugins into local agent homes.
#
# Canonical source:
#   - plugins/ contains grouped skill sources for Claude Code and Codex.
#   - Selected upstream skills without local plugin manifests are linked from
#     their submodule paths.
#
# Codex keeps ~/.codex/skills as a real directory because it also contains
# Codex's built-in .system skills; this script syncs skill symlinks into that
# directory without touching .system or other non-symlink entries.

LINK_CLAUDE=true
LINK_CODEX=true
LINK_SKILLS=true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PLUGINS_DIR="$SCRIPT_DIR/plugins"
CLAUDE_MD_FILE="$SCRIPT_DIR/CLAUDE.md"
AGENTS_MD_FILE="$SCRIPT_DIR/AGENTS.md"

if [ -f "$CLAUDE_MD_FILE" ] && [ -f "$AGENTS_MD_FILE" ]; then
    CLAUDE_MD_SOURCE="$CLAUDE_MD_FILE"
    AGENTS_MD_SOURCE="$AGENTS_MD_FILE"
elif [ -f "$CLAUDE_MD_FILE" ]; then
    CLAUDE_MD_SOURCE="$CLAUDE_MD_FILE"
    AGENTS_MD_SOURCE="$CLAUDE_MD_FILE"
elif [ -f "$AGENTS_MD_FILE" ]; then
    CLAUDE_MD_SOURCE="$AGENTS_MD_FILE"
    AGENTS_MD_SOURCE="$AGENTS_MD_FILE"
else
    echo "Warning: Neither CLAUDE.md nor AGENTS.md found in $SCRIPT_DIR, so instructions will not be linked."
    CLAUDE_MD_SOURCE=""
    AGENTS_MD_SOURCE=""
fi

CLAUDE_COMMANDS_TARGET="$HOME/.claude/commands"
CLAUDE_MD_TARGET="$HOME/.claude/CLAUDE.md"
CLAUDE_SKILLS_TARGET="$HOME/.claude/skills"
CODEX_PROMPTS_TARGET="$HOME/.codex/prompts"
CODEX_AGENTS_TARGET="$HOME/.codex/AGENTS.md"
CODEX_SKILLS_TARGET="$HOME/.codex/skills"

create_symlink() {
    local source="$1"
    local target="$2"

    if [ -L "$target" ]; then
        echo "Removing existing symlink at $target"
        if ! rm "$target"; then
            echo "Warning: failed to remove existing symlink at $target"
            return 1
        fi
    elif [ -e "$target" ]; then
        echo "Warning: $target exists and is not a symlink. Skipping."
        return 1
    fi

    mkdir -p "$(dirname "$target")"
    if ln -s "$source" "$target"; then
        echo "Linked $target -> $source"
    else
        echo "Warning: failed to link $target -> $source"
        return 1
    fi
}

remove_symlink() {
    local target="$1"

    if [ -L "$target" ]; then
        echo "Removing existing symlink at $target"
        if ! rm "$target"; then
            echo "Warning: failed to remove existing symlink at $target"
            return 1
        fi
    fi
}

ensure_directory() {
    local target="$1"

    if [ -L "$target" ]; then
        echo "Removing existing symlink at $target"
        if ! rm "$target"; then
            echo "Warning: failed to remove existing symlink at $target"
            return 1
        fi
    elif [ -e "$target" ] && [ ! -d "$target" ]; then
        echo "Warning: $target exists and is not a directory. Skipping."
        return 1
    fi

    mkdir -p "$target"
}

sync_skill_links() {
    local args=("$@")
    local target_index=$((${#args[@]} - 1))
    local target_dir="${args[$target_index]}"
    unset 'args[$target_index]'
    local source_dirs=("${args[@]}")
    local source_dir
    local skill_path
    local skill_name
    local target_path

    ensure_directory "$target_dir" || return 1

    for target_path in "$target_dir"/*; do
        if [ ! -L "$target_path" ]; then
            continue
        fi

        echo "Removing skill link at $target_path"
        rm "$target_path" || return 1
    done

    for source_dir in "${source_dirs[@]}"; do
        if [ ! -d "$source_dir" ]; then
            continue
        fi

        for skill_path in "$source_dir"/*; do
            if [ ! -d "$skill_path" ]; then
                if [ -L "$skill_path" ] && [ ! -e "$skill_path" ]; then
                    echo "Warning: skipping dangling skill symlink $skill_path -> $(readlink "$skill_path")"
                fi
                continue
            fi

            skill_name="$(basename "$skill_path")"
            create_symlink "$skill_path" "$target_dir/$skill_name"
        done
    done
}

# Legacy slash-command links are intentionally removed. Both Claude and Codex
# read direct skill links in their skills directories; ~/.claude/plugins is a
# managed directory (marketplace installs) and does NOT discover loose dirs.
if [ "$LINK_CLAUDE" = true ]; then
    remove_symlink "$CLAUDE_COMMANDS_TARGET"
fi

if [ "$LINK_CODEX" = true ]; then
    remove_symlink "$CODEX_PROMPTS_TARGET"
fi

if [ "$LINK_CLAUDE" = true ] && [ -n "$CLAUDE_MD_SOURCE" ]; then
    create_symlink "$CLAUDE_MD_SOURCE" "$CLAUDE_MD_TARGET"
fi

if [ "$LINK_CODEX" = true ] && [ -n "$AGENTS_MD_SOURCE" ]; then
    create_symlink "$AGENTS_MD_SOURCE" "$CODEX_AGENTS_TARGET"
fi

if [ "$LINK_SKILLS" = true ] && [ "$LINK_CLAUDE" = true ]; then
    sync_skill_links \
        "$PLUGINS_DIR"/*/skills \
        "$CLAUDE_SKILLS_TARGET"
    # gstack skills resolve their compiled binary and bin/ helpers via
    # ~/.claude/skills/gstack (the canonical gstack install location).
    create_symlink "$SCRIPT_DIR/gstack" "$CLAUDE_SKILLS_TARGET/gstack"
fi

if [ "$LINK_SKILLS" = true ] && [ "$LINK_CODEX" = true ]; then
    sync_skill_links \
        "$PLUGINS_DIR"/*/skills \
        "$CODEX_SKILLS_TARGET"
fi

echo "Done!"
