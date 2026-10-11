#!/usr/bin/env bash
# This regression depends on the old limiter, so reconstruct its locked deps.
# The expected result is failing assertions against the preceding revision.
set -euo pipefail
cd "$(dirname "$0")/.."
revision="${1:-5d0c43063750dd8d71a7ba1362362a5615c2a297}"
proof_dir="$(mktemp -d /tmp/athn-ipv6-before-XXXXXX)"
trap 'rm -rf -- "$proof_dir"' EXIT
git archive "$revision" | tar -x -C "$proof_dir"
npm ci --prefix "$proof_dir" --ignore-scripts --no-audit > /dev/null
TEST_SOURCE_DIR="$proof_dir" node --test test/ipv6-rate-limit.test.mjs
