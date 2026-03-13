# 里程碑 5：部署与文档

## 目标

完成生产配置、部署文档与公开可访问版本，确保项目可以在 Cloudflare 上稳定运行。

## Todo List

- [x] 整理运行与部署说明
- [x] 明确 Cloudflare 配置项与发布入口
- [x] 完成生产构建与部署脚本
- [x] 补充常见问题与运维建议
- [x] 验证公网可访问部署流程

## 交付物

- Cloudflare 部署配置：`wrangler.jsonc`
- Cloudflare Worker 与 Durable Object：`worker/`
- 部署说明文档：`doc/cloudflare-deployment.md`
- 更新后的项目入口文档：`README.md`

## 验收标准

- 公开地址可访问
- 房间创建与加入正常
- WebSocket 可建立连接
- 房间状态广播正常
- 部署步骤清晰且可复现

## 验收结果

- 验收日期：2026-03-13
- 验收结论：通过
- 验收说明：
  - 已成功部署到 [https://game-hub.yongee.workers.dev](https://game-hub.yongee.workers.dev)
  - 已验证健康检查、房间创建、房间加入
  - 已验证 WebSocket 握手返回 `101`
  - 已验证客户端可收到 `room:state` 广播
