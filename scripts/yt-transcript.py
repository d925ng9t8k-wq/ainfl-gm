#!/usr/bin/env python3
"""
yt-transcript.py — YouTube transcript reader for 9

Tier 1: youtube-transcript-api (fast, free, no download)
Tier 2: yt-dlp + openai-whisper (fallback when captions unavailable)

Usage:
    python3 yt-transcript.py <youtube_url>
    python3 yt-transcript.py <youtube_url> --timestamps   (include timestamps)
    python3 yt-transcript.py <youtube_url> --model large  (whisper model size)
"""

import sys
import os
import re
import argparse
import subprocess
import tempfile


def extract_video_id(url):
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:v=|/v/|youtu\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def tier1_transcript_api(video_id, include_timestamps=False):
    """Attempt to pull transcript via youtube-transcript-api (v1.x instance API)."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        api = YouTubeTranscriptApi()
        transcript_list = api.list(video_id)

        # Prefer manually created English, then auto-generated, then any + translate
        transcript = None
        try:
            transcript = transcript_list.find_manually_created_transcript(['en', 'en-US', 'en-GB'])
        except Exception:
            pass

        if transcript is None:
            try:
                transcript = transcript_list.find_generated_transcript(['en', 'en-US', 'en-GB'])
            except Exception:
                pass

        if transcript is None:
            # Try any available transcript and translate to English
            try:
                first = next(iter(transcript_list))
                if first.is_translatable:
                    transcript = first.translate('en')
                else:
                    transcript = first
            except Exception:
                pass

        if transcript is None:
            return None, "No transcript available"

        data = transcript.fetch()

        if include_timestamps:
            lines = []
            for entry in data:
                t = int(entry.start)
                h, rem = divmod(t, 3600)
                m, s = divmod(rem, 60)
                ts = f"[{h:02d}:{m:02d}:{s:02d}]" if h else f"[{m:02d}:{s:02d}]"
                lines.append(f"{ts} {entry.text.strip()}")
            return '\n'.join(lines), None
        else:
            text = ' '.join(entry.text.strip() for entry in data)
            # Clean up extra whitespace
            text = re.sub(r'\s+', ' ', text).strip()
            return text, None

    except ImportError:
        return None, "youtube-transcript-api not installed"
    except Exception as e:
        return None, str(e)


def tier2_yt_dlp_whisper(url, whisper_model='base', include_timestamps=False):
    """Fallback: download audio with yt-dlp, transcribe with Whisper."""
    import whisper
    import json

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, 'audio.mp3')

        # Download audio only
        print("[yt-transcript] Downloading audio via yt-dlp...", file=sys.stderr)
        result = subprocess.run(
            [
                'yt-dlp',
                '--no-playlist',
                '-x',                          # extract audio
                '--audio-format', 'mp3',
                '--audio-quality', '5',        # medium quality — enough for speech
                '-o', audio_path,
                url
            ],
            capture_output=True,
            text=True
        )

        if result.returncode != 0:
            return None, f"yt-dlp failed: {result.stderr.strip()}"

        if not os.path.exists(audio_path):
            # yt-dlp may add extension — find it
            candidates = [f for f in os.listdir(tmpdir) if f.startswith('audio')]
            if not candidates:
                return None, "yt-dlp produced no output file"
            audio_path = os.path.join(tmpdir, candidates[0])

        # Transcribe with Whisper
        print(f"[yt-transcript] Transcribing with Whisper ({whisper_model} model)...", file=sys.stderr)
        model = whisper.load_model(whisper_model)
        result = model.transcribe(audio_path, verbose=False)

        if include_timestamps:
            lines = []
            for seg in result.get('segments', []):
                t = int(seg['start'])
                h, rem = divmod(t, 3600)
                m, s = divmod(rem, 60)
                ts = f"[{h:02d}:{m:02d}:{s:02d}]" if h else f"[{m:02d}:{s:02d}]"
                lines.append(f"{ts} {seg['text'].strip()}")
            return '\n'.join(lines), None
        else:
            text = result.get('text', '').strip()
            return text, None


def main():
    parser = argparse.ArgumentParser(
        description='Pull transcript from a YouTube video.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('url', help='YouTube video URL')
    parser.add_argument('--timestamps', action='store_true', help='Include timestamps in output')
    parser.add_argument('--model', default='base',
                        choices=['tiny', 'base', 'small', 'medium', 'large'],
                        help='Whisper model size for fallback transcription (default: base)')
    parser.add_argument('--force-whisper', action='store_true',
                        help='Skip tier 1, go straight to yt-dlp + Whisper')
    parser.add_argument('--verbose', action='store_true', help='Show progress info on stderr')

    args = parser.parse_args()

    video_id = extract_video_id(args.url)
    if not video_id:
        print(f"ERROR: Could not parse video ID from URL: {args.url}", file=sys.stderr)
        sys.exit(1)

    if args.verbose:
        print(f"[yt-transcript] Video ID: {video_id}", file=sys.stderr)

    transcript = None
    error = None

    # Tier 1: youtube-transcript-api
    if not args.force_whisper:
        if args.verbose:
            print("[yt-transcript] Tier 1: Trying youtube-transcript-api...", file=sys.stderr)
        transcript, error = tier1_transcript_api(video_id, args.timestamps)
        if transcript:
            if args.verbose:
                print("[yt-transcript] Tier 1 success.", file=sys.stderr)
        else:
            if args.verbose:
                print(f"[yt-transcript] Tier 1 failed: {error}", file=sys.stderr)
                print("[yt-transcript] Tier 2: Falling back to yt-dlp + Whisper...", file=sys.stderr)

    # Tier 2: yt-dlp + Whisper
    if transcript is None:
        transcript, error = tier2_yt_dlp_whisper(args.url, args.model, args.timestamps)
        if transcript:
            if args.verbose:
                print("[yt-transcript] Tier 2 success.", file=sys.stderr)
        else:
            print(f"ERROR: Both methods failed. Last error: {error}", file=sys.stderr)
            sys.exit(1)

    print(transcript)


if __name__ == '__main__':
    main()
