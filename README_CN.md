# CPA Manager Plus

[English](README.md)

这是面向 **CLI Proxy API（CPA）** 的单文件 Web 管理面板，并提供 **Manager Server** 用于多 CPA 节点管理、持久化请求统计和托管面板。

CPA 自 v6.10.0 起不再内置用量统计。当前方案通过常驻 Manager Server 消费 CPA 的用量队列，把请求级事件写入 SQLite，并向面板提供兼容的用量查询接口。

CPA Manager Plus 是 CPA-Manager 的推荐后续版本。它把 CPA 管理面板与可 Docker 部署的 Manager Server 组合在一起，提供 Plus 登录 token 保护的完整面板模式、按节点加密保存 CPA Management Key、服务端统计分析、模型价格、API Key 别名、仪表盘卡片、多节点请求监控和 Codex 账号巡检。

- **CPA 主项目**: https://github.com/router-for-me/CLIProxyAPI
- **推荐 CPA 版本**: >= v7.1.39
- **HTTP 用量队列最低 CPA 版本**: >= v6.10.8

## 面板预览

![首页仪表盘，展示 Manager Server 状态、用量指标、请求健康度、Token 构成、模型成本和采集器状态](img/dashboard-overview.png)
![请求监控账号汇总，展示账号统计、额度进度、Token 结构、模型使用和单账号成本](img/request-monitoring-account-overview.png)
![请求监控实时事件，展示最近调用、模型、推理强度、请求状态、TPS、延迟、用量和费用](img/request-monitoring-realtime-events.png)
![服务端 Codex 账号巡检，展示定时运行、结果分页、账号状态、清理建议和日志](img/server-codex-inspection.png)

## 提供什么

- 面向 CPA Management API（`/v0/management`）的单文件 React 管理面板
- Docker 化 Manager Server，用 SQLite 持久化请求统计并托管内置面板
- Windows/macOS/Linux 原生 `amd64` 和 `arm64` 运行包，内置管理面板
- 多 CPA 节点管理：可添加多个 CPA 节点，在 Header 切换当前节点，并让每个节点独立保存连接密钥和采集配置
- 两种部署模式：
  - **完整 Docker 方案**：访问 Manager Server 内置面板，首次安装初始化 Plus 登录 token，之后在节点管理中添加 CPA 节点
  - **CPA 控制面板方案**：继续使用 CPA 的 `/management.html` 作为纯 CPA 面板，不配置也不访问单独的 Manager Server
- 完整 Docker 方案提供运行时监控、账号/模型/渠道拆解、模型价格、Token 费用估算、导入导出、API Key 别名、服务端 Codex 巡检和 Manager Server 系统工具
- 两种模式都保留普通 CPA 管理能力和本地 Codex 账号巡检

## 选择部署模式

| 模式 | 入口地址 | 用户需要配置 | 适用场景 |
|---|---|---|---|
| 完整 Docker 方案 | `http://<host>:18317/management.html` | 首次安装：Plus 登录 token；登录后：添加一个或多个 CPA 节点，填写 CPA 地址 + CPA Management Key | 新部署、单入口、多节点监控、最少浏览器/CORS 问题 |
| CPA 控制面板方案 | `http://<cpa-host>:8317/management.html` | 使用 CPA Management Key 登录 CPA | 保留 CPA 自动载入面板，但不需要 Manager Server 统计能力 |
| 前端开发方案 | Vite dev server 或 `apps/web/dist/index.html` | CPA 地址 | 本地开发 |

完整 Docker 方案不内置 CPA 本体。CPA 仍然作为上游服务独立运行；Docker 镜像提供 Manager Server 和内置管理面板。

### 两种模式的功能边界

| 能力 | 完整 Docker 方案 | CPA 控制面板方案 |
|---|---:|---:|
| CPA 配置、提供商/账号/Key 管理、认证文件、日志、配额视图和 CPA Management API 功能 | 支持 | 支持 |
| 浏览器本地 Codex 账号巡检 | 支持 | 支持 |
| Plus 登录 token、按节点加密保存 CPA Management Key、节点管理 | 支持 | 不支持 |
| 请求监控、首页用量统计、模型价格、API Key 别名、用量导入导出 | 支持 | 不支持 |
| 服务端 Codex 巡检、定时任务、持久化巡检历史 | 支持 | 不支持 |
| Manager Server `/status`、CPA 节点接口、`/v0/management/usage`、模型价格、别名、导入导出接口 | 仅 Plus 登录 token | 不使用 |

