# 开发与发布指南

本工程为 `@caojinyu111/vue-bim-viewer` 的独立 SDK 源码，当前版本 **0.3.5**。运行代码使用 JavaScript，公开类型声明单独维护。浏览器预览由外部 Vue 应用提供。

## 环境与安装

使用 Node.js 24 LTS 与 npm，在工程根目录执行：

```sh
npm ci
npm run check
```

依赖版本由锁文件固定。Vue 3.5.43、Three.js 0.183.1 的 peerDependencies 与开发依赖均固定版本，@types/three 固定 0.183.1；three-tile 0.12.2 是普通依赖。Vue/Three 构建时排除，three-tile（含 plugin）参与构建，保留 ESM/CJS。更新依赖时同时验证消费兼容性。

## 工程结构

| 目录或文件            | 职责                                                    |
| --------------------- | ------------------------------------------------------- |
| `src/index.js`        | 公开运行入口和样式导入                                  |
| `src/MineViewer.vue`  | JavaScript Vue 组件、Props、事件、插槽及实例方法        |
| `src/*.js`            | 渲染、模型、构件、外观、相机、背景、Marker、GIS 与影像  |
| `src/camera-zoom.js` | 每 Viewer 独立的缩放目标、参数与边界计算，复用相机动画 |
| `src/marker-clustering.js` / `src/MarkerClusters.vue` | 屏幕距离聚合、默认数量按钮、自定义展示和分页成员列表 |
| `src/selection.js`    | 内置选中填色、轮廓和临时材质生命周期                    |
| `src/gis/`            | 地图坐标适配、three-tile 图层、DEM 数据与网格、请求预算 |
| `src/navigation/`     | Home、26 方向骰子及相机方向同步                         |
| `src/component-tree/` | 独立构件目录组件、搜索与展开、显隐三态及两档透明按钮    |
| `src/assets/svg/`     | Home、构件目录及面板使用的静态 SVG 图标                 |
| `src/SvgIcon.vue`     | 内部装饰图标组件，显示本地 SVG 原始内容                 |
| `src/style.css`       | 组件样式                                                |
| `types/`              | 公开 `.d.ts`，包括组件、数据结构与 GIS 声明             |
| `scripts/`            | 构建时复制公开声明                                      |
| `AGENTS.md`           | 后续开发与统一宿主验证约定                              |
| `dist/`               | 自动生成的 ESM、CJS、CSS 与声明文件                     |

修改源码和 `types/`，通过构建生成 `dist/`。修改公开接口时，应同步更新运行实现、独立声明、文档及宿主接入。

静态图标保存在 `src/assets/svg/`，通过 `import icon from '../assets/svg/home.svg?raw'` 导入，并交给内部 `SvgIcon` 的 `source` 属性显示。仅使用可信的本地 SVG，不传入外部 HTML。保留各图标的 `viewBox`，由调用组件的 CSS 控制尺寸、填充、描边及 `currentColor`；局部填充直接写在 SVG 路径属性中。按钮负责事件、焦点和无障碍名称，图标仅作装饰。动态方向骰子保留 `ViewCube.vue` 中的 SVG 模板，以支持相机同步和方向交互。SVG 内容会内嵌到 ESM/CJS 产物，宿主无需配置资源路径，也不额外请求图标文件。

构件目录只持有模型树快照、搜索与展开状态，通过外观查询和变更计数同步三态。显隐操作批量提交给已有 appearance 实例；选择共用 `selectComponent`，目录名称点击再组合定位。隐藏构件不自动显示，空节点不移动相机；公开 API 的单独选择和原点定位行为保持独立。`navigation.componentTree` 默认 true，关闭只隐藏目录界面。验证时覆盖与宿主自有树和外观面板的交叉操作，以及隐藏祖先下单独显示子分支、模型重载、窄屏鼠标操作和原生控件焦点顺序。

构件透明状态集中在 appearance.js 管理。每个几何节点只保存自身 translucent 布尔覆盖，材质按原不透明度乘 0.5 或 1；父级仅汇总完整分支，隐藏构件计入，透明状态不沿祖先继承。公共设置扩展整个分支，批量按输入顺序，changedIds 只列批末自身覆盖净变化，最多发一次事件。恢复构件时整组不透明，颜色和显隐仅恢复本节点。外观记录 schemaVersion 为 2，导入精确节点覆盖，不重复扩展分支；不支持记录静默忽略。构件树 schemaVersion 为 1。关闭目录保留状态，成功模型重载重新创建外观实例，失败保留当前实例，持久化由宿主自行实现。

实心与空心正方体保存在 assets/svg，以公开查询的 effective.translucent 驱动，不维护独立缓存。验证应覆盖父网格含子网格、混合分支、重叠批量、精确导入、原材质透明、无变化事件及宿主双向同步。

