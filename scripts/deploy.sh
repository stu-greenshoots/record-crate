#!/bin/sh
# Build the phone app and publish it to the gh-pages branch, which GitHub Pages
# serves at https://stu-greenshoots.github.io/record-crate/.
#
# (docs/pages-workflow.yml.example does the same from GitHub Actions; it needs a
# token with the `workflow` scope to push: `gh auth refresh -s workflow`.)
set -e
cd "$(dirname "$0")/.."
npm test
npm run build
touch dist-app/.nojekyll
REMOTE=$(git remote get-url origin)
REV=$(git rev-parse --short HEAD)
# Publish from a throwaway copy so no repository is ever created inside the project.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -R dist-app/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git add -A
git commit -qm "Deploy $REV"
git push -f -q "$REMOTE" gh-pages
cd - >/dev/null
echo "Deployed. https://stu-greenshoots.github.io/record-crate/"
