#!/bin/bash

# Link global-agent-context instructions and skills into local agent homes.
#
# Canonical source:
#   - skills/ contains reusable workflows for Claude Code and Codex.
#   - Skills can be invoked directly in Claude with /skill-name, so legacy
#     slash-command markdown is no longer generated into Codex wrappers.
#
# Claude can use a single skills directory symlink. Codex keeps ~/.codex/skills
# as a real directory because it also contains Codex's built-in .system skills;
# this script syncs top-level skill symlinks into that directory without
# touching .system or other non-symlink entries.

LINK_CLAUDE=true
LINK_CODEX=true
LINK_SKILLS=true

SKILLS_DIR="$(pwd)/skills"
CLAUDE_MD_FILE="$(pwd)/CLAUDE.md"
AGENTS_MD_FILE="$(pwd)/AGENTS.md"

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
    echo "Warning: Neither CLAUDE.md nor AGENTS.md found in $(pwd), so instructions will not be linked."
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

remove_path() {
    local target="$1"

    if [ -L "$target" ]; then
        echo "Removing existing symlink at $target"
        if ! rm "$target"; then
            echo "Warning: failed to remove existing symlink at $target"
            return 1
        fi
    elif [ -d "$target" ]; then
        echo "Removing existing directory at $target"
        if ! rm -rf "$target"; then
            echo "Warning: failed to remove existing directory at $target"
            return 1
        fi
    elif [ -e "$target" ]; then
        echo "Warning: $target exists and is not a symlink or directory. Skipping."
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

sync_codex_skill_links() {
    local source_dir="$1"
    local target_dir="$2"
    local skill_path
    local skill_name
    local target_path

    ensure_directory "$target_dir" || return 1

    for target_path in "$target_dir"/*; do
        if [ ! -L "$target_path" ]; then
            continue
        fi

        echo "Removing Codex skill link at $target_path"
        rm "$target_path" || return 1
    done

    for skill_path in "$source_dir"/*; do
        if [ ! -d "$skill_path" ]; then
            continue
        fi

        skill_name="$(basename "$skill_path")"
        create_symlink "$skill_path" "$target_dir/$skill_name"
    done
}

# Legacy slash-command links are intentionally removed. Claude invokes skills
# with /skill-name, and Codex reads the same skills from ~/.codex/skills.
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
    remove_path "$CLAUDE_SKILLS_TARGET"
    create_symlink "$SKILLS_DIR" "$CLAUDE_SKILLS_TARGET"
fi

if [ "$LINK_SKILLS" = true ] && [ "$LINK_CODEX" = true ]; then
    sync_codex_skill_links "$SKILLS_DIR" "$CODEX_SKILLS_TARGET"
fi

VERCEL_REACT="$(pwd)/.agents/skills/vercel-react-best-practices"
if [ -d "$VERCEL_REACT" ]; then
    create_symlink "$VERCEL_REACT" "$SKILLS_DIR/vercel-react-best-practices"
else
    echo "Warning: Vercel React skill not found. Run: npx skills add vercel-labs/agent-skills -y"
fi

echo "Done!"
