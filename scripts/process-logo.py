"""Remove white background from logo.png and export web/README sizes."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "logo.png"
ASSETS = ROOT / "assets"
PUBLIC = ROOT / "public"

WHITE_THRESHOLD = 235
EDGE_SOFTNESS = 18


def remove_white_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size

    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue

            brightness = (red + green + blue) / 3
            if brightness < WHITE_THRESHOLD:
                continue

            saturation = max(red, green, blue) - min(red, green, blue)
            if saturation > 28:
                continue

            distance = min(
                red - WHITE_THRESHOLD,
                green - WHITE_THRESHOLD,
                blue - WHITE_THRESHOLD,
                255,
            )
            if distance >= EDGE_SOFTNESS:
                pixels[x, y] = (red, green, blue, 0)
            else:
                fade = max(0, min(255, int(255 * (1 - distance / EDGE_SOFTNESS))))
                pixels[x, y] = (red, green, blue, min(alpha, fade))

    bbox = rgba.getbbox()
    return rgba.crop(bbox) if bbox else rgba


def save_resized(image: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    resized = image.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(path, optimize=True)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source image: {SOURCE}")

    transparent = remove_white_background(Image.open(SOURCE))

    ASSETS.mkdir(exist_ok=True)
    (PUBLIC / "assets").mkdir(parents=True, exist_ok=True)

    transparent.save(ASSETS / "logo-transparent.png", optimize=True)
    save_resized(transparent, ASSETS / "logo-banner.png", 512)
    save_resized(transparent, PUBLIC / "assets" / "logo-icon.png", 40)
    save_resized(transparent, PUBLIC / "assets" / "logo-header.png", 56)
    save_resized(transparent, PUBLIC / "favicon-16x16.png", 16)
    save_resized(transparent, PUBLIC / "favicon-32x32.png", 32)
    save_resized(transparent, PUBLIC / "apple-touch-icon.png", 180)

    favicon_sizes = [(16, 16), (32, 32), (48, 48)]
    favicon_images = [
        transparent.resize(size, Image.Resampling.LANCZOS) for size in favicon_sizes
    ]
    favicon_images[0].save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=favicon_sizes,
        append_images=favicon_images[1:],
    )

    print("Generated logo assets:")
    for path in sorted(
        [
            ASSETS / "logo-transparent.png",
            ASSETS / "logo-banner.png",
            PUBLIC / "assets" / "logo-icon.png",
            PUBLIC / "assets" / "logo-header.png",
            PUBLIC / "favicon-16x16.png",
            PUBLIC / "favicon-32x32.png",
            PUBLIC / "apple-touch-icon.png",
            PUBLIC / "favicon.ico",
        ]
    ):
        print(f"  {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
