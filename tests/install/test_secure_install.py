"""Offline installer tests using synthetic releases, not actual plugin code."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/secure-install.py'
spec = importlib.util.spec_from_file_location('secure_install', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.commit = 'a' * 40
        self.release = self.home / '.understand-secure/releases' / self.commit
        self.plugin = self.release / 'understand-anything-plugin'
        for rel in ('skills/understand/SKILL.md', 'skills/understand-dashboard/SKILL.md',
                    'agents/project-scanner.md', 'packages/core/dist/index.js',
                    'packages/core/dist/figma/index.js', 'packages/viewer/bin/viewer.mjs',
                    'packages/viewer/dist/index.html', 'packages/viewer/bin/dist/staleness.js'):
            path = self.plugin / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture', encoding='utf-8')
        self.approve()
        self.target = self.home / '.agents/skills/understand'

    def approve(self):
        data = json.dumps({'commit': self.commit, 'entries': module.inventory(self.release)}).encode()
        (self.release / module.MANIFEST).write_bytes(data)
        self.digest = hashlib.sha256(data).hexdigest()

    def cli(self, *args, success=True):
        env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home))
        result = subprocess.run([sys.executable, str(SCRIPT), *args], env=env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)

    def install(self, platform='codex', success=True):
        self.cli(platform, '--commit', self.commit, '--manifest-sha256', self.digest, success=success)

    def test_all_platforms(self):
        self.assertEqual(len(module.PLATFORMS), 15)

        for platform in module.PLATFORMS:
            with self.subTest(platform=platform):
                self.install(platform)

                relative, style = module.PLATFORMS[platform]
                target = self.home / relative

                if style == 'folder':
                    link = target / 'understand-anything'
                    expected = self.plugin / 'skills'
                else:
                    link = target / 'understand'
                    expected = self.plugin / 'skills/understand'

                self.assertTrue(link.exists())
                self.assertEqual(link.resolve(), expected.resolve())

                self.cli('--uninstall', platform)
                self.assertFalse(os.path.lexists(link))

    def test_shared_links_and_uninstall(self):
        self.install()
        self.install('gemini')
        self.cli('--uninstall', 'codex')
        self.assertTrue(self.target.exists())
        self.cli('--uninstall', 'gemini')
        self.assertFalse(os.path.lexists(self.target))
        self.assertFalse(os.path.lexists(self.home / '.understand-anything-plugin'))
        self.assertTrue(self.release.exists())

    def test_conflict_preserved(self):
        self.target.mkdir(parents=True)
        self.install(success=False)
        self.assertTrue(self.target.is_dir())
        self.assertFalse(os.path.lexists(self.home / '.understand-anything-plugin'))

    def test_tampered_release_rejected(self):
        (self.plugin / 'skills/understand/SKILL.md').write_text('tampered')
        self.install(success=False)
        self.assertFalse(os.path.lexists(self.target))

    @unittest.skipIf(os.name == 'nt', 'POSIX security fixture')
    def test_hardlinked_release_rejected(self):
        source = self.plugin / 'skills/understand/SKILL.md'
        os.link(source, self.home / 'external-link.md')
        self.install(success=False)
        self.assertFalse(os.path.lexists(self.target))

    @unittest.skipIf(os.name == 'nt', 'POSIX security fixture')
    def test_hardlinked_manifest_rejected(self):
        os.link(
            self.release / module.MANIFEST,
            self.home / 'external-manifest.json',
        )
        self.install(success=False)

    @unittest.skipIf(os.name == 'nt', 'POSIX permissions fixture')
    def test_modified_permissions_rejected(self):
        source = self.plugin / 'skills/understand/SKILL.md'
        source.chmod(source.stat().st_mode ^ 0o100)
        self.install(success=False)

    @unittest.skipIf(os.name == 'nt', 'POSIX security fixture')
    def test_hardlinked_state_rejected(self):
        self.install()
        os.link(
            self.home / '.understand-secure/installations.json',
            self.home / 'external-state.json',
        )
        self.cli('--uninstall', 'codex', success=False)
        self.assertTrue(self.target.exists())

    def test_uninstall_tampered_release(self):
        self.install()
        source = self.plugin / 'skills/understand/SKILL.md'
        source.write_text('tampered', encoding='utf-8')

        self.cli('--uninstall', 'codex')

        self.assertFalse(os.path.lexists(self.target))
        self.assertFalse(os.path.lexists(
            self.home / '.understand-anything-plugin'
        ))
        self.assertTrue(self.release.exists())

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink fixture')
    def test_uninstall_missing_release(self):
        import shutil
        self.install()
        shutil.rmtree(self.release)
        self.cli('--uninstall', 'codex')
        self.assertFalse(os.path.lexists(self.target))

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink fixture')
    def test_replaced_managed_link_rejected(self):
        self.install()
        alias = self.home / 'alias'
        alias.symlink_to(self.plugin / 'skills/understand')
        self.target.unlink()
        self.target.symlink_to(alias)
        self.cli('--uninstall', 'codex', success=False)
        self.assertEqual(os.readlink(self.target), str(alias))

    @unittest.skipIf(os.name == 'nt', 'POSIX permissions fixture')
    def test_private_state_permissions(self):
        self.install()
        state = self.home / '.understand-secure/installations.json'
        self.assertEqual(state.stat().st_mode & 0o777, 0o600)

    def test_incomplete_managed_inventory_rejected(self):
        self.install()
        state = self.home / '.understand-secure/installations.json'
        data = json.loads(state.read_text())
        del data['codex']['entries']['.understand-anything-plugin']
        state.write_text(json.dumps(data))
        self.cli('--uninstall', 'codex', success=False)
        self.assertTrue(self.target.exists())

    @unittest.skipIf(os.name == 'nt', 'POSIX permissions fixture')
    def test_group_writable_release_rejected(self):
        self.release.chmod(0o775)
        self.install(success=False)

    @unittest.skipIf(os.name == 'nt', 'POSIX permissions fixture')
    def test_world_writable_file_rejected(self):
        source = self.plugin / 'skills/understand/SKILL.md'
        source.chmod(0o666)
        self.install(success=False)

    @unittest.skipIf(os.name == 'nt', 'POSIX permissions fixture')
    def test_world_writable_directory_rejected(self):
        (self.plugin / 'skills').chmod(0o777)
        self.install(success=False)

    def test_wrong_digest(self):
        self.digest = '0' * 64
        self.install(success=False)

    def test_update_disabled(self):
        self.cli('--update', success=False)

    def test_kiro_configuration(self):
        self.install('kiro')
        config = self.home / '.kiro/agents/understand.json'
        agent = json.loads(config.read_text())
        self.assertEqual(agent['name'], 'understand')
        self.assertEqual(agent['allowedTools'], [])
        self.assertNotIn('subagent', agent['tools'])
        self.assertNotIn('code', agent['tools'])
        self.cli('--uninstall', 'kiro')
        self.assertFalse(config.exists())

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink fixture')
    def test_external_link_rejected(self):
        (self.plugin / 'escape').symlink_to(self.home)
        self.install(success=False)

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink fixture')
    def test_redirected_target_rejected(self):
        outside = self.home / 'outside'
        outside.mkdir()
        (self.home / '.agents').symlink_to(outside, target_is_directory=True)
        self.install(success=False)
        self.assertEqual(list(outside.iterdir()), [])

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink fixture')
    def test_foreign_symlink_preserved(self):
        outside = self.home / 'outside'
        outside.mkdir()
        self.target.parent.mkdir(parents=True)
        self.target.symlink_to(outside, target_is_directory=True)
        self.install(success=False)
        self.assertEqual(self.target.resolve(), outside)


if __name__ == '__main__':
    unittest.main()
