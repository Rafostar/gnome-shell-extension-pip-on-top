#!/bin/sh

set -u

OUTPUT_FILE="pip-title-matchers.json"
CHROME_STRINGS_URI="https://api.github.com/repos/chromium/chromium/contents/chrome/app/resources"
CHROME_PIP_TRANSLATION_ID="7750228210027921155"
export CHROME_PIP_TRANSLATION_ID

UPDATE_FIREFOX=1
UPDATE_CHROME=1

usage() {
  cat <<EOF
Usage: $0 [--firefox-only | --chrome-only | --help]

Options:
  --firefox-only  Update only .firefox in $OUTPUT_FILE
  --chrome-only   Update only .chrome in $OUTPUT_FILE
  --help          Show this help
EOF
}

for arg in "$@"; do
  case "$arg" in
    --firefox-only)
      UPDATE_FIREFOX=1
      UPDATE_CHROME=0
      ;;
    --chrome-only)
      UPDATE_FIREFOX=0
      UPDATE_CHROME=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

TEMP_XPI="/tmp/pip-on-top-lang.$$"
TEMP_FIREFOX_TITLES="/tmp/pip-on-top-firefox-titles.$$"
TEMP_FIREFOX_SORTED="/tmp/pip-on-top-firefox-sorted.$$"
TEMP_FIREFOX_FILTERED="/tmp/pip-on-top-firefox-filtered.$$"
TEMP_FIREFOX_JSON="/tmp/pip-on-top-firefox-json.$$"
TEMP_CHROME_URLS="/tmp/pip-on-top-chrome-urls.$$"
TEMP_CHROME_TITLES="/tmp/pip-on-top-chrome-titles.$$"
TEMP_CHROME_SORTED="/tmp/pip-on-top-chrome-sorted.$$"
TEMP_CHROME_FILTERED="/tmp/pip-on-top-chrome-filtered.$$"
TEMP_CHROME_JSON="/tmp/pip-on-top-chrome-json.$$"
TEMP_BUILTIN_TITLES="/tmp/pip-on-top-builtin-titles.$$"
TEMP_OUTPUT="/tmp/pip-on-top-matchers.$$"

cleanup() {
  rm -f \
    "$TEMP_XPI" \
    "$TEMP_FIREFOX_TITLES" \
    "$TEMP_FIREFOX_SORTED" \
    "$TEMP_FIREFOX_FILTERED" \
    "$TEMP_FIREFOX_JSON" \
    "$TEMP_CHROME_URLS" \
    "$TEMP_CHROME_TITLES" \
    "$TEMP_CHROME_SORTED" \
    "$TEMP_CHROME_FILTERED" \
    "$TEMP_CHROME_JSON" \
    "$TEMP_BUILTIN_TITLES" \
    "$TEMP_OUTPUT"
}
trap cleanup EXIT INT TERM

touch "$TEMP_FIREFOX_TITLES" "$TEMP_CHROME_TITLES"
cat > "$TEMP_BUILTIN_TITLES" <<EOF
Picture-in-Picture
Picture in picture
Picture-in-picture
Picture in Picture
TelegramDesktop
EOF

extract_chrome_translation_from_xtb() {
  perl -0777 -ne '
    my $id = $ENV{"CHROME_PIP_TRANSLATION_ID"};
    if (/<translation\s+id="\Q$id\E">(.*?)<\/translation>/s) {
      my $t = $1;
      $t =~ s/<ph[^>]*\/>//g;
      $t =~ s/<[^>]+>//g;
      $t =~ s/&quot;/"/g;
      $t =~ s/&apos;/'"'"'/g;
      $t =~ s/&lt;/</g;
      $t =~ s/&gt;/>/g;
      $t =~ s/&amp;/&/g;
      $t =~ s/^\s+|\s+$//g;
      print "$t\n" if $t ne "";
    }
  '
}

normalize_spaces() {
  perl -CS -pe 's/\x{00A0}/ /g; s/[ \t]+/ /g; s/^\s+|\s+$//g'
}

