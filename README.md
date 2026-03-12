# 跳跳棋在线对战项目

本仓库包含客户端与服务端，支持 2 人在线对战，后续可扩展 4/6 人。

## 目录结构

- `client/` 前端 React + Vite
- `server/` 后端 Node.js + Socket.IO
- `shared/` 前后端共享协议类型
- `doc/` 里程碑与实施文档

## 本地运行

### 一句命令启动（推荐）

```bash
npm run dev
```

首次执行需要在根目录安装依赖：

```bash
npm install
```

### 分别启动（可选）

```bash
cd server
npm install
npm run dev
```

```bash
cd client
npm install
npm run dev
```

默认端口：`4000`（可用 `PORT` 环境变量修改）

### 2. 启动客户端

```bash
cd client
npm install
npm run dev
```

默认会连接 `http://localhost:4000`。如需修改，设置：

```bash
VITE_SERVER_URL=http://localhost:4000
```

## 生产构建

```bash
cd client
npm run build

cd ../server
npm run build
npm start
```

## 说明

- 房间与对局状态由服务端权威维护
- 支持断线重连（基于本地 session token）
- 表情包由服务端校验并广播

## 常见问题与排障

- 无法连接服务端：确认 `server` 已启动且端口一致，客户端 `VITE_SERVER_URL` 指向正确地址
- 房间号无效：确认对方已经创建房间并分享正确房间号
- 断线重连失败：清理浏览器 LocalStorage 后重新创建房间
