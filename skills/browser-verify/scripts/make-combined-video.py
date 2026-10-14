#!/usr/bin/env python3
"""Join the flow videos into one captioned video, and save frames to check it.

Usage: make-combined-video.py spec.json out.mp4

The spec lists the flows in order. Paths are relative to the spec file. Times are seconds on
the raw recording's clock, as the contact sheet shows them; the script maps them through the
cuts that trim-video.py saved beside each trimmed video.

{
  "title": "ZANE-123: Share no longer sticks on Sharing...",
  "flows": [
    {
      "video": "videos/share.trimmed.mp4",
      "title": "Share a meeting",
      "look_for": "The button shows Sharing..., then Shared.",
      "captions": [{"at": 1.2, "text": "Click Share"}, {"at": 3.4, "text": "Sharing... shows"}],
      "holds": [3.4],
      "existing_bug": false
    }
  ]
}

A caption shows until the next caption starts. A hold freezes the frame at that time for 1.5 s.
Existing-bug flows go last, on a red card.
"""

import json
import subprocess
import sys
import tempfile
import textwrap
from itertools import count
from pathlib import Path

FPS = 30
CARD_SECONDS = 3.0
INTRO_SECONDS = 4.0
HOLD_SECONDS = 1.5
END_HOLD_SECONDS = 2.0
CARD_COLOR = "0x1F2937"
BUG_COLOR = "0xB3261E"
BUG_TITLE = "Existing bug - NOT part of this fix"
HELD = "(frame held)"
CAPTION_LINES = 2
ENCODE = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-video_track_timescale", "90000"]
_ids = count()


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    data = json.loads(out)
    return data["streams"][0]["width"], data["streams"][0]["height"], float(data["format"]["duration"])


def wrap(text, width, size):
    return textwrap.wrap(text, max(10, int(width / (size * 0.55)))) or [""]


def drawtext(tmp, text, size, y, color="white", bold=False, enable=None):
    """One centred line; the text goes through a file so it needs no filter escaping."""
    path = tmp / f"text{next(_ids)}.txt"
    path.write_text(text)
    options = [f"textfile='{path}'", "expansion=none", f"fontsize={size}", f"fontcolor={color}", "x=(w-text_w)/2", f"y={y}"]
    # With fontconfig, fontfile takes a pattern; its colon is escaped for both filter parsing levels.
    options.append("fontfile=Sans\\\\:bold" if bold else "font=Sans")
    if enable:
        options.append(f"enable='{enable}'")
    return "drawtext=" + ":".join(options)


def card(tmp, out, width, height, seconds, color, blocks):
    """Render a card with blocks of (text, size, color, bold), centred as one column."""
    lines = [(line, size, fg, bold) for text, size, fg, bold in blocks for line in wrap(text, width * 0.85, size)]
    heights = [round(size * 1.35) for _, size, _, _ in lines]
    y = (height - sum(heights)) // 2
    filters = []
    for (line, size, fg, bold), line_height in zip(lines, heights):
        if line:
            filters.append(drawtext(tmp, line, size, y, fg, bold))
        y += line_height
    ffmpeg("-f", "lavfi", "-i", f"color=c={color}:s={width}x{height}:r={FPS}:d={seconds}", "-vf", ",".join(filters) or "null", *ENCODE, str(out))


def load_cuts(video):
    sidecar = video.with_suffix(".cuts.json")
    return json.loads(sidecar.read_text())["cuts"] if sidecar.exists() else []


def to_trimmed(t, cuts):
    return t - sum(min(max(t - start, 0), end - start) for start, end in cuts)


def caption_spans(captions, windows, total):
    """Split the flow into spans that each show one label: the latest caption, marked during a hold."""
    bounds = sorted({0.0, total, *[at for at, _ in captions], *[t for window in windows for t in window]})
    spans = []
    for start, end in zip(bounds, bounds[1:]):
        text = next((text for at, text in reversed(captions) if at <= start + 1e-6), "")
        if any(hold_start - 1e-6 <= start < hold_end for hold_start, hold_end in windows):
            text = f"{text}  {HELD}" if text else HELD
        if spans and spans[-1][2] == text:
            spans[-1] = (spans[-1][0], end, text)
        elif end - start > 1e-6:
            spans.append((start, end, text))
    return [span for span in spans if span[2]]


