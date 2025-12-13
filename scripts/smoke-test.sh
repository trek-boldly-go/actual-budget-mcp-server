#!/usr/bin/env bash
set -euo pipefail

# Quick, non-destructive smoke test for MCP + Keycloak.
# Defaults are wired to the docker-compose setup; override via env vars as needed.

KC_HOST_PORT="${KC_HOST_PORT:-localhost:8080}"
MCP_HOST_PORT="${MCP_HOST_PORT:-localhost:3000}"
KC_USER="${KC_USER:-demo-user}"
KC_PASS="${KC_PASS:-demo-pass}"
KC_CLIENT_ID="${KC_CLIENT_ID:-actual-mcp-public}"
KC_GRANT_TYPE="${KC_GRANT_TYPE:-password}"

TEST_WRITES="${TEST_WRITES:-0}" # set to 1 to run write tests (adds/updates/deletes temporary records); defaults to read-only.

command -v jq >/dev/null 2>&1 || { echo "jq is required for this script"; exit 1; }

echo "Requesting token from Keycloak at http://${KC_HOST_PORT} (user=${KC_USER}, client_id=${KC_CLIENT_ID})"
TOKEN_RESP=$(curl -sS -X POST \
  "http://${KC_HOST_PORT}/realms/actual-mcp/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=${KC_GRANT_TYPE}" \
  -d "client_id=${KC_CLIENT_ID}" \
  -d "username=${KC_USER}" \
  -d "password=${KC_PASS}")

ACCESS_TOKEN=$(echo "${TOKEN_RESP}" | jq -r '.access_token // empty')
if [[ -z "${ACCESS_TOKEN}" ]]; then
  echo "Failed to obtain access_token. Full response:"
  echo "${TOKEN_RESP}"
  exit 1
fi
echo "Got access token."

echo "Initializing MCP session..."
HDR_FILE=$(mktemp)
BODY_FILE=$(mktemp)
curl -sS -D "${HDR_FILE}" "http://${MCP_HOST_PORT}/mcp" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{
    "jsonrpc": "2.0",
    "id": "init-1",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "smoke-test", "version": "0.0.1" }
    }
  }' -o "${BODY_FILE}"

echo "Init headers:"
cat "${HDR_FILE}"
echo "Init body:"
cat "${BODY_FILE}"

# Prefer the session ID from the response header if provided
HEADER_SESSION_ID=$(awk -F': ' '/^mcp-session-id:/ {print $2; exit}' "${HDR_FILE}" | tr -d '\r\n ')
INIT_RESP=$(cat "${BODY_FILE}")
SESSION_ID=$( (echo "${INIT_RESP}" | jq -r '.result.sessionId // empty') 2>/dev/null || true )
if [[ -n "${HEADER_SESSION_ID}" ]]; then
  SESSION_ID="${HEADER_SESSION_ID}"
fi
if [[ -z "${SESSION_ID}" ]]; then
  EVENT_ID=$(awk -F': ' '/^id:/ {print $2; exit}' "${BODY_FILE}")
  if [[ -n "${EVENT_ID}" ]]; then
    SESSION_ID="${EVENT_ID%%_*}"
  fi
fi
SESSION_ID="$(echo -n "${SESSION_ID}" | tr -d '\r\n ')"
if [[ -z "${SESSION_ID}" ]]; then
  echo "Failed to initialize MCP session. Response:"
  echo "${INIT_RESP}"
  exit 1
fi
echo "Session initialized: ${SESSION_ID}"

# Keep SSE stream open so the transport stays alive during tests
STREAM_LOG=$(mktemp)
curl -sN "http://${MCP_HOST_PORT}/mcp" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Accept: text/event-stream" \
  -H "mcp-session-id: ${SESSION_ID}" \
  >"${STREAM_LOG}" 2>/dev/null &
STREAM_PID=$!
sleep 1

call_mcp() {
  local cid="$1"
  local payload="$2"
  curl -sS "http://${MCP_HOST_PORT}/mcp" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "mcp-session-id: ${SESSION_ID}" \
    --data "${payload}"
}

extract_data_json() {
  awk '/^data: / {sub("^data: ",""); print}' | head -n1
}

extract_text_payload() {
  # Given an SSE body with JSON, extract the first text content payload (string)
  local raw="$1"
  echo "${raw}" | extract_data_json | jq -r '.result.content[]? | select(.type=="text") | .text' 2>/dev/null
}

