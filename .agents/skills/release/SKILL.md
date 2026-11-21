---
name: release
description: >-
  Run the end-to-end release workflow for this CLIProxyAPI fork: verify a clean
  working tree, bump the fork version (-sN), run lint/web build/tests/server build,
  commit and push an annotated tag with explicit refspecs, wait for CI
  prepare-release, and write the Chinese GitHub Release Log. Use whenever the
  user invokes "release" or asks to cut/publish a new version or tag.
---

# CLIProxyAPI Fork 发版流程 (`release`)

执行本仓库（`juzi5201314/CLIProxyAPI`）的完整发版流程：确保工作区干净、递增版本号、验证构建与测试、提交并推送标签、等待 CI 建好 Release 后撰写中文 Release Log。

## 1. 检查工作区与确定目标版本号

1. 检查当前工作区与分支状态：
   ```bash
   git status
   git branch -vv
   git tag --sort=-v:refname | head -n 10
   ```
   - 若工作区有未提交改动，先确认是需先提交/清理还是中止发版；严禁将无关改动混入发版提交。
2. 计算下一个版本号：
   - 查看最新 tag（如 `v8.0.79-s1`）。同一上游版本下递增 `-s<N>` 后缀（如 `v8.0.79-s2`）；若刚合并新的上游版本且尚无对应 `-s*` tag，则从 `v<upstream>-s1` 开始。
   - 若用户明确指定了目标版本号，以用户指定为准。
3. 查看自上一版以来的提交与改动详情，作为编写 Release Log 的唯一事实依据：
   ```bash
   git log <prev_tag>..HEAD --stat
   ```

## 2. 递增版本号

1. 修改以下文件中的版本号（如无必要不触碰其他文件）：
   - `cmd/server/main.go`：更新 `Version = "<version>"`（不带 `v` 前缀，例如 `"8.0.79-s2"`）。
   - `README.md`：更新顶部当前版本标记 `` `v<version>` ``（带 `v` 前缀，例如 `` `v8.0.79-s2` ``）。
2. 搜索旧版本号确认没有遗漏引用：
   ```bash
   rg -n "<prev_version_without_v>" --hidden -g '!.git' -g '!web/dist' -g '!pnpm-lock.yaml'
   ```

## 3. 全量验证（提交前一次性执行）

按仓库规范依次完成格式化、前端 lint/构建、全量单测与服务端编译检查：

```bash
gofmt -w . && pnpm -C web lint && pnpm -C web build && go test ./... && go build -o test-output ./cmd/server && rm test-output
```

- 检查 `git status -s` 与 `git diff --stat`：确认除版本改动外，仅在前端源码有未打包变更时才会更新 `web/dist/index.html`，无多余脏文件。

## 4. 提交、打标签与推送

1. 暂存版本变更文件并按 Conventional Commit 提交：
   ```bash
   git add README.md cmd/server/main.go
   # 若 web/dist/index.html 有变更一并暂存
   git commit -m "chore(release): bump version to v<version>"
   ```
2. 创建附注标签：
   ```bash
   git tag -a v<version> -m "Release v<version>"
   ```
3. **使用显式 refspec 推送**（仓库存在历史同名标签 `refs/tags/main`，直接写 `git push origin main` 会触发 `src refspec main matches more than one` 报错）：
   ```bash
   git push origin refs/heads/main:refs/heads/main refs/tags/v<version>:refs/tags/v<version>
   ```
4. 再次检查 `git status`，确保工作区完全干净（`nothing to commit, working tree clean`）。

## 5. 等待 `prepare-release` 并编写 Release Log

推送 tag 后，GitHub Actions 会自动触发两个工作流：
- `.github/workflows/release.yaml`：首步 `prepare-release` 会创建（或覆盖编辑）Release 页面，随后各平台矩阵编译并上传二进制与 `checksums.txt`。
- `.github/workflows/docker-image.yml`：构建 `linux/amd64`、`linux/arm64` 多架构镜像并推送至 GHCR，完成后按锚点注释向 Release body 插入或更新 `## Docker Images` 段落。

**关键顺序**：必须等 `prepare-release` job 完成后再更新 Release Log，否则会被 `prepare-release` 的 `gh release edit` 覆盖。

1. 查询最新触发的 `release` workflow run ID：
   ```bash
   gh run list --limit 5 --json databaseId,workflowName,headBranch,status,conclusion
   ```
2. 若 `prepare-release` 尚未完成，使用 `schedule` 定时（约 30 秒，禁止在 shell 中使用 `sleep`）等待后检查：
   ```bash
   gh run view <run_id> --json jobs -q '.jobs[] | select(.name=="prepare-release") | "\(.name): \(.status) (\(.conclusion))"'
   ```
3. 检查当前 Release body 是否已被 `docker-image` 写入 Docker 段落：
   ```bash
   gh release view v<version> --json body -q .body
   ```
4. 编写 Release Log（写入临时 scratch 文件，使用中文）：
   - 开头为 `## 更新说明`，按真实提交内容提炼精炼、准确的条目（排除 `chore(release)` 提交本身）。
   - **完整保留**以下锚点区块，以便 `docker-image.yml` 自动插入或更新 Docker 拉取命令：
     ```markdown
     <!-- cliproxyapi-linux-release-assets:start -->
     ## Linux release assets

     - `CLIProxyAPI_<version>_linux_<arch>.tar.gz` is the default Linux build. It supports dynamic library plugins and is built against a GLIBC 2.17 baseline.
     - `CLIProxyAPI_<version>_linux_<arch>_no-plugin.tar.gz` is the portable Linux build for musl-based or older systems such as OpenWrt. It does not support dynamic library plugins.

     ## FreeBSD release assets

     - `CLIProxyAPI_<version>_freebsd_aarch64_no-plugin.tar.gz` is the FreeBSD arm64 build. It is built without CGO and does not support dynamic library plugins.
     <!-- cliproxyapi-linux-release-assets:end -->
     ```
   - 若 `docker-image` 已经写入 `<!-- cliproxyapi-docker-images:start -->...<!-- cliproxyapi-docker-images:end -->`，一并保留在 `<!-- cliproxyapi-linux-release-assets:end -->` 下方。
   - 末尾附上对比链接：
     `**Full Changelog**: https://github.com/juzi5201314/CLIProxyAPI/compare/<prev_tag>...v<version>`
5. 提交更新并核对结果：
   ```bash
   gh release edit v<version> --title "v<version>" --notes-file <notes_file>
   gh release view v<version> --json url,body
   ```

## 6. 最终汇报

检查 `gh run list --limit 4` 状态后，向用户简明汇报：
- 版本号与提交 SHA
- 校验结果（lint / web build / `go test ./...` / `go build`）与工作区干净状态
- GitHub Release 链接与 Release Log 摘要
- CI 工作流（`pr-test-build`、`release`、`docker-image`）当前状态
