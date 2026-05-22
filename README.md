# 自动填表助手

Windows 本地工具，用于监控微信独立聊天窗口里的腾讯文档表单链接，并按本地账号资料自动填写表单。

## 使用方式

普通用户不需要克隆源码。请到 GitHub Releases 下载最新的安装包：

[https://github.com/GiazaiGia/auto-form-helper/releases](https://github.com/GiazaiGia/auto-form-helper/releases)

## 当前功能

- 微信监控台：识别独立聊天窗口里的腾讯文档表单链接。
- 自动填表：按本地微信号、抖音号、赛道和截图资料填写腾讯文档表单。
- 自动/手动提交测试：支持测试填写流程，不影响正式历史记录。
- 多抖音号连续填写：同一个微信号下多个同赛道抖音号可连续填写。
- 历史记录：支持筛选、导出和删除。
- 窗口适配：主窗口、监控台和可见 Edge 填表窗口会按用户电脑屏幕自动调整大小。
- 自动更新：通过 GitHub Release 检查新版本。

## 许可证

本项目采用 Source Available License，详见 [LICENSE](LICENSE)。

你可以：

- 查看源码。
- 下载、fork、修改源码。
- 自己编译并在自己的电脑上使用修改版。
- 分享源码层面的修改或补丁，但需要保留原许可证和署名。

未经作者书面授权，不可以：

- 售卖本软件或修改版。
- 公开分发编译后的安装包、exe 或打包应用。
- 改名包装成本软件的商业版本。
- 去掉原作者署名、许可证或项目来源说明。

这不是 OSI 标准意义上的开源许可证；它的目标是让用户能自己检查和修改代码，同时避免被未经授权商业化分发。

## 隐私

软件是本地工具，没有作者后台。微信号、抖音号、手机号、身份证号、支付宝信息、截图和历史记录默认只保存在用户自己的电脑里。

详细说明见 [PRIVACY.md](PRIVACY.md)。

## 本地数据

安装版默认把数据保存到 Windows 用户数据目录，例如：

```text
%APPDATA%\wechat-order-form-helper\data
```

常见本地数据包括：

- `config/accounts.json`
- `config/answers.json`
- `config/monitor.json`
- `history.json`
- `monitor-events.json`
- `.qqdocs*`

这些文件已被 `.gitignore` 排除，不应该提交到仓库。

## 开发

需要 Windows、Node.js 和 npm。

```cmd
npm install
npm run desktop
```

只启动本地服务：

```cmd
npm run app
```

运行填表脚本：

```cmd
npm run fill -- <腾讯文档表单链接>
```

## 打包

```cmd
npm run dist
```

生成文件会在 `release/` 目录。

注意：`tools/` 目录不提交到源码仓库。公开源码版本可以运行基础功能；高级 OCR 依赖的 PaddleOCR 运行文件需要自行准备，正式发布安装包中可额外打入这些运行文件。

## 免责声明

本工具用于用户自己管理本地资料和填写自己有权限填写的表单。使用者应遵守腾讯文档、微信和相关平台规则，并自行承担使用修改版软件的风险。