cleanup() {
  if [[ -n "${RULE_ID:-}" ]]; then
    call_mcp "cleanup-rule" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"cleanup-rule\",
      \"method\": \"tools/call\",
      \"params\": { \"name\": \"delete-rule\", \"arguments\": { \"ruleId\": \"${RULE_ID}\" } }
    }" >/dev/null || true
  fi
  if [[ -n "${PAYEE_ID:-}" ]]; then
    call_mcp "cleanup-payee" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"cleanup-payee\",
      \"method\": \"tools/call\",
      \"params\": { \"name\": \"delete-payee\", \"arguments\": { \"payeeId\": \"${PAYEE_ID}\" } }
    }" >/dev/null || true
  fi
  if [[ -n "${CAT_ID:-}" ]]; then
    call_mcp "cleanup-cat" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"cleanup-cat\",
      \"method\": \"tools/call\",
      \"params\": { \"name\": \"delete-category\", \"arguments\": { \"categoryId\": \"${CAT_ID}\" } }
    }" >/dev/null || true
  fi
  if [[ -n "${CG_ID:-}" ]]; then
    call_mcp "cleanup-cg" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"cleanup-cg\",
      \"method\": \"tools/call\",
      \"params\": { \"name\": \"delete-category-group\", \"arguments\": { \"groupId\": \"${CG_ID}\" } }
    }" >/dev/null || true
  fi
  if [[ -n "${TXN_ID:-}" ]]; then
    call_mcp "cleanup-txn" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"cleanup-txn\",
      \"method\": \"tools/call\",
      \"params\": { \"name\": \"delete-transaction\", \"arguments\": { \"transactionId\": \"${TXN_ID}\" } }
    }" >/dev/null || true
  fi
}
trap cleanup EXIT

echo "Fetching accounts..."
ACCTS_RAW=$(call_mcp "acct-1" '{
  "jsonrpc": "2.0",
  "id": "acct-1",
  "method": "tools/call",
  "params": { "name": "get-accounts", "arguments": {} }
}')
ACCTS_JSON=$(echo "${ACCTS_RAW}" | extract_data_json)
ACCTS_TEXT=$(extract_text_payload "${ACCTS_RAW}")
echo "${ACCTS_TEXT:-${ACCTS_JSON}}"

ACCOUNT_ID=""
if [[ -n "${ACCTS_TEXT}" ]]; then
  ACCOUNT_ID=$(echo "${ACCTS_TEXT}" | jq -r '.[0].id // empty' 2>/dev/null || true)
fi
if [[ -z "${ACCOUNT_ID}" && -n "${ACCTS_JSON}" ]]; then
  ACCOUNT_ID=$(echo "${ACCTS_JSON}" | jq -r '.. | objects | select(.id?) | .id' | head -n1 2>/dev/null || true)
fi
ACCOUNT_ID="$(echo -n "${ACCOUNT_ID}" | tr -d '\r\n ')"

sleep 1

echo "Fetching transactions (all accounts, date range wide)..."
TXNS_RAW=$(call_mcp "txn-1" "{
  \"jsonrpc\": \"2.0\",
  \"id\": \"txn-1\",
  \"method\": \"tools/call\",
  \"params\": {
    \"name\": \"get-transactions\",
    \"arguments\": {
      \"startDate\": \"1900-01-01\",
      \"endDate\": \"2999-12-31\"
      $(if [[ -n "${ACCOUNT_ID}" ]]; then echo ", \"accountId\": \"${ACCOUNT_ID}\""; fi)
    }
  }
}")
TXNS_JSON=$(echo "${TXNS_RAW}" | extract_data_json)
echo "${TXNS_JSON}"

