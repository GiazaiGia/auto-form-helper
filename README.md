# 自动填表助手

Windows 本地工具，用于监控微信独立聊天窗口里的腾讯文档表单链接，并按本地账号资料自动填写表单。

## 下载使用

普通使用不需要克隆源码。请到 GitHub Releases 下载最新的 `auto-form-helper-setup-*.exe` 安装包。

## 当前功能

- 微信监控台：识别独立聊天窗口里的腾讯文档表单链接
- 虚拟屏支持：可把已接入的监控窗口放到虚拟屏
- 找回独立窗口：独立聊天窗口如果跑到虚拟屏，可先移回主屏再接入
- 同步开关：左侧先识别，开启同步后再把链接送入右侧队列
- 自动填表：按本地账号资料匹配抖音号和赛道后填写腾讯文档表单
- 自动更新：通过 GitHub Release 检查新版本

## 本地数据

以下文件是个人数据，不会提交到仓库：

- `config/accounts.json`
- `config/answers.json`
- `config/monitor.json`
- `history.json`
- `monitor-events.json`
- `.qqdocs*`

## 开发

```cmd
npm install
npm run desktop
```

打包安装包：

```cmd
npm run dist
```

生成文件会在 `release/` 目录。PaddleOCR 等大体积运行文件不提交到源码仓库，正式分发请使用 Release 里的安装包。
