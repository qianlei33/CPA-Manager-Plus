# CPA Manager Plus

[中文文档](README_CN.md)

A single-file Web UI for **CLI Proxy API (CPA)** plus a **Manager Server** for multi-node CPA management, persistent usage analytics, and panel hosting.

Since v6.10.0, CPA no longer includes built-in usage statistics. This project now supports usage analytics through a long-running Manager Server that consumes the CPA usage queue, persists request events to SQLite, and exposes panel-compatible usage APIs.

CPA Manager Plus is the recommended successor to CPA-Manager. It combines the CPA management panel with a Docker-ready Manager Server, Plus-token protected full-panel mode, encrypted per-node CPA Management Key storage, server-backed analytics, model pricing, API key aliases, dashboard cards, multi-node request monitoring, and Codex account inspection.

- **CPA Main project**: https://github.com/router-for-me/CLIProxyAPI
- **Recommended CPA version**: >= v7.1.39
- **Minimum CPA version for HTTP usage queue**: >= v6.10.8

## Panel Preview

![Dashboard overview showing Manager Server status, usage metrics, request health, token breakdowns, model costs, and collector state](img/dashboard-overview.png)
![Request monitoring account overview showing account statistics, quota progress, token structure, model usage, and per-account costs](img/request-monitoring-account-overview.png)
![Request monitoring realtime events showing recent calls, model, reasoning effort, request status, TPS, latency, usage, and cost](img/request-monitoring-realtime-events.png)
![Server Codex account inspection showing scheduled runs, result pagination, account status, cleanup recommendations, and logs](img/server-codex-inspection.png)

## What This Provides

- A single-file React management panel for CPA Management API (`/v0/management`)
- A Dockerized Manager Server for SQLite-backed usage persistence and built-in panel hosting
- Native `amd64` and `arm64` packages for Windows, macOS, and Linux with the panel embedded
- Multi-node CPA management: add multiple CPA nodes, switch the current node in the header, and keep each node's connection key and collector settings independent
- Two deployment modes:
  - **Full Docker mode**: open the built-in panel from Manager Server; first install initializes the Plus login token, then CPA nodes are added from the Node Management page
  - **CPA panel mode**: keep using CPA's `/management.html` as a pure CPA panel; it does not configure or call a separate Manager Server
- Full Docker mode adds runtime monitoring, account/model/channel breakdowns, model pricing, estimated token cost, imports/exports, API key aliases, server Codex inspection, and Manager Server system utilities
- Both modes keep normal CPA management and local Codex account inspection available

## Choose a Deployment Mode

| Mode | Entry URL | What the user configures | Best for |
|---|---|---|---|
| Full Docker mode | `http://<host>:18317/management.html` | First install: Plus login token; after login: add one or more CPA nodes with CPA URL + CPA Management Key | New deployments, one entry point, multi-node monitoring, least browser/CORS complexity |
| CPA panel mode | `http://<cpa-host>:8317/management.html` | Log in to CPA with the CPA Management Key | Existing CPA automatic panel loading without Manager Server analytics |
| Frontend only | Vite dev server or `apps/web/dist/index.html` | CPA URL | Development |

Full Docker mode does not bundle CPA itself. CPA still runs as the upstream service; the Docker image provides the Manager Server plus an embedded copy of this management panel.

### Feature Boundary by Mode

| Capability | Full Docker mode | CPA panel mode |
|---|---:|---:|
| CPA config, provider/account/key management, auth files, logs, quota views, and CPA Management API features | Yes | Yes |
| Local Codex account inspection in the browser | Yes | Yes |
| Plus login token, encrypted per-node CPA Management Key storage, node management | Yes | No |
| Request monitoring, dashboard usage statistics, model prices, API key aliases, usage import/export | Yes | No |
| Server Codex inspection, scheduled runs, persisted inspection history | Yes | No |
| Manager Server `/status`, CPA node APIs, `/v0/management/usage`, model-price, alias, and import/export APIs | Plus login token only | Not used |

