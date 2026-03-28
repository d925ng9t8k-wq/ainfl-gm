#!/usr/bin/env bash
# youtube-reader.sh — 9's YouTube transcript reader
#
# Usage:
#   ./youtube-reader.sh <youtube_url>
#   ./youtube-reader.sh <youtube_url> --timestamps
#   ./youtube-reader.sh <youtube_url> --model small   (whisper model: tiny/base/small/medium/large)
#   ./youtube-reader.sh <youtube_url> --force-whisper  (skip caption API, go straight to audio)
#
# Tier 1: youtube-transcript-api (instant, no download)
# Tier 2: yt-dlp + openai-whisper (for videos without captions)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/yt-transcript.py"

# ─── Colors for stderr output ────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

log()  { echo -e "${GREEN}[youtube-reader]${NC} $*" >&2; }
warn() { echo -e "${YELLOW}[youtube-reader]${NC} $*" >&2; }
err()  { echo -e "${RED}[youtube-reader] ERROR:${NC} $*" >&2; }

# ─── Argument parsing ────────────────────────────────────────────────────────
URL=""
EXTRA_ARGS=()

if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <youtube_url> [--timestamps] [--model tiny|base|small|medium|large] [--force-whisper]" >&2
    exit 1
fi

URL="$1"
shift
EXTRA_ARGS=("$@")

# ─── Dependency checks ───────────────────────────────────────────────────────
check_and_install_deps() {
    local missing=0

    # Python 3
    if ! command -v python3 &>/dev/null; then
        err "python3 not found. Install via: brew install python3"
        missing=1
    fi

    # pip3
    if ! command -v pip3 &>/dev/null; then
        warn "pip3 not found — will attempt install with python3 -m pip"
    fi

    # youtube-transcript-api
    if ! python3 -c "import youtube_transcript_api" &>/dev/null; then
        log "Installing youtube-transcript-api..."
        python3 -m pip install youtube-transcript-api --break-system-packages --quiet 2>/dev/null \
            || pip3 install youtube-transcript-api --break-system-packages --quiet
    fi

    # yt-dlp
    if ! command -v yt-dlp &>/dev/null; then
        log "Installing yt-dlp via brew..."
        brew install yt-dlp >&2
    fi

    # ffmpeg (required by Whisper and yt-dlp audio extraction)
    if ! command -v ffmpeg &>/dev/null; then
        log "Installing ffmpeg via brew..."
        brew install ffmpeg >&2
    fi

    # openai-whisper (only needed if tier 1 fails, but install proactively)
    if ! python3 -c "import whisper" &>/dev/null; then
        log "Installing openai-whisper (this may take a moment)..."
        python3 -m pip install openai-whisper --break-system-packages --quiet 2>/dev/null \
            || pip3 install openai-whisper --break-system-packages --quiet
    fi

    if [[ $missing -ne 0 ]]; then
        exit 1
    fi
}

# ─── Main ────────────────────────────────────────────────────────────────────
check_and_install_deps

if [[ ! -f "$PYTHON_SCRIPT" ]]; then
    err "Python script not found: $PYTHON_SCRIPT"
    exit 1
fi

log "Fetching transcript for: $URL"

python3 "$PYTHON_SCRIPT" "$URL" "${EXTRA_ARGS[@]}"
