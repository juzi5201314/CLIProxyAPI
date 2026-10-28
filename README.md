# CLIProxyAPI

> **Linux 一键安装 / 平滑升级**：
> ```bash
> curl -fsSL https://raw.githubusercontent.com/juzi5201314/CLIProxyAPI/main/install.sh | bash
> ```
> 常用管理命令：`~/cliproxyapi/install.sh [status | auth | check-config | update | uninstall]`
>
> **Docker**：
> ```bash
> docker pull ghcr.io/juzi5201314/cliproxyapi:latest
> ```

本项目为 [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的功能增强 Fork 版本（版本号标记为 `*-s*`，当前版本：`v8.0.43-s8`）。在官方版本基础上，主要对思考参数透传、请求日志数据库、管理面板与可视化体验进行了改进。

---

<img width="1647" height="867" alt="CLIProxyAPI Web Dashboard" src="https://github.com/user-attachments/assets/0f8d51a9-0b7d-4d13-ae14-6a290aad4a71" />

## 🌟 Fork 核心特性

### 1. 思考力度（Reasoning / Thinking）保真透传
- **参数不被强制截断**：移除原版对自定义模型 thinking 参数的限制，客户端设定的思考等级原样透传给上游。
- **跨协议平滑映射**：在 OpenAI、Codex 与 Claude 等不同协议互转时，准确对齐思考强度。
- **缺失思考 Token 自动补算**：部分第三方 API 返回思考内容但未提供 `thinking_tokens` 时，集成分词器在本地自动估算补齐，保证用量与费用统计准确。

### 2. 高效压缩的请求数据库（Request DB）
- **轻量嵌入式存储**：基于纯 Go SQLite 驱动，无额外外部依赖与 CGO，单文件本地持久化。
- **zstd 高压缩比**：请求头与报文详情经 zstd 压缩入库，节省 70%+ 存储空间；默认长期保留，支持按天轮转或手动清理。
- **细粒度指标记录**：精准记录每笔请求的 Token 明细（包含缓存命中与思考量）、真实调用模型、延迟、首字时间（TTFT）与状态码。

### 3. 内置现代化管理面板（Web Dashboard）
- **单二进制直接内嵌**：基于 React 19 + shadcn/ui，编译期直接打入可执行文件，访问 `/management` 即可使用，无需联网从 GitHub 动态拉取。
- **实时日志与监控图表**：内置 SSE 实时请求流、延迟与 TPS 统计、上游主机直观标注与链路追踪。
- **模型定价与成本分析**：内置主流模型价格表，支持自定义单价设置，直观核算调用成本。
- **更好用的 Playground**：支持多模态文件上传、流式打断、历史消息原地编辑与重新发送，并适配移动端操作。

---

## 本地编译与构建

```bash
make web            # 构建前端仪表盘（pnpm -C web install && pnpm -C web build）
make build          # 构建仪表板 + 服务端二进制（前端嵌入 web/dist/index.html）
make test           # 运行全量单元测试
```

前端源码位于 `web/`，发布流水线会自动构建前端单文件并嵌入 Go 二进制中，Docker 镜像构建同理（多阶段构建）。