One Manager Server can manage multiple CPA nodes. Each node stores its own CPA Base URL, encrypted CPA Management Key, enabled state, request-monitoring switch, and collector settings. The header node selector controls which CPA node the panel manages; Manager Server also forwards node-aware requests with `X-CPA-Node-ID`.

## CPA Prerequisites

Request statistics require the CPA usage queue:

- CPA Management must be enabled because the usage queue uses the same availability and CPA Management Key as `/v0/management`.
- Request monitoring requires CPA usage publishing: set `usage-statistics-enabled: true`, or submit `{ "value": true }` to `PUT /usage-statistics-enabled`. CPA Manager Plus attempts to enable this automatically for a CPA node when request monitoring is enabled while adding or editing that node.
- Disabling CPAM request monitoring only stops the Manager Server collector. It does not automatically disable CPA usage publishing or clear the CPA usage queue. If CPA usage publishing remains enabled, re-enabling request monitoring within the queue retention window may collect events retained while the collector was stopped.
- CPA `v7.1.39+` is recommended for current panel capabilities and the full Redis usage metadata set used by newer monitoring views: request-side `reasoning_effort`, `service_tier`, `executor_type`, `tokens.cache_read_tokens`, `tokens.cache_creation_tokens`, `fail.status_code`, and `fail.body`. CPA `v6.10.8+` already exposes the HTTP usage queue endpoint `/v0/management/usage-queue`, which can pass through regular HTTP reverse proxies. Older compatible CPA versions omit these optional fields; CPA Manager Plus still imports and collects those events, with missing string fields shown as empty/unknown and missing numeric fields treated as `0`.
- CPA `v7.1.39+` RESP Pub/Sub emits usage control messages such as `{"support_refresh":true}` and `{"refresh":true}`. Current CPA Manager Plus filters those control messages instead of storing them as empty request rows; refresh messages also clear the auth snapshot cache so account metadata is re-read after CPA auth/config changes.
- `reasoning_effort` is the request-side reasoning configuration. It is not actual reasoning token usage; actual reasoning consumption is still reported by `tokens.reasoning_tokens`.
- Manager Server `auto` mode tries RESP Pub/Sub (`subscribe`) first, then the HTTP usage queue, then RESP pop mode for older CPA versions. RESP transports listen on the CPA API port, usually `8317`, and cannot pass through a regular HTTP reverse proxy.
- CPA keeps queue items in memory for `redis-usage-queue-retention-seconds`, default `60` seconds and maximum `3600` seconds. Keep Manager Server running continuously.
- Manager Server `pollIntervalMs` must be less than or equal to the CPA queue retention window converted to milliseconds. Saves are rejected when the collector would poll too slowly and risk expired queue items.
- Exactly one Manager Server should consume the same CPA node's usage queue. A single Manager Server may consume multiple different CPA nodes.

## Architecture

### Full Docker Mode

```text
Browser
  -> Manager Server :18317
      -> built-in management.html
      -> /v0/management/usage and /v0/management/model-prices from SQLite
      -> other /v0/management/* proxied to CPA
      -> HTTP/RESP/PubSub consumer -> CPA API port
      -> SQLite /data/usage.sqlite
```

On first startup, the login page calls `GET /usage-service/info` and detects that it is hosted by Manager Server. If Plus login credentials have not been initialized yet, the page asks you to set the Plus login token. CPA connections are no longer configured in a legacy `/setup` wizard. After logging in, open **CPA Nodes** from the header node menu, add one or more CPA nodes, enter each CPA Base URL and CPA Management Key, and choose whether request monitoring should be enabled for that node. When monitoring is enabled, Manager Server validates the CPA Management API, attempts to enable CPA usage publishing, checks the node polling interval against the CPA queue retention window, stores the node in SQLite, and starts an independent collector for that node.

After Manager Server is configured, a new browser opening the same URL uses the normal login form. Full Docker mode uses the Plus login token as the login credential; CPA Management Keys are stored server-side per node and are only used by Manager Server when it talks to the selected CPA upstream.

### CPA Panel Mode

```text
Browser
  -> CPA /management.html
      -> normal CPA Management API calls stay on CPA
      -> local Codex inspection runs in the browser
```

