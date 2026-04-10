#!/bin/bash

# This script symlinks slash commands, agent instructions, and skills to Claude Code and Codex.
#
# For each symlink, the script:
# 1. Removes any existing symlink at the target location
# 2. Warns and skips if a non-symlink file exists (to avoid overwriting real files)
# 3. Creates a new symlink if the target doesn't exist

# Configuration - set to true/false to enable/disable linking
LINK_CLAUDE=true
LINK_CODEX=true
LINK_SKILLS=true

# Source directories (run this script from the repo root)
SLASH_COMMANDS_DIR="$(pwd)/slash-commands"
SKILLS_DIR="$(pwd)/skills"

# Source files - detect which exist
CLAUDE_MD_FILE="$(pwd)/CLAUDE.md"
AGENTS_MD_FILE="$(pwd)/AGENTS.md"

# Determine which source file to use for each target
if [ -f "$CLAUDE_MD_FILE" ] && [ -f "$AGENTS_MD_FILE" ]; then
    # Both exist: use CLAUDE.md for Claude, AGENTS.md for Codex
    CLAUDE_MD_SOURCE="$CLAUDE_MD_FILE"
    AGENTS_MD_SOURCE="$AGENTS_MD_FILE"
elif [ -f "$CLAUDE_MD_FILE" ]; then
    # Only CLAUDE.md exists: use it for both
    CLAUDE_MD_SOURCE="$CLAUDE_MD_FILE"
    AGENTS_MD_SOURCE="$CLAUDE_MD_FILE"
elif [ -f "$AGENTS_MD_FILE" ]; then
    # Only AGENTS.md exists: use it for both
    CLAUDE_MD_SOURCE="$AGENTS_MD_FILE"
    AGENTS_MD_SOURCE="$AGENTS_MD_FILE"
else
    echo "Warning: Neither CLAUDE.md nor AGENTS.md found in $(pwd), so instructions will not be linked."
    CLAUDE_MD_SOURCE=""
    AGENTS_MD_SOURCE=""
fi

# Target paths
CLAUDE_COMMANDS_TARGET="$HOME/.claude/commands"
CLAUDE_MD_TARGET="$HOME/.claude/CLAUDE.md"
CLAUDE_SKILLS_TARGET="$HOME/.claude/skills"
CODEX_PROMPTS_TARGET="$HOME/.codex/prompts"
CODEX_AGENTS_TARGET="$HOME/.codex/AGENTS.md"
CODEX_SKILLS_TARGET="$HOME/.codex/skills"

# Helper function to create a symlink
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

    if [ ! -e "$target" ]; then
        mkdir -p "$(dirname "$target")"
        if ln -s "$source" "$target"; then
            echo "Linked $target -> $source"
        else
            echo "Warning: failed to link $target -> $source"
            return 1
        fi
    fi
}

create_skill_links() {
    local source_dir="$1"
    local target_dir="$2"

    mkdir -p "$target_dir"

    for skill_path in "$source_dir"/*; do
        if [ ! -d "$skill_path" ]; then
            continue
        fi

        local skill_name
        skill_name="$(basename "$skill_path")"
        create_symlink "$skill_path" "$target_dir/$skill_name"
    done
}

# ====================
# Slash Commands
# ====================
if [ "$LINK_CLAUDE" = true ]; then
    create_symlink "$SLASH_COMMANDS_DIR" "$CLAUDE_COMMANDS_TARGET"
fi

if [ "$LINK_CODEX" = true ]; then
    create_symlink "$SLASH_COMMANDS_DIR" "$CODEX_PROMPTS_TARGET"
fi

# ====================
# Instructions (CLAUDE.md / AGENTS.md)
# ====================
if [ "$LINK_CLAUDE" = true ] && [ -n "$CLAUDE_MD_SOURCE" ]; then
    create_symlink "$CLAUDE_MD_SOURCE" "$CLAUDE_MD_TARGET"
fi

if [ "$LINK_CODEX" = true ] && [ -n "$AGENTS_MD_SOURCE" ]; then
    create_symlink "$AGENTS_MD_SOURCE" "$CODEX_AGENTS_TARGET"
fi

# ====================
# Skills
# ====================
if [ "$LINK_SKILLS" = true ] && [ "$LINK_CLAUDE" = true ]; then
    create_symlink "$SKILLS_DIR" "$CLAUDE_SKILLS_TARGET"
fi

if [ "$LINK_SKILLS" = true ] && [ "$LINK_CODEX" = true ]; then
    create_skill_links "$SKILLS_DIR" "$CODEX_SKILLS_TARGET"
fi

# ====================
# npx skills (link specific .agents/skills into skills/)
# ====================
VERCEL_REACT="$(pwd)/.agents/skills/vercel-react-best-practices"
if [ -d "$VERCEL_REACT" ]; then
    create_symlink "$VERCEL_REACT" "$SKILLS_DIR/vercel-react-best-practices"
else
    echo "Warning: Vercel React skill not found. Run: npx skills add vercel-labs/agent-skills -y"
fi

echo "Done!"
