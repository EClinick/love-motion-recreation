#!/usr/bin/env bash
# Download Satoshi (Fontshare, free licence) into fonts/. Not committed to the repo.
set -euo pipefail
cd "$(dirname "$0")/../fonts"
css=$(curl -s "https://api.fontshare.com/v2/css?f[]=satoshi@500,700,900&display=swap")
for w in 500 700 900; do
  url=$(echo "$css" | awk -v w="$w" '/src:/{s=$0} /font-weight/{if ($2==w";") print s}' | grep -o "//cdn[^']*woff2" | head -1)
  curl -s -o "Satoshi-$w.woff2" "https:$url"
  echo "Satoshi-$w.woff2"
done
