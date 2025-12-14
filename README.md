## Simple Streamable HTTP MCP Server

A minimal Model Context Protocol (MCP) HTTP server for the Actual Budget API. It exposes the Actual tools over HTTP with server-sent events for streaming responses.

### What it does
- Runs an MCP server at `/mcp` with streaming (SSE) support.
- Provides tool endpoints for Accounts, Transactions, Categories, Payees, Rules, reporting, and AI-style summaries.

### Prerequisites
- Node 18+ (matches the SDK requirement)
- npm
- Actual credentials: `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID` (required to start the server)

### Install
```bash
npm install
```

### Run (dev)
```bash
export ACTUAL_SERVER_URL=https://your-actual
export ACTUAL_PASSWORD=...
export ACTUAL_SYNC_ID=... # Find your sync_id in your Actual Server advanced settings
npm run dev
```
The server listens on `http://localhost:3000/mcp` by default.

### Build & run compiled output
```bash
npm run build
npm start
```

### Docker
Build and run locally:
```bash
npm run docker:run
# or manually
npm run docker:build
docker run --rm -p 3000:3000 \
  -e MCP_PORT=3000 \
  -e ACTUAL_SERVER_URL=https://your-actual \
  -e ACTUAL_PASSWORD=... \
  -e ACTUAL_SYNC_ID=... \
  ghcr.io/trek-boldly-go/actual-budget-mcp-server:latest
```

### Docker Compose (MCP + Keycloak OAuth)
The repo includes a compose stack that runs the MCP server and Keycloak, with a realm preloaded from an env-templated JSON. First/last name and email are populated so the default user can authenticate without extra profile setup.
```bash
docker compose up -d
```

Services:
- `mcp` (ports `3000:3000`): runs with `MCP_AUTH_MODE=oauth` and introspects tokens against Keycloak.
- `keycloak` (ports `8080:8080`): imports `docker/keycloak/realm-export/actual-mcp-realm.template.json` rendered by `keycloak-realm-builder`. If you change `KEYCLOAK_REALM`, also override the MCP issuer envs (compose defaults do not nest).
- `keycloak-realm-builder`: renders the realm template with env vars before Keycloak starts.

Images and platforms:
- `mcp` service keeps the published image name and will build locally if missing (so arm64 works). Override the target platform with `MCP_DOCKER_PLATFORM` (default `linux/amd64`); if you prefer native, set `MCP_DOCKER_PLATFORM=linux/arm64`.

Environment knobs (with defaults):
- `MCP_PORT` (default `3000`), `MCP_AUTH_MODE` (default `oauth`), `MCP_PUBLIC_URL` (default `http://localhost:3000/mcp`)
- `MCP_OAUTH_ISSUER_URL` (default `http://keycloak:8080/realms/${KEYCLOAK_REALM}`)
- `KEYCLOAK_REALM` (default `actual-mcp`)
- `KEYCLOAK_PUBLIC_CLIENT_ID` (default `actual-mcp-public`)
- `KEYCLOAK_INTROSPECTION_CLIENT_ID` / `KEYCLOAK_INTROSPECTION_CLIENT_SECRET` (default `actual-mcp-introspection` / `actual-mcp-introspection-secret`)
- `KEYCLOAK_DEMO_USER` / `KEYCLOAK_DEMO_PASSWORD` (default `demo-user` / `demo-pass`)
- `KEYCLOAK_DEMO_FIRST_NAME` / `KEYCLOAK_DEMO_LAST_NAME` (default `Demo` / `User`)
- `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` (default `admin` / `admin`)
- Actual credentials (required): `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID`

Getting a token for testing:
```bash
curl -X POST http://localhost:8080/realms/actual-mcp/protocol/openid-connect/token \
  -d grant_type=password \
  -d client_id=actual-mcp-public \
  -d username=demo-user \
  -d password=demo-pass
```
Then call the MCP server with `Authorization: Bearer <access_token>`. If you prefer UI login, you can also run a standard authorization code flow via your OAuth client.