if [[ "${TEST_WRITES}" == "1" ]]; then
  echo "TEST_WRITES=1 -> running write tests (temporary resources)."
  # ACCOUNT_ID already set above
  if [[ -z "${ACCOUNT_ID}" ]]; then
    echo "No account ID found to post a test transaction; skipping txn write test."
  else
    echo "Adding a tiny test transaction..."
    ADD_RESP=$(call_mcp "add-1" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"add-1\",
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"add-transaction\",
        \"arguments\": {
          \"accountId\": \"${ACCOUNT_ID}\",
          \"date\": \"2025-12-31\",
          \"amount\": -1,
          \"payeeName\": \"Smoke Test\",
          \"notes\": \"Non-destructive tiny txn\"
        }
      }
    }")
    echo "${ADD_RESP}"
    ADD_JSON=$(echo "${ADD_RESP}" | extract_data_json)
    TXN_ID=$(echo "${ADD_JSON}" | jq -r '.. | strings | select(startswith("Created transaction ")) | split(" ") | .[2] // empty')
  fi

  echo "Creating a temp category group..."
  CG_RESP=$(call_mcp "cg-1" '{
    "jsonrpc": "2.0",
    "id": "cg-1",
    "method": "tools/call",
    "params": {
      "name": "create-category-group",
      "arguments": { "groupName": "Smoke Group", "isIncomeGroup": false }
    }
  }')
  echo "${CG_RESP}"
  CG_JSON=$(echo "${CG_RESP}" | extract_data_json)
  CG_ERROR=$(echo "${CG_JSON}" | jq -r '.result.isError // false' 2>/dev/null || true)
  CG_ID=$(echo "${CG_JSON}" | jq -r '.. | strings | select(startswith("Created category group")) | split(" ") | last // empty')
  if [[ "${CG_ERROR}" == "true" || -z "${CG_ID}" ]]; then
    echo "Skipping remaining write tests: category group not created (response indicated error or missing ID)."
    TEST_WRITES=0
  fi

  echo "Creating a temp category..."
  CAT_RESP=$(call_mcp "cat-1" "{
    \"jsonrpc\": \"2.0\",
    \"id\": \"cat-1\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"create-category\",
      \"arguments\": { \"groupId\": \"${CG_ID}\", \"categoryName\": \"Smoke Cat\" }
    }
  }")
  echo "${CAT_RESP}"
  CAT_JSON=$(echo "${CAT_RESP}" | extract_data_json)
  CAT_ERROR=$(echo "${CAT_JSON}" | jq -r '.result.isError // false' 2>/dev/null || true)
  CAT_ID=$(echo "${CAT_JSON}" | jq -r '.. | strings | select(startswith("Created category ")) | split(" ") | last // empty')
  if [[ "${CAT_ERROR}" == "true" || -z "${CAT_ID}" ]]; then
    echo "Skipping remaining write tests: category not created (response indicated error or missing ID)."
    TEST_WRITES=0
  fi

  echo "Creating a temp payee..."
  PAYEE_RESP=$(call_mcp "payee-1" '{
    "jsonrpc": "2.0",
    "id": "payee-1",
    "method": "tools/call",
    "params": {
      "name": "create-payee",
      "arguments": { "payeeName": "Smoke Payee" }
    }
  }')
  echo "${PAYEE_RESP}"
  PAYEE_JSON=$(echo "${PAYEE_RESP}" | extract_data_json)
  PAYEE_ERROR=$(echo "${PAYEE_JSON}" | jq -r '.result.isError // false' 2>/dev/null || true)
  PAYEE_ID=$(echo "${PAYEE_JSON}" | jq -r '.. | strings | select(startswith("Created payee ")) | split(" ") | last // empty')
  if [[ "${PAYEE_ERROR}" == "true" || -z "${PAYEE_ID}" ]]; then
    echo "Skipping remaining write tests: payee not created (response indicated error or missing ID)."
    TEST_WRITES=0
  fi

  echo "Creating a temp rule..."
  RULE_RESP=$(call_mcp "rule-1" '{
    "jsonrpc": "2.0",
    "id": "rule-1",
    "method": "tools/call",
    "params": {
      "name": "create-rule",
      "arguments": {
        "stage": "pre",
        "conditionsOp": "and",
        "conditions": [
          { "field": "amount", "op": "lt", "value": -1 }
        ],
        "actions": [
          { "op": "append-notes", "value": " smoke" }
        ]
      }
    }
  }')
  echo "${RULE_RESP}"
  RULE_JSON=$(echo "${RULE_RESP}" | extract_data_json)
  RULE_ERROR=$(echo "${RULE_JSON}" | jq -r '.result.isError // false' 2>/dev/null || true)
  RULE_ID=$(echo "${RULE_JSON}" | jq -r '.. | strings | select(startswith("Created rule ")) | split(" ") | last // empty')
  if [[ "${RULE_ERROR}" == "true" || -z "${RULE_ID}" ]]; then
    echo "Rule not created (response indicated error or missing ID)."
  fi

  echo "Cleaning up temp resources..."
  if [[ -n "${RULE_ID}" ]]; then
    call_mcp "rule-del" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"rule-del\",
      \"method\": \"tools/call\",
      \"params\": { \"name\": \"delete-rule\", \"arguments\": { \"ruleId\": \"${RULE_ID}\" } }
    }" >/dev/null || true
  fi
  if [[ -n "${PAYEE_ID}" ]]; then
    call_mcp "payee-del" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"payee-del\",
      \"method\": \"tools/call\",
      \"params\": { \"name\": \"delete-payee\", \"arguments\": { \"payeeId\": \"${PAYEE_ID}\" } }
    }" >/dev/null || true
  fi
  if [[ -n "${CAT_ID}" ]]; then
    call_mcp "cat-del" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"cat-del\",
      \"method\": \"tools/call\",
      \"params\": { \"name\": \"delete-category\", \"arguments\": { \"categoryId\": \"${CAT_ID}\" } }
    }" >/dev/null || true
  fi
  if [[ -n "${CG_ID}" ]]; then
    call_mcp "cg-del" "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"cg-del\",
      \"method\": \"tools/call\",
      \"params\": { \"name\": \"delete-category-group\", \"arguments\": { \"groupId\": \"${CG_ID}\" } }
    }" >/dev/null || true
  fi
else
  echo "TEST_WRITES=0 (default) -> skipping write tests to avoid modifying data."
fi

if [[ -n "${STREAM_PID:-}" ]]; then
  kill "${STREAM_PID}" >/dev/null 2>&1 || true
fi

echo "Smoke test complete."
if [[ -s "${STREAM_LOG}" ]]; then
  echo "SSE stream log (debug):"
  cat "${STREAM_LOG}"
fi
