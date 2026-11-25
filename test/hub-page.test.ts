import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { missingDownloads, render } from '../scripts/hub-page.mjs';

const repo = 'DataCraft-Team/DT-Connect';
const template = fs.readFileSync(path.join(__dirname, '..', 'hub', 'README.md'), 'utf8');

function shotsDir(groups: Record<string, string[]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
  for (const [group, files] of Object.entries(groups)) {
    fs.mkdirSync(path.join(dir, group));
    for (const f of files) fs.writeFileSync(path.join(dir, group, f), '');
  }
  return dir;
}

// The names a release carries (one Android APK for every device since 1.2.1), for a version the page is rendered for.
const releaseFiles = (v: string) => [
  `DT-Connect-Setup-${v}.exe`,
  `DT-Connect-${v}-android-universal.apk`,
  `DT-Connect-${v}-linux-amd64.deb`, `DT-Connect-${v}-linux-arm64.deb`,
  `DT-Connect-${v}-linux-x86_64.rpm`, `DT-Connect-${v}-linux-aarch64.rpm`,
  `DT-Connect-${v}-linux-x64.pacman`, `DT-Connect-${v}-linux-aarch64.pacman`,
  `DT-Connect-${v}-mac-arm64.pkg`, `DT-Connect-${v}-mac-x64.pkg`,
  'SHA256SUMS.txt',
];

describe('download page', () => {
  it('links every download to a file the release has, and nothing is left unfilled', () => {
    const page = render(template, { tag: 'v2.3.4', repo, screenshotsDir: shotsDir({ android: ['01-home.png'] }) });
    expect(missingDownloads(page, { tag: 'v2.3.4', repo, files: releaseFiles('2.3.4') })).toEqual([]);
    expect(page).not.toMatch(/\{\{|<!-- \/?section/);
    expect(page).toContain(`https://github.com/${repo}/releases/download/v2.3.4/DT-Connect-Setup-2.3.4.exe`);
  });

  it('reports a link to an installer the release lacks', () => {
    const page = render(template, { tag: 'v2.3.4', repo, screenshotsDir: shotsDir({}) });
    const files = releaseFiles('2.3.4').filter((f) => !f.endsWith('mac-x64.pkg'));
    expect(missingDownloads(page, { tag: 'v2.3.4', repo, files })).toEqual(['DT-Connect-2.3.4-mac-x64.pkg']);
  });

  it('shows a screenshots section only for a folder that has pictures', () => {
    const page = render(template, { tag: 'v1.0.0', repo, screenshotsDir: shotsDir({ android: ['02-home.png', '01-welcome.png'], desktop: [] }) });
    expect(page).toContain('تصاویر اندروید');
    expect(page).not.toContain('تصاویر ویندوز');
    expect(page.indexOf('screenshots/android/01-welcome.png')).toBeLessThan(page.indexOf('screenshots/android/02-home.png'));
  });
});
