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
cd dist-app
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -qm "Deploy $(git -C .. rev-parse --short HEAD)"
git push -f -q "$REMOTE" gh-pages
rm -rf .git
echo "Deployed. https://stu-greenshoots.github.io/record-crate/"