目录按钮与面板互斥显示，首次打开从距场景顶、左各 16px 的按钮原位置开始。`ComponentTreePanel.vue` 的 `position` 变量在同一实例内保存移动位置，关闭、配置隐藏或模型重载不重置，重新挂载或刷新页面后恢复默认值，不使用本地存储。通过 Pointer Events 和指针捕获处理标题栏拖动，标题文字和空白处显示移动光标，关闭按钮显示手形光标并阻止拖动启动；位置按目录容器的局部坐标计算，并限制四周 16px 边界。打开时修正越界位置；ResizeObserver 仅在面板打开时监听场景尺寸，尺寸变化时结束拖动并保存修正后的位置；关闭、禁用或卸载时释放指针捕获并清理尺寸监听。目录不注册键盘监听或行焦点导航，保留搜索输入和原生控件键盘行为。拖动不改变搜索、展开、显隐和选择状态。验证覆盖关闭重开、配置切换和重载后的位置记忆、边界、窗口尺寸及全屏变化、指针离开标题栏、关闭后的焦点恢复，以及场景事件隔离。

地图使用 TileMap 和有限根节点适配器，优先 16 级、最多 256 张；不使用全球 LOD。影像与可选 DEM 共享 6 并发和取消信号。每个实例独立统计影像与 terrain-status，Viewer 在按需渲染帧调用 update；图片和地形完成后触发刷新。关闭后停止调度并取消请求，迟到图像和几何会释放，不再添加到场景或通知宿主。透明度改变不重新请求数据。模型拾取、树、外观和标签不访问地图节点。

DEM 默认关闭；相对模式以配准参考点的 DEM 高程为零，真实模式需要可靠高程配准及椭球高转换。`terrain-source.js` 适配天地图 zlib/150×150 UInt16 小端高程栅格、c 矩阵、三角插值与每实例 64 MiB 缓存；`terrain-geometry.js` 生成 33×33 地表与裙边；`requests.js` 管理共享请求预算。DEM 数据级别取影像级别与 12 的较小值，影像级别低于 6 时不支持地形；无有效响应或样本缺测时报告错误，不将其视为零高程。高程基准未确认时只能使用相对预览。完整公开配置、限制与事件见 API 9.11。

GIS 控制点的模型坐标沿用源模型单位；默认最小二乘配准要求水平分散且不共线，`first-point` 模式由首点固定位置、其余点确定方向。`metersPerUnit` 负责将模型单位换算为 GIS 使用的米制坐标。

three-tile/plugin 在启用地图时延迟导入，避免其 GeoJSON 初始化依赖 OffscreenCanvas 导致 Node/SSR 导入失败。实际启用 GIS 地图的浏览器仍需支持 `OffscreenCanvas`、`fetch`、`createImageBitmap`、`AbortSignal.any` 和 `AbortSignal.timeout`；启用 DEM 还需 `DecompressionStream`。构建会生成私有共享块与插件块（ESM/CJS 各自一套），它们随整个 `dist/` 分发，不作为公开子路径。不要只复制 `index.js` 或 `index.cjs`。

Marker 聚合由包内 `marker-clustering.js` 维护每实例的网格与聚散缓冲，`MarkerClusters.vue` 显示数量和分页成员。相机预测共用实际投影函数，先验证可见性与拆分结果，再复用已有相机动画。完成回调在最终投影后执行，取消时丢弃，避免拖动或数据变化后打开过期列表。Viewer 缓存相机矩阵与投影；标记、显隐或尺寸变化使缓存失效，无关 GIS 渲染帧不会重复聚合。功能验证统一在宿主执行，尤其覆盖 2000 点、完全重合、成员弹窗、动画中断与静止停止调度；构造数据与真实业务数据分别说明。

相机操作共用 `camera-motion.js` 的动画与完成/取消回调。`camera-zoom.js` 不独立调度 RAF，连续调用累计尚未完成的目标距离，外部相机操作或用户交互会清理旧缩放目标。定位/导航默认 800ms，缩放默认 300ms；单次 duration 优先于组件配置，0 或减少动态效果设置即时完成。

## 检查命令

| 命令                   | 作用                                            |
| ---------------------- | ----------------------------------------------- |
| `npm run build`        | Vite 构建 ESM/CJS/CSS，并复制公开声明           |
| `npm run check`        | 格式检查与构建                                  |
| `npm run format:check` | 检查 JavaScript、Vue、CSS、声明、脚本、配置与 SVG 格式；SVG 显式使用 HTML 解析器 |
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

## 消费应用验证

使用实际 Vue 应用，通过公开包入口与 `style.css` 消费构建后的 `dist/`，验证应用集成。开发环境的具体项目和验证约定见仓库中的 `AGENTS.md`，使用者无需采用维护者的本机目录或应用配置。

