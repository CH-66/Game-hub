# Game-hub

Game-hub 是一个跳跳棋在线对战项目，当前仓库已经落地为适合 Cloudflare 的部署形态：

- 前端：React + Vite + TypeScript
- 实时后端：Cloudflare Workers + Durable Objects + WebSocket
- 共享协议：`shared/`
- 棋盘与规则：复用 `server/src/rules/`

## 目录结构

- `client/`：前端应用
- `server/`：原 Node.js 版本服务端与规则实现
- `shared/`：前后端共享类型与协议
- `worker/`：Cloudflare Worker 与 Durable Object 运行时
- `doc/`：里程碑与部署文档

## 本地开发

先安装依赖：

```bash
npm install --registry=https://registry.npmjs.org/
npm --prefix client install --registry=https://registry.npmjs.org/
```

启动 Cloudflare Worker + 前端本地联调：

```bash
npm run dev
```

说明：

- Worker 默认由 `wrangler dev` 提供，地址通常为 `http://127.0.0.1:8787`
- 前端开发服务器会通过 `VITE_SERVER_URL=http://127.0.0.1:8787` 连接本地 Worker

## Cloudflare 部署

构建前端静态资源：

```bash
npm run build:cloudflare
```

部署到 Cloudflare：

```bash
npm run deploy:cloudflare
```

当前已部署地址：

- [https://game-hub.yongee.workers.dev](https://game-hub.yongee.workers.dev)

更多部署细节请查看：

- [Cloudflare 部署说明](/E:/python/game-hub/doc/cloudflare-deployment.md)

## 架构说明

- 静态页面通过 Worker `assets` 绑定托管
- 每个房间对应一个 Durable Object 实例
- 客户端通过 HTTP 发送操作意图，通过 WebSocket 接收房间状态广播
- 房间状态、回合校验、断线超时判定都由服务端权威维护

## 验证命令

健康检查：

```bash
curl https://game-hub.yongee.workers.dev/health
```

查看当前部署版本：

```bash
npx wrangler deployments list
```

## 备注

- `server/` 仍保留原 Node.js 版本代码，便于对照规则逻辑
- 生产部署链路已切换到 Cloudflare Worker，不再依赖 Express + Socket.IO
