#!/usr/bin/env bash
# Apply .github/repository-settings.yml to the GitHub repository.
#
# Usage: scripts/apply-repository-settings.sh [--dry-run] [SECTION...]
#
#   SECTION    repository, environments or rulesets. Defaults to all three,
#              applied in that order.
#   --dry-run  Print the requests instead of sending them. Sends no API
#              requests at all, so the existing state is not compared: syncing
#              branch policies and deleting rulesets happen only when applying.
#
# Requires gh, jq and yq (https://github.com/mikefarah/yq, v4).
# When applying, GH_TOKEN needs "Administration: Read and write" on the repository.
# The repository is taken from GITHUB_REPOSITORY, or from gh in a local clone.

set -euo pipefail

settings_file="${SETTINGS_FILE:-.github/repository-settings.yml}"
dry_run=false
sections=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    repository | environments | rulesets) sections="$sections $arg" ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done
sections="${sections:-repository environments rulesets}"

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

# settings EXPRESSION: evaluate a yq expression against the settings file, as compact JSON.
settings() {
  yq --output-format=json --indent=0 "$1" "$settings_file"
}

# api METHOD PATH [BODY]: send a request, or print it on a dry run.
api() {
  local method=$1 path=$2 body=${3-}
  if $dry_run; then
    echo "$method $path${body:+ $body}"
    return
  fi
  if [ -n "$body" ]; then
    gh api --method "$method" "$path" --input - <<<"$body" >/dev/null
  else
    gh api --method "$method" "$path" >/dev/null
  fi
  echo "$method $path: done"
}

apply_repository() {
  api PATCH "repos/$repo" "$(settings '.repository')"
}

apply_environments() {
  local count i name
  count=$(yq '.environments | length' "$settings_file")
  for ((i = 0; i < count; i++)); do
    name=$(yq ".environments[$i].name" "$settings_file")
    api PUT "repos/$repo/environments/$name" \
      "$(settings ".environments[$i] | del(.name) | del(.deployment_branch_policies)")"
    sync_branch_policies "$name" "$(settings ".environments[$i].deployment_branch_policies // []")"
  done
}

# sync_branch_policies ENVIRONMENT WANTED_JSON: create missing policies, delete the rest.
sync_branch_policies() {
  local environment=$1 wanted=$2 path existing missing extra line
  path="repos/$repo/environments/$environment/deployment-branch-policies"
  if $dry_run; then
    echo "SYNC $path $wanted"
    return
  fi
  existing=$(gh api "$path?per_page=100" --jq '[.branch_policies[] | {id, name, type}]')
  missing=$(jq -c --argjson existing "$existing" \
    '.[] | select(. as $w | $existing | any(.name == $w.name and .type == $w.type) | not)' <<<"$wanted")
  extra=$(jq -r --argjson wanted "$wanted" \
    '.[] | select(. as $e | $wanted | any(.name == $e.name and .type == $e.type) | not) | .id' <<<"$existing")
  while IFS= read -r line; do
    [ -n "$line" ] && api POST "$path" "$line"
  done <<<"$missing"
  while IFS= read -r line; do
    [ -n "$line" ] && api DELETE "$path/$line"
  done <<<"$extra"
  return 0
}

apply_rulesets() {
  local existing count i name id wanted_names extra line
  existing='[]'
  if ! $dry_run; then
    existing=$(gh api "repos/$repo/rulesets?per_page=100&includes_parents=false" \
      --jq '[.[] | select(.source_type == "Repository") | {id, name}]')
  fi
  count=$(yq '.rulesets | length' "$settings_file")
  for ((i = 0; i < count; i++)); do
    name=$(yq ".rulesets[$i].name" "$settings_file")
    id=$(jq -r --arg name "$name" '.[] | select(.name == $name) | .id' <<<"$existing")
    if [ -n "$id" ]; then
      api PUT "repos/$repo/rulesets/$id" "$(settings ".rulesets[$i]")"
    else
      # On a dry run this is printed as POST even when the ruleset already exists.
      api POST "repos/$repo/rulesets" "$(settings ".rulesets[$i]")"
    fi
  done
  wanted_names=$(settings '[.rulesets[].name]')
  extra=$(jq -r --argjson wanted "$wanted_names" \
    '.[] | select(.name as $n | $wanted | index($n) | not) | .id' <<<"$existing")
  while IFS= read -r line; do
    [ -n "$line" ] && api DELETE "repos/$repo/rulesets/$line"
  done <<<"$extra"
  return 0
}

for section in $sections; do
  echo "== $section"
  "apply_$section"
done
