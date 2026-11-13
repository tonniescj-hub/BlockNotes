# 代码复用地图

核查日期：2026-10-09。实际版本以 package-lock.json 为准。依赖与游戏素材分别记录；只按需求复用，不导入联机、角色、合成或地形系统。

| 模块 / 仓库 | 锁定版本或参考 commit | 许可 / 活跃度 | 使用范围与决定 |
| --- | --- | --- | --- |
| [Three.js](https://github.com/mrdoob/three.js) | 0.180.0 | MIT，持续维护 | 采用几何、纹理、相机、射线与合并工具；静态房间无需体素引擎 |
| [react-three-fiber](https://github.com/pmndrs/react-three-fiber) | 9.8.1 | MIT，支持 React 19 | 采用 Canvas 生命周期和 pointer events；不另造交互框架 |
| [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) | 8a3ce60b40f1ff7a26422a8f8904fbedbe808688 | MIT，2026-10-06 有推送 | 移植六面的顶点 / UV 表；参考 JSON 模型继承、方向阴影与 AO。整库依赖 minecraft-data、chunk/world/网络生态且内带旧 Three，不适合静态小房间 |
| [prismarine-web-client](https://github.com/PrismarineJS/prismarine-web-client) | 395d100851c4f8c47c037f32f8447db464dc6753 | MIT，2026-10-06 有推送 | 研究资源与 GUI 分层；mineflayer / WebSocket / 网络客户端与本项目无关，未导入代码 |
| [drei](https://github.com/pmndrs/drei) | bf6f4addf47467d3885de272d94ca5127f6ef68f | MIT，2026-10-05 有推送 | 不采用：固定受限相机只需 lerp + useFrame，引入相机工具收益有限 |
| [minecraft-inventory](https://github.com/sya-ri/minecraft-inventory) | d1188a8b2aa4dbe5e7f661bbca63834a56bc5669 | MIT 代码，2026-10-02 有推送 | 参考格子与游戏资源许可区分；拖放、合成与多余状态未采用 |
| [minecraft-gui](https://github.com/rabbikazmi/minecraft-gui) | 5cf68533c7b9c4bf966553c1f7b4de13ae9c1559 | MIT，2025-08-11 最后推送 | 参考 DOM 容器；原始 GUI 尺寸直接依据 1.21 定义，未复制样例代码 |
| [Tiptap](https://github.com/ueberdosis/tiptap) | 3.31.4 | MIT 内核，持续维护 | 采用唯一编辑器、ProseMirror 文档与历史；书页分页为显示层，不拆正文，不限制字数 |
| [Milkdown](https://github.com/Milkdown/milkdown) | bbb8bcbbb8ce0aa16f92567c23f6236747be9b3b | MIT，2026-10-08 有推送 | Markdown 方案备选；已采用 Tiptap，不引入竞争编辑器 |
| [Tauri plugins](https://github.com/tauri-apps/plugins-workspace) | 46381516b7bd7b6915ded698d93e92760b4221d7 | Apache-2.0 仓库，组件查看各自声明；2026-10-08 有推送 | 调研官方 SQL / 文件 API；开发机无 Rust，用户已接受 Electron，本轮保留单一桌面壳 |
| [Electron](https://github.com/electron/electron) | 44.7.0 | MIT + Chromium notices | 采用 sandbox、contextIsolation、窄 IPC 与文件对话框；Node 24 内置 SQLite，减少原生扩展成本 |
| [Node SQLite](https://nodejs.org/api/sqlite.html) | Electron Node 24.21 | Node 许可 | 采用 DatabaseSync 事务、WAL、VACUUM INTO；迁移、revision、恢复合并为本项目领域逻辑 |

补充检索了 `RandomEngy/tauri-sqlite`、`FocusCookie/tauri-sqlite-example`、`emarifer/note-taking-db` 的桌面/数据库分层模式，未复制代码或导入依赖。

## 资源解析与原版视觉

2026-10-10 可靠性修复采用 `stream-json` 3.7.0 / `stream-chain` 4.2.6（BSD-3-Clause）解析备份 token 流。复用上游 Parser 与 Assembler，在 Worker 中逐条暂存 SQLite，再以一个事务合并，避免重新实现 JSON 解析器。版本由 lockfile 锁定，原文许可已收集，API 参考 https://github.com/uhop/stream-json/wiki/Assembler 。

[mcasset.cloud/1.21](https://mcasset.cloud/1.21) 用于目录研究。实际本地素材来自 Mojang 官方客户端，提取脚本校验 SHA-1，递归解析模型 parent 和纹理引用。块坐标 1 单位 = 1 方块，JSON 16 像素 = 1 单位；复用原版 slab、stairs、fence、pot、lantern、lectern 模型。GUI 使用原版 182×22 hotbar、24×24 selection、18×18 slot、book 页与按钮定义；nearest 采样，无纹理插值。

代码许可原文保留在 THIRD_PARTY_NOTICES.md 与 docs/licenses。游戏资源不进入 Git，也不进入默认公开打包路径。私人本地包单独显式构建；没有对外发布。

## 讲台与分类维护（2026-10-10）

独立讲台复用现有 Three.js / R3F 场景、相机与模型，并复用 `BookEditor` 的 Tiptap / ProseMirror 和 DOM 分页测量。仅增加固定镜头预设与选书界面，没有新增编辑器或依赖。自定义书架删除使用既有 SQLite 事务和 revision 机制，在一个事务内迁移所有状态笔记并删除空分类；无需修改数据库版本或旧备份格式。


## 2026-11-13 阅读资料更新

采用 npm 固定版本依赖，不复制整套 GitHub 项目：

| 依赖 | 版本 | 来源 | 用途 |
| --- | --- | --- | --- |
| pdfjs-dist | 6.5.438 | https://github.com/mozilla/pdf.js | PDF 页面、文字层、目录与文字提取；Apache-2.0 |
| mammoth | 1.13.0 | https://github.com/mwilliamson/mammoth.js | DOCX 内容转换；BSD-2-Clause；禁用嵌入样式映射和外部文件访问 |
| docx | 9.15.3 | https://github.com/dolanmiu/docx | 标准 DOCX 生成；MIT |
| sanitize-html | 2.18.2 | https://github.com/apostrophecms/sanitize-html | 转换及恢复 HTML 白名单清理；MIT |
| cheerio | 1.2.0 | https://github.com/cheeriojs/cheerio | 目录、稳定块 ID 与文本提取；MIT |

继续使用现有 Tiptap 编辑器和 yauzl ZIP 检查。依赖及传递依赖许可证由 `scripts/collect-licenses.mjs` 保留于 `docs/licenses/`。boolbase 1.0.0 的 npm 包未带独立许可证，保留上游 https://raw.githubusercontent.com/fb55/boolbase/master/LICENSE 的原始 ISC 文本；isarray 1.0.0 的许可证来自该版本 README。