一个 Manager Server 可以管理多个 CPA 节点。每个节点独立保存 CPA Base URL、加密后的 CPA Management Key、启用状态、请求监控开关和采集配置。Header 的节点选择器决定当前面板操作哪个 CPA 节点；Manager Server 也会通过 `X-CPA-Node-ID` 处理节点上下文。

## CPA 前置条件

请求统计依赖 CPA 的用量队列：

- CPA 必须启用 Management，因为用量队列与 `/v0/management` 使用相同的可用性条件和 Management Key。
- 使用请求监控时，CPA 必须启用用量发布：配置 `usage-statistics-enabled: true`，或通过 `PUT /usage-statistics-enabled` 提交 `{ "value": true }`。CPA Manager Plus 在新增或编辑节点并启用请求监控时，会尝试为该节点自动打开该开关。
- 关闭 CPAM 请求监控只会停止 Manager Server 采集器，不会自动关闭 CPA 用量发布或清空 CPA 用量队列。如果 CPA 用量发布仍开启，在队列保留时间内再次启用请求监控，可能会采集到关闭采集器期间保留的数据。
- 推荐使用 CPA `v7.1.39+` 以匹配当前面板能力，并获取新版监控视图所需的完整 Redis usage 元数据：请求侧 `reasoning_effort`、`service_tier`、`executor_type`、`tokens.cache_read_tokens`、`tokens.cache_creation_tokens`、`fail.status_code` 和 `fail.body`。CPA `v6.10.8+` 已提供 HTTP 用量队列接口 `/v0/management/usage-queue`，可通过普通 HTTP 反代访问。旧版兼容 CPA 不会输出这些可选字段；CPA Manager Plus 仍会兼容导入和采集旧事件，缺失的字符串字段显示为空/未知，缺失的数值字段按 `0` 处理。
- CPA `v7.1.39+` 的 RESP Pub/Sub 会发送 `{"support_refresh":true}`、`{"refresh":true}` 这类 usage 控制消息。当前 CPA Manager Plus 会过滤这些控制消息，不会把它们写成空请求行；收到 refresh 时还会清理认证快照缓存，以便 CPA 认证/配置变化后重新读取账号元数据。
- `reasoning_effort` 是请求侧推理强度配置，不是实际推理 token 消耗；实际消耗仍以 `tokens.reasoning_tokens` 为准。
- Manager Server 的 `auto` 模式会先尝试 RESP Pub/Sub（`subscribe`），再尝试 HTTP 用量队列，最后回退到旧版 RESP 弹出模式。RESP 传输监听在 CPA API 端口，通常是 `8317`，不能通过普通 HTTP 反代转发。
- CPA 在内存中保留队列项的时间由 `redis-usage-queue-retention-seconds` 控制，默认 `60` 秒，最大 `3600` 秒。Manager Server 应保持常驻运行。
- Manager Server 的 `pollIntervalMs` 必须小于等于 CPA 队列保留时间换算后的毫秒值；否则服务会拒绝保存，避免空闲轮询过慢导致队列项过期。
- 同一个 CPA 节点只应有一个 Manager Server 消费用量队列。一个 Manager Server 可以同时消费多个不同 CPA 节点。

## 架构

### 完整 Docker 方案

```text
浏览器
  -> Manager Server :18317
      -> 内置 management.html
      -> /v0/management/usage 和 /v0/management/model-prices 从 SQLite 返回
      -> 其他 /v0/management/* 反代到 CPA
      -> HTTP/RESP/PubSub 消费器 -> CPA API 端口
      -> SQLite /data/usage.sqlite
```

首次启动时，登录页会调用 `GET /usage-service/info`，识别当前是否由 Manager Server 托管。如果 Plus 登录凭据尚未初始化，页面会要求你设置 Plus 登录 token。CPA 连接不再通过旧 `/setup` 向导配置。登录后，从 Header 节点菜单进入 **CPA 节点管理**，添加一个或多个 CPA 节点，填写每个节点的 CPA Base URL 和 CPA Management Key，并选择是否为该节点启用请求监控。启用时，Manager Server 会验证 CPA Management API，尝试启用 CPA 用量统计，校验节点采集间隔不超过 CPA 队列保留时间，把节点保存到 SQLite，并为该节点启动独立采集器。

Manager Server 初始化完成后，新浏览器再次打开同一地址会使用普通登录表单。完整 Docker 方案的登录凭证是 Plus 登录 token；CPA Management Key 按节点加密保存在服务端，只用于 Manager Server 访问对应 CPA 上游。

### CPA 控制面板方案

