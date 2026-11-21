# CLIProxyAPI

Fork 自 [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)，当前版本 `v8.0.79-s2`。在官方版基础上改了一些自用顺手的功能。

**Linux 安装 / 升级**
```bash
curl -fsSL https://raw.githubusercontent.com/juzi5201314/CLIProxyAPI/main/install.sh | bash
```
管理脚本：`~/cliproxyapi/install.sh [status | auth | check-config | update | uninstall]`

**Docker**
```bash
docker pull ghcr.io/juzi5201314/cliproxyapi:latest
```

<img width="1647" height="867" alt="CLIProxyAPI Web Dashboard" src="https://github.com/user-attachments/assets/0f8d51a9-0b7d-4d13-ae14-6a290aad4a71" />

## 相比原版的主要改动

- Web 管理面板直接打包进二进制（访问 `/management`），不再运行时从 GitHub 下载前端静态文件。
- 新增基于纯 Go SQLite 的请求日志库（`observability.request-db`），报文用 zstd 压缩落盘，用来看实时请求流、TTFT/TPS、缓存命中率和调用耗时。
- 不强制截断自定义模型的 thinking 强度，支持按模型配置 `thinking-level-mapping`；上游返回思考内容但没给 `thinking_tokens` 时本地自动估算。
- 支持给供应商和单个 Key / 凭据设置本地最大并发数（`max-concurrency`），支持按供应商指定 `service-tier` 并记录上游实际返回的层级。
- 支持给各类 API Key 供应商设置名称，请求日志直接按 `provider(name)` 展示，方便区分同协议的不同渠道。
- 后台内置模型单价配置与费用估算、各家配额主动探测、可视化配置编辑，以及带上下文长度探测的 Playground。
- HTTP/2 `stream error` / `GOAWAY` 按瞬态网络错误自动切号重试。

## 本地编译

```bash
make web      # 构建前端 (pnpm -C web install && pnpm -C web build)
make build    # 构建前端并编译服务端二进制
make test     # 运行测试
```
