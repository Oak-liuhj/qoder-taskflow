# npm 与插件市场正式发布

本文件说明发布和市场收录流程。**0.1.4 已于 2026-11-18 发布到 npm，`latest` 为 0.1.4**，匿名下载、独立生产安装和注册表包的真实 AgentLoop 测试已核验。后续 npm 发布须递增版本号，不能覆盖已发布版本。npm、GitHub 标签、可选的 GitHub Release 附件和插件市场收录分别核验。

dsh-market 本身是市场应用，[官方投稿说明](https://github.com/dsh-market/dsh-market#submit-your-plugin)要求向 `awesome-dsh-plugin/awesome-dsh-plugin` 提交目录条目；不向市场应用仓库 PR 插件条目。当前申请与检查见 [SUBMISSION.md](../marketplace/SUBMISSION.md)。

0.1.4 的发布代码为 `61740612507aee65656dc016f0e9ed470d5cfa92`，标签为 `v0.1.4`，Windows/Ubuntu CI 均通过。市场申请仍为 [#16424](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16424)，已更新功能描述和发布验证记录；PR 提交、合并和市场刷新分别核验。

## 版本和兼容性

- npm 已发布版本：`0.1.4`；npm 发布标签：`latest`。
- 宿主要求：`>=0.2.1-rc.3 <1.0.0-0 || >=0.2.2-0 <1.0.0-0 || >=0.2.3-0 <1.0.0-0 || >=0.3.0-0 <1.0.0-0`。
- `engines.dsh` 与必需 DSH peer 范围一致；开发依赖保持 `0.2.2-rc.2` 基线。
- DSH 检查采用 `includePrerelease: true`；`∩` 只用于解释范围交集，不得写入 SemVer 字段。
- 声明范围不代表每个宿主版本已实测。自动化记录、宿主版本与剩余原生界面/真实模型验收分别见 [acceptance.md](./acceptance.md)。

## 本地构建与打包

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm run check:package
npm run check:hosts
```

`check:release` 检查正式版本、标签、宿主范围边界、peer、README、入口、许可、图标和市场元数据。`check:package` 打包并在仓库外安装实际 tgz，验证生产入口、客户端 ModuleLoader 和真实 AgentLoop 固定模型集成，输出 `dist/package-report.json` 和 `dist/SHA256SUMS.txt`。打包上限为 128 KiB，解包上限为 512 KiB。

完整 PRD、开发截图、JSX/CSS 源、测试及脚本不进入 npm 运行包。安装用户无需构建。请以本次最终包报告为准，不沿用 alpha 包的哈希或体积。

## 原生宿主验收

在独立 profile 中安装最终 tgz，核对插件标题/图标/详情、右侧任务槽位、左侧工具视图、真实模型多轮规划、子会话与孙子会话、直接父通知及重启后的计划恢复。测试目标最低宿主和实际使用的宿主版本，记录版本与结果。

开发验收外壳、SemVer 边界测试与固定模型 AgentLoop 测试不能替代完整原生界面和真实模型验收。保留生产 profile 配置、原生会话与任务账本。

## 发布步骤

1. 审查差异与验收记录，同步源码、锁文件、构建产物、文档、许可和素材。将完整代码推送 GitHub，确认远端 CI 通过，添加 `dsh-plugin` topic。
2. 后续发布先在 package.json、锁文件及文档中递增版本，查询官方 registry 确认该版本未占用，再检查本机 npm 登录与发布权限。凭据及验证码不进入仓库或日志。以下以 `$taskflowVersion` 指代这次待发布的新版本，勿对已发布的 0.1.4 重复执行。
3. 使用已经通过安装验证的同一个 tgz 发布：

   ```powershell
   npm whoami --registry=https://registry.npmjs.org/
   $taskflowVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
   $taskflowArchive = (Resolve-Path "dist/dsh-taskflow-$taskflowVersion.tgz").Path
   npm publish "$taskflowArchive" --tag latest --access public --registry=https://registry.npmjs.org/ --ignore-scripts
   npm view "dsh-taskflow@$taskflowVersion" version engines dist-tags repository dist --json --registry=https://registry.npmjs.org/
   ```

4. 匿名下载官方 registry 的目标版本，核对 tarball 哈希与最终候选一致，再在独立 profile 按确切版本安装。npm 返回 HTTP 202 且提示正在处理时，等待公开仓库可见再核验，不因短时 404 重复发布。镜像同步与安装器最小发布时间窗口也可能导致短时不可见，分别核对版本、标签与已安装清单。
5. 推送对应版本标签；如需 GitHub Release 安装来源，再创建 Release 并上传同一 tgz、SHA256SUMS 和包报告。Release 附件不是 npm 来源插件的目录收录前置条件；未创建时不宣称存在下载附件。
6. 按 [市场贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 投稿 `marketplace/Oak-liuhj__dsh-taskflow.yml`。只新增自己的条目，不手改目录生成的 README；仓库需创建满一天、含真实代码及 `dsh.bundle.patch`。本项目分类为 `workflow`，图标采用 GitHub 托管 PNG，截图由根目录 `screenshots.json` 声明。
7. 分别记录 npm 发布、Release 下载、市场 PR、合并、目录刷新及实际可搜索/安装结果。npm 与目录通过发布包的 `repository` 关联，市场 YAML 不添加 `npm:` 字段。

## 用户更新

通过注册表包名安装后，宿主插件详情的“重新检查”查询新版本，“更新”安装指定兼容版本。也可执行：

```sh
dsh plugin --profile web add dsh-taskflow@0.1.4
```

将 `web` 替换为实际 profile。Git、本地目录及 tgz 安装不使用宿主的 npm 注册表更新列表，应手动安装新来源。不要通过版本豁免强行跳过未满足的宿主要求。

## 后续维护

已发布 npm 版本不可覆盖。修复时递增版本，重新构建并验证最终 tgz。保持包名、根导出、ModuleLoader ID、Cordis 插件 ID 和数据目录稳定；不因版本号调整清空或重建任务账本。