Use this when CPA still auto-downloads and serves the panel. This mode is served by CPA and is fully isolated from Manager Server. It does not show the Manager Server initialization page, does not ask for the Plus login token, does not save a Manager Server URL, and does not expose features backed by Manager Server SQLite or CPA usage statistics. The monitoring center, dashboard usage statistics, model pricing, API key aliases, usage import/export, collector status, and server Codex inspection are hidden or unavailable. Local Codex account inspection remains available because it runs in the browser against the CPA-accessible auth files.

### Manager Server Backend

The Go backend lives under the `github.com/seakee/cpa-manager-plus/apps/manager-server` module. It still exposes the compatible `/usage-service/*` management endpoints. Its request path follows a layered shape:

```text
model -> repository -> service -> controller -> router
```

- `internal/model` defines persisted and API-facing data structures.
- `internal/repository` owns SQLite access and schema migration while keeping the existing tables compatible.
- `internal/service` contains Plus initialization, CPA node management, usage, model price, API key alias, proxy, panel, and collector lifecycle rules.
- `internal/http/controller`, `internal/http/middleware`, and `internal/http/router` keep HTTP decoding, CORS/auth/recovery, Gin routing, and response writing at the edge.
- `internal/httpapi` remains a compatibility wrapper for the current `cmd/cpa-manager-plus` entrypoint.
- `internal/worker` coordinates collector startup/restart/stop without changing the existing HTTP, RESP Pub/Sub, RESP pop, and auto queue consumers.

## Quick Start: Full Docker Mode

### Container Images

Public multi-arch images are published to both registries:

- Docker Hub: `seakee/cpa-manager-plus`
- GitHub Container Registry: `ghcr.io/seakee/cpa-manager-plus`

```bash
docker run -d \
  --name cpa-manager-plus \
  --restart unless-stopped \
  -p 18317:18317 \
  -v cpa-manager-plus-data:/data \
  seakee/cpa-manager-plus:latest
```

Open:

```text
http://<host>:18317/management.html
```

On first install:

- Set the Plus login token on the first page.
- Log in with that token.
- Open **CPA Nodes** from the header node menu and add a CPA node.
- CPA URL examples:
  - Docker Desktop host CPA: `http://host.docker.internal:8317` (default suggestion unless the panel was built with `VITE_DEFAULT_CPA_BASE_URL`)
  - Same compose network: `http://cli-proxy-api:8317`
  - Remote CPA: `https://your-cpa.example.com`
- CPA Management Key

After the first node is saved, the same entry URL uses the node list stored in Manager Server SQLite. New browsers only need the Plus login token on the login page.

The published image supports `linux/amd64` and `linux/arm64`. Docker examples use Docker Hub by default. To pull from GitHub Container Registry instead, replace `seakee/cpa-manager-plus:latest` with `ghcr.io/seakee/cpa-manager-plus:latest`.

### Native Packages

GitHub Releases also provide native packages with the panel embedded:

- `cpa-manager-plus_<version>_linux_amd64.tar.gz`
- `cpa-manager-plus_<version>_linux_arm64.tar.gz`
- `cpa-manager-plus_<version>_darwin_amd64.tar.gz`
- `cpa-manager-plus_<version>_darwin_arm64.tar.gz`
- `cpa-manager-plus_<version>_windows_amd64.zip`
- `cpa-manager-plus_<version>_windows_arm64.zip`

macOS/Linux:

```bash
tar -xzf cpa-manager-plus_vX.Y.Z_linux_amd64.tar.gz
cd cpa-manager-plus_vX.Y.Z_linux_amd64
./cpa-manager-plus
```

The tar archives preserve execute permissions, so no extra `chmod +x` is normally required after extraction. If macOS blocks the unsigned binary, run `xattr -dr com.apple.quarantine .` in the extracted directory and start it again.

Windows PowerShell:

```powershell
Expand-Archive .\cpa-manager-plus_vX.Y.Z_windows_amd64.zip -DestinationPath .
cd .\cpa-manager-plus_vX.Y.Z_windows_amd64
.\cpa-manager-plus.exe
```