Redirect URIs for `actual-mcp-public` (preloaded):
- `http://localhost:3000/*`
- `http://localhost:4173/*`
Add your MCP client’s exact callback if it differs.

### Environment variables
- `MCP_PORT` (default `3000`)
- `MCP_PUBLIC_URL` (default `http://localhost:<MCP_PORT>/mcp`) used for OAuth resource metadata
- `MCP_AUTH_MODE` (`bearer` default) choose `none`, `bearer`, or `oauth`
- `MCP_BEARER_TOKEN` required when `MCP_AUTH_MODE=bearer`
- OAuth mode:
  - `MCP_OAUTH_INTERNAL_ISSUER_URL` (e.g., `http://keycloak:8080/realms/actual-mcp`) used by the server for discovery/introspection (defaults to `MCP_OAUTH_ISSUER_URL`)
  - `MCP_OAUTH_ISSUER_URL` (back-compat) falls back to internal issuer when `MCP_OAUTH_INTERNAL_ISSUER_URL` is unset. If you change `KEYCLOAK_REALM`, update these explicitly; compose does not nest defaults.
  - `MCP_OAUTH_CLIENT_ID` / `MCP_OAUTH_CLIENT_SECRET` (used for token introspection)
  - `MCP_OAUTH_INTROSPECTION_URL` (optional override; defaults to issuer metadata)
  - `MCP_OAUTH_AUDIENCE` (optional audience/resource value to enforce)
  - `MCP_OAUTH_PUBLIC_ISSUER_URL` (optional) public-facing issuer to advertise in metadata; server still uses the internal issuer for discovery/introspection
  - `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL` (set to `true` for HTTP issuers in dev only)
- Actual configuration: `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID` (required for real Actual usage)
- `ACTUAL_DATA_DIR` (default `/app/.actual-data` in Docker)
- `ACTUAL_ENCRYPTION_PASS` (optional)
- Amounts: all tools and rules use the currency’s smallest unit (e.g., cents for USD).

### Authentication
The server now supports three modes via `MCP_AUTH_MODE` (default `bearer`):
- `bearer` (default): Require `Authorization: Bearer <MCP_BEARER_TOKEN>` on every `/mcp` request. Set `MCP_BEARER_TOKEN` to a long random value.
- `oauth`: Use OAuth 2.1/2.0 Bearer tokens from an external Authorization Server (e.g., Keycloak). The server introspects tokens with `MCP_OAUTH_CLIENT_ID` / `MCP_OAUTH_CLIENT_SECRET`, exposes OAuth protected resource metadata at `/.well-known/oauth-protected-resource/mcp`, and enforces `MCP_OAUTH_AUDIENCE` if provided.
- `none`: No authentication (only for trusted networks).

Quick bearer setup:
1) Set `MCP_AUTH_MODE=bearer` and `MCP_BEARER_TOKEN="<long-random-token>"`.
2) Restart the server.
3) Configure your MCP client to send `Authorization: Bearer <long-random-token>` on `/mcp`.

Quick OAuth (Keycloak) flow:
1) Set `MCP_AUTH_MODE=oauth`, `MCP_OAUTH_ISSUER_URL`, `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET`, and optionally `MCP_OAUTH_AUDIENCE`.
2) Ensure your Authorization Server supports the RFC 7662 introspection endpoint; the server will auto-discover it from the issuer metadata.
3) Clients can discover the resource metadata at `/.well-known/oauth-protected-resource/mcp` and follow the `authorization_servers` entry to your IdP.

### Development notes
- Lint: `npm run lint` (standard-with-typescript, semicolons enforced)
- Build: `npm run build`
- CI publishes Docker images to GHCR on `main` pushes (`.github/workflows/ci.yml`).

### Where to wire in the real Actual API
- `src/actual/client.ts` connects directly to your Actual server. All reads and writes are live; provide required env vars before starting.