1. 在 SDK 目录执行 `npm run check`。
2. 本地联调可使用 `npm link`：先在 SDK 目录执行 `npm link`，再在消费应用目录执行 `npm link @caojinyu111/vue-bim-viewer`。核对链接实际指向当前 SDK，并统一 Vue、Three.js 的版本和实例。
3. 执行消费应用自己的检查、生产构建和开发启动命令，使用实际模型打开浏览器，验证模型加载、地图、控制台及相关交互。
4. 涉及布局时检查桌面与窄屏；按变更回归 Home、骰子、模型选择、Marker 和 GIS。宿主未启用的能力明确记录为未覆盖，不用合成夹具代替真实宿主验收。
5. 验证结果随交付说明提供，不在 SDK 内累计临时报告、截图或安装包。构建与链接成功不能代替浏览器功能验证。

本地联调完成后保留 npm link。统一宿主为同级 `../bim-view-tool`：在宿主根目录执行 `npm run check`，它会重建 SDK、建立并检查真实 npm link，再构建应用。确认应用始终通过包名和公开 `style.css` 使用 `dist`。

验收安装包时，先记录宿主 manifest、锁文件和链接状态，在 `apps/viewer-host` 中执行 `npm install <tgz绝对路径> --no-save --package-lock=false --no-audit --no-fund`。确认已安装目录不再链接到 SDK、版本正确，再直接在该应用目录执行 `npm run build` 和预览命令。此阶段不要运行宿主根目录的 `npm run check`、`npm run build` 或 `npm run dev`，这些命令会重建并恢复 npm link，导致实际验证对象变化。临时安装使用宿主既有 npm 缓存和链接区配置，不修改用户全局配置。

安装包验收无论成功或失败，都在宿主根目录执行 `npm run link` 和 `npm run check:link` 恢复并确认链接，核对 manifest 和锁文件未变。不要用直接导入 SDK 源码的方式代替公开包入口验证。

## 0.3.5 版本内容

本版纳入独立缩放方法、可选 Marker 聚合、自定义聚合插槽和模型坐标视角快照，并同步组件公开声明与接入文档。聚合默认关闭、半径默认 48 CSS 像素；默认按钮外观采用固定默认值，由宿主 CSS 覆盖或插槽扩展。如果宿主曾配置开发阶段的 `--mv-cluster-*` 变量，需迁移为 CSS 覆盖，按钮尺寸不影响聚合半径。

运行时入口保持 `MineViewer`、`flattenComponentTree`、`createGisPlacement`，内部缩放与聚合工厂不作为包导出。保持依赖版本和外观记录格式，清除无条件输出模型及构件数据的调试日志。`initialView` 已升级为 `ViewState`，旧的 `direction / fitPadding` 配置不再兼容；宿主未提供快照时使用自动适配。功能验收、浏览器兼容和性能范围以实际交付结果为准。

## 0.3.5 打包与发布

确认包配置与锁文件中的版本均为 `0.3.5`，然后执行：

```sh
npm run check
npm pack --dry-run
```

`prepack` 只重新构建。发布白名单包括 `dist/`、`README.md`、`API.md`、`LICENSE`，npm 自动包含 `package.json`。发布工作流运行 `npm run check`，该步骤只做格式检查与构建；功能验收须在发布前通过实际消费应用完成。

检查包文件列表：应仅包含完整 `dist/`、`README.md`、`API.md`、`LICENSE` 和 `package.json`。共享分块、动态插件分块及声明必须完整，源码、测试、开发指南、本机配置和验收记录不进入 npm 包。

需要生成安装包时，用 `npm pack --pack-destination <仓库外输出目录>`，生成 `caojinyu111-vue-bim-viewer-0.3.5.tgz`，不在本项目保留历史安装包；安装包须通过实际消费应用验证。浏览器、类型或性能验证只记录实际覆盖的范围，不宣称未执行的检查通过。

使用具备包发布权限的 npm 账号发布已验证的安装包：

```sh
npm publish <已验证安装包的绝对路径> --access public
```

发布目标由 `publishConfig` 指向官方 npm registry，访问权限为 public。认证信息通过本机 npm 配置或发布平台提供，不写入工程。`--dry-run` 用于检查分发内容，不创建线上版本。

GitHub 的 Publish to npm 工作流支持手动触发和推送 `v*` 标签触发；工作流检查 package.json 与 package-lock.json 的包名及版本一致，标签触发时还要求标签精确匹配 `v${package.version}`，不匹配则终止。准备版本不包含推送标签或启动工作流。提交发布内容时，确保 `src/gis/`、`src/navigation/`、类型和文档均已纳入版本控制，避免只提交已有文件的修改而遗漏功能模块。

## 后续版本维护

根据变更选择新版本，用 `npm version <版本号> --no-git-tag-version` 同步更新包配置和锁文件；同步调整文档中的版本与安装示例，重新执行检查、打包和实际消费验证。npm 已发布的同名同版本不可覆盖。

保持三个运行时导出及已声明包子路径的稳定性。功能或限制变化时，同时核对 Props、事件、插槽、实例方法和公开类型；当前 `ViewerApi` 包含 23 个实例方法，视角快照不新增实时事件。实际支持范围与已知问题统一维护在 [API 文档](./API.md#troubleshooting)。
