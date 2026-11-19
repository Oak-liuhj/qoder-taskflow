# Qoder 插件正式版发布

版本：0.1.0。目标为 [Qoder 插件广场](https://qoder.com/zh/marketplace)，开发者入口为 [我的发布](https://qoder.com/account/apphub-publications)。

2026-11-19 已核对官方发布总览、插件发布、发布者资料、自测报告和审核版本说明，以及公开市场的“提交到社区”链接。官方正式市场采用发布中心上传、审核、自动上线流程，未在这些官方入口发现 GitHub PR 投稿渠道。CLI 的自定义 marketplace.json 目录源与官方市场收录是不同流程。

## 发布者资料

在发布中心填写个人或组织资料：全局唯一的发布者名称、简介（最多 128 字）、国家码、电话和邮箱。头像或 Logo 为 JPG / PNG、最大 100 KB；官方说明当前资料页的头像仅供审核查看，公开署名以发布预览为准。网站和 GitHub 选填。身份认证按账号页面提供的入口与条件办理，不假定现有账号已经认证。

## 发布前验证

```sh
npm ci --ignore-scripts
npm run check
git diff --check
```

使用 dist/qoder-taskflow-0.1.0.zip，不要上传源码目录或根开发 package。ZIP 顶层直接包含 .qoder-plugin/plugin.json，没有额外外层目录。根开发包设置 private，避免误发 npm。

根 package、插件 manifest、MCP 与面板版本必须一致，正式版不带预发布后缀。dist/qoder-package-report.json 包含逐文件哈希和实际打包依赖，dist/SHA256SUMS.txt 包含 ZIP 哈希。插件 README、英文说明、更新记录、项目许可证及第三方许可随包交付。

有 CLI 的环境额外运行 qoder plugins validate ./dist/qoder-taskflow，命令名按实际安装调整。实机安装验收与自动化验证分别记录。

## 投稿

1. 登录发布中心，完成发布者资料与页面要求的认证。
2. 打开“我的扩展 → 开始发布 → 插件”，上传上述 ZIP；包大小以当前页面限制为准。
3. 核对平台解析出的名称、0.1.0 版本和能力，填写展示名称、图标、分类、简介、使用说明及署名。可使用 marketplace/LISTING.md 中的文案。
4. 核对每个 MCP 服务及识别出的认证方式。本项目的 taskflow 是包内 Node.js stdio 服务，无在线 MCP URL，不使用额外 OAuth 或 API Key。应在审核材料说明运行方式、Node.js 前置条件与复现步骤，按平台实际解析结果处理；不要编造服务器地址或测试 Key。
5. 提供与本次 0.1.0 对应的自测报告，完成上架前检查并核对市场预览。当前材料见 marketplace/SELF_TEST_0.1.0.md，其中正式版实机安装、完整工作流及截图仍标为待补，不应原样声称全部验收通过。
6. 点击提交审核，在“我的扩展”查看进度和修改意见；审核通过后平台自动发布。

本插件包含 MCP Apps 界面。官方要求自测报告记录界面加载、关键交互、工具返回与画面结果的一致性，并附操作截图或演示。历史开发版界面观察不能替代本次正式包的实机报告。无法提供报告或测试资料时，只能按发布页面允许的分支说明原因，不能保证通过审核。账号、密码和 Key 仅填写平台审核专用区域，不放入公开介绍、截图或包中。

提交后在 marketplace/SUBMISSION.md 记录真实提交时间、平台状态、回执及详情链接。审核待处理、审核通过、公开可搜索是不同状态；实际公开页面可访问后才记录“已上架”。若平台要求额外开发者协议或账号验证，按实际流程完成。本地导入与 GitHub 源码更新不代表广场上架。

本仓库不保存访问令牌、浏览器登录态或账号凭据。

## 官方依据

- [发布扩展总览](https://docs.qoder.com/zh/developers/publishing/overview)
- [发布者资料与认证](https://docs.qoder.com/zh/developers/publishing/publisher-profile)
- [发布插件](https://docs.qoder.com/zh/developers/publishing/plugins)
- [自测报告](https://docs.qoder.com/zh/developers/publishing/self-test-report)
- [审核测试资料](https://docs.qoder.com/zh/developers/publishing/review-test-materials)
- [审核与版本管理](https://docs.qoder.com/zh/developers/maintenance/review-and-versions)
