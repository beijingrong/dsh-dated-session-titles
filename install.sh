#!/usr/bin/env bash
# Install dsh-session-title-dated into a DSH profile.
#
#   ./install.sh [profile]        # default profile: web
#
# The plugin imports @deepseek-ai/dsh-* from the running DSH installation, so
# it resolves them through a node_modules symlink instead of installing
# duplicate copies.
set -euo pipefail

PROFILE="${1:-${DSH_PROFILE_NAME:-web}}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$DSH_HOME/profiles/$PROFILE/plugins/dsh-session-title-dated"
PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"

[ -f "$SRC_DIR/index.mjs" ] || { echo "run install.sh from the repository directory" >&2; exit 1; }
command -v dsh >/dev/null 2>&1 || { echo "dsh not found in PATH" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node not found in PATH" >&2; exit 1; }

DSH_JS="$(node -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' "$(command -v dsh)")"
DSH_PKG="$(dirname "$(dirname "$DSH_JS")")"
NODE_MODULES="$DSH_PKG/node_modules"
if [ ! -d "$NODE_MODULES/@deepseek-ai/dsh-session-title-llm" ]; then
	echo "cannot locate the DSH node_modules directory (tried $NODE_MODULES)" >&2
	exit 1
fi

mkdir -p "$PLUGIN_DIR"
cp -f "$SRC_DIR/index.mjs" "$SRC_DIR/package.json" "$SRC_DIR/README.md" "$PLUGIN_DIR"/
cp -f "$SRC_DIR"/test*.mjs "$PLUGIN_DIR"/ 2>/dev/null || true
ln -sfn "$NODE_MODULES" "$PLUGIN_DIR/node_modules"

node - "$PATCH" "$PLUGIN_DIR/index.mjs" <<'NODE'
const fs = require('node:fs');
const [patch, plugin] = process.argv.slice(2);
let text = fs.existsSync(patch) ? fs.readFileSync(patch, 'utf8') : '';
if (text.includes('# >>> dsh-session-title-dated')) {
	console.log('profile patch already has the plugin block');
	process.exit(0);
}
if (text.includes('session-title-dated')) {
	console.log('warning: the profile patch already mentions session-title-dated without markers; leaving it unchanged');
	process.exit(0);
}
if (/^\s*\[\]\s*$/m.test(text) && text.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).length === 1) {
	text = text.replace(/^\s*\[\]\s*$/m, '').trimEnd();
}
const block = [
	'',
	'# >>> dsh-session-title-dated',
	'# 会话标题：YYYY-MM-DD 分类：简短描述',
	'- id: session-title-llm',
	'  disabled: true',
	'- insert:',
	'    - id: session-title-dated-v2',
	`      name: ${plugin}`,
	'      config:',
	'        backfill: true',
	'# <<< dsh-session-title-dated',
	'',
].join('\n');
if (text.trim().length === 0) text = '# dsh profile patch\n';
fs.writeFileSync(patch, text.trimEnd() + '\n' + block);
console.log('profile patch updated');
NODE

echo
echo "installed to: $PLUGIN_DIR"
echo "restart 'dsh web' (or let the profile HMR reload the patch) and open a new session."