You can double-click `cpa-manager-plus.exe` on Windows, but PowerShell is recommended because it keeps logs and startup errors visible.

Then open:

```text
http://<host>:18317/management.html
```

Native packages do not include CPA itself. Run CPA separately, set the Plus login token on first install, then add CPA nodes from the Node Management page. After initialization, the login page only needs the Plus login token. Set `USAGE_DATA_DIR` or `USAGE_DB_PATH` only when you want to override the default data location.

On first start, if `USAGE_DATA_DIR` and `USAGE_DB_PATH` are not set, the native package creates `config.json` next to the binary and writes SQLite data to `data/usage.sqlite` in the same directory. When developing with `go run ./cmd/cpa-manager-plus`, defaults are resolved from the current working directory instead of Go's temporary build directory, so repeated restarts use the same `config.json`, `data/usage.sqlite`, and `data/data.key`.

### Docker Compose

```yaml
services:
  cpa-manager-plus:
    image: seakee/cpa-manager-plus:latest
    restart: unless-stopped
    ports:
      - "18317:18317"
    volumes:
      - cpa-manager-plus-data:/data

volumes:
  cpa-manager-plus-data:
```

Start:

```bash
docker compose up -d
```

To use GitHub Container Registry, replace the compose image with `ghcr.io/seakee/cpa-manager-plus:latest`.

### Linux Host CPA

If CPA runs directly on a Linux host and Manager Server runs in Docker, add a host gateway:

```bash
docker run -d \
  --name cpa-manager-plus \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 18317:18317 \
  -v cpa-manager-plus-data:/data \
  seakee/cpa-manager-plus:latest
```

Then enter `http://host.docker.internal:8317` as the CPA URL when adding a CPA node.

## Quick Start: CPA Panel Mode

1. Start CPA as usual and open:

   ```text
   http://<cpa-host>:8317/management.html
   ```

   Log in to CPA with the CPA Management Key. This entry is served by CPA and does not use Manager Server initialization.

2. To make CPA use this project as its default panel, open:

   ```text
   Configuration -> Remote Access and Control Panel
   ```

   Set **Panel Repository** (`remote-management.panel-repo`) to:

   ```text
   https://github.com/seakee/CPA-Manager-Plus
   ```

   Keep **Disable Control Panel** off. If **Disable Panel Auto Updates** is on, CPA only downloads the panel when the cached `static/management.html` is missing.

3. Save the CPA configuration and reload:

   ```text
   http://<cpa-host>:8317/management.html
   ```

4. Use the CPA panel normally.

This mode is intentionally limited to CPA-backed functionality. It does not configure Manager Server, does not send the current CPA URL or CPA Management Key to Manager Server, and does not read Manager Server SQLite data. Use Full Docker mode when you need request monitoring, historical usage statistics, model pricing, API key aliases, usage import/export, or server Codex inspection.

## Build Locally

```bash
docker compose -f docker-compose.manager.yml up --build
```

This builds the React panel and embeds it into the Go Manager Server binary.

## Manager Server Configuration

CPA connections are managed as CPA nodes after logging in. Each node stores its CPA Base URL, encrypted CPA Management Key, enabled state, request-monitoring switch, and collector settings in SQLite. The old `CPA_UPSTREAM_URL` / `CPA_MANAGEMENT_KEY` environment variables remain as a compatibility fallback when no CPA nodes are configured, but the recommended path is to add nodes from the UI or the CPA node API.

The variables below are Manager Server runtime settings. Frontend build-time settings are separate: `VITE_DEFAULT_CPA_BASE_URL` only affects UI defaults when adding nodes; it does not create a node by itself.

