#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run this test as root on Linux.' >&2; exit 1; }
script=$(cd -- "$(dirname -- "$0")" && pwd)/initialize-secrets.sh
fixture=$(mktemp -d /tmp/hire-ai-secrets-test.XXXXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
failures=0

# Intercept the first mutation so even the unfixed script cannot touch system paths.
mkdir "$fixture/bin"
printf '#!/usr/bin/env bash\nprintf attempted > "$MUTATION_LOG"\nexit 99\n' > "$fixture/bin/install"
chmod 0700 "$fixture/bin/install"
for path in / /opt /tmp /etc /var /usr /home /root /srv /opt/../etc /tmp/.. /opt/./hire-ai //opt/hire-ai; do
  export MUTATION_LOG="$fixture/mutation-${failures}"
  status=0
  PATH="$fixture/bin:$PATH" bash "$script" "$path" >/dev/null 2>&1 || status=$?
  if [[ $status -eq 0 || -e $MUTATION_LOG ]]; then
    echo "FAIL: unsafe deployment path reached a write: $path" >&2
    failures=$((failures + 1))
  fi
done

mkdir "$fixture/real-parent"
ln -s "$fixture/real-parent" "$fixture/link-parent"
if bash "$script" "$fixture/link-parent/deployment" >/dev/null 2>&1; then
  echo 'FAIL: symlink ancestor was accepted.' >&2
  failures=$((failures + 1))
fi
if [[ -e $fixture/real-parent/deployment ]]; then
  echo 'FAIL: symlink ancestor allowed writes into its destination.' >&2
  failures=$((failures + 1))
fi

mkdir -m 0755 "$fixture/existing-shared"
if bash "$script" "$fixture/existing-shared" >/dev/null 2>&1; then
  echo 'FAIL: existing non-private directory was accepted.' >&2
  failures=$((failures + 1))
fi
if [[ $(stat -c %a "$fixture/existing-shared") != 755 || -e $fixture/existing-shared/secrets ]]; then
  echo 'FAIL: existing non-private directory was modified.' >&2
  failures=$((failures + 1))
fi

mkdir -m 0777 "$fixture/writable-parent"
mkdir -m 0700 "$fixture/foreign-parent"
chown 65534:65534 "$fixture/foreign-parent"
for parent in writable-parent foreign-parent; do
  if bash "$script" "$fixture/$parent/deployment" >/dev/null 2>&1; then
    echo "FAIL: untrusted ancestor was accepted: $parent" >&2
    failures=$((failures + 1))
  fi
  if [[ -e $fixture/$parent/deployment ]]; then
    echo "FAIL: untrusted ancestor allowed writes: $parent" >&2
    failures=$((failures + 1))
  fi
done

[[ $failures -eq 0 ]] || exit 1
echo 'PASS: unsafe paths and symlink ancestors are rejected before mutation.'
echo 'PASS: existing non-private directories remain unchanged.'
echo 'PASS: untrusted ancestor ownership and permissions are rejected.'
