## Simple Streamable HTTP MCP Server

A minimal Model Context Protocol (MCP) HTTP server for the Actual Budget API. It exposes the Actual tools over HTTP with server-sent events for streaming responses. The Actual client is stubbed/in-memory by default—swap in real Actual API calls to make it production-ready.

### What it does
- Runs an MCP server at `/mcp` with streaming (SSE) support.
- Provides tool endpoints for Accounts, Transactions, Categories, Payees, Rules, reporting, and AI-style summaries.
- Current limitation: all mutating tools (`add-transaction`, `update-transaction`, `delete-*`, etc.) are stubbed and return a read-only notice. Only read-style operations are functional.

### Prerequisites
- Node 18+ (matches the SDK requirement)
- npm

### Install
```bash
npm install
```

### Run (dev)
```bash
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
  ghcr.io/<owner>/actual-budget-mcp-server:latest
```

### Environment variables
- `MCP_PORT` (default `3000`)
- `MCP_BEARER_TOKEN` (optional) set to enable shared-secret auth; when set, clients must send `Authorization: Bearer <token>` on all `/mcp` requests.
- `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID` (required for real Actual usage)
- `ACTUAL_DATA_DIR` (default `/app/.actual-data` in Docker)
- `ACTUAL_ENCRYPTION_PASS` (optional)

### Authentication
Auth is off by default. To require a token on every MCP call while keeping setup easy:
1. Choose a secret and set `MCP_BEARER_TOKEN="your-long-random-token"` in your environment (or `.env` when using a process manager).
2. Restart the server.
3. Configure your MCP client to send `Authorization: Bearer your-long-random-token` to the `/mcp` endpoint. Most clients let you set a header in their server config.

The server validates the token on every POST/GET/DELETE to `/mcp` and will return 401 with a `WWW-Authenticate` header if the header is missing or the token is wrong. Remove `MCP_BEARER_TOKEN` to go back to unauthenticated mode.

### Development notes
- Lint: `npm run lint` (standard-with-typescript, semicolons enforced)
- Build: `npm run build`
- CI publishes Docker images to GHCR on `main` pushes (`.github/workflows/ci.yml`).

### Where to wire in the real Actual API
- `src/actual/client.ts` currently uses an in-memory stub with optional Actual API initialization. Replace stubbed sections with Actual SDK calls as needed.