def flow_part(tmp, out, flow, video, width, video_height, bar_height, size):
    _, _, duration = probe(video)
    cuts = load_cuts(video)
    # A hold needs at least one frame before it to freeze.
    holds = sorted(min(max(to_trimmed(t, cuts), 1 / FPS), duration) for t in flow.get("holds", []))
    pieces = list(zip([0.0, *holds], [*holds, duration]))
    graph = [f"[0:v]split={len(pieces)}" + "".join(f"[s{i}]" for i in range(len(pieces)))]
    for i, (start, end) in enumerate(pieces):
        pad = HOLD_SECONDS if i < len(holds) else END_HOLD_SECONDS
        graph.append(f"[s{i}]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={pad}[p{i}]")

    def shift(t):
        return t + HOLD_SECONDS * sum(1 for hold in holds if hold < t - 1e-6)

    total = duration + HOLD_SECONDS * len(holds) + END_HOLD_SECONDS
    captions = sorted((shift(to_trimmed(c["at"], cuts)), c["text"]) for c in flow.get("captions", []))
    windows = [(shift(hold), shift(hold) + HOLD_SECONDS) for hold in holds]
    spans = caption_spans(captions, windows, total)

    chain = [
        "".join(f"[p{i}]" for i in range(len(pieces))) + f"concat=n={len(pieces)}:v=1:a=0",
        f"fps={FPS}",
        f"scale={width}:{video_height}:force_original_aspect_ratio=decrease",
        f"pad={width}:{video_height + bar_height}:(ow-iw)/2:({video_height}-ih)/2:black",
    ]
    line_height = round(size * 1.3)
    for start, end, text in spans:
        lines = wrap(text, width * 0.94, size)
        if len(lines) > CAPTION_LINES:
            raise SystemExit(f'Caption too long for {CAPTION_LINES} lines in "{flow["title"]}": {text}')
        y = video_height + (bar_height - line_height * len(lines)) // 2
        for line in lines:
            chain.append(drawtext(tmp, line, size, y, enable=f"gte(t,{start:.3f})*lt(t,{end:.3f})"))
            y += line_height
    graph.append(",".join(chain))
    ffmpeg("-i", str(video), "-filter_complex", ";".join(graph), "-t", f"{total:.3f}", *ENCODE, str(out))
    return total, spans


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    spec_path, out = Path(sys.argv[1]), Path(sys.argv[2])
    filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, check=True).stdout
    if " drawtext " not in filters:
        raise SystemExit("ffmpeg on PATH has no drawtext filter. On macOS: brew install ffmpeg-full, then put /opt/homebrew/opt/ffmpeg-full/bin first on PATH.")

    spec = json.loads(spec_path.read_text())
    flows = [f for f in spec["flows"] if not f.get("existing_bug")] + [f for f in spec["flows"] if f.get("existing_bug")]
    videos = [spec_path.parent / f["video"] for f in flows]
    width, video_height, _ = probe(videos[0])
    bar_height = 2 * round(video_height * 0.07)  # x264 needs an even height
    height = video_height + bar_height
    big, small = round(height * 0.06), round(height * 0.037)

    tmp = Path(tempfile.mkdtemp(prefix="combined-"))
    parts, timeline, clock = [], [], 0.0

    def add(path, seconds, label):
        nonlocal clock
        parts.append(path)
        timeline.append((clock, clock + seconds, label))
        clock += seconds

    listing = [(f"{i}. {f['title']}" + (" (existing bug)" if f.get("existing_bug") else ""), small, "white", False) for i, f in enumerate(flows, 1)]
    card(tmp, tmp / "intro.mp4", width, height, INTRO_SECONDS, CARD_COLOR, [(spec["title"], big, "white", True), ("", small, "white", False), *listing])
    add(tmp / "intro.mp4", INTRO_SECONDS, "intro")

    for i, (flow, video) in enumerate(zip(flows, videos), 1):
        look_for = ("Look for: " + flow["look_for"], small, "white", False)
        if flow.get("existing_bug"):
            blocks = [(BUG_TITLE, big, "white", True), ("", small, "white", False), (flow["title"], small, "white", True), look_for]
        else:
            blocks = [(f"Flow {i} of {len(flows)}", small, "0x9CA3AF", False), (flow["title"], big, "white", True), ("", small, "white", False), look_for]
        card(tmp, tmp / f"card{i}.mp4", width, height, CARD_SECONDS, BUG_COLOR if flow.get("existing_bug") else CARD_COLOR, blocks)
        add(tmp / f"card{i}.mp4", CARD_SECONDS, f"flow{i}-card")
        start = clock
        seconds, spans = flow_part(tmp, tmp / f"flow{i}.mp4", flow, video, width, video_height, bar_height, small)
        add(tmp / f"flow{i}.mp4", seconds, f"flow{i}")
        timeline += [(start + a, start + b, f"flow{i}-caption{n}") for n, (a, b, _) in enumerate(spans, 1)]

    concat = tmp / "parts.txt"
    concat.write_text("".join(f"file '{part}'\n" for part in parts))
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(out))

    frames = out.with_name(out.stem + "-frames")
    frames.mkdir(exist_ok=True)
    timeline.sort()
    for n, (start, end, label) in enumerate(timeline, 1):
        print(f"{start:7.2f} - {end:7.2f}  {label}")
        # A whole flow gets its middle frame; a card or caption gets a frame near its start.
        at = (start + end) / 2 if "-" not in label and label != "intro" else start + min(0.6, (end - start) / 2)
        ffmpeg("-ss", f"{at:.3f}", "-i", str(out), "-frames:v", "1", str(frames / f"{n:02d}-{label}.png"))
    print(f"{out} ({clock:.1f}s), frames in {frames}")


if __name__ == "__main__":
    main()