```text
浏览器
  -> CPA /management.html
      -> 普通 CPA Management API 请求仍然访问 CPA
      -> 本地 Codex 巡检在浏览器内执行
```

当你希望保留 CPA 自动下载并托管面板的机制时，使用这个方案。该模式由 CPA 托管页面，并与 Manager Server 完全隔离：不显示 Manager Server 初始化页，不要求输入 Plus 登录 token，不保存 Manager Server 地址，也不开放依赖 Manager Server SQLite 或 CPA 用量统计的功能。监控中心、首页用量统计、模型价格、API Key 别名、用量导入导出、采集器状态和服务端 Codex 巡检都会隐藏或不可用。本地 Codex 账号巡检仍可使用，因为它在浏览器内针对 CPA 可访问的认证文件执行。

### Manager Server 后端

Go 后端位于 `github.com/seakee/cpa-manager-plus/apps/manager-server` 模块。它仍保留兼容的 `/usage-service/*` 管理端点。请求链路按以下分层组织：

```text
model -> repository -> service -> controller -> router
```

- `internal/model` 定义持久化和 API 响应相关数据结构。
- `internal/repository` 负责 SQLite 读写和 schema 迁移，并保持现有数据表兼容。
- `internal/service` 承担 Plus 初始化、CPA 节点管理、usage、模型价格、API Key 别名、代理、面板和 collector 生命周期等业务规则。
- `internal/http/controller`、`internal/http/middleware` 和 `internal/http/router` 把 HTTP decode、CORS/auth/recovery、Gin 路由和响应写入限制在边界层。
- `internal/httpapi` 保留为当前 `cmd/cpa-manager-plus` 入口的兼容 wrapper。
- `internal/worker` 负责 collector 启动、重启和停止，不改变现有 HTTP、RESP Pub/Sub、RESP 弹出和 auto 队列消费协议。

## 快速开始：完整 Docker 方案

### 容器镜像

公开多架构镜像会发布到两个仓库：

- Docker Hub：`seakee/cpa-manager-plus`
- GitHub Container Registry：`ghcr.io/seakee/cpa-manager-plus`

```bash
docker run -d \
  --name cpa-manager-plus \
  --restart unless-stopped \
  -p 18317:18317 \
  -v cpa-manager-plus-data:/data \
  seakee/cpa-manager-plus:latest
```

打开：

```text
http://<host>:18317/management.html
```

首次安装时：

- 设置 Plus 登录 token。
- 使用该 token 登录。
- 从 Header 节点菜单进入 **CPA 节点管理** 并添加 CPA 节点。
- CPA 地址示例：
  - Docker Desktop 访问宿主机 CPA：`http://host.docker.internal:8317`（默认建议值；如果面板构建时设置了 `VITE_DEFAULT_CPA_BASE_URL`，则使用该值）
  - 同一 compose 网络：`http://cli-proxy-api:8317`
  - 远程 CPA：`https://your-cpa.example.com`
- CPA Management Key

保存第一个节点后，同一入口地址会使用 Manager Server SQLite 中保存的节点列表。新浏览器只需要在登录页填写 Plus 登录 token。

发布镜像支持 `linux/amd64` 和 `linux/arm64`。Docker 示例默认使用 Docker Hub。如果要从 GitHub Container Registry 拉取，把 `seakee/cpa-manager-plus:latest` 替换成 `ghcr.io/seakee/cpa-manager-plus:latest`。

### 原生运行包

GitHub Releases 同时提供内置面板的原生运行包：

- `cpa-manager-plus_<version>_linux_amd64.tar.gz`
- `cpa-manager-plus_<version>_linux_arm64.tar.gz`
- `cpa-manager-plus_<version>_darwin_amd64.tar.gz`
- `cpa-manager-plus_<version>_darwin_arm64.tar.gz`
- `cpa-manager-plus_<version>_windows_amd64.zip`
- `cpa-manager-plus_<version>_windows_arm64.zip`

macOS/Linux：

```bash
tar -xzf cpa-manager-plus_vX.Y.Z_linux_amd64.tar.gz
cd cpa-manager-plus_vX.Y.Z_linux_amd64
./cpa-manager-plus
```

tar 包已保留执行权限，正常解压后不需要额外 `chmod +x`。macOS 如果提示无法打开未签名程序，可在解压目录执行 `xattr -dr com.apple.quarantine .` 后再运行。

Windows PowerShell：

```powershell
Expand-Archive .\cpa-manager-plus_vX.Y.Z_windows_amd64.zip -DestinationPath .
cd .\cpa-manager-plus_vX.Y.Z_windows_amd64
.\cpa-manager-plus.exe
```

