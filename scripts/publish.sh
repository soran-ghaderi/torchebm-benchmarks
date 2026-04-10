#!/usr/bin/env bash
# Usage: bash scripts/publish.sh path/to/result.json [subdir]
# Copies JSON to benchmarks/results/, updates manifest.json, commits, and pushes.
set -euo pipefail

if [ $# -eq 0 ]; then
    echo "Usage: bash scripts/publish.sh path/to/result.json [subdir]"
    echo "  subdir: optional subdirectory under benchmarks/results/ (e.g. Linux-CPython-3.10-64bit)"
    exit 1
fi

src="$1"
subdir="${2:-}"

if [ ! -f "$src" ]; then
    echo "Error: File not found: $src"
    exit 1
fi

# Copy file
if [ -n "$subdir" ]; then
    mkdir -p "benchmarks/results/$subdir"
    dest="benchmarks/results/$subdir/$(basename "$src")"
    manifest_entry="$subdir/$(basename "$src")"
else
    dest="benchmarks/results/$(basename "$src")"
    manifest_entry="$(basename "$src")"
fi

cp "$src" "$dest"
echo "Copied $src -> $dest"

# Regenerate manifest.json from all JSON files in results/
manifest="benchmarks/results/manifest.json"
files=$(find benchmarks/results -name '*.json' ! -name 'manifest.json' -printf '%P\n' | sort)
echo "[" > "$manifest"
sep=""
for f in $files; do
    printf '%s  "%s"' "$sep" "$f" >> "$manifest"
    sep=$',\n'
done
printf '\n]\n' >> "$manifest"

echo "Updated manifest.json"

git add benchmarks/results/
git commit -m "bench: add $(basename "$src")"
git push
echo "Done! Published $(basename "$src")"
