# 开发说明

需要 Node.js ≥24.9.0。源码仅面向 Qoder，根 package.json 为私有开发包，交付物是 Qoder 插件 ZIP。

| 路径 | 职责 |
| --- | --- |
| src/domain/ | 任务、依赖、身份归属、版本和结果的领域校验 |
| src/storage/ | 原子文件账本与内存事务 |
| src/qoder/ | MCP 协议、项目隔离、原生委派契约、Hook 和 MCP Apps 面板 |
| qoder/ | 插件 manifest、技能、命令、Agent 和 Hook 配置 |
| scripts/ | ZIP 构建、依赖许可收集和正式版检查 |
| test/ | 领域回归、Qoder 协议、独立安装包和面板验证 |
| marketplace/ | 投稿文案与实际提交状态 |

## 验证

```sh
npm ci --ignore-scripts
npm run check
git diff --check
```

npm test 的 Qoder 套件先构建插件，随后从临时目录解压并启动实际 MCP，测试 Hook、资源与前端握手。check:release 检查版本一致、打包白名单、逐文件哈希、许可、独立安装目录与 ZIP 一致。

仅生成包运行 npm run build；build:qoder 是同一命令的兼容别名。check:package 是 check:release 的兼容别名，需要先构建。插件版本以 qoder/.qoder-plugin/plugin.json 为运行时唯一来源，根开发包版本必须同步。

构建输出仅写入 dist/，测试使用临时目录或 .local/tests，不使用已安装插件的数据。不要为验证修改用户账本、宿主数据库或登录信息。

## 能力边界

MCP 只维护账本并返回 dispatch；真实聊天创建、回调和读取由当前 Qoder 会话调用宿主工具。缺少宿主工具时报告失败并保留状态。历史账本字段保留读取兼容，不代表当前插件提供对应宿主界面功能。

新增功能分别记录单元/协议验证和实机观察，不能由测试替代插件广场上架或真实宿主验收。
