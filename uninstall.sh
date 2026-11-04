#!/usr/bin/env bash
# Remove dsh-session-title-dated from a DSH profile.
#
#   ./uninstall.sh [profile]      # default profile: web
set -euo pipefail

PROFILE="${1:-${DSH_PROFILE_NAME:-web}}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PLUGIN_DIR="$DSH_HOME/profiles/$PROFILE/plugins/dsh-session-title-dated"
PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"

if [ -f "$PATCH" ]; then
	node - "$PATCH" <<'NODE'
const fs = require('node:fs');
const patch = process.argv[2];
const text = fs.readFileSync(patch, 'utf8');
const start = text.indexOf('# >>> dsh-session-title-dated');
const end = text.indexOf('# <<< dsh-session-title-dated');
if (start === -1 || end === -1) {
	console.log('no marker block found; remove the session-title-llm disabled row and the session-title-dated insert row by hand');
	process.exit(0);
}
const next = `${text.slice(0, start)}${text.slice(end + '# <<< dsh-session-title-dated'.length)}`.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(patch, next);
console.log('profile patch updated');
NODE
fi

rm -rf "$PLUGIN_DIR"
echo "removed $PLUGIN_DIR"
