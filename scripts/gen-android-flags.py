#!/usr/bin/env python3
"""Draws the Android app's round location flags from flag-icons' square SVGs (the desktop app's flags):
android/app/src/main/assets/flags/<code>.webp, 96 px, cropped to the circle the app shows them in.
Needs: npm ci (for node_modules/flag-icons), rsvg-convert and Pillow. Run from the repository root."""
import io
import pathlib
import subprocess

from PIL import Image, ImageDraw

src = pathlib.Path('node_modules/flag-icons/flags/1x1')
out = pathlib.Path('android/app/src/main/assets/flags')
out.mkdir(parents=True, exist_ok=True)
size = 96
mask = Image.new('L', (size * 4, size * 4), 0)
ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
mask = mask.resize((size, size), Image.LANCZOS)
count = 0
for svg in sorted(src.glob('*.svg')):
    code = svg.stem.lower()
    if len(code) != 2:
        continue
    png = subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), str(svg)], check=True, capture_output=True).stdout
    img = Image.open(io.BytesIO(png)).convert('RGBA')
    img.putalpha(Image.composite(img.getchannel('A'), Image.new('L', img.size, 0), mask))
    img.save(out / f'{code}.webp', 'WEBP', quality=88, method=6)
    count += 1
print(f'{count} flags in {out}')
