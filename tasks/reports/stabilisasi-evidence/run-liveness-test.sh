#!/bin/bash
# Automated acceptance test for ~/workspace/vm-services/liveness-watchdog.sh
# (stabilization brief 2026-11-24, acceptance: controlled restart).
#
# Everything is stubbed/contained: state lives in a temp dir, the restart
# command is a logging stub, `systemctl` is a PATH stub (only used by the
# script for the ActiveEnterTimestamp grace lookup), and the dead probe
# target is port 9 (discard, connection refused). The live probe target
# is the healthy test instance on port 3107. Production is never touched.
#
# Phases (GRACE_S=0 except phase 6, to isolate variables):
#   1. dead probe runs 1-2   -> ZERO restarts, failures 1 then 2
#   2. dead probe run 3      -> exactly ONE restart, counter reset to 0
#   3. dead probe runs 4-6   -> threshold met again but cooldown (300 s)
#                               suppresses any further restart
#   4. COOLDOWN_S=0 run      -> restart fires again (cooldown expiry path)
#   5. failures=2 on dead, then LIVE probe -> success resets counter to 0
#   6. GRACE_S=60 + fresh service timestamp -> failures NOT counted
set -u
W=/tmp/stab-liveness-test
rm -rf "$W"; mkdir -p "$W/state" "$W/bin"
STUB_LOG="$W/restarts.log"; : >"$STUB_LOG"
export STUB_DIR="$W"
export GRACE_S=0

cat >"$W/bin/restart-stub.sh" <<EOF
#!/bin/bash
echo "restart-called at \$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$STUB_LOG"
EOF
chmod +x "$W/bin/restart-stub.sh"

cat >"$W/bin/systemctl" <<'EOF'
#!/bin/bash
# Stub: only `show -p ActiveEnterTimestamp` is used by the watchdog.
if [ "$1" = "show" ]; then
  if [ -f "$STUB_DIR/fresh" ]; then
    date -u '+%a %Y-%m-%d %H:%M:%S UTC'
  else
    echo "Mon 2026-11-23 00:00:00 UTC"
  fi
fi
exit 0
EOF
chmod +x "$W/bin/systemctl"

WATCHDOG=/home/hatch/workspace/vm-services/liveness-watchdog.sh
DEAD=http://127.0.0.1:9/healthz
LIVE=http://127.0.0.1:3107/healthz

run_probe() {
  PATH="$W/bin:$PATH" STATE_DIR="$W/state" PROBE_URL="$1" \
    RESTART_CMD="$W/bin/restart-stub.sh" "$WATCHDOG"
}
fail_count() {
  if [ -f "$W/state/state.env" ]; then
    grep -o 'consecutive_failures=[0-9]*' "$W/state/state.env" | cut -d= -f2
  else
    echo 0
  fi
}
restarts() { wc -l <"$STUB_LOG" | tr -d ' '; }

PASS=0; FAIL=0
assert() {
  if [ "$2" = "$3" ]; then
    echo "PASS: $1 (=$2)"; PASS=$((PASS + 1))
  else
    echo "FAIL: $1 - got $2, want $3"; FAIL=$((FAIL + 1))
  fi
}

echo "--- phase 1: dead probe, runs 1-2 -> no restart"
run_probe "$DEAD" >/dev/null
assert "run1 restarts" "$(restarts)" 0
assert "run1 failures" "$(fail_count)" 1
run_probe "$DEAD" >/dev/null
assert "run2 restarts" "$(restarts)" 0
assert "run2 failures" "$(fail_count)" 2

echo "--- phase 2: run 3 -> exactly one restart, counter reset"
run_probe "$DEAD" >/dev/null
assert "run3 restarts" "$(restarts)" 1
assert "run3 failures reset" "$(fail_count)" 0

echo "--- phase 3: runs 4-6 inside cooldown -> suppressed"
run_probe "$DEAD" >/dev/null
run_probe "$DEAD" >/dev/null
run_probe "$DEAD" >/dev/null
assert "run6 restarts still" "$(restarts)" 1
assert "run6 failures" "$(fail_count)" 3

echo "--- phase 4: COOLDOWN_S=0 -> restart fires again"
PATH="$W/bin:$PATH" STATE_DIR="$W/state" PROBE_URL="$DEAD" \
  RESTART_CMD="$W/bin/restart-stub.sh" COOLDOWN_S=0 "$WATCHDOG" >/dev/null
assert "post-cooldown restarts" "$(restarts)" 2
assert "post-cooldown failures reset" "$(fail_count)" 0

echo "--- phase 5: failures=2 on dead probe, LIVE probe resets"
rm -f "$W/state/state.env"
run_probe "$DEAD" >/dev/null
run_probe "$DEAD" >/dev/null
assert "pre-live failures" "$(fail_count)" 2
run_probe "$LIVE" >/dev/null
assert "live resets failures" "$(fail_count)" 0
assert "live causes no restart" "$(restarts)" 2

echo "--- phase 6: grace (GRACE_S=60, fresh service start) -> not counted"
rm -f "$W/state/state.env"
touch "$W/fresh"
PATH="$W/bin:$PATH" STATE_DIR="$W/state" PROBE_URL="$DEAD" \
  RESTART_CMD="$W/bin/restart-stub.sh" GRACE_S=60 "$WATCHDOG" >/dev/null
assert "grace failures stay" "$(fail_count)" 0
assert "grace no restart" "$(restarts)" 2
rm -f "$W/fresh"

echo "=== RESULT: PASS=$PASS FAIL=$FAIL ==="
echo "--- stub restart log ---"
cat "$STUB_LOG"
echo "--- watchdog decision log (liveness.log) ---"
cat "$W/state/liveness.log"
[ "$FAIL" = "0" ]
