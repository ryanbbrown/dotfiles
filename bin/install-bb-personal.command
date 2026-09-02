#!/usr/bin/env bash
set -u

repo_root="${HOME}/code/bb-personal"

cd -- "${repo_root}"
status=$?
if [ "${status}" -ne 0 ]; then
  printf 'Personal BB installation failed: checkout not found at %s.\n' "${repo_root}" >&2
  if [ -t 0 ]; then
    printf 'Press Return to close.\n' >&2
    IFS= read -r _ || true
  fi
  exit "${status}"
fi

pnpm personal:install
status=$?
if [ "${status}" -ne 0 ]; then
  printf 'Personal BB installation failed with exit status %s.\n' "${status}" >&2
  if [ -t 0 ]; then
    printf 'Press Return to close.\n' >&2
    IFS= read -r _ || true
  fi
  exit "${status}"
fi

osascript -e 'tell application "Terminal" to close front window' &
exit 0
