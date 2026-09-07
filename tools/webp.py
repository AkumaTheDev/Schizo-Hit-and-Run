"""Write WebP twins for the converted game textures.

Textures at or below 256 px are stored losslessly, which halves the PNG size
without changing a pixel. Larger remastered surfaces use quality 90, which is
roughly an eighth of the PNG size. The browser prefers the .webp file and falls
back to the .png when a twin is missing.
"""
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from PIL import Image

ASSETS = Path(__file__).resolve().parent.parent / 'public' / 'assets'
FOLDERS = ['textures', 'remaster']

def convert(png: Path) -> int:
    webp = png.with_suffix('.webp')
    if webp.exists() and webp.stat().st_mtime >= png.stat().st_mtime:
        return webp.stat().st_size
    with Image.open(png) as image:
        image = image.convert('RGBA') if image.mode != 'RGBA' else image
        if max(image.size) <= 256:
            image.save(webp, 'WEBP', lossless=True, quality=100, method=6)
        else:
            image.save(webp, 'WEBP', quality=90, method=6)
    return webp.stat().st_size

def main() -> None:
    files = [p for folder in FOLDERS for p in sorted((ASSETS / folder).glob('*.png'))]
    before = sum(p.stat().st_size for p in files)
    with ProcessPoolExecutor() as pool:
        after = sum(pool.map(convert, files, chunksize=16))
    print(f'{len(files)} textures: {before:,} bytes of PNG, {after:,} bytes of WebP')

if __name__ == '__main__':
    sys.exit(main())
