# Cloudflare 部署说明

## 目标

为 Game-hub 提供一套可以直接在 Cloudflare 上运行的部署方案，并完成实际发布验证。

## 部署结论

当前项目已经完成以下落地：

- 前端静态资源托管到 Cloudflare Workers Assets
- 房间状态迁移到 Durable Objects
- 实时通信改为原生 WebSocket
- 已发布到公开地址：
  - [https://game-hub.yongee.workers.dev](https://game-hub.yongee.workers.dev)

## 架构方案

### 1. 前端托管

- 使用 Vite 产出 `client/dist`
- 通过 `wrangler.jsonc` 的 `assets.directory` 指向 `client/dist`
- SPA 路由由 `not_found_handling: "single-page-application"` 接管

### 2. 实时房间服务

- Worker 负责 HTTP 路由与静态资源入口
- 每个房间通过 `ROOMS` Durable Object 命名实例隔离
- 玩家操作通过 HTTP API 提交：
  - `POST /api/rooms`
  - `POST /api/rooms/:roomId/join`
  - `POST /api/rooms/:roomId/reconnect`
  - `POST /api/rooms/:roomId/ready`
  - `POST /api/rooms/:roomId/move`
  - `POST /api/rooms/:roomId/emoji`
  - `POST /api/rooms/:roomId/chat`
  - `POST /api/rooms/:roomId/restart`
  - `POST /api/rooms/:roomId/leave`
- 房间广播通过 `GET /ws/:roomId?token=...` 建立 WebSocket

### 3. 状态权威

- Durable Object 是单房间的唯一可信状态源
- 棋盘初始化、走子合法性、胜负判定复用现有规则模块
- 断线超时由 Durable Object Alarm 调度

## 配置文件

- `wrangler.jsonc`
- `worker/src/index.ts`
- `worker/src/game-room.ts`
- `client/src/net/useGameSocket.ts`

## 部署步骤

### 1. 登录 Cloudflare

```bash
npx wrangler whoami
```

### 2. 安装依赖

```bash
npm install --registry=https://registry.npmjs.org/
npm --prefix client install --registry=https://registry.npmjs.org/
```

### 3. 构建前端

```bash
npm run build:cloudflare
```

### 4. 发布 Worker

```bash
npm run deploy:cloudflare
```

## 2026-03-13 验证结果

- 已确认 `wrangler whoami` 登录成功
- 已确认 `npm --prefix client run build` 成功
- 已确认 `wrangler deploy --dry-run` 成功
- 已确认正式部署成功
- 已确认 `POST /api/rooms` 可创建房间
- 已确认 `POST /api/rooms/:roomId/join` 可加入房间
- 已确认 `GET /ws/:roomId?token=...` WebSocket 握手返回 `101`
- 已确认 WebSocket 能收到 `room:state` 广播事件

## 运维建议

- 若后续扩展到 4/6 人，优先继续沿用 Durable Object 单房间模型
- 若需要排行榜或战绩，可再增加 D1
- 若需要图片、录像、棋谱回放文件，可再增加 R2
- 生产环境建议在 `wrangler.jsonc` 中继续细化 `workers_dev`、自定义域名和预览环境策略

## Todo List

- [x] 明确 Cloudflare 产品选型
- [x] 接入 Worker + Durable Object 运行时
- [x] 完成前端到 Worker 的通信改造
- [x] 完成 `wrangler` 配置与部署脚本
- [x] 完成真实 Cloudflare 发布
- [x] 完成线上接口与 WebSocket 验证

## 验收结果

- 验收日期：2026-03-13
- 验收结论：通过
- 验收说明：Cloudflare 版本已可公开访问，房间创建、加入、WebSocket 握手与房间状态广播均验证通过。
