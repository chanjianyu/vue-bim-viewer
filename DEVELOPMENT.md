# 开发与发布指南

本工程为 `@caojinyu111/vue-bim-viewer` 的独立 SDK 源码，当前版本 **0.3.0**。运行代码使用 JavaScript，公开类型声明单独维护。浏览器预览由外部 Vue 应用提供。

## 环境与安装

使用 Node.js 24 LTS 与 npm，在工程根目录执行：

```sh
npm ci
npm run check
```

依赖版本由锁文件固定。Vue、Three.js 保持现有 peerDependencies 范围；更新依赖时同时验证消费兼容性。

## 工程结构

| 目录或文件           | 职责                                                   |
| -------------------- | ------------------------------------------------------ |
| `src/index.js`       | 公开运行入口和样式导入                                 |
| `src/MineViewer.vue` | JavaScript Vue 组件、Props、事件、插槽及实例方法       |
| `src/*.js`           | 渲染、模型、构件、外观、相机、背景、Marker、GIS 与影像 |
| `src/style.css`      | 组件样式                                               |
| `types/`             | 公开 `.d.ts`，包括组件、数据结构与 GIS 声明            |
| `scripts/`           | 声明复制与消费类型验证                                 |
| `test/`              | Node 自动化测试                                        |
| `dist/`              | 自动生成的 ESM、CJS、CSS 与声明文件                    |
| `release/`           | 本地发布安装包与验证报告                               |

修改源码和 `types/`，通过构建生成 `dist/`。修改公开接口时，应同步更新运行实现、独立声明、文档及相关测试。

## 检查命令

| 命令                   | 作用                                            |
| ---------------------- | ----------------------------------------------- |
| `npm run build`        | Vite 构建 ESM/CJS/CSS，并复制公开声明           |
| `npm run typecheck`    | 验证独立声明与严格 TypeScript Vue 消费示例      |
| `npm test`             | 先构建，再运行全部 Node 测试                    |
| `npm run check`        | 格式检查、消费类型验证、构建与全部测试          |
| `npm run format:check` | 检查 JavaScript、Vue、CSS、声明、脚本和配置格式 |
| `npm run format`       | 格式化上述文件                                  |

`test:gis` 保留原命令名，实际运行 `test/*.test.mjs` 中的全部测试；其中部分用例读取构建产物，需要先构建。通常直接执行 `npm test`。

`typecheck` 使用 `strict: true`、`skipLibCheck: false` 验证 Props、事件、插槽、实例方法及 GIS 输入，同时确认非法消费代码会产生类型错误。TypeScript 工具仅参与声明验证，运行源码不经过 TS 编译。

## 持续构建与应用预览

先执行一次完整构建，再分别启动两个监听进程：

```sh
npm run build:watch
```

```sh
npm run types:watch
```

前者更新 JavaScript 与样式，后者将 `types/` 中的声明变化同步到 `dist/`。这些命令不启动网页。在外部 Vue 应用中使用 SDK 时，组件与样式始终通过公开包名导入。

发布安装包的消费验证使用独立应用：安装生成的 `.tgz`，按 README 安装 peerDependencies，运行应用构建并在浏览器检查模型加载与交互。验证对象应为实际安装包。

## 0.3.0 打包与发布

确认包配置与锁文件中的版本均为 `0.3.0`，然后执行：

```sh
npm run check
node --input-type=module -e "import { mkdirSync } from 'node:fs'; mkdirSync('release', { recursive: true })"
npm pack --pack-destination ./release
npm publish ./release/caojinyu111-vue-bim-viewer-0.3.0.tgz --dry-run
```

`prepack` 会重新构建并运行全部 Node 测试。打包结果为 `release/caojinyu111-vue-bim-viewer-0.3.0.tgz`。发布白名单包括 `dist/`、`README.md`、`API.md`、`LICENSE`，npm 自动包含 `package.json`。

检查包文件列表，并在独立应用中完成 JavaScript、TypeScript、ESM/CJS、CSS 和 Vue 接入验证。验证报告记录实际命令、结果和环境；浏览器或性能验证只记录实际覆盖的范围。

使用具备包发布权限的 npm 账号发布已验证的安装包：

```sh
npm publish ./release/caojinyu111-vue-bim-viewer-0.3.0.tgz --access public
```

发布目标由 `publishConfig` 指向官方 npm registry，访问权限为 public。认证信息通过本机 npm 配置或发布平台提供，不写入工程。`--dry-run` 用于检查分发内容，不创建线上版本。

## 后续版本维护

根据变更选择新版本，用 `npm version <版本号> --no-git-tag-version` 同步更新包配置和锁文件；同步调整文档中的版本与安装示例，重新执行检查、打包和实际消费验证。npm 已发布的同名同版本不可覆盖。

保持三个运行时导出及已声明包子路径的稳定性。功能或限制变化时，同时核对 Props、事件、插槽、实例方法和公开类型。实际支持范围与已知问题统一维护在 [API 文档](./API.md#troubleshooting)。