| Variable | Default | Description |
|---|---:|---|
| `CPA_MANAGER_CONFIG` | empty | Optional config file path. When empty, native packages use `config.json` next to the binary |
| `HTTP_ADDR` | `0.0.0.0:18317` | Manager Server HTTP listen address |
| `USAGE_DB_PATH` | Docker: `/data/usage.sqlite`; native: `./data/usage.sqlite` | SQLite database path |
| `USAGE_DATA_DIR` | Docker: `/data`; native: `./data` | Base data directory when `USAGE_DB_PATH` is not overridden |
| `CPA_MANAGER_ADMIN_KEY` | empty | Optional preconfigured Plus login token/admin credential for unattended deployments; when empty, first install asks the user to set one in the browser |
| `CPA_MANAGER_ADMIN_KEY_FILE` | `/run/secrets/cpa_admin_key` | Optional file containing the preconfigured Plus login token/admin credential |
| `CPA_MANAGER_DATA_KEY` | empty | Optional data encryption key; when empty, read or generate it through `CPA_MANAGER_DATA_KEY_PATH` |
| `CPA_MANAGER_DATA_KEY_FILE` | `/run/secrets/cpa_data_key` | Optional data encryption key file |
| `CPA_MANAGER_DATA_KEY_PATH` | Docker: `/data/data.key`; native: `./data/data.key` | Auto-generated data encryption key file path |
| `CPA_UPSTREAM_URL` | empty | Compatibility fallback CPA base URL used only when no CPA nodes are configured |
| `CPA_MANAGEMENT_KEY` | empty | Compatibility fallback CPA Management Key used only when no CPA nodes are configured |
| `CPA_MANAGEMENT_KEY_FILE` | `/run/secrets/cpa_management_key` | Optional file for the fallback CPA Management Key |
| `USAGE_COLLECTOR_MODE` | `auto` | Default/fallback collection mode. CPA nodes store their own collector mode and override this value in multi-node mode |
| `USAGE_RESP_QUEUE` | `usage` | Default/fallback RESP key argument; node-level `queue` overrides it |
| `USAGE_RESP_POP_SIDE` | `right` | Default/fallback pop side; node-level `popSide` overrides it |
| `USAGE_BATCH_SIZE` | `100` | Default/fallback maximum queue records per pop; node-level `batchSize` overrides it |
| `USAGE_POLL_INTERVAL_MS` | `500` | Default/fallback idle polling interval; node-level `pollIntervalMs` overrides it |
| `USAGE_QUERY_LIMIT` | `50000` | Default/fallback recent event query limit; node-level `queryLimit` overrides it |
| `USAGE_CORS_ORIGINS` | `*` | Allowed browser origins for CPA panel mode |
| `USAGE_RESP_TLS_SKIP_VERIFY` | `false` | Skip TLS verification for RESP connection |
| `PANEL_PATH` | empty | Serve a custom `management.html` instead of the embedded one |

Startup configuration precedence is: environment variables > `config.json` > program defaults. Relative paths in the config file are resolved from the config file directory. The generated default config is:

```json
{
  "httpAddr": "0.0.0.0:18317",
  "dataDir": "./data"
}
```

If `CPA_MANAGER_ADMIN_KEY` is set before the first boot, the service initializes the Plus login credential from that value. Otherwise, the first browser visit asks the user to set the Plus login token. CPA nodes are stored in SQLite `cpa_nodes`; node secrets are encrypted with the data key.

### CPA vs CPA Manager Plus Configuration Boundary

- **CPA configuration**: `usage-statistics-enabled`, `redis-usage-queue-retention-seconds`, proxy, logging, routing, auth files, and related fields still belong to CPA and are managed by `/config` / `/config.yaml`.
- **CPA Manager Plus configuration**: Plus login token, data key, CPA node list, encrypted per-node CPA Management Keys, request monitoring enablement, and node collector settings are persisted in Manager Server SQLite in Full Docker mode. Plus global settings are managed from the header **Plus Settings** entry; CPA connections are managed from **CPA Nodes**.
- The configuration panel edits CPA configuration for the current node. Saving CPAM node settings does not write to CPA `config.yaml`; enabling request monitoring for a node calls CPA Management API to enable usage publishing, while disabling request monitoring only stops that node's CPAM collector.

### Migration Guide

When upgrading from the old CPA-Manager project, read [Migration from CPA-Manager](docs/migration-from-cpa-manager.md) first. The core rules are:

