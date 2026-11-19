# 开发说明

## 目录与依赖方向

```text
index.js                      # 稳定服务端入口
client.js                     # 提交到仓库的 ModuleLoader 构建产物
src/
  domain/task-service.mjs     # 任务树、归属、版本、状态和事务规则
  application/task-runtime.mjs# 全树调度、等待、并发及通知重送
  storage/task-store.mjs      # 原子文件账本、单写入锁与内存存储
  server/
    index.mjs                # 宿主生命周期装配
    config.mjs               # 配置 schema
    prompts.mjs              # 模型规划约定
    tools.mjs                # 模型工具到领域操作的映射
    session-context.mjs      # 状态注入与委派约束
    notifications.mjs        # 直接父通知和会话持久化
    tool-views.mjs           # 实际工具调用的展示适配
    rpc.mjs                  # 所有者界面操作
  client/
    index.jsx                # 槽位注册与左侧 portal 兼容层
    components/              # TaskPanel / TaskDialog / ToolPanel
    hooks/                   # 会话状态轮询
    model.mjs                # 展示树和进度投影
    styles.css               # 宿主隔离和布局适配
    generated/               # 从 PRD 同步的样式和 SVG，不手工编辑
scripts/                     # 构建、校验与隔离验收外壳
locale/                      # 用户可见的双语元数据
marketplace/                 # 收录 YAML 与投稿草稿
licenses/                    # 第三方许可
```

`domain` 只依赖 Node；`application` 依赖领域服务与注入的宿主接口；`storage` 不依赖 DSH；`server` 负责所有 DSH API 适配。客户端不直接读文件账本，通过所有者 RPC 同步。根入口和任务数据 schema 保持原值，此次移动文件不迁移或重写现有数据。

## 常用命令

```sh
npm ci
npm run build          # 同步 PRD 样式/图标并编译客户端
npm run build:check    # 只比较生成物，不写文件
npm test               # 领域、调度、客户端和真实 AgentLoop 固定模型测试
npm run check:release  # 元数据、入口、依赖、许可和投稿格式
npm run check          # 上述一致性检查 + 测试 + 发布检查
npm run check:package  # 打包并真实安装 tgz，检查生产入口和客户端
npm run check:hosts    # 在隔离目录安装最终包和各精确宿主版本，运行固定模型集成
npm run dev            # http://127.0.0.1:4173
```

源码开发需安装 devDependencies；发布包是已构建的运行产物，不包含源码开发工具、JSX、完整原型、截图或测试。禁止添加安装时构建或拉取脚本来依赖开发环境。

## 样式与验收

保留 `docs/prototype/dsh-taskflow-prd.html` 作为权威原型。`scripts/prd-assets.mjs` 只抽取任务树、工具窗口和弹窗规则，加组件作用域后生成 CSS 和 SVG 组件。更新原型或生成逻辑后执行 build，再检查桌面、手机与深浅主题；生成客户端内保留完整 MIT 通知。

开发外壳使用真实 DSH AgentLoop、JSONL 会话持久化与固定响应模型，数据位于 `.local/dev`。它不读取用户密钥，也不执行真实业务；`/prototype` 可直接对照原型。自动化与截图的具体证据边界见 [验收记录](./acceptance.md)。

## 依赖策略

服务端直接导入的 `@deepseek-ai/dsh-tools`、`dsh-llm`、`schemastery` 声明为必需 peer，以保证安装器能够解析实际导入。Cordis 上下文由宿主注入；React / ReactDOM 由浏览器 ModuleLoader 提供，作为 optional peer 声明，开发时仍精确安装。没有引入生产运行时的 esbuild、测试夹具或完整 DSH 可执行程序。

`engines.dsh` 与服务端 DSH peer 使用同一范围，从 0.2.1-rc.3 起、排除 1.0.0 及其预发行；开发依赖固定在 rc.2，作为可复现测试基线。发布校验检查版本边界、README 和 peer 一致性；真实宿主测试的结果单独记录，不能由范围校验推断。registry 的 `latest` 或 `next` 标签变化不会自动扩大兼容声明。Node CI 使用 24.22.1，与本地验证版本一致；最低版本声明为 24.9.0。

## 提交与 CI

CI 在 Linux 与 Windows 上运行构建一致性、测试、发布格式及实际包安装检查；只上传候选 tgz 和校验和，不发布 npm 或创建市场 PR。提交时包括新源码、生成物、锁文件及文档；不要只提交文件移动的一半，也不要提交 `.local`、凭据、账本和 dist。

## 受限工作区构建

默认从当前项目构建。若工作副本所在目录的祖先无法被原生 esbuild 读取，可设置 `TASKFLOW_BUILD_SOURCE` 指向经过逐文件比对、内容相同的客户端源码目录；只影响构建与客户端测试的源码读取位置，产物仍写入当前项目。此选项用于隔离验证，不进入运行包，也不改变默认构建行为。

`check:hosts` 默认测试 0.2.1-rc.3、0.2.2-rc.2、0.2.2-rc.3；可通过逗号分隔的 `TASKFLOW_HOST_VERSIONS` 指定版本。先执行 `check:package`，再执行宿主矩阵，结果记录在 `dist/host-report.json`，绑定实际 tgz 的 SHA-256。报告仅证明服务端固定模型流程，不证明完整原生界面和生产模型已验收。测试会安装注册表上的真实宿主依赖，需要网络或对应缓存。
