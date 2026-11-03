# 开发与发布指南

本工程为 `@caojinyu111/vue-bim-viewer` 的独立 SDK 源码，当前版本 **0.3.2**。运行代码使用 JavaScript，公开类型声明单独维护。浏览器预览由外部 Vue 应用提供。

## 环境与安装

使用 Node.js 24 LTS 与 npm，在工程根目录执行：

```sh
npm ci
npm run check
```

依赖版本由锁文件固定。Vue 3.5.43、Three.js 0.183.1 的 peerDependencies 与开发依赖均固定版本，@types/three 固定 0.183.1；three-tile 0.12.2 是普通依赖。Vue/Three 构建时排除，three-tile（含 plugin）参与构建，保留 ESM/CJS。更新依赖时同时验证消费兼容性。

## 工程结构

| 目录或文件           | 职责                                                    |
| -------------------- | ------------------------------------------------------- |
| `src/index.js`       | 公开运行入口和样式导入                                  |
| `src/MineViewer.vue` | JavaScript Vue 组件、Props、事件、插槽及实例方法        |
| `src/*.js`           | 渲染、模型、构件、外观、相机、背景、Marker、GIS 与影像  |
| `src/gis/`           | 地图坐标适配、three-tile 图层、DEM 数据与网格、请求预算 |
| `src/navigation/`    | Home、26 方向骰子及相机方向同步                         |
| `src/style.css`      | 组件样式                                                |
| `types/`             | 公开 `.d.ts`，包括组件、数据结构与 GIS 声明             |
| `scripts/`           | 构建时复制公开声明                                      |
| `AGENTS.md`          | 后续开发与统一宿主验证约定                              |
| `dist/`              | 自动生成的 ESM、CJS、CSS 与声明文件                     |

修改源码和 `types/`，通过构建生成 `dist/`。修改公开接口时，应同步更新运行实现、独立声明、文档及宿主接入。

地图使用 TileMap 和有限根节点适配器，优先 16 级、最多 256 张；不使用全球 LOD。影像与可选 DEM 共享 6 并发和取消信号。每个实例独立统计影像与 terrain-status，Viewer 在按需渲染帧调用 update；图片和地形完成后触发刷新。关闭后停止调度并取消请求，迟到图像和几何会释放，不再添加到场景或通知宿主。透明度改变不重新请求数据。模型拾取、树、外观和标签不访问地图节点。

DEM 默认关闭；相对模式以配准参考点的 DEM 高程为零，真实模式需要可靠高程配准及椭球高转换。`terrain-source.js` 适配天地图 zlib/150×150 UInt16 小端高程栅格、c 矩阵、三角插值与每实例 64 MiB 缓存；`terrain-geometry.js` 生成 33×33 地表与裙边；`requests.js` 管理共享请求预算。DEM 数据级别取影像级别与 12 的较小值，影像级别低于 6 时不支持地形；无有效响应或样本缺测时报告错误，不将其视为零高程。高程基准未确认时只能使用相对预览。完整公开配置、限制与事件见 API 9.11。

three-tile/plugin 在启用地图时延迟导入，避免其 GeoJSON 初始化依赖 OffscreenCanvas 导致 Node/SSR 导入失败。构建会生成私有共享块与插件块（ESM/CJS 各自一套），它们随整个 `dist/` 分发，不作为公开子路径。不要只复制 `index.js` 或 `index.cjs`。

## 检查命令

| 命令                   | 作用                                            |
| ---------------------- | ----------------------------------------------- |
| `npm run build`        | Vite 构建 ESM/CJS/CSS，并复制公开声明           |
| `npm run check`        | 格式检查与构建                                  |
| `npm run format:check` | 检查 JavaScript、Vue、CSS、声明、脚本和配置格式 |
| `npm run format`       | 格式化上述文件                                  |

本项目检查只证明格式和 ESM/CJS/CSS 构建成功、公开声明已复制，不代表功能验收或严格 TypeScript 消费检查通过。公开 `.d.ts` 继续独立维护，运行源码使用 JavaScript。