Windows 可直接双击 `cpa-manager-plus.exe` 启动，但推荐用 PowerShell 运行，方便查看日志和错误信息。

启动后打开：

```text
http://<host>:18317/management.html
```

原生包不包含 CPA 本体。请让 CPA 独立运行，首次安装时设置 Plus 登录 token，然后在节点管理中添加 CPA 节点。初始化完成后，登录页只需要 Plus 登录 token。需要自定义数据位置时，可以设置 `USAGE_DATA_DIR` 或 `USAGE_DB_PATH` 覆盖默认值。

原生包首次启动时，如果没有设置 `USAGE_DATA_DIR` 或 `USAGE_DB_PATH`，会在程序所在目录自动生成 `config.json`，并把 SQLite 数据写入同目录下的 `data/usage.sqlite`。这样解压后的目录就是完整的程序和用户数据目录。本地开发使用 `go run ./cmd/cpa-manager-plus` 时，默认路径会按当前启动目录解析，而不是 Go 临时构建目录，因此重复重启会使用同一份 `config.json`、`data/usage.sqlite` 和 `data/data.key`。

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

启动：

```bash
docker compose up -d
```

如果要使用 GitHub Container Registry，把 compose 中的镜像替换为 `ghcr.io/seakee/cpa-manager-plus:latest`。

### Linux 宿主机运行 CPA

如果 CPA 直接运行在 Linux 宿主机，Manager Server 运行在 Docker 中，需要添加 host gateway：

```bash
docker run -d \
  --name cpa-manager-plus \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 18317:18317 \
  -v cpa-manager-plus-data:/data \
  seakee/cpa-manager-plus:latest
```

然后在添加 CPA 节点时将 CPA 地址填写为 `http://host.docker.internal:8317`。

## 快速开始：CPA 控制面板方案

1. 正常启动 CPA，打开：

   ```text
   http://<cpa-host>:8317/management.html
   ```

   使用 CPA Management Key 登录 CPA。这个入口由 CPA 托管，不使用完整 Docker 初始化页。

2. 要让 CPA 将本项目作为默认面板，在 CPA 面板进入：

   ```text
   配置面板 -> 远程访问和控制面板设置
   ```

   将「面板仓库」（`remote-management.panel-repo`）设置为：

   ```text
   https://github.com/seakee/CPA-Manager-Plus
   ```

   保持「禁用控制面板」关闭。如果开启了「禁用面板自动更新」，CPA 只会在缓存文件 `static/management.html` 不存在时重新下载面板。

3. 保存 CPA 配置并重新打开：

   ```text
   http://<cpa-host>:8317/management.html
   ```

4. 正常使用 CPA 面板。

该模式刻意限制在 CPA 支持的功能范围内，不配置 Manager Server，不把当前 CPA 地址或 CPA Management Key 发送给 Manager Server，也不读取 Manager Server SQLite 数据。需要请求监控、历史用量统计、模型价格、API Key 别名、用量导入导出或服务端 Codex 巡检时，请使用完整 Docker 方案。

## 本地从源码构建

```bash
docker compose -f docker-compose.manager.yml up --build
```

该命令会构建 React 面板，并把它内置到 Go Manager Server 二进制中。

## Manager Server 配置项

CPA 连接在登录后通过 CPA 节点管理维护。每个节点的 CPA Base URL、加密后的 CPA Management Key、启用状态、请求监控开关和采集配置都会保存到 SQLite。旧的 `CPA_UPSTREAM_URL` / `CPA_MANAGEMENT_KEY` 环境变量仍作为没有配置 CPA 节点时的兼容 fallback，但推荐通过 UI 或 CPA node API 添加节点。

