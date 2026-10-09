#!/usr/bin/env python3
"""Shorten static spans in a screen recording so only UI changes remain.

Usage: trim-video.py in.mp4 out.mp4 [--min-cells 3] [--flicker 4] [--min-freeze 1.0] [--hold 1.0] [--preroll 0.3]
"""

import argparse
import subprocess
from collections import Counter

# Frames are compared at this size, so a changed cell is an 8x8-pixel block of a 1280-wide video.
GRID_W, GRID_H = 160, 80
PIXEL_NOISE = 6
SMALL_UPDATE = 0.01


def probe(path, entry):
    return subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", entry, "-of", "csv=p=0", path],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def changed_cells(path):
    """Return, per frame, the grid cells that changed since the previous frame."""
    size = GRID_W * GRID_H
    ffmpeg = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-i", path, "-vf", f"scale={GRID_W}:{GRID_H}:flags=area,format=gray", "-f", "rawvideo", "-"],
        stdout=subprocess.PIPE,
    )
    frames, previous = [], None
    while len(frame := ffmpeg.stdout.read(size)) == size:
        frames.append([] if previous is None else [i for i, (a, b) in enumerate(zip(frame, previous)) if abs(a - b) > PIXEL_NOISE])
        previous = frame
    if ffmpeg.wait():
        raise SystemExit(f"ffmpeg failed to decode {path}")
    return frames


def static_spans(path, min_cells, flicker, min_freeze):
    """Return (start, end, leads_into_change) for each static span of at least min_freeze seconds."""
    num, den = probe(path, "stream=r_frame_rate").split("/")
    fps = int(num) / int(den)
    frames = changed_cells(path)
    # A cell that changes in many separate small updates is a counter or caret; its changes count as static.
    small, last_change = Counter(), {}
    for index, cells in enumerate(frames):
        if len(cells) < SMALL_UPDATE * GRID_W * GRID_H:
            for cell in cells:
                if last_change.get(cell) != index - 1:
                    small[cell] += 1
                last_change[cell] = index
    # Include neighbouring cells, since a counter's digits shift by a few pixels as they change.
    noisy = {
        (cell // GRID_W + dy) * GRID_W + cell % GRID_W + dx
        for cell, count in small.items()
        if count >= flicker
        for dy in (-1, 0, 1)
        for dx in (-1, 0, 1)
    }
    active = [len([cell for cell in cells if cell not in noisy]) >= min_cells for cells in frames]
    spans, start = [], None
    for index, is_active in enumerate(active + [True]):
        if not is_active and start is None:
            start = index
        elif is_active and start is not None:
            if (index - start) / fps >= min_freeze:
                spans.append((start / fps, index / fps, index < len(active)))
            start = None
    return spans, len(active) / fps


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--min-cells", type=int, default=3, help="changed grid cells a frame needs to count as a change")
    parser.add_argument("--flicker", type=int, default=4, help="small updates after which a cell counts as noise")
    parser.add_argument("--min-freeze", type=float, default=1.0, help="shortest static span to shorten, in seconds")
    parser.add_argument("--hold", type=float, default=1.0, help="seconds to keep after each change")
    parser.add_argument("--preroll", type=float, default=0.3, help="seconds to keep before each change")
    args = parser.parse_args()

    spans, duration = static_spans(args.input, args.min_cells, args.flicker, args.min_freeze)
    cuts = [(start + args.hold, end - (args.preroll if leads else 0)) for start, end, leads in spans]
    cuts = [(start, end) for start, end in cuts if end > start]
    removed = sum(end - start for start, end in cuts)
    print(f"{len(cuts)} static spans cut, {duration:.1f}s -> {duration - removed:.1f}s")

    drop = "+".join(f"between(t,{start:.3f},{end:.3f})" for start, end in cuts) or "0"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", args.input,
            "-vf", f"select='not({drop})',setpts=N/FRAME_RATE/TB",
            "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", args.output,
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
