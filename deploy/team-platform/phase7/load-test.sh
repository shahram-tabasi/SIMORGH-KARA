#!/usr/bin/env bash
# Phase 7 load test: many people opening Mattermost and Plane at once, from
# the office network, through the same gateways people use. Reads only.
#
#   bash deploy/team-platform/phase7/load-test.sh            # 400 requests, 20 at a time
#   N=2000 C=50 bash deploy/team-platform/phase7/load-test.sh
set -euo pipefail
N=${N:-400}; C=${C:-20}
run() {  # run <label> <url>
  local out; out=$(seq "$N" | xargs -P "$C" -I{} curl -s -o /dev/null -w '%{http_code} %{time_total}\n' "$2")
  local bad n; bad=$(echo "$out" | awk '$1 != 200' | wc -l); n=$(echo "$out" | wc -l)
  echo "$out" | awk '{ print $2 }' | sort -n | awk -v label="$1" -v n="$n" -v bad="$bad" '
    { t[NR] = $1 }
    END { p50 = t[int(NR*0.5) > 0 ? int(NR*0.5) : 1]; p95 = t[int(NR*0.95) > 0 ? int(NR*0.95) : 1];
          printf "%-32s %d requests, %d not 200, p50 %.0f ms, p95 %.0f ms, max %.0f ms\n", label, n, bad, p50*1000, p95*1000, t[NR]*1000 }'
}
run "Mattermost /api/v4/system/ping" https://team.simorghai.com/api/v4/system/ping
run "Mattermost web app"             https://team.simorghai.com/
run "Plane web app"                  https://plane.simorghai.com/
run "Plane API /api/instances/"      https://plane.simorghai.com/api/instances/
echo
echo "Watch at the same time: kubectl top pods -n plane; kubectl top pods -n mattermost"
echo "Good enough for a team this size: no errors, p95 under 1000 ms."