1. Stop the old backend service before backup, then back up the old `/data` directory or Docker volume, including at least `usage.sqlite`, `usage.sqlite-wal`, and `usage.sqlite-shm`.
2. Start CPA Manager Plus with the same old `/data` volume, or copy the old data into the new `/data`. The old project often used `cpa-manager-data`; the Plus examples use `cpa-manager-plus-data`. Do not accidentally start with an empty new volume.
3. On first Plus startup, the service adds `settings.admin_credential_v1`, `settings.bootstrap_state_v1`, and `/data/data.key`. From this point forward, backups must include both SQLite files and `data.key`.
4. Full Docker mode now logs in with the Plus login token, not the CPA Management Key. Prefer setting `CPA_MANAGER_ADMIN_KEY` or `CPA_MANAGER_ADMIN_KEY_FILE` during unattended migration, or initialize the token in the browser on first visit.
5. Older single-node `/setup` data is retained only as compatibility data. Current deployments should add CPA connections through CPA Nodes; historical usage migration is not automatic.
6. If you use `CPA_UPSTREAM_URL` / `CPA_MANAGEMENT_KEY`, they are treated as fallback values only when no CPA nodes exist. To switch to node persistence, remove those environment variables if desired, restart, and add nodes from the panel.
7. Older external-Manager CPA panel integrations are no longer supported. Open the Manager Server-hosted panel to view historical usage data, model prices, aliases, imports/exports, and server inspection history. CPA panel mode remains a pure CPA panel.

## Data and Security Notes

- SQLite data is stored under `/data`; mount it to persistent storage.
- The Plus login token/admin credential is not stored in plaintext. SQLite `settings.admin_credential_v1` stores only the salt and HMAC-SHA256 digest. Use `CPA_MANAGER_ADMIN_KEY_FILE` with Docker Secret or an external secret manager when you want unattended credential initialization.
- CPA Management Keys are encrypted with the data key before they are stored in SQLite `cpa_nodes`, so node collectors and CPA Management API proxying can resume after restart.
- The data key is provided by `CPA_MANAGER_DATA_KEY` / `CPA_MANAGER_DATA_KEY_FILE`, or generated at `CPA_MANAGER_DATA_KEY_PATH`; Docker defaults to `/data/data.key` with `0600` permissions.
- Data key security assessment: AES-GCM prevents a leaked SQLite file alone from directly exposing the CPA Management Key. If an attacker gets both `/data/usage.sqlite` and `/data/data.key`, the CPA Management Key can still be decrypted. If the data key is lost, encrypted CPA Management Key values cannot be recovered and the CPA connection must be initialized or saved again.
- CPA nodes are stored in SQLite `cpa_nodes`; legacy `settings.setup` and `settings.manager_config_v1` are compatibility data.
- Protect the `/data` volume. It contains usage metadata, Plus credential digest, the data key file, and encrypted per-node CPA Management Keys.
- Manager Server redacts key-like fields before storing raw JSON payload snapshots, but request metadata may still expose requested/resolved models, endpoints, account labels, project snapshots, and token usage.
- RESP pop queue consumption is destructive. RESP Pub/Sub is streaming. Do not run multiple Manager Server consumers against the same CPA instance.
- If Manager Server is down longer than CPA's queue retention window, that period's usage cannot be recovered without CPA-side persistence.
- If only the CPAM collector is stopped while CPA usage publishing remains enabled, restarting the collector within the retention window may consume queue items produced while collection was disabled.

