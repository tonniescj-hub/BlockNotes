# BlockNotes

[![Source checks](https://github.com/tonniescj-hub/BlockNotes/actions/workflows/ci.yml/badge.svg)](https://github.com/tonniescj-hub/BlockNotes/actions/workflows/ci.yml)

一间可以写笔记的 3D 方块书房。面向 Windows，笔记保存在本机 SQLite；通过书与笔记录、讲台阅读、书架分类、箱子归档。固定主视角，鼠标带来小幅平滑视差，没有角色漫游。

当前预览版为 **0.2.1 Windows x64（阅读与笔记流程完善）**。[下载 0.2.1](https://github.com/tonniescj-hub/BlockNotes/releases/tag/v0.2.1)，全部版本见 [Releases](https://github.com/tonniescj-hub/BlockNotes/releases)，其他平台尚未验收。项目由 tonniescj-hub 发起和维护，免费分享；项目自身代码采用 MIT。

**BlockNotes 不是 Minecraft 官方产品，未经 Mojang 或 Microsoft 批准，也不与其关联。** 项目源码、第三方代码与原版游戏资源的许可分别管理。

![3D 书房实机截图](docs/screenshots/room.png)

[开始使用](docs/getting-started.md) · [功能教程](docs/user-guide.md) · [开发日志](docs/development-log.md) · [路线图](docs/roadmap.md) · [原创与许可声明](COPYRIGHT.md)

## 能做什么

- 导入 Word `.docx` / PDF 学习资料，讲台阅读、目录、阅读位置记忆、划线和想法；扫描件支持页级心得。
- 摘录携带出处加入读书笔记；笔记或摘录汇总导出 Word，支持调用本机 WPS／默认程序打开。

- 书与笔：中文输入、富文本、翻页、末页新增空白页、防抖自动保存与 Ctrl+S 保存。
- 讲台：独立 3D 阅读近景，左侧筛选笔记，右侧只读翻页；阅读不修改正文或笔记版本。
- 书架：分类、重命名、自定义书架删除；非空分类删除时迁移笔记，保留正文和状态。
- 指南针与命名牌：搜索书名、正文、标签，以及管理名称、标签和归属。
- 箱子：归档、回收与恢复；软删除和归档相互独立。
- 备份：完整 JSON 导出、旧格式兼容、事务合并、冲突副本去重、大文件后台恢复。
- 唱片机：本地资源准备后，按需播放 Java 1.21 的 19 张音乐唱片；暂停菜单暂停音乐，启动不自动播放。

## 运行前须知

**源码和公开程序包不内置原版游戏素材。** Windows 程序首次启动会自动下载并校验与你看到的演示相同的 Java 1.21 资源，完成后进入书房；以后读取本地资源，可离线使用。不需要普通用户安装 Node 或 npm。

资源准备从 Mojang 官方端点获取固定版本文件，校验客户端、索引和所需素材的哈希，像素字体复用同一转换实现。它不会验证游戏所有权，文件可下载不等于获得再分发授权。请自行确认你有权获取和使用对应资源，不要将生成的资源包上传至仓库、网盘或 Release。来源、哈希与许可边界见 [第三方声明](THIRD_PARTY_NOTICES.md)。

首次准备需要网络和足够磁盘空间；失败可重试，已校验缓存可复用。笔记与资源安装分开，全部校验通过后才启用新资源。资源一致不意味着所有显卡、DPI 或 DOM 字体排版与游戏渲染器完全相同。实际验收及限制见 [发布记录](docs/github-release-2026-10-10.md)。

## 界面预览

| 书与笔 | 独立讲台 |
| --- | --- |
| ![书与笔](docs/screenshots/editor.png) | ![讲台阅读](docs/screenshots/lectern.png) |

截图来自实际 Windows 应用，使用原创虚构学习笔记；完整演示及来源见 [截图说明](docs/screenshots/README.md)。

## 从源码启动

需要 Windows x64、Node.js **22.22 或以上**、npm 和 Git。首次安装依赖及准备资源需要网络；资源准备完毕后应用可离线使用。

在项目根目录执行：

```powershell
npm ci
powershell -NoProfile -File scripts/setup-local-resources.ps1
npm run desktop
```

`desktop` 启动本机 Vite 和 Electron。也可 `npm run build` 后 `npm start`。端口固定为 `127.0.0.1:5173`，不面向局域网开放。

### 数据与演示内容

桌面数据默认位于 `%APPDATA%\blocknotes\blocknotes.sqlite`，实际位置可在 Esc → 选项查看。浏览器开发模式默认使用 `.local/`；需要隔离时在启动前设置 `BLOCKNOTES_DATA_DIR`。更新程序不应删除数据目录。

首次启动创建空笔记库，不包含开发者的个人笔记。`examples/study-notes.json` 是原创虚构的学习文案，供演示和测试参考，**不是可直接恢复的备份**，不会自动导入。

## 操作

点击场景中的讲台、书架、箱子或唱片机进入功能；下方九格物品栏提供固定入口。数字 1–7 切换功能，Ctrl+N 新建笔记，Ctrl+K 检索，Ctrl+S 立即保存。

书房中 Esc 打开暂停菜单，容器中 Esc 关闭当前界面。设置和备份位于 Esc → 选项。删除笔记位于编辑器「书名与标签…」的次级操作中，进入回收区后仍可恢复。

## 构建和验收

不依赖原版素材的源码检查：

```powershell
npm run audit:source
npm run check
npm test
npm run build
npm run pack
node scripts/verify-package.mjs release/win-unpacked --public
```

`pack` 排除游戏资源，首次运行在用户本机自动准备。公共 CI 运行源码审查、类型检查、单元测试和构建，不获取或上传游戏资源；完整实机回归单独执行。

准备本地资源后的完整实机验收：

```powershell
npm run test:e2e
npm run pack:local
$env:BLOCKNOTES_TEST_EXE = (Resolve-Path 'release/win-unpacked/BlockNotes.exe').Path
npm run test:e2e
Remove-Item Env:BLOCKNOTES_TEST_EXE
```

`pack:local` / `portable:local` 将原版素材放入 `resources/minecraft`，用于本机验证，**不用于公共发布**。保留整个 `win-unpacked` 文件夹，不单独移动 EXE。当前构建没有代码签名；不要将未签名构建描述为已完成 Windows 信任验证。

## 项目结构

| 位置 | 职责 |
| --- | --- |
| `src/minecraft/layout.ts` | 房间布局、材质选择、镜头与交互区 |
| `src/Scene.tsx`、`src/minecraft/` | 3D 模型解析、光照、GUI 图标、声音与唱片 |
| `src/App.tsx`、`BookEditor.tsx`、`LecternReader.tsx` | 功能入口、编辑与独立只读阅读 |
| `src/useLibrary.ts` | 串行保存、失败草稿保护 |
| `server/` | SQLite、搜索、迁移与后台备份恢复 |
| `electron/` | 沙箱桌面壳、IPC、本地文件与媒体协议 |
| `tests/` | 数据与模型测试、真实 Electron 回归 |

完整需求见 [产品计划书](BlockNotes_项目开发计划书.md)，开发约束见 [AGENTS.md](AGENTS.md)。架构与代码来源见 [architecture](docs/architecture.md)、[reuse-map](docs/reuse-map.md)；历史验收记录保留其验收日期，不代表后续版本自动通过。

## 许可与贡献

项目自身代码采用 [MIT](LICENSE)，第三方代码保留原许可，详见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md) 与 `docs/licenses/`。本项目的 MIT 许可不授予 Minecraft 游戏文件、纹理、字体或音频的使用及再分发权。

作者以非商业目的开发并免费分享，这不是对 MIT 追加禁止商用限制；使用或分发 MIT 代码须保留版权与许可声明。原创来源、品牌身份与素材边界见 [COPYRIGHT](COPYRIGHT.md)。

提交问题和改进前请阅读 [贡献说明](CONTRIBUTING.md) 与 [安全说明](SECURITY.md)。资源使用边界依据 [Minecraft EULA](https://www.minecraft.net/en-us/eula) 与 [Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines) 单独核查；不把原版素材标为开源资产。