## 持续构建与应用预览

先执行一次完整构建，再分别启动两个监听进程：

```sh
npm run build:watch
```

```sh
npm run types:watch
```

前者更新 JavaScript 与样式，后者将 `types/` 中的声明变化同步到 `dist/`。这些命令不启动网页。在外部 Vue 应用中使用 SDK 时，组件与样式始终通过公开包名导入。

## 统一使用 bim-view-tool 验证

所有功能开发完成后，使用同级 `D:/work/bim-view-tool` 项目作为唯一宿主验证入口。不要在 SDK 中新建临时消费项目、测试目录或浏览器夹具，除非用户另行要求。

1. 在 SDK 目录执行 `npm run check`。
2. 在 `D:/work/bim-view-tool` 执行 `npm run check`，完成宿主格式检查、两端构建和真实 npm link 检查。宿主及隔离链接注册区必须指向当前 SDK，且通过包入口与 `style.css` 消费 `dist/`。
3. 在宿主执行 `npm run dev`，使用其实际模型打开浏览器，验证加载、控制台和本次改动的交互。默认端口为 5173；有冲突时先设置 `BIM_HOST_PORT`。
4. 涉及布局时检查桌面与窄屏；按变更回归 Home、骰子、模型选择、Marker 和 GIS。宿主未启用的能力明确记录为未覆盖，不用合成夹具代替真实宿主验收。
5. 验证结果随交付说明提供，不在 SDK 内累计临时报告、截图或安装包。构建与链接成功不能代替浏览器功能验证。

日常验证保留真实 npm link。只有用户明确要求验收发布安装包时，才在同一宿主中安装指定 `.tgz` 验证，并在完成后恢复链接。不自动修改宿主业务配置或发布 npm。

## 0.3.2 打包与发布

确认包配置与锁文件中的版本均为 `0.3.2`，然后执行：

```sh
npm run check
npm pack --dry-run
```

`prepack` 只重新构建。发布白名单包括 `dist/`、`README.md`、`API.md`、`LICENSE`，npm 自动包含 `package.json`。发布工作流保留 `npm run check` 入口，该步骤只做格式检查与构建；功能验收在发布前通过 `bim-view-tool` 完成。

检查包文件列表：应仅包含完整 `dist/`、`README.md`、`API.md`、`LICENSE` 和 `package.json`。共享分块、动态插件分块及声明必须完整，源码、测试、开发指南、本机配置和验收记录不进入 npm 包。

需要生成安装包时，用 `npm pack --pack-destination <仓库外输出目录>`，生成 `caojinyu111-vue-bim-viewer-0.3.2.tgz`，不在本项目保留历史安装包；安装包的实际消费验证仍使用 `bim-view-tool`。浏览器、类型或性能验证只记录实际覆盖的范围，不宣称未执行的检查通过。

使用具备包发布权限的 npm 账号发布已验证的安装包：

```sh
npm publish <已验证安装包的绝对路径> --access public
```

发布目标由 `publishConfig` 指向官方 npm registry，访问权限为 public。认证信息通过本机 npm 配置或发布平台提供，不写入工程。`--dry-run` 用于检查分发内容，不创建线上版本。

GitHub 的 Publish to npm 工作流支持手动触发和推送 `v*` 标签触发；准备版本不包含推送标签或启动工作流。提交发布内容时，确保 `src/gis/`、`src/navigation/`、类型和文档均已纳入版本控制，避免只提交已有文件的修改而遗漏功能模块。

## 后续版本维护

根据变更选择新版本，用 `npm version <版本号> --no-git-tag-version` 同步更新包配置和锁文件；同步调整文档中的版本与安装示例，重新执行检查、打包和实际消费验证。npm 已发布的同名同版本不可覆盖。

保持三个运行时导出及已声明包子路径的稳定性。功能或限制变化时，同时核对 Props、事件、插槽、实例方法和公开类型。实际支持范围与已知问题统一维护在 [API 文档](./API.md#troubleshooting)。