## Runtime Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Basic health check |
| `GET /status` | SQLite, event count, global collector status, and per-node collector status |
| `GET /usage-service/info` | Allows the frontend to detect Manager Server mode, Plus credential state, and whether CPA nodes exist |
| `GET /v0/management/cpa-nodes` | Lists configured CPA nodes |
| `POST /v0/management/cpa-nodes` | Creates a CPA node with connection, key, and collector settings |
| `PUT /v0/management/cpa-nodes/{id}` | Updates a CPA node and hot-reloads collectors |
| `DELETE /v0/management/cpa-nodes/{id}` | Deletes a CPA node and stops its collector |
| `POST /v0/management/cpa-nodes/{id}/validate` | Validates a node's CPA Management API connection |
| `POST /v0/management/admin-token/init` | Initializes the Plus login token on first install |
| `PUT /v0/management/admin-token` | Rotates the Plus login token |
| `GET /v0/management/usage` | Compatible usage payload for the panel |
| `GET /v0/management/usage/export` | Export usage events as JSONL |
| `POST /v0/management/usage/import` | Import JSONL usage events or legacy JSON snapshots |
| `GET /v0/management/model-prices` | Read SQLite-backed model pricing |
| `PUT /v0/management/model-prices` | Replace saved model pricing |
| `POST /v0/management/model-prices/sync` | Sync model prices from LiteLLM, OpenRouter, and other pricing metadata sources, including source metadata |
| `GET /models`, `GET /v1/models` | Proxy model-list requests to the selected CPA node |
| `/v0/management/*` | Proxied to the selected CPA node except Manager Server-owned endpoints |

After Plus initialization, `/status`, usage, model-pricing, node management, and `/v0/management/*` proxy endpoints require the Plus login token as a Bearer token. CPA Management Keys are not accepted for Manager Server-only endpoints; they are stored server-side per node and used only by Manager Server when it talks to CPA upstream. With multiple enabled nodes, node-aware proxy requests require the current node context via `X-CPA-Node-ID` or `nodeId`.

Usage import accepts two file families: JSONL/NDJSON event files exported by Manager Server, and legacy JSON snapshots produced by older CPA `/usage/export`. Legacy JSON can be converted only when `usage.apis.*.models.*.details[]` request details are present. Files that contain only aggregate totals are rejected because request-level monitoring data cannot be reconstructed. Legacy import is a migration/recovery path, not a perfect continuation of newly collected Manager Server data: old files may miss metadata such as `api_key_hash`, channel, request ID, method/path, latency, cache tokens, or failure reason, so account matching, API Key level analysis, and detail accuracy may be lower. Importing legacy files affects totals, trend charts, and account/key breakdowns; use a test or backup database first when accuracy matters.

Failure bodies from CPA usage events are treated as sensitive diagnostics. Manager Server keeps the raw `fail_body` only in the local SQLite database for internal troubleshooting, while normal APIs, compatible usage payloads, and JSONL exports expose only `fail_summary`, which is redacted and truncated. JSONL exports intentionally omit `raw_json` and raw `fail_body`; imports remain compatible with older exports and snapshots.

## Feature Overview

- **Dashboard**: connection state, backend version, quick health summary
- **Configuration**: visual/source editing for CPA configuration of the current node, including Codex `identity-confuse`
- **CPA Nodes**: add, edit, validate, switch, and delete CPA nodes; configure node-level request monitoring and collector polling
- **AI Providers**: Gemini, Codex, Claude, Vertex, OpenAI-compatible providers, and Ampcode
- **Auth Files**: upload, download, delete, status, OAuth exclusions, model aliases
- **Quota**: quota views for supported providers
- **Request Monitoring**: persisted usage KPIs, model/channel/account/API-key breakdowns, requested vs resolved model tracking, project snapshots, model pricing, estimated token cost, failure analysis, realtime tables with a readable source label and one prioritized supplemental detail
- **Codex Account Inspection**: batch probing and cleanup suggestions for Codex auth pools
- **Logs**: incremental file log reading and filtering
- **Plus Settings**: view Manager Server runtime state and rotate the Plus login token
- **System Info**: current-node model list, version checks, and local state tools

## Development

Frontend:

```bash
npm install
npm run dev
npm run type-check
npm run lint
npm run build
```

Manager Server:

```bash
cd apps/manager-server
go test ./...
go test -race ./...
go vet ./...
go run ./cmd/cpa-manager-plus
```

## Build and Release

