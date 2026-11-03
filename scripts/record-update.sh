#!/usr/bin/env bash
# Record the screen with your voice, shrink it, and post it into a subscriber's OMSKing Report chat as the platform.
#
#   scripts/record-update.sh                      record until Ctrl+C (or 10 min), then send
#   scripts/record-update.sh -t 90 -s "Surat"     stop after 90 s, send to the subscriber whose name contains "Surat"
#   scripts/record-update.sh -m "Label fix done"  caption for the chat message
#   scripts/record-update.sh -n                   record and keep the file, do not send
#   scripts/record-update.sh -f clip.mov          send an existing recording instead of recording a new one
#
# Login and defaults come from the environment or scripts/record-update.local (git-ignored):
#   OMS_UPDATE_EMAIL, OMS_UPDATE_PASSWORD, OMS_UPDATE_SUBSCRIBER, OMS_API_BASE, OMS_UPDATE_MAX_SEC
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/scripts/record-update.local"
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && source "$CONFIG"

API="${OMS_API_BASE:-http://localhost:5002/api/v1}"
SUBSCRIBER="${OMS_UPDATE_SUBSCRIBER:-Leheriya}"
MAX_SEC="${OMS_UPDATE_MAX_SEC:-600}"
OUT_DIR="$ROOT/recordings"
LIMIT_MB=48
CAPTION=""
SEND=1
SOURCE=""

usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while getopts "t:s:m:f:nh" opt; do
  case "$opt" in
    t) MAX_SEC="$OPTARG" ;;
    s) SUBSCRIBER="$OPTARG" ;;
    m) CAPTION="$OPTARG" ;;
    f) SOURCE="$OPTARG" ;;
    n) SEND=0 ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ '$1' is not installed"; exit 1; }; }
need ffmpeg; need ffprobe; need curl; need node
[ -n "$SOURCE" ] || need screencapture

WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# Reads one field from JSON on stdin; prints nothing when it is missing.
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));if(v!=null)process.stdout.write(String(v));}catch{}})' "$1"; }

TENANT_ID=""
TENANT_NAME=""

# Logs in and picks the subscriber thread. The token only ever sits in a 0600 header file, never on the command line.
connect() {
  if [ -z "${OMS_UPDATE_EMAIL:-}" ] || [ -z "${OMS_UPDATE_PASSWORD:-}" ]; then
    echo "✗ Set OMS_UPDATE_EMAIL and OMS_UPDATE_PASSWORD (platform admin login) in $CONFIG"
    exit 1
  fi
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API" || true)" = "000" ]; then
    echo "✗ The OMSKing backend is not reachable at $API — start it with 'make run'"
    exit 1
  fi
  local login token
  login="$(E="$OMS_UPDATE_EMAIL" P="$OMS_UPDATE_PASSWORD" node -e 'process.stdout.write(JSON.stringify({email:process.env.E,password:process.env.P}))' \
    | curl -s --max-time 15 -X POST "$API/auth/login" -H 'content-type: application/json' --data-binary @-)"
  token="$(printf '%s' "$login" | field data.accessToken)"
  if [ -z "$token" ]; then
    echo "✗ Login failed: $(printf '%s' "$login" | field message)"
    exit 1
  fi
  umask 077
  printf 'authorization: Bearer %s\n' "$token" > "$WORK/auth"
  local threads pick
  threads="$(curl -s --max-time 15 -H @"$WORK/auth" "$API/support/threads")"
  pick="$(printf '%s' "$threads" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const rows=(JSON.parse(s).data||[]);const q=process.argv[1].toLowerCase();
      const hits=rows.filter(r=>r.tenantName.toLowerCase().includes(q));
      if(hits.length===1){process.stdout.write(hits[0].tenantId+"\t"+hits[0].tenantName);return;}
      process.stderr.write((hits.length?"More than one":"No")+" subscriber matches \""+process.argv[1]+"\". Subscribers: "+rows.map(r=>r.tenantName).join(", ")+"\n");
      process.exit(1);
    })' "$SUBSCRIBER")" || { echo "✗ Pick one with -s \"name\""; exit 1; }
  TENANT_ID="${pick%%$'\t'*}"
  TENANT_NAME="${pick#*$'\t'}"
}

