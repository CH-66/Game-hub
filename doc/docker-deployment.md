# Docker 部署说明

本文说明如何将当前项目以单容器方式部署到支持 Docker 的 Linux 服务器或本地环境。

## 部署结论

当前仓库已经支持 Docker 部署，镜像行为如下：

- 构建阶段分别编译 `client/` 与 `server/`
- 运行阶段仅保留服务端生产依赖与前端静态资源
- 容器默认监听 `4000` 端口
- 访问 `/health` 可进行健康检查
- 前端默认同源连接 Socket.IO 服务端，无需额外配置 `VITE_SERVER_URL`

## 文件说明

- `Dockerfile`：多阶段构建镜像
- `docker-compose.yml`：单机部署入口
- `.dockerignore`：减少构建上下文

## 前置条件

- 已安装 Docker
- 如果使用 Compose，需安装 `docker compose`
- 服务器已开放目标端口，例如 `4000`

## 方式一：直接使用 Docker

### 1. 构建镜像

```bash
docker build -t game-hub:latest .
```

### 2. 启动容器

```bash
docker run -d \
  --name game-hub \
  -p 4000:4000 \
  --restart unless-stopped \
  game-hub:latest
```

### 3. 验证服务

```bash
curl http://127.0.0.1:4000/health
```

预期返回：

```json
{"ok":true}
```

## 方式二：使用 Docker Compose

### 1. 启动

```bash
docker compose up -d --build
```

### 2. 查看状态

```bash
docker compose ps
docker compose logs -f
```

### 3. 停止

```bash
docker compose down
```

## 服务器部署建议

如果是公网部署，建议放在 Nginx 或 Caddy 之后：

- 80/443 由反向代理接收
- 反向代理转发到 `127.0.0.1:4000`
- 开启 WebSocket 转发

如果暂时不接反向代理，也可以直接暴露 `4000` 端口测试访问。

## 更新发布

代码更新后执行：

```bash
docker compose up -d --build
```

如果使用原生 Docker：

```bash
docker build -t game-hub:latest .
docker rm -f game-hub
docker run -d \
  --name game-hub \
  -p 4000:4000 \
  --restart unless-stopped \
  game-hub:latest
```

## 常见问题

### 1. 页面能打开，但对局连不上

检查点：

- 浏览器访问的地址是否就是容器对外暴露的地址
- 反向代理是否同时转发了 WebSocket
- 是否错误设置了 `VITE_SERVER_URL`

说明：

当前前端默认使用 `window.location.origin` 连接同源服务端，正常 Docker 部署下通常不需要再配置 `VITE_SERVER_URL`。

### 2. 容器启动了，但健康检查失败

检查：

```bash
docker logs game-hub
curl http://127.0.0.1:4000/health
```

确认：

- 容器内应用是否正常启动
- 端口映射是否正确
- 服务器安全组或防火墙是否放行

### 3. 构建镜像很慢

当前镜像已使用多阶段构建，并通过 `.dockerignore` 排除了 `node_modules`、`dist`、文档目录和本地缓存目录。首次构建较慢属正常，后续会复用层缓存。

## Todo List

- [x] 确认项目支持单容器部署
- [x] 提供 `docker compose` 启动方式
- [x] 补充健康检查说明
- [x] 说明同源 Socket 连接策略
- [x] 提供更新发布与排障步骤