- Vite builds a single-file `apps/web/dist/index.html`.
- Tagging `vX.Y.Z` or a prerelease tag such as `vX.Y.Z-beta` triggers `.github/workflows/release.yml`.
- The release workflow uploads `apps/web/dist/management.html`, native packages, and `checksums.txt` to GitHub Releases.
- Native packages are published for `linux`, `darwin`, and `windows` on both `amd64` and `arm64`, with the management panel embedded.
- The same workflow builds `Dockerfile.manager-server` and pushes public images to Docker Hub and GitHub Container Registry.
- The Docker image is published for `linux/amd64` and `linux/arm64`.
- The GitHub Container Registry image is `ghcr.io/seakee/cpa-manager-plus`; it uses the workflow `GITHUB_TOKEN` with `packages: write`.
- The workflow syncs `README.md` to the Docker Hub overview when Docker Hub publishing is enabled.
- Optional GitHub secrets for Docker Hub publishing:
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`

## Troubleshooting

- **Cannot connect in full Docker mode**: verify the CPA URL from inside the Manager Server container. For host CPA on Linux, use `--add-host=host.docker.internal:host-gateway`.
- **Full Docker mode opens the login form immediately**: Plus credentials have already been initialized. Enter the Plus login token, then manage CPA nodes from the header node menu.
- **No CPA nodes after login**: open the header node menu and choose **Node Management**, then add a CPA node.
- **Monitoring is empty**: ensure the current node has request monitoring enabled, verify Manager Server `/status` `nodeCollectors`, and confirm only one consumer is running for that CPA node.
- **Realtime monitoring shows empty `-` request rows after upgrading CPA**: upgrade CPA Manager Plus. CPA `v7.1.39+` sends Pub/Sub control messages; older CPAM builds may store them as empty usage events.
- **`unsupported RESP prefix 'H'`**: upgrade CPA to `v6.10.8+` or keep `USAGE_COLLECTOR_MODE=http` for reverse-proxied HTTP queue access. RESP Pub/Sub/RESP pop modes require the CPA URL to be a container/host direct address for port `8317`, not a regular HTTP reverse-proxy domain.
- **CPA panel still shows the old panel**: verify that CPA **Panel Repository** is `https://github.com/seakee/CPA-Manager-Plus`. If the new panel still does not load, clear CPA's cached panel file and reload or restart CPA:
  ```bash
  rm static/management.html
  ```
- **401 from Manager Server**: Manager Server endpoints use the Plus login token. CPA Management Key is stored per node and is not accepted for Manager Server-only APIs.
- **Docker panel shows stale data**: check `/status` for `nodeCollectors`, `lastConsumedAt`, `lastInsertedAt`, and `lastError` for the selected node.
- **CPA panel mode is missing monitoring/pricing/imports**: this is expected. These are Full Docker / Manager Server-hosted panel features.
- **Data disappears after container rebuild**: mount `/data` to a Docker volume or host directory.
- **Old data is missing after migrating from CPA-Manager**: verify that the Plus container is mounting the old `/data` volume, not a newly created empty `cpa-manager-plus-data` volume.
- **Plus login token is lost**: setting `CPA_MANAGER_ADMIN_KEY` does not overwrite an existing `settings.admin_credential_v1`. Stop Manager Server, back up `/data`, and follow [Reset the Manager Server Admin Key](docs/reset-admin-key.md).
- **Detailed FAQ**: see [FAQ and Troubleshooting](https://github.com/seakee/CPA-Manager-Plus/wiki/CPA-Manager-Plus-FAQ-and-Troubleshooting) or the [Chinese FAQ](https://github.com/seakee/CPA-Manager-Plus/wiki/CPA%E2%80%90Manager-%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98%E4%B8%8E%E8%A7%A3%E5%86%B3%E6%96%B9%E6%A1%88).

## References

- CLIProxyAPI: https://github.com/router-for-me/CLIProxyAPI
- Redis usage queue documentation: https://help.router-for.me/management/redis-usage-queue.html
- Migration from CPA-Manager: [docs/migration-from-cpa-manager.md](docs/migration-from-cpa-manager.md)
- Reset the Manager Server admin key: [docs/reset-admin-key.md](docs/reset-admin-key.md)
- Release checklist: [docs/release-checklist.md](docs/release-checklist.md)

## Acknowledgements

- Thanks to the upstream projects [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) and [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) for the foundation and inspiration.
- Thanks to the [Linux.do](https://linux.do/) community for project promotion and feedback.

## License

MIT
