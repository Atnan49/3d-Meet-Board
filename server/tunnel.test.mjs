import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCloudflaredAsset } from './tunnel.mjs';

test('resolveCloudflaredAsset maps Windows, macOS, and Linux platforms accurately', () => {
  const win64 = resolveCloudflaredAsset('win32', 'x64');
  assert.equal(win64.binName, 'cloudflared.exe');
  assert.equal(win64.isArchive, false);
  assert.ok(win64.url.endsWith('cloudflared-windows-amd64.exe'));

  const win32 = resolveCloudflaredAsset('win32', 'ia32');
  assert.ok(win32.url.endsWith('cloudflared-windows-386.exe'));

  const macArm = resolveCloudflaredAsset('darwin', 'arm64');
  assert.equal(macArm.binName, 'cloudflared');
  assert.equal(macArm.isArchive, true);
  assert.ok(macArm.url.endsWith('cloudflared-darwin-arm64.tgz'));

  const macX64 = resolveCloudflaredAsset('darwin', 'x64');
  assert.ok(macX64.url.endsWith('cloudflared-darwin-amd64.tgz'));

  const linuxX64 = resolveCloudflaredAsset('linux', 'x64');
  assert.equal(linuxX64.isArchive, false);
  assert.ok(linuxX64.url.endsWith('cloudflared-linux-amd64'));

  const linuxArm = resolveCloudflaredAsset('linux', 'arm64');
  assert.ok(linuxArm.url.endsWith('cloudflared-linux-arm64'));

  assert.throws(() => resolveCloudflaredAsset('freebsd', 'x64'));
  assert.throws(() => resolveCloudflaredAsset('linux', 's390x'));
});
