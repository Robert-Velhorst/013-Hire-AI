#!/usr/bin/env bash
set -euo pipefail
script=$(cd -- "$(dirname -- "$0")" && pwd)/initialize-secrets.sh
fixture=$(mktemp -d /tmp/hire-ai-secrets-test.XXXXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
root="$fixture/deployment"
bash "$script" "$root" >/dev/null
before=$(sha256sum "$root"/secrets/* "$root"/.env.database "$root"/.env.session)
bash "$script" "$root" >/dev/null
after=$(sha256sum "$root"/secrets/* "$root"/.env.database "$root"/.env.session)
[[ $before == "$after" ]]
[[ $(stat -c %a "$root") == 700 ]]
for file in "$root"/secrets/* "$root"/.env.database "$root"/.env.session; do
  [[ $(stat -c %a "$file") == 600 ]]
done
echo 'PASS: initialized secrets remain identical on rerun and are owner-only.'

printf 'DATABASE_URL=invalid\n' > "$root/.env.database"
if bash "$script" "$root" >/dev/null 2>&1; then
  echo 'FAIL: inconsistent configuration was accepted.' >&2
  exit 1
fi
[[ $(< "$root/.env.database") == DATABASE_URL=invalid ]]
echo 'PASS: inconsistent existing configuration is rejected without replacement.'

mkdir -m 0700 "$fixture/symlink-case"
ln -s "$root/secrets" "$fixture/symlink-case/secrets"
if bash "$script" "$fixture/symlink-case" >/dev/null 2>&1; then
  echo 'FAIL: symlink secrets directory was accepted.' >&2
  exit 1
fi
echo 'PASS: symlink secrets directory is rejected.'
