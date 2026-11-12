#!/usr/bin/env bash
# AGPL-3.0 §6 (Issue #8): Release-Text verlinkt den exakten Quellstand; Assets SOURCE.md und mupdf-sys-<v>.crate
# (MuPDF-C-Quellen, kommen sonst nur von crates.io). Wiederholbar: Link nur einmal, Assets per --clobber.
# Aufruf aus .github/workflows/release-source.yml im Checkout des Tags: scripts/release-source.sh vX.Y.Z
set -euo pipefail
tag=$1
repo=${GITHUB_REPOSITORY:?}
link="https://github.com/$repo/tree/$tag"

# Issue #24: Tag = App-Version, sonst verlinkt die mitgelieferte licenses/SOURCE.md (aus package.json) einen anderen Quellstand
for v in "$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)" \
         "$(sed -n 's/^version = "\(.*\)"$/\1/p' src-tauri/Cargo.toml | head -1)" \
         "$(awk '/^name = "pdf-note"$/ {getline; print $3; exit}' src-tauri/Cargo.lock | tr -d '"')"; do
  [ "$v" = "${tag#v}" ] || { echo "Version $v (package.json/Cargo.toml/Cargo.lock) passt nicht zu Tag $tag"; exit 1; }
done

# Version + Prüfsumme von mupdf-sys aus Cargo.lock dieses Tags
read -r ver sum < <(awk '/^name = "mupdf-sys"$/ {f=1} f && /^version/ {v=$3} f && /^checksum/ {print v, $3; exit}' src-tauri/Cargo.lock | tr -d '"')
[ -n "${sum:-}" ] || { echo "mupdf-sys nicht in Cargo.lock"; exit 1; }

out=$(mktemp -d)
crate="$out/mupdf-sys-$ver.crate"
curl -fsSL -o "$crate" "https://crates.io/api/v1/crates/mupdf-sys/$ver/download"
echo "$sum  $crate" | sha256sum -c -
sed "s/<Version>/${tag#v}/g; s/<mupdf-sys>/$ver/g" SOURCE.md > "$out/SOURCE.md"
gh release upload "$tag" "$out/SOURCE.md" "$crate" --clobber

body=$(gh release view "$tag" --json body -q .body)
case "$body" in
  *"$link"*) echo "Quellcode-Link steht schon im Release-Text" ;;
  *) printf 'Quellcode (AGPL-3.0 §6): %s – MuPDF-C-Quellen: mupdf-sys-%s.crate, siehe SOURCE.md\n\n%s\n' "$link" "$ver" "$body" > "$out/notes.md"
     gh release edit "$tag" --notes-file "$out/notes.md" ;;
esac