if [ "$UPDATE_FIREFOX" -eq 1 ]; then
  FIREFOX_VERSION=${FIREFOX_VERSION:-$(
    curl -fsSL "https://product-details.mozilla.org/1.0/firefox_versions.json" \
      | sed -n 's/.*"LATEST_FIREFOX_VERSION":[[:space:]]*"\([^"]*\)".*/\1/p'
  )}
  [ -n "$FIREFOX_VERSION" ] || {
    echo "[firefox] Failed to resolve latest Firefox version. Set FIREFOX_VERSION manually." >&2
    exit 1
  }

  FIREFOX_TRANSLATIONS_PATH="pub/firefox/releases/$FIREFOX_VERSION/linux-x86_64/xpi/"
  FIREFOX_TRANSLATIONS_URI="https://ftp.mozilla.org/$FIREFOX_TRANSLATIONS_PATH"
  FIREFOX_LANG_PACKS=$(
    curl -fsSL "$FIREFOX_TRANSLATIONS_URI" \
      | grep -Po "(?<=$FIREFOX_TRANSLATIONS_PATH).*?(?=\\.xpi)"
  )
  [ -n "$FIREFOX_LANG_PACKS" ] || {
    echo "[firefox] No language packs found at $FIREFOX_TRANSLATIONS_URI" >&2
    exit 1
  }

  echo "[firefox] Using Firefox version: $FIREFOX_VERSION"
  echo "[firefox] Found $(printf '%s\n' "$FIREFOX_LANG_PACKS" | wc -l | tr -d ' ') language packs"

  printf '%s\n' "$FIREFOX_LANG_PACKS" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    lang=$(echo "$line" | tr "-" "_")
    echo "[firefox] Downloading: $lang"

    if ! curl -fsSL "$FIREFOX_TRANSLATIONS_URI$line.xpi" -o "$TEMP_XPI"; then
      echo "[firefox] Skipping $lang (download failed)"
      continue
    fi

    pip_name=$(
      unzip -p "$TEMP_XPI" "localization/$line/toolkit/pictureinpicture/pictureinpicture.ftl" 2>/dev/null \
        | sed -n -e 's/^.*pictureinpicture-player-title = //p' \
        | normalize_spaces
    )
    if [ -n "$pip_name" ]; then
      printf '%s\n' "$pip_name" >> "$TEMP_FIREFOX_TITLES"
      echo "[firefox] $lang => $pip_name"
    else
      echo "[firefox] $lang => no value for pictureinpicture-player-title"
    fi
  done

  sort -u "$TEMP_FIREFOX_TITLES" > "$TEMP_FIREFOX_SORTED"
  awk 'NR==FNR { skip[$0]=1; next } !($0 in skip)' "$TEMP_BUILTIN_TITLES" "$TEMP_FIREFOX_SORTED" > "$TEMP_FIREFOX_FILTERED"
  jq -R . "$TEMP_FIREFOX_FILTERED" | jq -s . > "$TEMP_FIREFOX_JSON"
  echo "[firefox] Extracted $(jq 'length' "$TEMP_FIREFOX_JSON") non-builtin titles"
fi

if [ "$UPDATE_CHROME" -eq 1 ]; then
  curl -fsSL "$CHROME_STRINGS_URI" \
    | jq -r '.[] | select(.name | test("^generated_resources_.*\\.xtb$")) | .download_url' \
    > "$TEMP_CHROME_URLS"

  CHROME_FILE_COUNT=$(wc -l < "$TEMP_CHROME_URLS" | tr -d ' ')
  [ "$CHROME_FILE_COUNT" -gt 0 ] || {
    echo "[chrome] No generated_resources_*.xtb files found at $CHROME_STRINGS_URI" >&2
    exit 1
  }

  echo "[chrome] Found $CHROME_FILE_COUNT xtb files"

  processed=0
  matched=0
  while IFS= read -r xtb_url; do
    [ -n "$xtb_url" ] || continue
    processed=$((processed + 1))
    file_name=$(basename "$xtb_url")
    echo "[chrome] Processing ($processed/$CHROME_FILE_COUNT): $file_name"

    pip_name=$(
      curl -fsSL "$xtb_url" \
        | extract_chrome_translation_from_xtb \
        | normalize_spaces
    )
    if [ -n "$pip_name" ]; then
      matched=$((matched + 1))
      printf '%s\n' "$pip_name" >> "$TEMP_CHROME_TITLES"
      echo "[chrome]   match id=$CHROME_PIP_TRANSLATION_ID => $pip_name"
    else
      echo "[chrome]   no match for id=$CHROME_PIP_TRANSLATION_ID"
    fi
  done < "$TEMP_CHROME_URLS"

  sort -u "$TEMP_CHROME_TITLES" > "$TEMP_CHROME_SORTED"
  awk 'NR==FNR { skip[$0]=1; next } !($0 in skip)' "$TEMP_BUILTIN_TITLES" "$TEMP_CHROME_SORTED" > "$TEMP_CHROME_FILTERED"
  jq -R . "$TEMP_CHROME_FILTERED" | jq -s . > "$TEMP_CHROME_JSON"
  echo "[chrome] Extracted $(jq 'length' "$TEMP_CHROME_JSON") non-builtin titles"
fi

if [ -f "$OUTPUT_FILE" ] && jq empty "$OUTPUT_FILE" >/dev/null 2>&1; then
  cp "$OUTPUT_FILE" "$TEMP_OUTPUT"
else
  jq -n '{firefox: [], chrome: []}' > "$TEMP_OUTPUT"
fi

if [ "$UPDATE_FIREFOX" -eq 1 ]; then
  jq --slurpfile firefoxTitles "$TEMP_FIREFOX_JSON" \
    '.firefox = $firefoxTitles[0] | del(.exact_titles, .suffix_titles)' \
    "$TEMP_OUTPUT" > "${TEMP_OUTPUT}.next"
  mv "${TEMP_OUTPUT}.next" "$TEMP_OUTPUT"
fi

if [ "$UPDATE_CHROME" -eq 1 ]; then
  jq --slurpfile chromeTitles "$TEMP_CHROME_JSON" \
    '.chrome = $chromeTitles[0] | del(.exact_titles, .suffix_titles)' \
    "$TEMP_OUTPUT" > "${TEMP_OUTPUT}.next"
  mv "${TEMP_OUTPUT}.next" "$TEMP_OUTPUT"
fi

mv "$TEMP_OUTPUT" "$OUTPUT_FILE"

echo "Written $OUTPUT_FILE"
echo "Done (firefox=$UPDATE_FIREFOX, chrome=$UPDATE_CHROME)"