if [ "$SEND" = 1 ]; then
  connect
  echo "→ Will send to: $TENANT_NAME (Report chat)"
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
RAW="$SOURCE"
if [ -z "$RAW" ]; then
  RAW="$OUT_DIR/update-$STAMP.mov"
  echo "● Recording the screen and your microphone (stops after ${MAX_SEC}s). Press Ctrl+C or any key to stop."
  trap ':' INT
  screencapture -v -g -k -C -x -V"$MAX_SEC" "$RAW" || true
  trap - INT
  if [ ! -s "$RAW" ]; then
    echo "✗ Nothing was recorded. macOS has probably blocked it:"
    echo "  System Settings → Privacy & Security → Screen & System Audio Recording → turn on the app running this command (Cursor or Terminal)"
    echo "  System Settings → Privacy & Security → Microphone → turn on the same app, then quit and reopen it"
    exit 1
  fi
fi
[ -s "$RAW" ] || { echo "✗ $RAW not found"; exit 1; }

MP4="$OUT_DIR/update-$STAMP.mp4"
echo "… Compressing"
ffmpeg -hide_banner -loglevel error -y -i "$RAW" \
  -vf "scale='min(1600,iw)':-2,fps=15" -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -ac 1 -movflags +faststart "$MP4"
DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MP4" | cut -d. -f1)"
DURATION="${DURATION:-0}"

size_mb() { echo $(( $(stat -f%z "$1") / 1048576 )); }
if [ "$(size_mb "$MP4")" -ge "$LIMIT_MB" ] && [ "$DURATION" -gt 0 ]; then
  KBPS=$(( LIMIT_MB * 8192 * 9 / 10 / DURATION - 96 ))
  [ "$KBPS" -lt 150 ] && KBPS=150
  echo "… Still too big for the chat (${LIMIT_MB}MB); re-encoding at ${KBPS}kbps"
  ffmpeg -hide_banner -loglevel error -y -i "$RAW" \
    -vf "scale='min(1280,iw)':-2,fps=12" -c:v libx264 -preset veryfast -b:v "${KBPS}k" -maxrate "${KBPS}k" -bufsize "$(( KBPS * 2 ))k" \
    -pix_fmt yuv420p -c:a aac -b:a 64k -ac 1 -movflags +faststart "$MP4"
fi
if [ "$(size_mb "$MP4")" -ge 50 ]; then
  echo "✗ $MP4 is $(size_mb "$MP4")MB; the chat takes videos up to 50MB. Record a shorter clip (-t seconds)."
  exit 1
fi
[ -z "$SOURCE" ] && rm -f "$RAW"
echo "✓ Saved $MP4 ($(size_mb "$MP4")MB, ${DURATION}s)"

[ "$SEND" = 1 ] || exit 0

connect
CAPTION="${CAPTION:-Project update · $(date '+%d %b %Y, %H:%M')}"
echo "… Sending to $TENANT_NAME"
RESULT="$(curl -s --max-time 600 -X POST "$API/support/threads/$TENANT_ID/messages" -H @"$WORK/auth" \
  --form-string "text=$CAPTION" -F "durationSec=$DURATION" -F "file=@$MP4;type=video/mp4")"
MESSAGE_ID="$(printf '%s' "$RESULT" | field data.id)"
if [ -z "$MESSAGE_ID" ]; then
  echo "✗ Not sent: $(printf '%s' "$RESULT" | field message). The file is kept at $MP4; resend with: scripts/record-update.sh -f \"$MP4\""
  exit 1
fi
echo "✓ Sent to $TENANT_NAME's Report chat (message $MESSAGE_ID). They see it under Report in the OMSKing app."
