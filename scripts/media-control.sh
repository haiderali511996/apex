#!/bin/bash
# Pause or resume music on this Mac.
#
# Usage: media-control.sh pause|play|toggle|status [--app "Spotify"]
#
# macOS has no public command that controls "whatever is playing", so this
# talks to the players that expose AppleScript: Music, Spotify, VLC and
# QuickTime Player. Only players that are already running are touched
# (asking a closed app a question would launch it). Without --app, `pause`
# pauses every player that is playing, and `play` resumes the one that was
# paused last (or the first running player if none is paused).
#
# Prints one line saying what happened; exits 1 when no player was found.
# Browser audio (YouTube, the in-app background music) is not reachable this way.

set -u

PLAYERS=("Music" "Spotify" "VLC" "QuickTime Player")

action="${1:-}"
shift || true
only=""
if [ "${1:-}" = "--app" ]; then only="${2:-}"; fi

running() { [ "$(osascript -e "application \"$1\" is running" 2>/dev/null)" = "true" ]; }

# Prints "playing" or "paused" for a running player.
state() {
  case "$1" in
    Music|Spotify) osascript -e "tell application \"$1\" to (player state as text)" 2>/dev/null ;;
    VLC) osascript -e 'tell application "VLC" to (playing as text)' 2>/dev/null | sed 's/true/playing/;s/false/paused/' ;;
    "QuickTime Player") osascript -e 'tell application "QuickTime Player" to if (count of documents) > 0 then (playing of document 1 as text)' 2>/dev/null | sed 's/true/playing/;s/false/paused/' ;;
  esac
}

# $2 is "pause" or "play".
send() {
  case "$1" in
    Music|Spotify) osascript -e "tell application \"$1\" to $2" ;;
    VLC) osascript -e "tell application \"VLC\" to $( [ "$2" = pause ] && echo 'if playing then play' || echo 'if not playing then play' )" ;;
    "QuickTime Player") osascript -e "tell application \"QuickTime Player\" to if (count of documents) > 0 then $2 document 1" ;;
  esac >/dev/null 2>&1
}

candidates=()
for p in "${PLAYERS[@]}"; do
  [ -n "$only" ] && [ "$p" != "$only" ] && continue
  running "$p" && candidates+=("$p")
done

if [ ${#candidates[@]} -eq 0 ]; then
  echo "No supported media player is running (looked for: ${only:-${PLAYERS[*]}})."
  exit 1
fi

case "$action" in
  status)
    for p in "${candidates[@]}"; do echo "$p: $(state "$p")"; done
    ;;
  pause)
    done_any=()
    for p in "${candidates[@]}"; do
      if [ "$(state "$p")" = "playing" ]; then send "$p" pause && done_any+=("$p"); fi
    done
    if [ ${#done_any[@]} -gt 0 ]; then echo "Paused: ${done_any[*]}"; else echo "Nothing was playing."; fi
    ;;
  play)
    target=""
    for p in "${candidates[@]}"; do
      if [ "$(state "$p")" = "paused" ]; then target="$p"; fi
    done
    [ -z "$target" ] && target="${candidates[0]}"
    send "$target" play && echo "Playing: $target"
    ;;
  toggle)
    for p in "${candidates[@]}"; do
      if [ "$(state "$p")" = "playing" ]; then exec "$0" pause --app "$p"; fi
    done
    exec "$0" play
    ;;
  *)
    echo "Usage: $0 pause|play|toggle|status [--app \"Spotify\"]" >&2
    exit 2
    ;;
esac
