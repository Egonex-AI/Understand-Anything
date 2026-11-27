#!/usr/bin/env python3
"""Offline activation of a separately prepared and approved release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

PLATFORMS = dict((n, (p, s)) for n, p, s in [
    ('gemini', '.agents/skills', 'per-skill'),
    ('codex', '.agents/skills', 'per-skill'),
    ('opencode', '.agents/skills', 'per-skill'),
    ('pi', '.agents/skills', 'per-skill'),
    ('openclaw', '.openclaw/skills', 'folder'),
    ('antigravity', '.gemini/antigravity/skills', 'folder'),
    ('vibe', '.vibe/skills', 'per-skill'),
    ('vscode', '.copilot/skills', 'per-skill'),
    ('hermes', '.hermes/skills', 'folder'),
    ('cline', '.cline/skills', 'folder'),
    ('kimi', '.kimi-code/skills', 'folder'),
    ('trae', '.trae/skills', 'per-skill'),
    ('nanobot', '.nanobot/workspace/skills', 'per-skill'),
    ('kiro', '.kiro/skills', 'per-skill'),
    ('devin', '.agents/skills', 'per-skill'),
])
HOME = Path.home().resolve()
BASE = HOME / '.understand-secure'
STATE = BASE / 'installations.json'
MANIFEST = 'release-manifest.json'


def fail(message):
    raise ValueError(message)


def exists(p):
    return os.path.lexists(p)


def is_link(p):
    st = p.lstat()
    return stat.S_ISLNK(st.st_mode) or bool(getattr(st, 'st_file_attributes', 0) & 0x400)


def safe_dir(p, create=False):
    # Refuse redirected parent directories, including Windows reparse points.
    for part in reversed([p, *p.parents]):
        if exists(part):
            if is_link(part) or not part.is_dir():
                fail(f'Unsafe directory: {part}')
        elif create:
            part.mkdir(mode=0o700)
        else:
            fail(f'Missing directory: {part}')


def sha(p):
    h = hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def inventory(root):
    if os.name != 'nt' and root.lstat().st_mode & 0o022:
        fail('Release root is writable by group or others')

    result = {}
    def walk_error(error):
        raise error
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        for name in sorted(dirs + files):
            p = Path(directory) / name
            rel = p.relative_to(root).as_posix()
            if rel == MANIFEST:
                continue
            if is_link(p):
                if name in dirs:
                    dirs.remove(name)
                resolved = p.resolve(strict=True)
                if not resolved.is_relative_to(root):
                    fail(f'External release link: {rel}')
                # Record the actual link destination, not just its resolved target.
                result[rel] = {'link': os.readlink(p)}
            elif p.is_file():
                metadata = p.lstat()
                if os.name != 'nt' and metadata.st_mode & 0o022:
                    fail(f'Unsafe release file permissions: {rel}')
                if metadata.st_nlink != 1:
                    fail(f'Hard-linked release file: {rel}')
                result[rel] = {'sha256': sha(p)}
                if os.name != 'nt':
                    result[rel]['mode'] = stat.S_IMODE(metadata.st_mode)
            elif p.is_dir():
                if os.name != 'nt' and p.lstat().st_mode & 0o022:
                    fail(f'Unsafe release directory permissions: {rel}')
                result[rel] = {'directory': True}
                if os.name != 'nt':
                    result[rel]['mode'] = stat.S_IMODE(p.lstat().st_mode)
            else:
                fail(f'Unsupported release entry: {rel}')
    return result


def verify(commit, digest):
    if not re.fullmatch(r'[0-9a-f]{40}', commit or '') or not re.fullmatch(r'[0-9a-f]{64}', digest or ''):
        fail('Provide the approved 40-character commit and independent SHA-256 manifest digest.')
    root = BASE / 'releases' / commit
    safe_dir(root)
    manifest = root / MANIFEST
    if (is_link(manifest) or not manifest.is_file()
            or manifest.lstat().st_nlink != 1):
        fail('Invalid manifest file')
    raw = manifest.read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        fail('Manifest digest mismatch')
    data = json.loads(raw)
    if data != {'commit': commit, 'entries': inventory(root)}:
        fail('Release inventory mismatch')
    plugin = root / 'understand-anything-plugin'
    safe_dir(plugin / 'skills')
    for rel in ('packages/core/dist/index.js', 'packages/core/dist/figma/index.js',
                'packages/viewer/bin/viewer.mjs', 'packages/viewer/dist/index.html',
                'packages/viewer/bin/dist/staleness.js'):
        if not (plugin / rel).is_file():
            fail(f'Missing built release artifact: {rel}')
    return plugin


def load_state():
    if not exists(STATE):
        return {}
    if (is_link(STATE) or not STATE.is_file()
            or STATE.lstat().st_nlink != 1):
        fail('Unsafe state file')
    data = json.loads(STATE.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or not set(data).issubset(PLATFORMS):
        fail('Invalid installation state')
    for entry in data.values():
        if not isinstance(entry, dict) or not re.fullmatch(r'[0-9a-f]{40}', entry.get('commit', '')) or not re.fullmatch(r'[0-9a-f]{64}', entry.get('digest', '')):
            fail('Invalid installation record')
    return data


def plan(platform, plugin):
    relative, style = PLATFORMS[platform]
    target = HOME / relative
    skills = plugin / 'skills'
    safe_dir(skills)
    entries = {HOME / '.understand-anything-plugin': ('link', plugin)}
    if style == 'folder':
        entries[target / 'understand-anything'] = ('link', skills)
    else:
        for child in sorted(skills.iterdir()):
            if child.is_dir() and (child / 'SKILL.md').is_file():
                entries[target / child.name] = ('link', child)
    if platform == 'kiro':
        agent = dict(name='understand', description='Analyze codebase into interactive knowledge graph',
                     prompt=(skills / 'understand/SKILL.md').as_uri(),
                     tools=['read', 'write', 'shell', 'grep', 'glob'],
                     allowedTools=[],
                     resources=[p.as_uri() for p in sorted((plugin / 'agents').glob('*.md'))])
        entries[HOME / '.kiro/agents/understand.json'] = ('file', (json.dumps(agent, indent=2) + '\n').encode())
    return entries


def encode_plan(entries):
    return {
        p.relative_to(HOME).as_posix(): {
            'kind': kind,
            'value': str(value) if kind == 'link' else value.hex(),
        }
        for p, (kind, value) in entries.items()
    }


def decode_plan(platform, record):
    plugin = BASE / 'releases' / record['commit'] / 'understand-anything-plugin'
    skills = plugin / 'skills'
    relative, style = PLATFORMS[platform]
    target = HOME / relative
    raw = record.get('entries')

    if not isinstance(raw, dict) or not raw:
        fail('Missing managed installation inventory')

    result = {}
    for name, entry in raw.items():
        if not isinstance(name, str) or not isinstance(entry, dict):
            fail('Invalid managed entry')

        p = HOME / name
        if p.relative_to(HOME).as_posix() != name or '..' in p.parts:
            fail('Invalid managed destination')

        kind = entry.get('kind')
        value = entry.get('value')
        if not isinstance(value, str):
            fail('Invalid managed value')

        if p == HOME / '.understand-anything-plugin':
            expected = plugin
        elif style == 'folder' and p == target / 'understand-anything':
            expected = skills
        elif style == 'per-skill' and p.parent == target:
            expected = skills / p.name
        elif platform == 'kiro' and p == HOME / '.kiro/agents/understand.json':
            if kind != 'file':
                fail('Invalid managed configuration')
            result[p] = ('file', bytes.fromhex(value))
            continue
        else:
            fail('Unauthorized managed destination')

        if kind != 'link' or Path(value) != expected:
            fail('Invalid managed link')

        result[p] = ('link', expected)

    if HOME / '.understand-anything-plugin' not in result:
        fail('Missing managed plugin link')

    return result


def matches(path, spec):
    kind, value = spec
    if not exists(path):
        return False
    if kind == 'link':
        if not is_link(path):
            return False
        if os.name != 'nt':
            return os.readlink(path) == str(value)
        return path.resolve(strict=False) == value.resolve(strict=False)
    return (
        not is_link(path)
        and path.is_file()
        and path.lstat().st_nlink == 1
        and path.read_bytes() == value
    )


def create(path, spec):
    safe_dir(path.parent, create=True)
    kind, value = spec
    if kind == 'file':
        with path.open('xb') as f:
            f.write(value)
    elif os.name == 'nt':
        # Windows junctions avoid requiring Developer Mode. No user paths in code.
        env = dict(os.environ, UA_INSTALL_LINK=str(path), UA_INSTALL_TARGET=str(value))
        subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                        "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:UA_INSTALL_LINK -Target $env:UA_INSTALL_TARGET | Out-Null"],
                       env=env, check=True)
    else:
        path.symlink_to(value, target_is_directory=True)


def remove(path, spec):
    if not matches(path, spec):
        fail(f'Refusing to remove modified entry: {path}')
    if spec[0] == 'link' and os.name == 'nt' and not path.is_symlink():
        path.rmdir()
    else:
        path.unlink()


def save(state):
    temp = BASE / 'installations.tmp'
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(state, f, indent=2)
        f.write('\n')
    os.replace(temp, STATE)


def operate(args):
    safe_dir(BASE, create=True)
    lock = BASE / 'installer.lock'
    lock.mkdir(mode=0o700)  # Concurrent installer calls fail closed.
    try:
        state = load_state()
        existing = {}
        for platform, record in state.items():
            existing[platform] = decode_plan(platform, record)
        if len({(r['commit'], r['digest']) for r in state.values()}) > 1:
            fail('Conflicting registered releases')

        registered = {}
        for entries in existing.values():
            for p, s in entries.items():
                if p in registered and registered[p] != s:
                    fail('Conflicting managed entries')
                registered[p] = s

        if args.uninstall:
            platform = args.uninstall
            if platform not in state:
                fail('Platform is not registered')
            remaining = {p for k, v in existing.items() if k != platform for p in v}
            todo = {p: s for p, s in existing[platform].items() if p not in remaining}
            for p, s in todo.items():
                safe_dir(p.parent)
                if not matches(p, s):
                    fail(f'Modified or missing managed entry: {p}')
            removed = []
            try:
                for p, s in todo.items():
                    remove(p, s)
                    removed.append((p, s))
                del state[platform]
                save(state)
            except Exception:
                for p, s in reversed(removed):
                    create(p, s)
                raise
            return
        platform = args.platform
        if any(v['commit'] != args.commit or v['digest'] != args.manifest_sha256 for v in state.values()):
            fail('Uninstall all registered platforms before switching releases.')
        plugin = verify(args.commit, args.manifest_sha256)
        desired = plan(platform, plugin)
        owned = {p: s for v in existing.values() for p, s in v.items()}
        for p, s in desired.items():
            safe_dir(p.parent, create=True)
            if exists(p) and (p not in owned or not matches(p, s)):
                fail(f'Unowned or modified destination: {p}')
        created = []
        try:
            for p, s in desired.items():
                if not exists(p):
                    create(p, s)
                    created.append((p, s))
            state[platform] = {
                'commit': args.commit,
                'digest': args.manifest_sha256,
                'entries': encode_plan(desired),
            }
            save(state)
        except Exception:
            for p, s in reversed(created):
                remove(p, s)
            raise
    finally:
        lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', nargs='?', choices=PLATFORMS)
    parser.add_argument('--commit')
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--uninstall', choices=PLATFORMS)
    parser.add_argument('--update', action='store_true')
    args = parser.parse_args()
    if args.update:
        parser.error('Automatic updates disabled; uninstall and activate an approved release.')
    if args.uninstall and (args.platform or args.commit or args.manifest_sha256):
        parser.error('Use --uninstall PLATFORM alone.')
    if not args.uninstall and not args.platform:
        print('\n'.join(f'{i}. {p}' for i, p in enumerate(PLATFORMS, 1)))
        try:
            choice = int(input('Platform number: '))
            if not 1 <= choice <= len(PLATFORMS):
                fail('Invalid platform')
            args.platform = list(PLATFORMS)[choice - 1]
        except (ValueError, EOFError):
            parser.error('Invalid platform')
    try:
        operate(args)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'Installation refused: {exc}\n')
    print('Operation completed.')


if __name__ == '__main__':
    main()
