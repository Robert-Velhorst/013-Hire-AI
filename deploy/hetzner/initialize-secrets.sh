#!/usr/bin/env bash
set -euo pipefail
umask 077

root=${1:-/opt/hire-ai}
[[ $EUID -eq 0 && $root == /*/* && $root != */ && $root != *//* &&
   ! $root =~ (^|/)\.\.?(/|$) ]] || {
  echo 'Use root and a canonical absolute path to a dedicated deployment directory.' >&2
  exit 1
}

# Validate every existing ancestor before creating anything. Root-owned sticky
# directories (such as /tmp) cannot replace a root-owned child, unlike mode 0777.
ancestor=$root
while :; do
  [[ ! -L $ancestor ]] || { echo 'Symlink deployment paths are not allowed.' >&2; exit 1; }
  if [[ -e $ancestor ]]; then
    [[ -d $ancestor && $(stat -c %u -- "$ancestor") == 0 ]] || {
      echo 'Deployment ancestors must be root-owned directories.' >&2
      exit 1
    }
    mode=$(stat -c %a -- "$ancestor")
    if (( (8#$mode & 0022) != 0 && (8#$mode & 01000) == 0 )); then
      echo 'Deployment ancestors must not be writable by other users.' >&2
      exit 1
    fi
  fi
  [[ $ancestor != / ]] || break
  ancestor=${ancestor%/*}
  ancestor=${ancestor:-/}
done
if [[ -e $root ]]; then
  [[ $(stat -c %a -- "$root") == 700 ]] || {
    echo 'An existing deployment directory must already have mode 0700; nothing was changed.' >&2
    exit 1
  }
else
  install -d -m 0700 -- "$root"
fi
[[ ! -L $root/.bootstrap.lock && ! -L $root/secrets ]] || exit 1
exec 9>"$root/.bootstrap.lock"
flock -x 9
install -d -m 0700 "$root/secrets"

for name in mysql-root-password mysql-app-password session-secret; do
  file="$root/secrets/$name"
  [[ ! -L $file ]] || exit 1
  if [[ ! -e $file ]]; then
    (set -C; openssl rand -hex 32 > "$file")
  fi
  [[ -f $file && $(wc -c < "$file") -eq 65 ]] || exit 1
  grep -Eq '^[0-9a-f]{64}$' "$file" || exit 1
  chmod 0600 "$file"
done

# Preserve existing credentials and reject inconsistent partial configuration.
database="DATABASE_URL=mysql://hire_ai:$(< "$root/secrets/mysql-app-password")@db:3306/hire_ai"
session="JWT_SECRET=$(< "$root/secrets/session-secret")"
for name in database session; do
  file="$root/.env.$name"
  expected=${!name}
  [[ ! -L $file ]] || exit 1
  if [[ ! -e $file ]]; then
    (set -C; printf '%s\n' "$expected" > "$file")
  fi
  [[ -f $file && $(< "$file") == "$expected" ]] || exit 1
  chmod 0600 "$file"
done
echo 'Local database and session secrets are initialized; existing values were preserved.'
