#!/usr/bin/env bash
# Usage: bash scripts/publish.sh [path/to/result.json [subdir]] [--push]
# Without arguments: regenerates manifest.json from existing files.
# With a file argument: copies it to benchmarks/results/ and regenerates manifest.
# Pass --push to also git add, commit, and push.
set -euo pipefail

results_dir="benchmarks/results"
manifest="$results_dir/manifest.json"
push=false
[[ " $* " == *" --push "* ]] && push=true

# Strip --push from positional args
args=()
for arg in "$@"; do
    [[ "$arg" == "--push" ]] || args+=("$arg")
done
set -- "${args[@]+"${args[@]}"}"

# If a file is specified, copy it into results
if [ $# -ge 1 ]; then
    src="$1"
    subdir="${2:-}"

    if [ ! -f "$src" ]; then
        echo "Error: File not found: $src"
        exit 1
    fi

    if [ -n "$subdir" ]; then
        mkdir -p "$results_dir/$subdir"
        dest="$results_dir/$subdir/$(basename "$src")"
    else
        dest="$results_dir/$(basename "$src")"
    fi

    real_src="$(realpath "$src")"
    real_dest="$(realpath -m "$dest")"

    if [ "$real_src" = "$real_dest" ]; then
        echo "Source is already at $dest, skipping copy."
    else
        cp "$src" "$dest"
        echo "Copied $src -> $dest"
    fi
fi

# Regenerate manifest.json from all JSON files in results/
files=$(find "$results_dir" -name '*.json' ! -name 'manifest.json' -printf '%P\n' | sort)
echo "[" > "$manifest"
sep=""
for f in $files; do
    printf '%s  "%s"' "$sep" "$f" >> "$manifest"
    sep=$',\n'
done
printf '\n]\n' >> "$manifest"
echo "Updated manifest.json"

if $push; then
    git add "$results_dir/"
    git commit -m "bench: update results"
    git push
    echo "Done! Published and pushed."
else
    echo "Done! Ready to test locally. Run with --push to commit and push."
fi
