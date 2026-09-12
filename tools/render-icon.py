#!/usr/bin/env python3
"""Renders the HistFzf extension icons to RGBA PNGs with TRUE alpha.

Pure stdlib (SDF rasterizer + minimal PNG encoder). Icons have
transparent outside-the-rounded-square corners: the previous QuickLook
pipeline composited the SVG against opaque white, which put the glyph
'inside a white box' in light-UI contexts.

This is the single source of truth for icon pixels; the geometry mirrors
icons/icon.svg (viewBox 0 0 128 128):
  rect 6,6 116x116 r30, gradient #1d1e22 -> #101114, border white alpha 0.10
  caret: rounded rect 82,42 16x44 r8, tilted -18 degrees about (64,64)
  streaks: (34,66)-(60,66) width 6 alpha 0.45 ; (40,78)-(66,78) width 6 alpha 0.25

Usage: python3 tools/render-icon.py   (writes icons/icon{16,32,48,128}.png)
"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Palette tokens (match src/overlay/overlay.css surface + the icon master)
BG_TOP = (0x1D, 0x1E, 0x22)
BG_BOTTOM = (0x10, 0x11, 0x14)
GLYPH = (0xF5, 0xF5, 0xF7)
STREAK = (0x8F, 0x8F, 0x98)

# Geometry in 128-unit viewBox coordinates
RECT_CENTER = (64.0, 64.0)
RECT_HALF = 58.0
RECT_RADIUS = 30.0
CARET_CENTER = (90.0, 64.0)   # the caret's axis-aligned center (82..98 × 42..86)
CARET_HALF = (8.0, 22.0)
CARET_RADIUS = 8.0
CARET_ANGLE_DEG = -18.0
STREAKS = (
    (34.0, 66.0, 60.0, 66.0, 6.0, 0.45),
    (40.0, 78.0, 66.0, 78.0, 6.0, 0.25),
)


def clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def mix(dst, src, a: float):
    if a <= 0.0:
        return dst
    return tuple(dst[i] + (src[i] - dst[i]) * a for i in range(3))


def sd_round_rect(px, py, half_x, half_y, r):
    qx = abs(px) - (half_x - r)
    qy = abs(py) - (half_y - r)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def sd_segment(px, py, ax, ay, bx, by):
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    denom = abx * abx + aby * aby
    t = 0.0 if denom == 0.0 else max(0.0, min(1.0, (apx * abx + apy * aby) / denom))
    return math.hypot(px - (ax + t * abx), py - (ay + t * aby))


def paint(px, py, scale):
    """Full A1 design in 128-units; returns (r, g, b, a_float)."""
    dx = px - RECT_CENTER[0]
    dy = py - RECT_CENTER[1]
    d_rect = sd_round_rect(dx, dy, RECT_HALF, RECT_HALF, RECT_RADIUS)
    cov_rect = clamp01(0.5 - d_rect * scale)
    if cov_rect <= 0.0:
        return (0.0, 0.0, 0.0, 0.0)

    t = clamp01((py - 6.0) / (RECT_HALF * 2.0))
    color = (
        BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
        BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
        BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t,
    )

    # hairline border: 2-unit band centered on the rect edge (fades by
    # distance from the BAND edge, not the center — same for all strokes)
    a_border = clamp01(0.5 - (abs(d_rect) - 1.0) * scale) * 0.10
    color = mix(color, (255, 255, 255), a_border)

    # caret, tilted about the tile center
    angle = math.radians(CARET_ANGLE_DEG)
    ca, sa = math.cos(angle), math.sin(angle)
    rel_x = px - RECT_CENTER[0]
    rel_y = py - RECT_CENTER[1]
    rotx = ca * rel_x - sa * rel_y
    roty = sa * rel_x + ca * rel_y
    caret_cx = CARET_CENTER[0] - RECT_CENTER[0]
    caret_cy = CARET_CENTER[1] - RECT_CENTER[1]
    d_caret = sd_round_rect(
        rotx - caret_cx, roty - caret_cy, CARET_HALF[0], CARET_HALF[1], CARET_RADIUS
    )
    a_caret = clamp01(0.5 - d_caret * scale)
    if a_caret > 0.0:
        color = mix(color, GLYPH, a_caret)

    # motion streaks, in tile space (they don't tilt with the caret)
    for (ax, ay, bx, by, width, alpha) in STREAKS:
        d = sd_segment(dx, dy, ax - 64, ay - 64, bx - 64, by - 64)
        half_w = width / 2.0
        a_streak = clamp01(0.5 - (d - half_w) * scale) * alpha
        if a_streak > 0.0:
            color = mix(color, STREAK, a_streak)

    return (color[0], color[1], color[2], 1.0)


def render_size(size: int) -> bytes:
    out = bytearray(size * size * 4)
    scale = size / 128.0
    for y in range(size):
        py = (y + 0.5) / scale
        for x in range(size):
            px = (x + 0.5) / scale
            r, g, b, a = paint(px, py, scale)
            i = (y * size + x) * 4
            out[i] = min(255, max(0, int(r + 0.5)))
            out[i + 1] = min(255, max(0, int(g + 0.5)))
            out[i + 2] = min(255, max(0, int(b + 0.5)))
            out[i + 3] = min(255, max(0, int(a * 255 + 0.5)))
    return bytes(out)


def encode_png(size: int, raw_rgba: bytes) -> bytes:
    def chunk(tag: bytes, body: bytes) -> bytes:
        return (
            struct.pack('>I', len(body))
            + tag
            + body
            + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    stride = size * 4
    raw = b''.join(
        b'\x00' + raw_rgba[y * stride:(y + 1) * stride] for y in range(size)
    )
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )


def main() -> None:
    targets = (
        ('icons/icon128.png', 128),
        ('icons/icon48.png', 48),
        ('icons/icon32.png', 32),
        ('icons/icon16.png', 16),
    )
    for rel, size in targets:
        path = os.path.join(ROOT, rel)
        with open(path, 'wb') as f:
            f.write(encode_png(size, render_size(size)))
        print('wrote', rel, f'({size}x{size}, true alpha)')


if __name__ == '__main__':
    main()
