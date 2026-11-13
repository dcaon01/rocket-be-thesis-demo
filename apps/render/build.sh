#!/usr/bin/env bash
# Builds dist/apps/render.zip for the python3.12 Lambda (x86_64): handler, WeasyPrint, fonts, and in lib/ the native
# libraries of Pango that the Lambda image lacks. Built inside the Lambda image itself, so the libraries match it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/dist/apps/render"
rm -rf "$OUT" "$OUT.zip"
mkdir -p "$OUT"

docker run --rm --platform linux/amd64 --entrypoint /bin/bash \
  -v "$ROOT/apps/render:/src:ro" -v "$OUT:/out" \
  public.ecr.aws/lambda/python:3.12 -c '
    set -euo pipefail
    ls /usr/lib64 > /tmp/base-libs
    dnf install -y pango harfbuzz fontconfig > /dev/null
    pip install -q --no-cache-dir --root-user-action=ignore --disable-pip-version-check --only-binary=:all: -r /src/requirements.txt -t /out

    # The libraries WeasyPrint opens and everything they link, minus what the Lambda image already has.
    mkdir -p /out/lib
    for name in libgobject-2.0.so.0 libpango-1.0.so.0 libharfbuzz.so.0 libharfbuzz-subset.so.0 libfontconfig.so.1 libpangoft2-1.0.so.0; do
      echo "/usr/lib64/$name"
      ldd "/usr/lib64/$name" | awk "/=> \\// { print \$3 }"
    done | sort -u | while read -r lib; do
      grep -qx "$(basename "$lib")" /tmp/base-libs || cp -L "$lib" /out/lib/
    done

    cp /src/src/handler.py /out/
    cp -r /src/fonts /out/fonts
    chown -R '"$(id -u):$(id -g)"' /out
  '

find "$OUT" -name "__pycache__" -type d -prune -exec rm -rf {} +
(cd "$OUT" && zip -qr9 ../render.zip .)
echo "Built $OUT.zip ($(du -h "$OUT.zip" | cut -f1))"