下表是 Manager Server 运行时配置。前端构建时配置是独立的：`VITE_DEFAULT_CPA_BASE_URL` 只影响添加节点时的 UI 默认建议值，不会自动创建节点。

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `CPA_MANAGER_CONFIG` | 空 | 可选配置文件路径；为空时原生包默认使用程序同目录的 `config.json` |
| `HTTP_ADDR` | `0.0.0.0:18317` | Manager Server HTTP 监听地址 |
| `USAGE_DB_PATH` | Docker：`/data/usage.sqlite`；原生包：`./data/usage.sqlite` | SQLite 数据库路径 |
| `USAGE_DATA_DIR` | Docker：`/data`；原生包：`./data` | 未覆盖 `USAGE_DB_PATH` 时的数据目录 |
| `CPA_MANAGER_ADMIN_KEY` | 空 | 可选预置 Plus 登录 token/管理员凭据；为空时首次安装会在浏览器中要求用户自行设置 |
| `CPA_MANAGER_ADMIN_KEY_FILE` | `/run/secrets/cpa_admin_key` | 可选 Plus 登录 token/管理员凭据文件 |
| `CPA_MANAGER_DATA_KEY` | 空 | 可选数据加密密钥；为空时从 `CPA_MANAGER_DATA_KEY_PATH` 读取或自动生成 |
| `CPA_MANAGER_DATA_KEY_FILE` | `/run/secrets/cpa_data_key` | 可选数据加密密钥文件 |
| `CPA_MANAGER_DATA_KEY_PATH` | Docker：`/data/data.key`；原生包：`./data/data.key` | 自动生成的数据加密密钥文件路径 |
| `CPA_UPSTREAM_URL` | 空 | 兼容 fallback CPA 地址，仅在没有配置 CPA 节点时使用 |
| `CPA_MANAGEMENT_KEY` | 空 | 兼容 fallback CPA Management Key，仅在没有配置 CPA 节点时使用 |
| `CPA_MANAGEMENT_KEY_FILE` | `/run/secrets/cpa_management_key` | fallback CPA Management Key 文件 |
| `USAGE_COLLECTOR_MODE` | `auto` | 默认/fallback 采集方式；多节点模式下节点自己的 `collectorMode` 会覆盖该值 |
| `USAGE_RESP_QUEUE` | `usage` | 默认/fallback RESP key 参数；节点级 `queue` 会覆盖该值 |
| `USAGE_RESP_POP_SIDE` | `right` | 默认/fallback 弹出方向；节点级 `popSide` 会覆盖该值 |
| `USAGE_BATCH_SIZE` | `100` | 默认/fallback 每次最多弹出记录数；节点级 `batchSize` 会覆盖该值 |
| `USAGE_POLL_INTERVAL_MS` | `500` | 默认/fallback 队列空闲轮询间隔；节点级 `pollIntervalMs` 会覆盖该值 |
| `USAGE_QUERY_LIMIT` | `50000` | 默认/fallback 近期事件查询上限；节点级 `queryLimit` 会覆盖该值 |
| `USAGE_CORS_ORIGINS` | `*` | CPA 控制面板方案下允许的浏览器来源 |
| `USAGE_RESP_TLS_SKIP_VERIFY` | `false` | RESP TLS 连接是否跳过证书校验 |
| `PANEL_PATH` | 空 | 使用自定义 `management.html` 替代内置面板 |

启动类配置的优先级为：环境变量 > `config.json` > 程序默认值。配置文件中的相对路径按配置文件所在目录解析。默认生成的配置文件内容如下：

```json
{
  "httpAddr": "0.0.0.0:18317",
  "dataDir": "./data"
}
```

如果首次启动前设置了 `CPA_MANAGER_ADMIN_KEY`，服务会使用该值初始化 Plus 登录凭证。否则首次浏览器访问时会要求用户设置 Plus 登录 token。CPA 节点保存到 SQLite `cpa_nodes`，节点密钥会使用数据密钥加密。

### CPA 与 CPA Manager Plus 配置边界

- **CPA 配置**：`usage-statistics-enabled`、`redis-usage-queue-retention-seconds`、代理、日志、路由、认证文件等仍属于 CPA，由 `/config` / `/config.yaml` 管理。
- **CPA Manager Plus 配置**：完整 Docker 方案下，Plus 登录 token、数据密钥、CPA 节点列表、按节点加密后的 CPA Management Key、请求监控开关和节点采集配置保存到 Manager Server SQLite。Plus 全局设置从 Header 的 **Plus 设置** 进入；CPA 连接从 **CPA 节点管理** 维护。
- 配置面板编辑的是当前节点对应 CPA 的配置。保存 CPAM 节点设置不会写入 CPA `config.yaml`；为节点启用请求监控时会按要求调用 CPA Management API 启用用量统计，关闭请求监控时只停止该节点的 CPAM 采集器。

### 迁移指引

从旧 CPA-Manager 升级时，请优先阅读 [CPA-Manager 到 CPA Manager Plus 迁移指南](docs/migration-from-cpa-manager.zh-CN.md)。核心规则如下：

