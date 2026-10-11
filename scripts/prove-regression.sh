#!/usr/bin/env bash
# Run a regression file against the unchanged application from a previous ref.
# A failing exit status is the expected evidence that the old defect exists.
set -euo pipefail
cd "$(dirname "$0")/.."
revision="${1:?Usage: bash scripts/prove-regression.sh BEFORE_REF TEST_FILE}"
test_file="${2:?Test file required}"
proof_dir="$(mktemp -d /tmp/athn-before-XXXXXX)"
trap 'rm -rf -- "$proof_dir"' EXIT
while IFS= read -r file; do
  mkdir -p "$proof_dir/$(dirname "$file")"
  git show "$revision:$file" > "$proof_dir/$file"
done < <(git ls-tree -r --name-only "$revision" | rg '\.mjs$' | rg -v '^(test|scripts)/')
ln -s "$PWD/node_modules" "$proof_dir/node_modules"
TEST_SOURCE_DIR="$proof_dir" node --test "$test_file"
