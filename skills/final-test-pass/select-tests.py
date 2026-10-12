#!/usr/bin/env python3
"""Select same-package unit tests importing changed files from a stack base."""
import argparse
import ast
import json
import re
import subprocess
from collections import defaultdict, deque
from pathlib import Path

ROOT = Path.cwd()
TS_EXT = ('.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs')
IMPORTS = re.compile(r'(?:\b(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?|\brequire\s*\(|\bimport\s*\()\s*[\'\"]([^\'\"]+)[\'\"]', re.S)


def git(*args):
    return subprocess.check_output(['git', *args], text=True).splitlines()


def owner(path):
    for parent in path.parents:
        if (ROOT / parent / 'package.json').is_file() or (ROOT / parent / 'pyproject.toml').is_file():
            return parent
    return None


def unit(path):
    s = str(path).lower()
    if any(x in s for x in ('/e2e/', '/integration/', '/eval/', '/live/', '/docker/', '/fixtures/')):
        return False
    if any(x in path.stem.lower() for x in ('e2e', 'live_', 'docker', 'integration')):
        return False
    if path.suffix == '.py':
        return path.name.startswith('test_') or path.name.endswith('_test.py')
    return re.search(r'\.(test|spec)\.[cm]?[jt]sx?$', path.name) is not None


def config_paths(pkg):
    cfg = ROOT / pkg / 'tsconfig.json'
    if not cfg.exists():
        return {}
    text = cfg.read_text()
    text = re.sub(r'/\*.*?\*/|^\s*//[^\n]*', '', text, flags=re.S | re.M)
    text = re.sub(r',\s*([}\]])', r'\1', text)
    try:
        return json.loads(text).get('compilerOptions', {}).get('paths', {})
    except ValueError:
        return {}


def ts_edges(path, pkg, files, aliases):
    try:
        text = (ROOT / path).read_text()
    except (OSError, UnicodeError):
        return set()
    out = set()
    for spec in IMPORTS.findall(text):
        bases = []
        if spec.startswith('.'):
            bases.append(path.parent / spec)
        for key, targets in aliases.items():
            if '*' in key:
                before, after = key.split('*', 1)
                if not (spec.startswith(before) and spec.endswith(after)):
                    continue
                middle = spec[len(before):len(spec)-len(after) if after else None]
            elif key == spec:
                middle = None
            else:
                continue
            for target in targets:
                bases.append(pkg / target.replace('*', middle or ''))
        for base in bases:
            base = Path(__import__('os').path.normpath(base))
            for candidate in [base, *[Path(str(base) + ext) for ext in TS_EXT], *[base / ('index' + ext) for ext in TS_EXT]]:
                if candidate in files and owner(candidate) == pkg:
                    out.add(candidate)
    return out


def py_edges(path, pkg, modules):
    try:
        tree = ast.parse((ROOT / path).read_text())
    except (SyntaxError, OSError, UnicodeError):
        return set()
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                parent = path.parent.relative_to(pkg).parts
                prefix = parent[:len(parent) - node.level + 1]
                base = '.'.join((*prefix, *(node.module or '').split('.'))).strip('.')
            else:
                base = node.module or ''
            names = [base, *[base + '.' + alias.name for alias in node.names]]
        else:
            continue
        for name in names:
            out.update(modules.get(name, ()))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('base', help='stack base commit, not the first branch commit')
    parser.add_argument('--language', choices=('ts', 'python', 'all'), default='all')
    args = parser.parse_args()
    changed = {Path(x) for x in git('diff', '--name-only', '--diff-filter=ACMR', args.base, 'HEAD')}
    tracked = {Path(x) for x in git('ls-files')}
    owners = {owner(p) for p in changed if p in tracked}
    for pkg in sorted(p for p in owners if p is not None):
        files = {p for p in tracked if p.is_relative_to(pkg) and owner(p) == pkg and p.suffix in (*TS_EXT, '.py') and 'node_modules' not in p.parts}
        aliases = config_paths(pkg)
        modules = defaultdict(set)
        for file in files:
            if file.suffix == '.py':
                rel = file.relative_to(pkg).with_suffix('')
                parts = rel.parts[:-1] if rel.name == '__init__' else rel.parts
                modules['.'.join(parts)].add(file)
                if parts and parts[0] == 'src':
                    modules['.'.join(parts[1:])].add(file)
        reverse = defaultdict(set)
        for path in files:
            if path.suffix == '.py':
                if args.language == 'ts':
                    continue
                deps = py_edges(path, pkg, modules)
            else:
                if args.language == 'python':
                    continue
                deps = ts_edges(path, pkg, files, aliases)
            for dep in deps:
                reverse[dep].add(path)
        seeds = changed & files
        reached = set(seeds)
        queue = deque(seeds)
        while queue:
            for importer in reverse[queue.popleft()]:
                if importer not in reached:
                    reached.add(importer)
                    queue.append(importer)
        for path in sorted(reached):
            if unit(path) and (args.language == 'all' or (path.suffix == '.py') == (args.language == 'python')):
                print(path)


if __name__ == '__main__':
    main()