1. 先停止旧后端服务，再备份旧 `/data` 目录或 Docker volume，至少包含 `usage.sqlite`、`usage.sqlite-wal`、`usage.sqlite-shm`。
2. 使用同一个旧 `/data` volume 启动 CPA Manager Plus，或把旧数据复制到新 `/data`。旧项目默认 volume 常见为 `cpa-manager-data`，Plus 示例默认是 `cpa-manager-plus-data`，不要误用空的新 volume。
3. 首次启动 Plus 后会新增 `settings.admin_credential_v1`、`settings.bootstrap_state_v1` 和 `/data/data.key`。从这一步开始，备份必须同时包含 SQLite 文件和 `data.key`。
4. 完整 Docker 方案的登录凭证会变成 Plus 登录 token，不再是 CPA Management Key。无人值守迁移时可显式设置 `CPA_MANAGER_ADMIN_KEY` 或 `CPA_MANAGER_ADMIN_KEY_FILE`，也可以首次访问时在浏览器中初始化。
5. 旧版单节点 `/setup` 数据仅作为兼容数据保留。当前部署应通过 CPA 节点管理添加 CPA 连接；历史用量不会自动迁移。
6. 如果使用环境变量 `CPA_UPSTREAM_URL` / `CPA_MANAGEMENT_KEY`，它们只在没有配置 CPA 节点时作为 fallback 使用。要改为节点持久化，可移除这些环境变量后重启，再从面板添加节点。
7. 旧版 CPA 托管面板外接 Manager Server 的集成方式不再支持。需要查看历史用量、模型价格、别名、导入导出或服务端巡检历史时，请打开 Manager Server 托管的面板；CPA 控制面板方案保持为纯 CPA 面板。

## 数据与安全说明

- SQLite 数据存储在 `/data`，必须挂载到持久化 volume 或宿主机目录。
- Plus 登录 token/管理员凭据不会明文保存；SQLite `settings.admin_credential_v1` 只保存盐和 HMAC-SHA256 摘要。需要无人值守初始化时，建议通过 `CPA_MANAGER_ADMIN_KEY_FILE` 使用 Docker Secret 或其他外部密钥管理。
- CPA Management Key 会用数据密钥加密后保存到 SQLite `cpa_nodes` 表，用于容器重启后恢复节点采集和反代 CPA 管理接口。
- 数据密钥由 `CPA_MANAGER_DATA_KEY` / `CPA_MANAGER_DATA_KEY_FILE` 提供，或自动生成到 `CPA_MANAGER_DATA_KEY_PATH`，Docker 默认 `/data/data.key`，权限 `0600`。
- 数据密钥安全评估：AES-GCM 加密能避免 SQLite 离线泄露时直接读出 CPA Management Key，但如果攻击者同时拿到 `/data/usage.sqlite` 和 `/data/data.key`，仍可解密；如果丢失数据密钥，已加密的 CPA Management Key 无法恢复，只能重新初始化/重新保存 CPA 连接。
- CPA 节点保存到 SQLite `cpa_nodes`；旧 `settings.setup` 和 `settings.manager_config_v1` 仅作为兼容数据。
- 请保护 `/data` volume，它包含用量元数据、Plus 凭证摘要、数据密钥文件和按节点加密后的 CPA Management Key。
- Manager Server 会在保存 raw JSON 快照前脱敏疑似密钥字段，但请求元数据仍可能暴露请求/实际模型、接口、账号标签、项目快照和 token 用量。
- RESP 弹出队列是破坏性消费，RESP Pub/Sub 是流式订阅；不要让多个 Manager Server 同时消费同一个 CPA 实例。
- 如果 Manager Server 停机超过 CPA 队列保留时间，该时段用量无法在不修改 CPA 的情况下恢复。
- 如果只关闭 CPAM 采集器而 CPA 用量发布仍开启，队列保留时间内重新开启采集器可能会消费停用期间仍保留的队列项。

## 运行时接口

| 接口 | 用途 |
|---|---|
| `GET /health` | 基础健康检查 |
| `GET /status` | SQLite、事件数、全局采集器状态和节点级采集器状态 |
| `GET /usage-service/info` | 让前端识别 Manager Server 模式、Plus 凭据状态和是否已有 CPA 节点 |
| `GET /v0/management/cpa-nodes` | 获取已配置 CPA 节点列表 |
| `POST /v0/management/cpa-nodes` | 创建 CPA 节点，保存连接、密钥和采集配置 |
| `PUT /v0/management/cpa-nodes/{id}` | 更新 CPA 节点并热重载采集器 |
| `DELETE /v0/management/cpa-nodes/{id}` | 删除 CPA 节点并停止对应采集器 |
| `POST /v0/management/cpa-nodes/{id}/validate` | 校验节点的 CPA Management API 连接 |
| `POST /v0/management/admin-token/init` | 首次安装时初始化 Plus 登录 token |
| `PUT /v0/management/admin-token` | 轮换 Plus 登录 token |
| `GET /v0/management/usage` | 面板兼容用量数据 |
| `GET /v0/management/usage/export` | JSONL 导出用量事件 |
| `POST /v0/management/usage/import` | 导入 JSONL 用量事件或旧版 JSON 快照 |
| `GET /v0/management/model-prices` | 读取 SQLite 中保存的模型价格 |
| `PUT /v0/management/model-prices` | 替换已保存的模型价格 |
| `POST /v0/management/model-prices/sync` | 从 LiteLLM、OpenRouter 等价格元数据同步模型价格，并返回价格来源 |
| `GET /models`、`GET /v1/models` | 将模型列表请求反代到当前选中的 CPA 节点 |
| `/v0/management/*` | 除 Manager Server 自身接口外，反代到当前选中的 CPA 节点 |

Plus 初始化完成后，`/status`、用量、模型价格、节点管理和 `/v0/management/*` 反代接口需要使用 Plus 登录 token 作为 Bearer token。CPA Management Key 不用于访问 Manager Server-only 接口；它按节点保存在服务端，只供 Manager Server 访问 CPA 上游。存在多个启用节点时，节点相关代理请求需要通过 `X-CPA-Node-ID` 或 `nodeId` 带上当前节点上下文。

用量导入支持两类文件：Manager Server 导出的 JSONL/NDJSON 事件文件，以及旧版 CPA `/usage/export` 生成的 JSON 快照。旧版 JSON 只有在 `usage.apis.*.models.*.details[]` 明细存在时才能转换为事件；如果文件只包含聚合总量，Manager Server 会拒绝导入，因为无法还原请求级明细。旧版导入属于迁移/恢复能力，不是与 Manager Server 新采集数据完全等价的历史延续：旧文件可能缺少 `api_key_hash`、渠道、请求 ID、method/path、延迟、缓存 token 或失败原因等元数据，账号匹配、API Key 维度分析和明细精度可能低于新采集数据。导入旧文件会影响总量、趋势图和账号/Key 拆解，准确性敏感时建议先导入测试库或备份库验证。

CPA usage 事件中的失败正文按敏感诊断信息处理。Manager Server 只在本地 SQLite 数据库中保留原始 `fail_body` 用于内部排查；普通 API、兼容用量 payload 和 JSONL 导出只暴露经过脱敏与截断的 `fail_summary`。JSONL 导出会主动省略 `raw_json` 和原始 `fail_body`；导入仍兼容旧导出文件和历史快照。

## 功能概览

- **仪表盘**：连接状态、后端版本、快速健康概览
- **配置管理**：可视化和源码模式编辑当前节点的 CPA 配置，包括 Codex `identity-confuse`
- **CPA 节点管理**：新增、编辑、校验、切换和删除 CPA 节点，配置节点级请求监控和采集轮询
- **AI 提供商**：Gemini、Codex、Claude、Vertex、OpenAI 兼容渠道、Ampcode
- **认证文件**：上传、下载、删除、状态、OAuth 排除模型、模型别名
- **配额管理**：支持提供商的配额视图
- **请求监控**：持久化用量 KPI、模型/渠道/账号/API Key 拆解、请求模型与实际模型追踪、项目快照、模型价格、Token 费用估算、失败分析、展示可读来源和单条优先补充信息的实时表格
- **Codex 账号巡检**：批量探测 Codex 认证池并给出清理建议
- **日志**：增量读取和筛选文件日志
- **Plus 设置**：查看 Manager Server 运行状态并轮换 Plus 登录 token
- **系统信息**：当前节点模型列表、版本检查、本地状态工具

## 开发命令

前端：

```bash
npm install
npm run dev
npm run type-check
npm run lint
npm run build
```

Manager Server：

```bash
cd apps/manager-server
go test ./...
go test -race ./...
go vet ./...
go run ./cmd/cpa-manager-plus
```

## 构建与发布

- Vite 输出单文件 `apps/web/dist/index.html`
- 打 `vX.Y.Z` 或 `vX.Y.Z-beta` 这类预发布标签会触发 `.github/workflows/release.yml`
- 发布流程会上传 `apps/web/dist/management.html`、原生运行包和 `checksums.txt` 到 GitHub Releases
- 原生运行包会发布 `linux`、`darwin`、`windows` 的 `amd64` 和 `arm64` 版本，包内已内置管理面板
- 同一个 workflow 会构建 `Dockerfile.manager-server`，并把公开镜像推送到 Docker Hub 和 GitHub Container Registry
- Docker 镜像会发布 `linux/amd64` 和 `linux/arm64`
- GitHub Container Registry 镜像是 `ghcr.io/seakee/cpa-manager-plus`，使用 workflow 自带的 `GITHUB_TOKEN` 和 `packages: write` 权限发布
- 启用 Docker Hub 发布时，workflow 会把 `README.md` 同步到 Docker Hub overview
- Docker Hub 发布的可选 GitHub secrets：
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`

## 常见问题

- **完整 Docker 方案无法连接 CPA**：确认容器内能访问 CPA 地址。Linux 宿主机 CPA 需要 `--add-host=host.docker.internal:host-gateway`。
- **完整 Docker 方案直接打开登录表单**：Plus 凭据已经初始化。输入 Plus 登录 token 后，从 Header 节点菜单管理 CPA 节点。
- **登录后没有 CPA 节点**：打开 Header 节点菜单，进入 **节点管理** 添加 CPA 节点。
- **监控页为空**：确认当前节点已启用请求监控，检查 Manager Server `/status` 中的 `nodeCollectors`，并确认该 CPA 节点只有一个消费者。
- **升级 CPA 后实时监控出现空的 `-` 请求行**：升级 CPA Manager Plus。CPA `v7.1.39+` 会发送 Pub/Sub 控制消息，旧版 CPAM 可能把它们写成空用量事件。
- **`unsupported RESP prefix 'H'`**：升级 CPA 到 `v6.10.8+`，或在普通 HTTP 反代场景使用 `USAGE_COLLECTOR_MODE=http`。RESP Pub/Sub/RESP 弹出模式要求 CPA 地址必须是容器/主机内能直连 `8317` 的地址，不能是普通 HTTP 反代域名。
- **CPA 面板仍显示旧面板**：确认 CPA 的「面板仓库」是 `https://github.com/seakee/CPA-Manager-Plus`。如果新面板仍未生效，在 CPA 容器或运行目录中删除缓存面板文件，然后刷新或重启 CPA：
  ```bash
  rm static/management.html
  ```
- **Manager Server 返回 401**：Manager Server 接口使用 Plus 登录 token。CPA Management Key 按节点保存，不用于 Manager Server-only API。
- **Docker 面板数据不更新**：检查 `/status` 中当前节点的 `nodeCollectors`、`lastConsumedAt`、`lastInsertedAt`、`lastError`。
- **CPA 控制面板方案没有监控/价格/导入导出**：这是预期行为，这些是完整 Docker / Manager Server 托管面板功能。
- **容器重建后数据丢失**：确认 `/data` 已挂载到 Docker volume 或宿主机目录。
- **从 CPA-Manager 迁移后看不到旧数据**：确认 Plus 容器挂载的是旧 `/data` volume，而不是新建的 `cpa-manager-plus-data` 空 volume。
- **Plus 登录 token 丢失**：已有 `settings.admin_credential_v1` 时，单独设置 `CPA_MANAGER_ADMIN_KEY` 不会覆盖旧凭证。请先停止 Manager Server、备份 `/data`，再按 [重置 Manager Server 管理员密钥](docs/reset-admin-key.zh-CN.md) 处理。
- **完整 FAQ**：查看 [CPA Manager Plus 常见问题与解决方案](https://github.com/seakee/CPA-Manager-Plus/wiki/CPA%E2%80%90Manager-%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98%E4%B8%8E%E8%A7%A3%E5%86%B3%E6%96%B9%E6%A1%88) 或 [English FAQ and Troubleshooting](https://github.com/seakee/CPA-Manager-Plus/wiki/CPA-Manager-Plus-FAQ-and-Troubleshooting)。

## 参考

- CLIProxyAPI: https://github.com/router-for-me/CLIProxyAPI
- Redis 用量队列文档: https://help.router-for.me/management/redis-usage-queue.html
- CPA-Manager 到 CPA Manager Plus 迁移指南: [docs/migration-from-cpa-manager.zh-CN.md](docs/migration-from-cpa-manager.zh-CN.md)
- 重置 Manager Server 管理员密钥: [docs/reset-admin-key.zh-CN.md](docs/reset-admin-key.zh-CN.md)
- 发布前检查清单: [docs/release-checklist.zh-CN.md](docs/release-checklist.zh-CN.md)

## 致谢

- 感谢上游项目 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 和 [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) 提供基础与参考。
- 感谢 [Linux.do](https://linux.do/) 社区对项目推广与反馈的支持。

## 许可证

MIT
