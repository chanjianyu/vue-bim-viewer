# API 与集成指南

适用版本：**0.3.3**。本文面向在 Vue 3 应用中集成 `@caojinyu111/vue-bim-viewer` 的开发者，说明模型资源约定、组件接口、业务接入方式及使用限制。

SDK 使用 JavaScript 实现，同时提供独立的 TypeScript 类型声明。除 TypeScript 接入章节外，组件与业务示例均使用 JavaScript。快速安装见 [README](./README.md)；参数字段和可选性可结合发布包中的声明文件查阅。

示例中的模型 URL、构件 ID、控制点和服务密钥须替换为应用实际数据。

## 目录

1. [功能总览与职责](#overview)
2. [安装与最小完整示例](#quick-start)
3. [模型资源与加载生命周期](#model-loading)
4. [组件 Props](#props)
5. [公开实例方法与构件查询](#viewer-api)
6. [外观修改、差异与保存](#appearance)
7. [Marker 标签与弹窗](#markers)
8. [事件与插槽参考](#events-slots)
9. [GIS 配准、影像与 DEM](#gis)
10. [公开类型索引](#types)
11. [模块入口与类型声明](#development)
12. [常见问题与限制](#troubleshooting)

<a id="overview"></a>

## 1. 功能总览与职责

### 1.1 功能清单

| 能力       | 当前支持内容                                                    | 使用入口                                         |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------ |
| 模型加载   | 通过 Manifest 加载 GLB/glTF，处理外部 buffer/image 和可选元数据 | `MineViewer`、`modelSource`                      |
| 三维浏览   | 拖动旋转、滚轮缩放、右键平移、容器尺寸适配、初始全模型视角      | `initialView`、`resetView()`                     |
| 视角导航   | Home、26 方向骰子、六个标准方向方法及实时显隐                   | `navigation`、`setViewDirection()`               |
| 构件树     | 内置目录、名称搜索、分支显隐、选中定位及完整树查询              | `navigation.componentTree`、`getComponentTree()` |
| 场景查询   | 源场景结构快照、活的 Three.js 根节点、对象对应 ID               | `getSceneTree()` 等                              |
| 构件交互   | 三维拾取、按 ID 选择、青绿色高亮与细轮廓、相机定位、清除选择    | `selectComponent()`、`focusComponent()`          |
| 锚点查询   | 对象原点、包围盒中心、包围盒 Y 轴顶部                           | `getComponentAnchor()`                           |
| 外观控制   | 显隐、两档透明、颜色、批量设置及状态同步                          | `setComponentAppearance()` 等                    |
| 差异与恢复 | 当前净差异、合并导入、恢复单节点或全部覆盖                      | `getAppearanceChanges()` 等                      |
| 标签       | 原始模型坐标点、构件锚点、模型偏移、屏幕偏移                    | `markers`                                        |
| 弹窗与模板 | 默认标签/弹窗、自定义插槽、点击切换和关闭                       | `marker`、`marker-popup`                         |
| GIS 配准   | 三点或多点水平配准、可选高程、ENU/ECEF 矩阵、误差报告           | `createGisPlacement()`                           |
| 地图影像   | 有限范围天地图影像、透明度、独立加载状态                        | `gis`、`gis-status`                              |
| DEM 地形   | 相对预览、真实高程转换、缺测回退及独立准备状态                  | `gis.terrain`、`terrain-status`                  |
| 场景背景   | 纯色或普通静态图片，居中 cover，可响应式更新                    | `background`、`background-error`                 |
| 树展开工具 | 按源顺序深度优先展开构件树                                      | `flattenComponentTree()`                         |

### 1.2 SDK 与宿主的分工

SDK 管理模型加载、渲染、构件索引、外观运行状态、选择、标签投影和资源清理。宿主通过参数、事件及公开方法接入业务。

以下由宿主负责：模型 URL 与访问权限、业务按钮、标签内容、localStorage/服务端保存、JSON 文件选择与下载、地图服务密钥、控制点及真实高程基准转换。SDK 内置构件目录与名称搜索，通过 `gis` 属性接入可选影像与 DEM。宿主可通过公开查询与外观方法自建扩展面板；SDK 不依赖业务 UI 组件库。

当前包的运行时命名导出只有：

```js
import { MineViewer, flattenComponentTree, createGisPlacement } from '@caojinyu111/vue-bim-viewer'
import '@caojinyu111/vue-bim-viewer/style.css'
```

`ViewerApi`、`ComponentTree`、`GisPlacementOptions` 等是类型导出，TypeScript 应使用 `import type`。包提供 ESM、CJS 和类型声明；Vue 组件的挂载和三维渲染在浏览器中进行。

<a id="quick-start"></a>

## 2. 安装与最小完整示例

### 2.1 安装依赖

在 Vue 应用中安装 SDK：

```sh
npm install @caojinyu111/vue-bim-viewer@0.3.3
```

运行环境要求 Vue **3.5.43**、Three.js **0.183.1** 和支持 WebGL2 的浏览器。Vue 与 Three.js 为精确版本的共享 peerDependencies，npm 7+ 会补齐尚未安装的 peer；已有不兼容版本的宿主先执行 `npm install vue@3.5.43 three@0.183.1`。three-tile **0.12.2** 与 Proj4js 随 SDK 安装，three-tile 随 SDK 构建。启用 GIS 地图还需要 `fetch`、`createImageBitmap`、`AbortSignal.any`、`AbortSignal.timeout` 和 `OffscreenCanvas`；启用 DEM 额外需要 `DecompressionStream`。SSR 只能在客户端挂载组件。

TypeScript 应用额外安装 Three.js 类型声明：

```sh
npm install --save-dev @types/three@0.183.1
```

公开声明引用 Three.js 类型。`@types/three` 是 SDK 的开发依赖，不会随运行依赖传递，消费项目需自行安装。JavaScript 项目需要完整 JSDoc 提示时也可安装。

组件挂载前应导入样式并确保容器宽高非零；SSR 项目在客户端挂载。ESM/CJS 模块可被读取不代表提供服务端三维渲染。

### 2.2 最小完整 Vue 示例

将以下内容保存为消费项目中的 `.vue` 组件，替换 `manifestUrl` 后使用。父容器必须具有明确的非零宽高。

```vue
<script setup>
import { computed, ref, shallowRef } from 'vue'
import { MineViewer, flattenComponentTree } from '@caojinyu111/vue-bim-viewer'
import '@caojinyu111/vue-bim-viewer/style.css'

const viewer = shallowRef(null)
const tree = shallowRef(null)
const errorMessage = ref('')
const selectedId = ref(null)
const modelSource = ref({ manifestUrl: '/models/manifest.json' })
const initialView = { direction: { x: 1.15, y: 0.72, z: 1.35 }, fitPadding: 1.35 }
const markers = ref([])
const components = computed(() => flattenComponentTree(tree.value))

function onReady(value) {
  tree.value = value
  errorMessage.value = ''
}

function onLoaded(info) {
  console.log('模型信息', info)
}

function onError(error) {
  errorMessage.value = error.message
}

function onSelect(component) {
  selectedId.value = component?.id ?? null
}

function locateFirst() {
  const first = components.value.find((node) => node.hasGeometry)
  if (!first || !viewer.value) return
  viewer.value.selectComponent(first.id)
  viewer.value.focusComponent(first.id)
}
</script>

<template>
  <div>
    <button type="button" :disabled="!tree" @click="locateFirst">定位首个几何构件</button>
    <button type="button" :disabled="!tree" @click="viewer?.resetView()">重置视角</button>
    <p v-if="errorMessage">{{ errorMessage }}</p>
    <p>当前选择：{{ selectedId ?? '无' }}</p>
    <div style="width: 100%; height: 600px">
      <MineViewer
        ref="viewer"
        :model-source="modelSource"
        :initial-view="initialView"
        :markers="markers"
        @component-tree-ready="onReady"
        @model-loaded="onLoaded"
        @model-error="onError"
        @component-select="onSelect"
      />
    </div>
  </div>
</template>
```

组件 ref 在 Vue 挂载后可用，模型数据还要等待 `component-tree-ready`。`shallowRef` 适合保存 SDK 实例和只读快照；业务标签数据可以用普通 `ref`，或替换整个 `shallowRef` 数组来触发更新。

### 2.3 TypeScript 与 JSDoc

使用 TypeScript 时，可将上例的脚本改为 `<script setup lang="ts">`，并为实例和树添加类型：

```ts
import { shallowRef } from 'vue'
import type { ComponentTree, ViewerApi } from '@caojinyu111/vue-bim-viewer'

const viewer = shallowRef<ViewerApi | null>(null)
const tree = shallowRef<ComponentTree | null>(null)

function onReady(value: ComponentTree): void {
  tree.value = value
  console.log(viewer.value?.getComponentTree())
}
```

JavaScript 项目也可以获取编辑器提示：

```js
import { shallowRef } from 'vue'

/** @type {import('vue').ShallowRef<import('@caojinyu111/vue-bim-viewer').ViewerApi | null>} */
const viewer = shallowRef(null)
```

TypeScript 与 JSDoc 分别适用于不同项目写法，按应用语言选择即可。

以下为可单独使用的完整 TypeScript 组件（先安装上面的声明依赖）：

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { MineViewer, flattenComponentTree } from '@caojinyu111/vue-bim-viewer'
import type { ComponentTree, ModelSource, ViewerApi } from '@caojinyu111/vue-bim-viewer'
import '@caojinyu111/vue-bim-viewer/style.css'

const viewer = shallowRef<ViewerApi | null>(null)
const tree = shallowRef<ComponentTree | null>(null)
const source: ModelSource = { manifestUrl: '/models/manifest.json' }
function onReady(value: ComponentTree): void {
  tree.value = value
}
function focusFirst(): void {
  const id = flattenComponentTree(tree.value).find((node) => node.hasGeometry)?.id
  if (typeof id !== 'string' || !id.trim() || !viewer.value?.getComponent(id)) return
  viewer.value.focusComponent(id)
}
</script>

<template>
  <button type="button" :disabled="!tree" @click="focusFirst">定位构件</button>
  <div style="height: 600px; width: 100%">
    <MineViewer ref="viewer" :model-source="source" @component-tree-ready="onReady" />
  </div>
</template>
```

<a id="model-loading"></a>

## 3. 模型资源与加载生命周期

### 3.1 Manifest

`modelSource` 的格式为 `{ manifestUrl: string }`。Manifest 地址解析后必须使用 HTTP/HTTPS；浏览器中的相对地址相对于当前页面解析。模型入口和可选元数据地址相对于 Manifest 地址解析。

```json
{
  "version": "1.0.0",
  "modelId": "mine-model",
  "label": "矿山模型",
  "entry": "./model.glb",
  "hierarchy": "./hierarchy.json",
  "properties": "./properties.json"
}
```

| 字段         | 必填 | 说明                                               |
| ------------ | ---- | -------------------------------------------------- |
| `version`    | 是   | 当前必须为字符串 `"1.0.0"`，这是 Manifest 格式版本 |
| `entry`      | 是   | `.glb` 或 `.gltf` 模型地址；路径相对 Manifest 解析 |
| `modelId`    | 否   | 模型身份；省略时使用解析后的 Manifest URL          |
| `label`      | 否   | 模型名称；省略时为“BIM 模型”                       |
| `hierarchy`  | 否   | 层级元数据 JSON 地址                               |
| `properties` | 否   | 属性元数据 JSON 地址                               |

glTF 的外部 buffer/image 地址相对于模型入口地址解析。资源服务器需要正确配置 CORS，避免资源 URL 返回前端路由的 HTML。当前公开参数没有自定义请求头、鉴权回调或请求代理选项。

### 3.2 可选元数据格式

`hierarchy.json` 支持根数组或 `{ "root": [...] }`。节点可包含 `name`、`uuid`、`componentId` 和 `children`：

```json
{
  "root": [
    {
      "name": "副井",
      "uuid": "shaft-auxiliary",
      "children": []
    }
  ]
}
```

`properties.json` 为以模型源节点名称索引的对象：

```json
{
  "副井": {
    "井筒类型": "副井",
    "设计单位": "示例单位"
  }
}
```

构件树的真实父子层级来自 glTF 场景节点，不会被 `hierarchy.json` 重建。该文件用于补充 ID/源层级关联；按名称关联要求名称可唯一确定，不能用同名构件的属性进行模糊绑定。

可选元数据读取或校验失败通常只产生警告，模型继续加载。模型或外部资源下载失败、模型解析失败、没有有效几何等会触发加载失败；部分贴图问题也可能由 Loader 以警告报告。

### 3.3 加载流程与事件

组件挂载后自动加载，依次读取 Manifest、下载模型和元数据、解析模型、构建构件索引。候选模型完整准备好后才替换旧场景。

成功时依次发出 `component-tree-ready`、用于清空选择的 `component-select(null)`、`model-loaded`。树就绪回调内已经可以查询构件、设置外观或恢复保存记录。

`model-loaded` 的 `ModelInfo` 包含：

| 字段                   | 说明                                               |
| ---------------------- | -------------------------------------------------- |
| `modelId`、`revision`  | 模型身份和当前资源内容版本                         |
| `label`、`manifestUrl` | 模型名称和实际成功加载的清单地址                   |
| `stats.meshes`         | 场景网格数                                         |
| `stats.triangles`      | 根据几何索引/顶点数汇总并取整的三角形计数          |
| `stats.bytes`          | 主 GLB/glTF 文件字节数，不是全部外部资源的下载总量 |
| `warnings`             | 可选元数据、构件关联及贴图等加载提示               |

### 3.4 切换、重载与失败处理

替换或修改响应式 `modelSource.manifestUrl` 会自动重载；同 URL 的资源内容发生变化时，主动调用 `reload()`。每次重载都会取消上一轮未完成请求，旧候选不会覆盖较新的加载结果。

```js
// 放在第 2 节示例的 script setup 中使用。
function switchModel(nextManifestUrl) {
  modelSource.value = { manifestUrl: nextManifestUrl }
}

async function refreshModel() {
  if (!viewer.value) return
  await viewer.value.reload()
  // 成功与失败分别由 model-loaded / model-error 通知。
}
```

**`reload(): Promise<void>` 的完成不等于加载成功。** 当前实现捕获加载错误并通过 `model-error({ message })` 通知，不能只依赖 Promise 是否 reject 来判断结果。

重载失败保留最后成功的模型、构件数据及其外观；首次加载失败时查询仍无模型数据。取消过时加载通常不会作为业务加载错误上报。重新成功加载会生成新的运行时外观状态，宿主按模型身份和版本决定是否重新导入差异。

卸载组件会取消请求、停止帧调度、移除事件和尺寸监听，释放渲染器、常规 Mesh 的模型几何、材质、纹理与临时资源；特殊对象的资源释放存在缺口，见第 12 节。宿主无需也不应重复释放 SDK 返回的活场景对象。

<a id="props"></a>

## 4. 组件参数

| Prop               | 类型                      | 默认值                                            | 生效方式                                          |
| ------------------ | ------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `modelSource`      | `ModelSource`             | 必填                                              | 监听 `manifestUrl` 字符串变化，自动加载/重载      |
| `markers`          | `Marker[]`                | `[]`                                              | 深度监听响应式标签数据，更新标签投影和显示        |
| `initialView`      | `InitialView`             | `{}`                                              | 成功展示模型时交给渲染器，用于全模型适配与重置    |
| `cameraTransition` | `CameraTransitionOptions` | `{ duration: 800 }`                               | 定位和重置时读取，设置默认过渡时长                |
| `gis`              | `GisOptions`              | 不加载地图                                        | 可选天地图影像及 DEM，见 9.9、9.11                |
| `background`       | `BackgroundOptions`       | `{ color: '#f4f7fb' }`                            | 深度监听，实时更新背景，不重载模型                |
| `navigation`       | `NavigationOptions`       | `{ home: true, cube: true, componentTree: true }` | 构件目录、Home 与方向骰子分别实时显隐，不重载模型 |

Vue 模板中分别使用 `:model-source`、`:markers`、`:initial-view`、`:camera-transition`、`:gis`、`:background` 和 `:navigation`。

`InitialView` 的字段：

| 字段         | 类型     | 有效默认值                      | 含义                                                             |
| ------------ | -------- | ------------------------------- | ---------------------------------------------------------------- |
| `direction`  | `Point3` | `{ x: 1.15, y: 0.72, z: 1.35 }` | 从观察目标指向相机的方向向量，会归一化，不是经纬度或相机绝对位置 |
| `fitPadding` | `number` | `1.35`                          | 包围盒适配留白倍率，必须为有限正数；越大看起来越远               |

非法或零方向使用默认方向；无效留白倍率使用默认值。`initialView` 没有独立的实时相机更新监听，不应当作相机控制 API；替换该配置后，可通过 `reload()` 在下一次成功展示时重新应用。`focusComponent()` 保持当前观察方向，`resetView()` 按当前渲染器持有的初始配置适配整个模型。

<a id="navigation"></a>

### 4.1 构件目录、Home 与 26 方向导航骰子

`NavigationOptions` 包含 `home?: boolean`、`cube?: boolean` 和 `componentTree?: boolean`，未提供的字段均为 `true`。可以替换整个配置，也可修改响应式对象的字段；界面立即生效，不重载模型、不改变当前相机。

| 配置                                                 | 导航显示                                    |
| ---------------------------------------------------- | ------------------------------------------- |
| 不传、`{}`                                           | 构件目录按钮、Home 与骰子均显示             |
| `{ home: false }`                                    | 构件目录按钮与骰子                          |
| `{ cube: false }`                                    | 构件目录按钮与 Home，右上角收缩为 44px 按钮 |
| `{ componentTree: false }`                           | Home 与骰子，构件目录关闭并隐藏             |
| `{ home: false, cube: false, componentTree: false }` | 全部隐藏，不占位；实例方法仍可使用          |

```vue
<script setup>
import { reactive, shallowRef } from 'vue'
import { MineViewer } from '@caojinyu111/vue-bim-viewer'
import '@caojinyu111/vue-bim-viewer/style.css'
const viewer = shallowRef(null)
const source = { manifestUrl: '/models/manifest.json' }
const navigation = reactive({ home: true, cube: true, componentTree: true })
</script>

<template>
  <label><input v-model="navigation.home" type="checkbox" />Home</label>
  <label><input v-model="navigation.cube" type="checkbox" />方向骰子</label>
  <label><input v-model="navigation.componentTree" type="checkbox" />构件目录</label>
  <div style="height: 600px">
    <MineViewer ref="viewer" :model-source="source" :navigation="navigation" />
  </div>
</template>
```

构件目录按钮位于左上角，距顶、左各 16px，命中区域 45px。面板默认关闭；打开后隐藏按钮，首次打开时面板左上角与按钮原位置重合。面板宽最多 320px、高最多 560px，尺寸受场景容器宽高减去 32px 的可用空间约束，列表独立滚动。模型就绪后默认展开根节点，仅呈现源模型实际层级，不含空间分类、地图、DEM 或标签。

标题文字及空白处显示四向移动光标，按住可用鼠标或触屏拖动面板；关闭按钮显示手形光标，不启动拖动。面板限制在场景内，四周保留 16px；打开和场景尺寸变化时自动修正并保存越界位置。关闭后按钮恢复原位，再次打开保留关闭前的位置。同一组件实例内，关闭、配置隐藏及模型重载均保留位置；重新挂载或刷新页面后恢复初始位置，不使用本地存储。搜索框和列表不作为拖动区域，拖动不触发模型旋转、平移或拾取。

目录正方体是独立透明按钮，操作规则见 [外观字段与分支状态](#appearance)。关闭、重开目录或配置隐藏保留当前外观；成功重载模型后 SDK 状态重置，加载失败保留当前状态。宿主随后回放的外观同步到目录，SDK 不使用本地存储。

目录搜索忽略名称大小写，保留匹配节点与祖先路径并自动展开；清除搜索恢复普通浏览的展开状态。搜索只过滤目录，不改变场景或复选框的操作范围。分支复选框按完整子树的几何体有效显隐显示全选、半选或未选，与颜色、透明度无关；没有几何后代的分支禁用复选框。取消勾选隐藏整组，勾选显示整组及此前单独隐藏的后代。单独显示隐藏祖先下的子构件会开启必要祖先，保留其他分支的隐藏状态。一次操作批量写入现有外观状态，沿用 `appearance-change`（`source: 'api'`）及外观保存、导入和恢复机制。

点击名称组合执行选择与定位：沿当前观察方向适配该分支的包围盒，沿用 `cameraTransition`，不自动寻找无遮挡方向。隐藏构件保持隐藏，只更新选择并定位；没有可定位几何时只选择并显示提示，相机不移动。公开 `selectComponent()` 和 `focusComponent()` 各自的行为保持独立。

三维拾取与宿主 API 选择会同步目录，面板打开时展开选中节点的祖先并滚动定位；选中项被当前搜索排除时保留搜索并提示。关闭面板或隐藏按钮保留显隐、选择及相机状态。成功切换模型后重置搜索、展开和选择；加载失败保留原模型与目录状态。目录不监听自定义键盘快捷键，Esc 不关闭面板；搜索框正常输入，展开按钮、复选框和名称按钮按原生焦点顺序及键盘行为工作。点击关闭后焦点返回目录按钮。目录鼠标操作不触发场景拾取或缩放。

视角导航位于右上角，距顶、右各 16px；骰子区域为 150×150px，Home 图标约 24px、命中区域 44px。切角骰子和房屋图标使用本地 SVG 和 Three.js 数学计算绘制，不请求远程素材。GIS 署名自动排列在右侧导航下方，标记弹窗避开右侧导航区域。

Home 等同于 `resetView()`：按 `initialView` 恢复方向，并重新适配整个模型，不清除选择、外观修改或标记。骰子随主相机旋转，六个面、十二条边、八个角均可点击；方向切换保留当前观察目标与距离，因此构件定位后仍围绕该构件观察。

世界坐标固定为上 `+Y`、下 `-Y`、右 `+X`、左 `-X`、前 `+Z`、后 `-Z`；边角方向是相应轴向量之和再归一化，不自动识别建筑正门。上下视角保留极小偏角，避免 OrbitControls 在极点退化。连续点击会从当前动画姿态转向新方向，主视窗拖动中断动画；时长沿用 `cameraTransition`，默认 800ms，减少动态效果设置下立即切换。

首次就绪前及图形上下文丢失后禁用导航；旧模型保留时重载期间仍可导航，失败后继续操作旧模型。控件支持 Tab、Enter、Space，点击不触发模型拾取。隐藏骰子时停止投影更新，再次显示立即同步当前朝向。此功能不包含骰子拖动、下拉菜单或实体 Home 键快捷操作；内部组件不从包入口导出。

### 4.2 背景颜色与背景图片

`BackgroundOptions` 为公开类型，可用 `import type { BackgroundOptions } from '@caojinyu111/vue-bim-viewer'` 引入：

```js
const background = {
  color: '#f4f7fb',
  imageUrl: '/images/background.jpg',
}
```

颜色只接受六位十六进制（大小写均可）；非法颜色回退默认值，并发出 `background-error({ message })`。图片地址为字符串，非法类型会报告背景错误并使用纯色。颜色只控制场景背景，不修改模型材质或光照。

配置图片后，图片加载期间显示指定颜色；成功后优先显示图片。普通静态 PNG/JPEG/WebP 图片固定在模型后方，不随相机旋转，按容器等比例铺满、居中裁剪，多余部分不显示。容器尺寸变化会重新计算裁剪，图片不会被拉伸。建议使用不透明图片；不提供透明图与颜色的叠底合成功能，也不作为 HDR/全景或环境光贴图使用。

图片加载失败时回退指定颜色，并发出 `background-error`；不会发出 `model-error` 或阻止模型加载。宿主可独立显示非阻断提示。切换模型不会改变背景；背景变化不重新下载模型、不清空构件选择或外观差异。

#### 资源地址

相对图片地址相对于消费页面解析，使用页面的 base URL，与模型 Manifest 所在地址无关。跨域图片需要图片服务器允许匿名 CORS 访问；当前没有自定义请求头或鉴权回调。图片地址会被浏览器访问，不应包含需要保密的凭据。

- **public 目录**：将文件放入宿主 `public/images/background.jpg`，使用 `imageUrl: '/images/background.jpg'`。Vite 部署在子路径时可使用 `import.meta.env.BASE_URL + 'images/background.jpg'`。
- **参与打包的资源**：在宿主配置模块中使用 `new URL('./assets/background.jpg', import.meta.url).href`，路径相对于该模块；图片文件必须实际存在。

```js
// 宿主配置模块；下列资源路径需替换为实际存在的文件。
export const SCENE_BACKGROUND = {
  color: '#dce5ed',
  imageUrl: new URL('./assets/background.jpg', import.meta.url).href,
}
// 宿主模板：<MineViewer :model-source="source" :background="SCENE_BACKGROUND" />
```

#### 动态切换与错误处理完整示例

```vue
<script setup>
import { ref } from 'vue'
import { MineViewer } from '@caojinyu111/vue-bim-viewer'

import '@caojinyu111/vue-bim-viewer/style.css'

const source = { manifestUrl: '/models/manifest.json' }
const background = ref({ color: '#f4f7fb' })
const backgroundMessage = ref('')
const modelMessage = ref('')

function showColor() {
  backgroundMessage.value = ''
  background.value = { color: '#dce5ed' }
}
function showImage() {
  backgroundMessage.value = ''
  background.value = { color: '#dce5ed', imageUrl: '/images/background.jpg' }
}
function onBackgroundError(error) {
  backgroundMessage.value = error.message
}
</script>

<template>
  <button type="button" @click="showColor">使用纯色</button>
  <button type="button" @click="showImage">使用背景图</button>
  <p v-if="backgroundMessage">{{ backgroundMessage }}</p>
  <p v-if="modelMessage">{{ modelMessage }}</p>
  <div style="width: 100%; height: 600px">
    <MineViewer
      :model-source="source"
      :background="background"
      @background-error="onBackgroundError"
      @model-error="modelMessage = $event.message"
    />
  </div>
</template>
```

替换配置对象或修改响应式配置中的字段都会实时生效；普通非响应式对象的原地修改不由 Vue 跟踪。同一 `imageUrl` 下改变颜色或容器尺寸不会重新下载图片；图片失败后也不会仅因改色而自动重试。需要重试相同 URL 时，先移除 `imageUrl`，`await nextTick()` 使 Vue 应用纯色配置后，再设置图片 URL。

更换/移除图片、组件卸载会释放已使用的背景纹理。已发起的图片下载不保证中断，但过时成功结果会被释放，过时错误不会再通知宿主。背景纹理独立于模型资源，不进入构件树、外观差异和保存恢复记录。

<a id="viewer-api"></a>

## 5. 公开实例方法与构件查询

### 5.1 方法参考

通过 `<MineViewer ref="viewer" />` 获取实例，再调用 `viewer.value` 上的方法。表中“未就绪”指尚无成功加载的模型；重载期间已有旧模型时，查询仍可返回旧模型的数据。

| 方法                                    | 输入与默认值                            | 返回值                        | 未就绪、未知 ID 或其他边界                                             |
| --------------------------------------- | --------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `getComponentTree()`                    | 无                                      | `ComponentTree \| null`       | 未就绪为 `null`；返回完整独立快照                                      |
| `getSceneTree()`                        | 无                                      | `ComponentTree \| null`       | 未就绪为 `null`；结构同源，去掉业务元数据，仅保留源节点索引关联        |
| `getSceneRoot()`                        | 无                                      | `Object3D \| null`            | 未就绪为 `null`；返回 Loader 原始场景根，活对象、只读使用              |
| `getComponentId(node)`                  | 当前场景的 `Object3D` 引用              | `string \| null`              | 未就绪或对象不属于当前场景为 `null`                                    |
| `getComponent(id)`                      | 构件 ID 字符串                          | `ComponentNode \| null`       | 未知 ID/未就绪为 `null`；含该节点的后代快照                            |
| `getComponentAnchor(id, anchor?)`       | ID；`anchor` 默认 `'origin'`            | `Point3 \| null`              | 未知 ID/未就绪为 `null`；没有包围盒时只能查询原点                      |
| `getComponentAppearance(id)`            | ID                                      | `AppearanceState \| null`     | 未知 ID/未就绪为 `null`                                                |
| `setComponentAppearance(id, patch)`     | ID 和外观字段                           | `OperationResult`             | 未就绪返回 `error`；未知 ID/非法 patch 分别报告                        |
| `setComponentAppearances(updates)`      | `{ id, patch }[]`                       | `OperationResult`             | 有效项应用，非法项跳过；不是整批回滚                                   |
| `getAppearanceChanges()`                | 无                                      | `AppearanceChangeSet \| null` | 未就绪为 `null`；就绪但无修改时 `overrides: []`                        |
| `applyAppearanceChanges(value)`         | 已解析的差异对象，不是 JSON 字符串      | `OperationResult`             | 格式、版本、字段校验失败时不应用；未知 ID 单独报告                     |
| `restoreComponent(id)`                  | 当前模型中的构件 ID                     | `OperationResult`             | 整组恢复不透明，颜色和显隐只恢复自身；无效 ID 不修改外观       |
| `restoreAllComponents()`                | 无                                      | `OperationResult`             | 删除所有自身覆盖；未就绪返回 `error`                                   |
| `selectComponent(id)`                   | ID 或 `null`                            | `boolean`                     | 有效选择/清空成功为 `true`；未知 ID/未就绪为 `false`                   |
| `focusComponent(id, options?)`          | ID；可选 `{ duration }`，毫秒           | `boolean`                     | 接受定位为 `true`；未知 ID/未就绪/非法时长为 `false`；不自动选择       |
| `focusPoint(point, options?)`          | 原模型 `{ x, y, z }`；可选 `{ distance, duration }` | `boolean` | 保持观察方向，默认保持距离；无效参数或不可用时返回 `false`，不打断有效动画 |
| `resetView(options?)`                   | 可选 `{ duration }`，毫秒               | `boolean`                     | 有模型时重置全模型视角；无模型/非法时长为 `false`                      |
| `setViewDirection(direction, options?)` | 六个标准方向；可选 `{ duration }`，毫秒 | `boolean`                     | 保留观察目标与距离；未就绪、非法方向或时长返回 `false`，不打断有效动画 |
| `reload()`                              | 无                                      | `Promise<void>`               | 取消前一轮加载；失败保留旧场景，通过事件报告结果                       |

`ViewDirection` 为 `'top' | 'bottom' | 'left' | 'right' | 'front' | 'back'`。例如 `viewer.value.setViewDirection('front', { duration: 0 })` 立即切到前视角。其余 20 个边角方向仅由内置骰子触发，不属于公开参数。

### 5.2 构件树、节点和版本

`ComponentTree` 的结构：

```json
{
  "schemaVersion": 1,
  "modelId": "building",
  "revision": "resource-example",
  "roots": []
}
```

`ComponentNode` 字段：

| 字段                   | 含义                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| `id`、`name`、`type`   | SDK 构件 ID、源名称和 Three.js 对象类型                            |
| `parentId`、`children` | 父 ID（根为 `null`）和有序子节点；支持多层及空节点                 |
| `hasGeometry`          | 当前节点本身是否为 Mesh，不代表整个子树是否有几何                  |
| `bounds`               | 汇总自身及后代几何的原模型空间包围盒；无几何范围时为 `null`        |
| `metadata`             | 源 `extras/userData`、可关联的 properties，以及源层级/节点索引信息 |

`bounds` 含 `min`、`max`、`center`，均为 `Point3`。元数据中的 `sourceNodeIndex` 没有可用关联时为 `null`。

ID 优先从 glTF 节点的 `extras.componentId`、`externalId`、`elementId`、`uuid` 依次取有效值，再尝试元数据关联。重复 ID 会产生警告并改用版本内回退 ID；名称只在能够唯一匹配时用于补充关联。

`revision` 是当前 Manifest、主模型、外部资源及成功读取元数据内容的确定性指纹，不等于 Manifest 的 `version`，也不是安全校验签名。回退 ID 仅保证资源版本内稳定，不能将旧模型的 ID 和外观记录直接套用到重新导出的资源。

### 5.3 查询和展开树

`flattenComponentTree(tree)` 是独立导出的方法，输入 `ComponentTree | null`，返回按原始顺序深度优先排列的 `ComponentNode[]`，父节点先于后代；`null` 返回空数组。

它创建新数组，但不再次深拷贝输入节点。SDK 的树查询本身返回独立快照，修改快照不会修改运行场景；业务界面需要更新运行状态时应调用公开方法。

```js
import { flattenComponentTree } from '@caojinyu111/vue-bim-viewer'

function inspectComponents(api) {
  const tree = api.getComponentTree()
  if (!tree) return []
  const nodes = flattenComponentTree(tree)
  console.table(nodes.map(({ id, name, parentId }) => ({ id, name, parentId })))
  return nodes
}
```

### 5.4 模型坐标和锚点

SDK 使用加载后源场景的模型坐标，展示居中通过外层 wrapper 实现，不改写节点数据。模型点和节点坐标沿用源模型单位；glTF 通常以米为单位，但 SDK 不会根据尺寸自动猜测或换算单位。需要进行 GIS 配准时，通过 `metersPerUnit` 声明一个模型单位对应多少米。

| anchor         | 返回位置                    | 注意事项                                              |
| -------------- | --------------------------- | ----------------------------------------------------- |
| `'origin'`     | 对象原点，扣除展示居中偏移  | 默认值；对象原点不等于井口中心                        |
| `'center'`     | 自身及后代几何包围盒中心    | 没有包围盒返回 `null`                                 |
| `'bounds-top'` | 包围盒中心的 x/z 与 `max.y` | 当前固定使用 Y 轴顶部，不随 GIS 的 `modelUpAxis` 改变 |

```js
function readAnchors(api, componentId) {
  const origin = api.getComponentAnchor(componentId)
  const center = api.getComponentAnchor(componentId, 'center')
  const top = api.getComponentAnchor(componentId, 'bounds-top')
  return { origin, center, top }
}
```

自行调用 Three.js `getWorldPosition()` 时，结果仍包含展示 wrapper 的偏移。业务点、Marker 和 GIS 控制点应统一使用原模型空间；优先使用 `getComponentAnchor()`，不要把屏幕像素或展示居中坐标当成原模型点。

### 5.5 选择、定位与高级场景读取

`selectComponent(id)` 设置选择效果并发出 `component-select`，不会自动移动相机；`focusComponent(id)` 调整视野但不会自动选择。空节点定位会围绕其原点给出局部视野。

`focusPoint(point, options?)` 按原模型 XYZ 聚焦，坐标与 `type: 'model'` Marker 一致，无需加减展示居中偏移。目标点位于画面中心，并成为后续拖动旋转及骰子方向切换的观察中心。保持调用时的观察方向；不传 `distance` 时保持调用时相机到当前观察中心的距离，传入时使用指定距离，单位沿用模型。不会自动选择构件、创建 Marker 或修改外观。

```js
viewer.value.focusPoint({ x: 100, y: 20, z: -50 })
viewer.value.focusPoint({ x: 100, y: 20, z: -50 }, { distance: 30, duration: 500 })
viewer.value.focusPoint({ x: 0, y: 0, z: 0 }, { duration: 0 })
```

`FocusPointOptions` 继承 `CameraTransitionOptions`，新增可选 `distance`。XYZ 必须全部为有限数值，显式距离必须为有限正数，时长必须为有限非负数；派生相机参数无效、模型未就绪、销毁或图形上下文丢失时返回 `false`，保留当前有效动画。返回 `true` 仅表示接受操作。单次时长优先于组件 `cameraTransition`，默认 800ms；连续调用、用户操作中断和减少动态效果行为与构件定位一致。参数对象和输入点均不会被改写。

允许聚焦模型内部及包围盒外的点，不吸附表面、不寻找无遮挡方向、不自动剖切；目标点可能被前方几何遮挡。缩放范围和裁剪面按需扩展以容纳指定距离及模型，GIS 沿用现有远裁剪补偿。Home 仍恢复全模型初始视角，选择、Marker 和弹窗沿用现有状态及可见性规则。

选择样式由 SDK 内置：青绿色表面高亮与浅绿色细轮廓，保留纹理、明暗和原有透明度，遵循场景遮挡，不显示穿透轮廓、不闪烁，也不自动创建标签。选择父节点时作用于其可见且非完全透明的子网格；隐藏构件不显示高亮。三维点击、构件树调用及 API 选择使用同一效果，不提供样式修改或禁用参数。

切换选择或传入 `null` 清空时恢复构件当前外观。选中期间修改颜色、透明度、显隐或导入、恢复外观，均继续生效；临时高亮不修改共享源材质、不计入外观差异、不触发 `appearance-change`。业务标签保持独立，地图与 DEM 不参与构件选择。

定位和重置默认使用 800 毫秒缓入缓出动画。通过组件 `:camera-transition="{ duration: 1000 }"` 设置统一时长，单次调用优先使用传入的 `duration`：

```js
viewer.value.focusComponent(componentId, { duration: 1200 })
viewer.value.resetView({ duration: 600 })
viewer.value.focusComponent(componentId, { duration: 0 }) // 即时定位
```

时长必须为有限非负毫秒数，非法值返回 false，且不打断正在运行的有效过渡。返回 true 表示请求已接受，不表示动画已完成。连续定位从当前姿态转向新目标；用户拖动、缩放会停止动画并接管相机。成功加载/替换模型、销毁或图形上下文中断也会停止旧动画；首次加载即时适配。系统启用“减少动态效果”时使用即时定位。

```js
function selectAndFocus(api, componentId) {
  if (!api.selectComponent(componentId)) return false
  return api.focusComponent(componentId)
}

function inspectScene(api) {
  const root = api.getSceneRoot()
  if (!root) return
  root.traverse((node) => console.log(api.getComponentId(node), node.name))
}
```

三维点击可以选择构件，点击空白清除选择；拖动旋转与点击通过移动距离区分。隐藏或命中源材质不可见、不透明度为 0 的构件不参与拾取。

`getSceneRoot()` 返回活的 Three.js 对象，仍处于 SDK 的展示层级内。它用于只读查询，不能直接重设父节点、变换、几何或材质，也不应放入深度响应式状态或持久化为 JSON。绕过公开方法修改可能破坏构件包围盒、标签、选择和外观状态的一致性，且没有对应的公开刷新接口。

<a id="appearance"></a>

## 6. 外观修改、差异与保存

### 6.1 外观字段与分支状态

`AppearancePatch` 至少包含一个已知字段，不支持任意材质属性：

| 字段 | 有效输入 | 含义 |
| --- | --- | --- |
| `visible` | `boolean` 或 `null` | 设置节点自身显隐覆盖；祖先隐藏继续隐藏后代 |
| `translucent` | `boolean` 或 `null` | 设置自身及全部后代几何体；true 为半透明，false/null 为不透明 |
| `color` | `#RRGGBB` 或 `null` | 设置自身颜色覆盖；输出统一为小写十六进制 |

省略字段表示不修改；visible/color 的 null 删除自身覆盖，translucent 的 null 将整组恢复为初始不透明。undefined、数值 opacity、非布尔 translucent、空对象、未知字段及非法颜色均报告为跳过，该项不部分应用。

半透明使用原材质不透明度的 50% 倍率，不透明使用 100% 倍率，保留模型材质自带透明效果。透明状态不沿祖先继承，也不逐级相乘；父级操作一次性写入全部几何后代，此后各子分支独立改变。显隐沿祖先继承，颜色使用最近有效覆盖，无覆盖时保留原材质颜色。visible: true 不能强行显示隐藏祖先下的构件。

getComponentAppearance(id) 返回独立快照：own 是自身覆盖，纯分组不保存 translucent；initial.translucent 为 false、initial.color 为 null；effective.visible/color 包含继承，而 effective.translucent 表示完整分支（包含自身几何体、隐藏几何体）是否全部半透明。混合或空分支返回 false。网格渲染使用自身状态，父级汇总不改变自身材质。

目录正方体与宿主读取同一份 effective.translucent，无独立点击缓存。全部半透明显示空心，点击整组不透明；全部不透明或混合显示灰色实心，点击整组半透明。空分支按钮禁用，搜索和折叠不改变统计或操作范围。正方体操作不改变显隐、颜色、选择或相机。

### 6.2 单项、批量修改和恢复

```js
function updateAppearance(api, componentId) {
  if (typeof componentId !== 'string' || !componentId.trim() || !api.getComponent(componentId)) {
    throw new Error('请传入当前模型中的有效构件 ID')
  }
  const result = api.setComponentAppearance(componentId, {
    visible: true,
    translucent: true,
    color: '#3388ff',
  })
  if (result.error) console.error(result.error)
  if (result.unknownIds.length) console.warn('未知 ID', result.unknownIds)
  if (result.skipped.length) console.warn('非法修改', result.skipped)
  return result
}

function updateMany(api, componentIds) {
  return api.setComponentAppearances(componentIds.map((id) => ({ id, patch: { translucent: true } })))
}

function restoreAppearance(api, componentId) {
  if (typeof componentId !== 'string' || !componentId.trim() || !api.getComponent(componentId)) {
    throw new Error('恢复前必须检查当前模型中的构件 ID')
  }
  return api.restoreComponent(componentId) // 整组恢复不透明，显隐和颜色仅恢复此节点自身
}

function restoreEverything(api) {
  return api.restoreAllComponents() // 用户明确选择全部恢复时调用
}
```

**调用约束：`restoreComponent` 必须传入当前模型中的有效构件 ID。漏传参数、传入 `undefined`、`null` 或空字符串会返回 `error`，不会修改任何外观；格式正确但不存在的 ID 会进入 `unknownIds`。需要恢复全部覆盖时，必须显式调用 `restoreAllComponents()`。**

`restoreComponent(id)` 将完整分支恢复不透明，只删除目标节点的颜色和显隐覆盖，后代独立颜色和显隐继续保留。`restoreAllComponents()` 恢复全部外观。批量操作按输入顺序执行，重叠分支以后者为准；批末没有净变化时不触发事件。

### 6.3 OperationResult 和事件

外观操作返回：

```json
{
  "changedIds": ["shaft-auxiliary"],
  "unknownIds": [],
  "skipped": []
}
```

| 字段         | 说明                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| `changedIds` | 批末自身覆盖实际变化的 ID；透明整组操作包含实际变化的几何后代，祖先汇总不单列 |
| `unknownIds` | 当前模型找不到的 ID                                                         |
| `skipped`    | `{ id, reason }[]`，字段无效或修改项结构不合法等                            |
| `error`      | 操作级错误，例如模型未就绪、批量输入不是数组或导入格式不合法                |

不要只检查 `error`：有些操作会部分成功，需要同时检查 `unknownIds` 和 `skipped`。普通批量更新跳过非法项，仍应用有效项。一次批量操作最多发出一次 `appearance-change`，只有批末自身覆盖有净变化时发出。目录和宿主在同一事件中刷新祖先汇总。

### 6.4 净差异、导出与导入规则

`getAppearanceChanges()` 记录当前相对逻辑初始状态的净差异，不是操作历史。恢复字段后会移除相应记录，全部恢复后 `overrides` 为空。示例结构：

```json
{
  "schemaVersion": 2,
  "modelId": "mine-model",
  "revision": "resource-example",
  "overrides": [
    {
      "id": "shaft-auxiliary",
      "original": { "translucent": false },
      "current": { "translucent": true }
    }
  ]
}
```

实际 `modelId`、`revision` 和 ID 应来自 SDK，不能照抄示例值。`original` 用于描述被修改字段的逻辑初值；导入使用 `current` 应用修改，不把 `original` 当作回滚命令，也不把选择轮廓写入记录。

`applyAppearanceChanges(value)` 接收 schemaVersion: 2，先完整校验模型身份、资源版本和全部字段，再精确合并每个节点的 current 覆盖。导入透明字段不扩展为整组操作，保留父子独立状态；纯分组不能保存自身透明覆盖，未列出的覆盖保持不变。未知 ID 进入 unknownIds，其他有效项继续生效。schemaVersion: 1 或任意 original/current 含数值 opacity 的整份记录静默忽略：返回空操作结果，不修改场景、不发事件、不提示，也不迁移或删除记录。新格式的其他无效数据返回错误，不部分应用。构件树本身保持 schemaVersion: 1。

传入空 `overrides` 不会清空已有修改。需要回到初始状态时调用恢复方法，不要把合并导入当作全量替换。

### 6.5 宿主保存与恢复完整示例

以下组件演示宿主如何监听变更、按模型身份与版本存储，并在树就绪时恢复。它不改变 SDK 的存储策略；SDK 自身不调用 localStorage。

```vue
<script setup>
import { ref, shallowRef } from 'vue'
import { MineViewer, flattenComponentTree } from '@caojinyu111/vue-bim-viewer'
import '@caojinyu111/vue-bim-viewer/style.css'

const viewer = shallowRef(null)
const tree = shallowRef(null)
const message = ref('')
const restoring = ref(false)
const source = { manifestUrl: '/models/manifest.json' }

function storageKey() {
  return tree.value ? `bim-appearance:v2:${tree.value.modelId}:${tree.value.revision}` : null
}

function report(result) {
  if (result.error) message.value = result.error
  else if (result.unknownIds.length || result.skipped.length)
    message.value = '存在未应用项，请核对记录'
}

function saveChanges() {
  const key = storageKey()
  const value = viewer.value?.getAppearanceChanges()
  if (!key || !value || restoring.value) return
  try {
    if (value.overrides.length) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
    message.value = value.overrides.length ? '修改已保存' : '已恢复初始外观'
  } catch (error) {
    message.value = `保存失败：${error.message}`
  }
}

function onReady(value) {
  tree.value = value
  const key = storageKey()
  if (!key || !viewer.value) return
  restoring.value = true
  try {
    const saved = localStorage.getItem(key)
    if (saved) report(viewer.value.applyAppearanceChanges(JSON.parse(saved)))
  } catch (error) {
    message.value = `恢复失败：${error.message}`
  } finally {
    restoring.value = false
  }
}

function changeFirst() {
  const first = flattenComponentTree(tree.value).find((node) => node.hasGeometry)
  if (first && viewer.value) report(viewer.value.setComponentAppearance(first.id, { translucent: true }))
}

function restoreAll() {
  if (!viewer.value || !tree.value) return
  report(viewer.value.restoreAllComponents())
  saveChanges() // 已是初始状态时可能不发事件，也同步清理保存记录。
}
</script>

<template>
  <div>
    <button type="button" :disabled="!tree" @click="changeFirst">修改首个几何构件</button>
    <button type="button" :disabled="!tree" @click="restoreAll">全部恢复</button>
    <p>{{ message }}</p>
    <div style="height: 600px">
      <MineViewer
        ref="viewer"
        :model-source="source"
        @component-tree-ready="onReady"
        @appearance-change="saveChanges"
        @model-error="message = $event.message"
      />
    </div>
  </div>
</template>
```

文件导出/导入同样由宿主完成：对 `getAppearanceChanges()` 的结果执行 `JSON.stringify()`，通过宿主文件下载逻辑保存；读取文件文本后先 `JSON.parse()`，再将对象交给 `applyAppearanceChanges()` 并检查结果。不要保存 `Object3D`，也不要忽略存储空间不足、JSON 解析失败或版本不匹配。

<a id="markers"></a>

## 7. Marker 标签与弹窗

### 7.1 标签数据格式

每个 Marker 需要唯一 `id`、`label` 和 `position`，可带 `screenOffset` 与 `data`。

```js
function makeMarkers(componentId) {
  return [
    {
      id: 'model-point',
      label: '模型坐标点',
      position: { type: 'model', x: 10, y: 20, z: 30 },
      screenOffset: { x: 0, y: -20 },
      data: { description: '由宿主定义的业务内容' },
    },
    {
      id: 'component-point',
      label: '构件锚点',
      position: {
        type: 'component',
        componentId,
        anchor: 'center',
        offset: { x: 0, y: 2, z: 0 },
      },
      data: { description: '跟随当前构件锚点' },
    },
  ]
}
```

| 字段                         | 说明                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| `id`                         | 标签自身的唯一 ID，不是构件 ID；缺失或重复会产生标记提示         |
| `label`                      | 默认标签文本                                                     |
| `position.type: 'model'`     | 直接使用原模型空间 `{ x, y, z }`                                 |
| `position.type: 'component'` | 按 `componentId` 查询当前模型锚点                                |
| `position.anchor`            | 构件标签专用，默认 `'origin'`；支持第 5 节三种锚点               |
| `position.offset`            | 构件标签专用，在原模型坐标轴上偏移，默认全 0；不是构件局部轴偏移 |
| `screenOffset`               | CSS 像素偏移，x 向右、y 向下，只移动显示标签，不改变模型位置     |
| `data`                       | 普通业务数据，由宿主用于插槽和事件                               |

标签坐标和模型偏移沿用加载后的模型单位。模型坐标和屏幕偏移必须是有限数值。构件 ID 或指定锚点不存在时，该标签会被跳过并显示提示。

### 7.2 自定义标签与弹窗完整示例

```vue
<script setup>
import { ref } from 'vue'
import { MineViewer } from '@caojinyu111/vue-bim-viewer'
import '@caojinyu111/vue-bim-viewer/style.css'

const source = { manifestUrl: '/models/manifest.json' }
const markers = ref([
  {
    id: 'survey-point',
    label: '示例点',
    position: { type: 'model', x: 10, y: 20, z: 30 },
    data: { description: '请将示例坐标替换为真实模型点位' },
  },
])

function onMarkerClick(marker) {
  console.log('标签业务数据', marker.id, marker.data)
}
</script>

<template>
  <div style="height: 600px">
    <MineViewer :model-source="source" :markers="markers" @marker-click="onMarkerClick">
      <template #marker="{ marker, selected }">
        <strong :style="{ color: selected ? '#ffcc66' : '#ffffff' }">{{ marker.label }}</strong>
      </template>
      <template #marker-popup="{ marker, close }">
        <h3>{{ marker.label }}</h3>
        <p>{{ marker.data?.description }}</p>
        <p>模型位置：{{ marker.modelPosition }}</p>
        <button type="button" @click="close">关闭</button>
      </template>
    </MineViewer>
  </div>
</template>
```

### 7.3 更新、显隐和关闭行为

宿主通过更新 `markers` 控制标签，SDK 不替宿主持久化或编辑点位。若使用 `shallowRef([])` 保存列表，应替换数组，避免只修改未被深度响应式跟踪的内部数据。

构件标签在绑定构件的 `effective.visible` 为 `false` 时隐藏；切换半透明不隐藏标签。独立模型坐标标签不绑定构件显隐。相机背面、裁剪面之外和视口外的标签不显示。

点击标签打开或切换弹窗，再次点击同一标签关闭。自定义弹窗调用 `close()` 关闭；Escape 键事件到达 Viewer 时也会关闭。标签移除、隐藏或离开有效视口后，活动弹窗会关闭。`marker` 插槽的 `selected` 表示该标签的弹窗是否活动，不是模型构件是否被选中。

当前没有几何遮挡检测：标签在其他模型物体后面仍可能显示；也没有海量 DOM 标签聚合、虚拟化或避让布局。

<a id="events-slots"></a>

## 8. 事件与插槽参考

### 8.1 事件参考

模型、背景与地图使用独立事件报告状态，宿主可分别展示加载进度与错误信息。

| 事件                   | 参数                    | 触发时机                                                         |
| ---------------------- | ----------------------- | ---------------------------------------------------------------- |
| `component-tree-ready` | `ComponentTree`         | 新模型及构件索引成功就绪；可在回调内查询与恢复外观               |
| `model-loaded`         | `ModelInfo`             | 成功展示模型，提供统计及警告                                     |
| `model-error`          | `{ message: string }`   | 模型加载、初始化渲染失败或图形上下文中断等                       |
| `component-select`     | `ComponentNode \| null` | API 选择、三维拾取、清空选择或新模型就绪时清空；不是相机定位事件 |
| `appearance-change`    | `AppearanceEvent`       | 外观自身覆盖发生变化；包含 source、before、after 和 result       |
| `marker-click`         | `Marker`                | 标签被点击，包括再次点击同一标签关闭弹窗时                       |
| `gis-status`           | `GisStatus`             | 影像加载、部分失败、就绪、关闭或错误状态变化                     |
| `terrain-status`       | `TerrainStatus`         | DEM 准备、部分失败、就绪、关闭或错误；与影像计数独立             |
| `background-error`     | `{ message: string }`   | 背景颜色/图片配置无效或当前图片加载失败；与模型错误独立          |

`AppearanceEvent.source` 为 `'api'`、`'restore'` 或 `'import'`；`before/after` 为 `AppearanceChangeSet` 快照，`result` 为本次 `OperationResult`。事件用于宿主同步界面和保存，不需要自行重新维护一套覆盖状态。

下面是可放入脚本中的事件处理函数示例，模板用 `@appearance-change="onAppearanceChange"` 绑定：

```js
function onAppearanceChange(event) {
  console.log('变更来源', event.source)
  console.log('变更前', event.before)
  console.log('变更后', event.after)
  console.log('应用结果', event.result)
}
```

### 8.2 插槽参考

| 插槽           | 参数                                             | 默认内容                                    |
| -------------- | ------------------------------------------------ | ------------------------------------------- |
| `marker`       | `{ marker: ProjectedMarker, selected: boolean }` | 标签圆点与 `label`，由 SDK 外层按钮处理点击 |
| `marker-popup` | `{ marker: ProjectedMarker, close: () => void }` | 标题、关闭按钮和模型位置                    |

`ProjectedMarker` 在 Marker 数据上增加屏幕 `x/y`（CSS 像素）、投影可见性 `visible` 和原模型位置 `modelPosition`。屏幕坐标只用于界面布局，不能作为 GIS 控制点。`marker-click` 的公开类型为 `Marker`，需要投影字段时使用插槽提供的 `ProjectedMarker`。

<a id="gis"></a>

## 9. GIS 配准、影像与 DEM

### 9.1 用途与基本流程

`createGisPlacement(options)` 是独立函数，无需先挂载 `MineViewer`。默认 `least-squares` 模式输入三个或更多在水平面上分散且不共线的“原始模型点 ↔ 现实坐标”对应关系，保持模型尺寸和竖直方向，求水平旋转和平移；有高程时再拟合整体竖直偏移。使用 `first-point` 模式时，首个控制点固定水平位置，其余控制点用于确定方向，不要求满足最小二乘模式的分布条件，但不能与首点水平重合，且方向不能互相抵消。

推荐流程：确认现实坐标系和模型单位/竖直轴，选取分散的对应点，调用方法，检查逐点误差，再用未参与拟合的独立点复核，最后由宿主将结果接到 GIS 模型图层。

此函数只计算配准结果，不自动倾斜、拉伸模型，不自动识别坐标系，也不会直接修改 Viewer 场景。将结果传给 `gis` 组件属性可显示天地图影像，见 9.9；可选 DEM 地形见 9.11。

### 9.2 全部输入选项

| 选项                  | 类型                                        | 默认值或要求                                                           |
| --------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `sourceCrs`           | `'EPSG:4529' \| 'EPSG:4490' \| 'EPSG:4326'` | 必填，所有地图点采用同一坐标系                                         |
| `horizontalAlignment` | `'least-squares' \| 'first-point'`          | 默认 least-squares；first-point 固定首点、其余方向归一化后等权拟合角度 |
| `controlPoints`       | 对应点数组                                  | 必填，至少 3 项；每项包含完整模型 `model` 和地图 `map`                 |
| `modelUpAxis`         | `'y' \| 'z'`                                | 默认 `'y'`；与实际加载后模型空间一致                                   |
| `metersPerUnit`       | `number`                                    | 默认 `1`，有限正数；毫米模型传 `0.001`，不自动拟合缩放                 |
| `fallbackHeight`      | `number`                                    | 默认 `0` 米；仅无高程控制点时作为局部 ENU 的竖直预览平移               |
| `maxErrorMeters`      | `number`                                    | 可省略；有限非负数，任一点水平误差超过该值时抛错                       |

不同 `sourceCrs` 对应的 `map` 格式：

| 坐标系      | map 字段                           | 单位和注意事项                                                              |
| ----------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `EPSG:4529` | `{ northing, easting, height? }`   | 国家2000三度带41带；测量 X → northing，测量 Y → easting，米；Y 保留 41 带号 |
| `EPSG:4490` | `{ longitude, latitude, height? }` | CGCS2000，经度、纬度均为度                                                  |
| `EPSG:4326` | `{ longitude, latitude, height? }` | WGS84，经度、纬度均为度                                                     |

模型点始终为 `{ x, y, z }`，坐标单位沿用源模型单位；SDK 不会自动判断或换算米、毫米等单位。`metersPerUnit` 用于声明一个模型单位对应多少米。即使暂不做高程配准也要提供完整模型点；可省略的是地图点的 `height`。经纬度不是平面米制坐标，测量 X/Y 也不能直接填入 `longitude/latitude`。

### 9.3 测量控制点接入示例

本例以测量人员**已确认 EPSG:4529** 为使用前提。表中坐标仅用于说明数据结构，实际接入时必须替换为项目测量结果；不能根据数字推断坐标系。三个控制点的模型对应点须从原始模型中取得，并与实际测量点一一对应，不能直接用对象原点或包围盒中心代替。

```js
import { createGisPlacement } from '@caojinyu111/vue-bim-viewer'

// modelPoints 的三项均须为真实原始模型坐标 { x, y, z }。
// ellipsoidHeights 为可选椭球高对象，键名与 modelPoints 一致。
function locateModel(modelPoints, ellipsoidHeights = {}) {
  const surveys = [
    ['controlA', 4500000, 41500000],
    ['controlB', 4500000, 41500100],
    ['controlC', 4500100, 41500000],
  ]
  const controlPoints = surveys.map(([key, northing, easting]) => ({
    model: modelPoints[key],
    map: {
      northing,
      easting,
      ...(ellipsoidHeights[key] === undefined ? {} : { height: ellipsoidHeights[key] }),
    },
  }))

  return createGisPlacement({
    sourceCrs: 'EPSG:4529',
    modelUpAxis: 'y',
    metersPerUnit: 1,
    maxErrorMeters: 1, // 只是示例阈值，须按实际项目精度要求设定。
    controlPoints,
  })
}

function inspectPlacement(modelPoints, ellipsoidHeights) {
  const placement = locateModel(modelPoints, ellipsoidHeights)
  console.log('模型原点位置', placement.position)
  console.log('水平角度', placement.rotationDegrees)
  console.table(placement.residuals)
  return placement.toGeographic(modelPoints.controlA)
}
```

如果阈值超限，应检查坐标系、轴序、单位、点位对应关系及测量误差，不能通过任意拉伸模型掩盖错误。高程阈值没有由 `maxErrorMeters` 代管，需单独检查竖直误差。

### 9.4 可直接运行的经纬度示例

以下为验证接口的合成数据，不是实际矿山模型坐标。模型 Y 向上，三个控制点对应约 120/90 米的水平基线，可用于独立确认调用方式。

```js
import { createGisPlacement } from '@caojinyu111/vue-bim-viewer'

const placement = createGisPlacement({
  sourceCrs: 'EPSG:4490',
  modelUpAxis: 'y',
  maxErrorMeters: 0.01,
  controlPoints: [
    { model: { x: 100, y: 0, z: 200 }, map: { longitude: 123, latitude: 41 } },
    {
      model: { x: 220, y: 0, z: 200 },
      map: { longitude: 123.00123520138344, latitude: 41.00054027150777 },
    },
    {
      model: { x: 100, y: 0, z: 110 },
      map: { longitude: 122.99946514080546, latitude: 41.000701840622 },
    },
  ],
})

console.log(placement.rotationDegrees) // 约 30 度，不是罗盘 heading。
console.log(placement.toGeographic({ x: 220, y: 0, z: 110 })) // 检查独立的第四个点。
console.log(placement.heightResolved) // false
```

### 9.5 后续补高程

在原对应点的 `map` 中补充 `height`，用同样的 `sourceCrs`、模型单位和竖直轴重新调用方法即可。一个有高程的控制点可确定整体竖直偏移，多点则在局部坐标中拟合平均偏移，并报告实际高程残差。

`height` 采用所选大地基准的**椭球高，单位为米**。图纸上的正常高等其他高程应由宿主先按实际高程基准转换，SDK 不内置大地水准面模型。保留模型的倾斜/形状，不用高程点拟合 pitch/roll。

无地图高程时：`heightResolved` 为 `false`，`position` 和 `toGeographic()` 的结果省略 `height`，`verticalRmse` 为 `null`。矩阵使用 `fallbackHeight` 预览，但这不意味着已取得真实高程，也不能把它当作模型中每个点的绝对椭球高。

至少一个地图高程有效时：`heightResolved` 为 `true`，自动使用控制点求出的竖直偏移并忽略 `fallbackHeight`；没有提供高程的控制点，其 `verticalError` 仍为 `null`。补高程只改变局部竖直平移，水平拟合矩阵保持一致；曲率与刚性放置的影响体现在最终残差中。

### 9.6 全部返回字段

| 字段                       | 类型                             | 含义                                                               |
| -------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `sourceCrs`                | 支持的 CRS 字符串                | 原地图输入坐标系                                                   |
| `reference`                | `Required<GeographicCoordinate>` | 第一个控制点的经纬度和椭球高 0，作为 ENU 基准；不是模型原点        |
| `position`                 | `GeographicCoordinate`           | 模型原点经纬度，以及高程已确定时的椭球高                           |
| `rotationDegrees`          | `number`                         | 模型水平 X 轴相对局部东方向的逆时针角度，不是 GIS 引擎通用 heading |
| `metersPerUnit`            | `number`                         | 使用的模型单位换算比例                                             |
| `heightResolved`           | `boolean`                        | 是否至少有一个地图高程控制点参与配准                               |
| `localMatrix`              | `number[]`                       | 16 项列主序矩阵：原模型坐标 → reference 处东、北、上局部米制坐标   |
| `ecefMatrix`               | `number[]`                       | 16 项列主序矩阵：原模型坐标 → 当前大地基准的 ECEF 米制坐标         |
| `horizontalRmse`           | `number`                         | 逐点水平残差的均方根，米                                           |
| `maxHorizontalError`       | `number`                         | 最大逐点水平残差，米                                               |
| `verticalRmse`             | `number \| null`                 | 有地图高程点的高程残差均方根，米；无高程时为 `null`                |
| `residuals`                | 数组                             | 按输入顺序排列的 `{ index, horizontalError, verticalError }`       |
| `toGeographic(modelPoint)` | 函数                             | 原模型任意点 → 当前大地基准的经纬度和可选椭球高                    |

`residuals.index` 从 0 开始。`horizontalError` 为同一椭球面上投到参考 ENU 的水平距离；`verticalError` 为最终椭球高减去该控制点输入高程的有符号差值，不是始终非负的绝对误差。

EPSG:4529/4490 输出仍采用 CGCS2000，EPSG:4326 输出采用 WGS84；SDK 不将两者默认视为相同，也不进行精密大地基准转换。

### 9.7 矩阵与天地图接入

矩阵可用 Three.js 标准接口读取：

```js
import { Matrix4, Vector3 } from 'three'

function transformModelPoint(placement, modelPoint) {
  const localMatrix = new Matrix4().fromArray(placement.localMatrix)
  const ecefMatrix = new Matrix4().fromArray(placement.ecefMatrix)
  const point = new Vector3(modelPoint.x, modelPoint.y, modelPoint.z)
  return {
    local: point.clone().applyMatrix4(localMatrix),
    ecef: point.clone().applyMatrix4(ecefMatrix),
    geographic: placement.toGeographic(modelPoint),
  }
}
```

ENU 的轴顺序为东、北、上。Y 向上的模型在水平旋转前按 `(x, -z, y)` 映射到 ENU；Z 向上模型按 `(x, y, z)` 映射。返回矩阵已包含轴向变换与单位换算，接入图层时避免重复处理。

天地图提供底图，具体三维图层如何接收模型由宿主所用引擎决定。需要 ECEF 的引擎读取 `ecefMatrix`；使用局部坐标的图层读取 `localMatrix` 并正确放置 `reference`。不要将矩阵直接传入只接受二维经纬度的 API，也不要将经纬度输出直接当作墨卡托瓦片米制坐标。

不要把 GIS 矩阵直接写入现有 Viewer 的活场景根节点：Viewer 的构件索引、包围盒和标签使用原模型坐标语义。内置影像层会将地图转换到既有展示空间；外接引擎时须另行确认大地基准与模型轴向转换。

结果按局部刚性模型计算，矿区范围内仍应结合残差和独立点验收。推荐保存输入配置与控制点，重建配准结果；`toGeographic` 是函数，不能通过简单 JSON 序列化结果对象保留。

### 9.8 错误与输入检查

方法同步返回 `GisPlacement`，输入不合规或阈值超限时同步抛出 `Error`，宿主用 `try/catch` 展示错误。`toGeographic()` 对传入模型点同样检查有限数值。

| 情况                                        | 处理方式                                               |
| ------------------------------------------- | ------------------------------------------------------ |
| 少于 3 个点、缺模型/地图坐标                | 抛错，补全对应关系                                     |
| 未支持的 CRS 或不合法的 `modelUpAxis`       | 抛错，明确坐标系及 Y/Z 竖直轴                          |
| 非有限数字、超范围经纬度、非法单位比例      | 抛错，检查数字类型和单位                               |
| `least-squares` 模式的模型或地图水平点共线、重合或过于接近共线 | 抛错，重新选择水平分散的点位 |
| `first-point` 模式的其他控制点与首点水平重合 | 抛错，选择能够确定水平方向的点位 |
| EPSG:4529 的 easting 缺少 41 带号或轴序颠倒 | 抛错，按测量 X/Y 正确填 northing/easting               |
| 不能确定一致的水平旋转                      | 抛错，核对对应点                                       |
| 水平误差超过 `maxErrorMeters`               | 抛错，排查点位/单位/坐标系；不设阈值时通过结果报告误差 |
| 多个高程点不一致                            | 保持刚性模型，返回竖直残差，由宿主确定可接受误差       |

### 9.9 首点锚定的平面影像

需要保持首个控制点水平位置时，使用 `horizontalAlignment: 'first-point'`。首点用于确定水平位置，其余点相对首点的单位水平方向等权求一个旋转角。它不会拟合缩放，不要求其余点距离对齐；残差仍返回。未设置 `maxErrorMeters` 时不会因距离偏差报错，非法输入或方向互相抵消仍报错。

```js
// controlPoints 的 model 均来自当前原始模型空间。
const placement = createGisPlacement({
  sourceCrs: 'EPSG:4529',
  modelUpAxis: 'y',
  metersPerUnit: 1,
  horizontalAlignment: 'first-point',
  controlPoints,
  fallbackHeight: -controlPoints[0].model.y,
})
const gis = {
  enabled: true,
  placement,
  imagery: { key: import.meta.env.VITE_TIANDITU_KEY },
  opacity: 0.65,
}
// <MineViewer :model-source="source" :gis="gis" @gis-status="handleGisStatus" />
```

应在构件树就绪后从当前模型取得控制点，并同步重建 `gis` 配置。上述 `fallbackHeight` 将第一个模型点对齐 ENU up=0，仅用于无高程时的平面预览。省略 `map.height` 时，`heightResolved` 保持 `false`。对象原点或包围盒中心不能代替现场确认的测量点。

`gis` 接收 `GisOptions`：`enabled?` 默认 false，`placement` 为配准结果，`imagery.key` 由宿主传入，`opacity?` 默认 0.65，范围 0–1。影像通过 three-tile 的 TDTSource 加载 HTTPS 天地图 img_w，不含注记。范围为模型水平范围外扩 1000 米后覆盖到瓦片边界，优先 16 级，最多 256 张；没有相机动态 LOD 或无限地图漫游。DEM 默认关闭，此时逐顶点转换到局部 ENU，压平 up=0，再通过配准逆矩阵及展示偏移显示。可选 DEM 见 9.11；地图不进入构件树、拾取和外观差异。

`gis-status` 为 `GisStatus`，含 `status`、`loaded`、`failed`、`total`、可选 `message`。status 为 `disabled/loading/ready/partial/error`。部分失败保留成功瓦片，全失败也不影响模型；无自动重试，可关闭再打开。透明度变化不重请求；关闭、替换配准/Key、模型成功切换和销毁会取消旧请求并释放纹理、ImageBitmap、材质和网格。相机聚焦仍以模型/构件为目标，远裁剪面兼顾地图。Key 在浏览器请求中可见，勿当作浏览器端秘密。

### 9.10 Vue 影像接入完整示例

下面采用 9.4 节合成控制点，演示完整的数据流。实际使用必须替换三个构件 ID、地图测量点和 Key，不能将这组经纬度用于任意真实模型。GIS 函数同步抛错，由宿主捕获；模型失败处理与地图状态分开显示。

```vue
<script setup>
import { ref, shallowRef } from 'vue'
import { MineViewer, createGisPlacement } from '@caojinyu111/vue-bim-viewer'
import '@caojinyu111/vue-bim-viewer/style.css'

const viewer = shallowRef(null)
const gis = shallowRef(undefined)
const message = ref('')
const mapStatus = ref('disabled')
const source = { manifestUrl: '/models/manifest.json' }
const key = '替换为应用的天地图Key'
const surveys = [
  { id: 'control-a', map: { longitude: 123, latitude: 41 } },
  { id: 'control-b', map: { longitude: 123.00123520138344, latitude: 41.00054027150777 } },
  { id: 'control-c', map: { longitude: 122.99946514080546, latitude: 41.000701840622 } },
]

function onReady() {
  gis.value = undefined
  message.value = ''
  try {
    const api = viewer.value
    if (!api) return
    const controlPoints = surveys.map(({ id, map }) => {
      if (typeof id !== 'string' || !id.trim() || !api.getComponent(id)) {
        throw new Error('当前模型缺少控制点构件')
      }
      const model = api.getComponentAnchor(id, 'center')
      if (!model) throw new Error(`构件 ${id} 没有有效中心锚点`)
      return { model, map }
    })
    const placement = createGisPlacement({
      sourceCrs: 'EPSG:4490',
      modelUpAxis: 'y',
      metersPerUnit: 1,
      horizontalAlignment: 'least-squares',
      maxErrorMeters: 0.5,
      controlPoints,
    })
    gis.value = { enabled: true, placement, imagery: { key }, opacity: 0.65 }
  } catch (error) {
    message.value = `GIS 配准失败：${error.message}`
  }
}

function toggleMap() {
  if (gis.value) gis.value = { ...gis.value, enabled: !gis.value.enabled }
}

function onGisStatus(status) {
  mapStatus.value = `${status.status}：${status.loaded}/${status.total}，失败 ${status.failed}`
}
</script>

<template>
  <button type="button" :disabled="!gis" @click="toggleMap">切换影像</button>
  <p>{{ message || mapStatus }}</p>
  <div style="width: 100%; height: 600px">
    <MineViewer
      ref="viewer"
      :model-source="source"
      :gis="gis"
      @component-tree-ready="onReady"
      @gis-status="onGisStatus"
      @model-error="message = $event.message"
    />
  </div>
</template>
```

模型切换成功后会再次调用 `onReady`，使用新模型重建配准；配准失败时该例清空影像配置，模型仍可浏览。失败重载没有树就绪事件，保留旧模型及其原配准。示例锚点为中心，不等于真实测量点，实际控制点应使用现场确认的原始模型坐标。

<a id="gis-terrain"></a>

### 9.11 可选 DEM 地形

`gis.terrain` 配置 DEM，默认关闭。相对预览配置如下，示例中的 `placement` 和 `tiandituKey` 由宿主提供：

```js
const gis = {
  enabled: true,
  placement,
  imagery: { key: tiandituKey },
  opacity: 0.65,
  terrain: { enabled: true, mode: 'relative' },
}
// <MineViewer :gis="gis" @gis-status="onImagery" @terrain-status="onTerrain" ... />
```

| 字段                | 类型                                                | 默认值及要求                                |
| ------------------- | --------------------------------------------------- | ------------------------------------------- |
| `enabled`           | `boolean`                                           | 默认 `false`；需同时开启 `gis.enabled`      |
| `key`               | `string`                                            | 省略时复用 `gis.imagery.key`                |
| `mode`              | `'relative' \| 'absolute'`                          | 默认 `'relative'`                           |
| `toEllipsoidHeight` | `(point: Required<GeographicCoordinate>) => number` | `absolute` 模式必填，同步返回有限米制椭球高 |

相对模式以 `placement.reference` 处 DEM 为基准，其他点取高程差；参考点位于 ENU 零高程平面，水平位置不变。基准缺测则整层保留平面；此模式不证明井口与实际地表已经对齐。

真实高程需要 `placement.heightResolved === true`，并显式提供同步转换函数。以下 `terrain` 对象应作为 `gis.terrain` 传入；`convertDemToPlacementEllipsoid` 由宿主根据已确认的高程基准实现：

```js
const terrain = {
  enabled: true,
  mode: 'absolute',
  toEllipsoidHeight({ longitude, latitude, height }) {
    return convertDemToPlacementEllipsoid(longitude, latitude, height)
  },
}
```

输入 `height` 是天地图 DEM 原始米制高程，返回值必须是与配准一致的有限 `number` 椭球高（米），不能返回 `null`、布尔值、字符串或 Promise。只有确认基准一致时才能直接返回 height；正常高需要可靠的大地水准面/似大地水准面转换。SDK 不推断基准，也不将人工常数偏移当作通用转换。配置缺失、回调抛错、返回非数字或非有限值时报告错误并保留相应平面影像，不悄悄切换相对模式。真实模式使用完整 ECEF → ENU → 配准逆变换 → 展示偏移；模型和 Marker 坐标始终不变。

SDK 的天地图 `elv_c` 适配器支持 zlib 压缩的 150×150 小端 UInt16 高程栅格，采用独立的地理 c 瓦片矩阵和三角插值，不直接复用影像 w 矩阵行列。DEM 数据级别取影像级别与 12 的较小值，影像级别 6 以下报告不支持地形；这是 SDK 的数据级别限制，不保证服务在所有区域和级别均有有效数据。每张影像生成 33×33 地表顶点及独立向下裙边，共享边缘取样一致。缺测值不伪造成零，相机缩放不改变瓦片级别，不支持地形碰撞或自动贴地，模型地表构件不会自动隐藏。

`TerrainStatus` 包含 `status`、`mode`、`loaded`、`failed`、`total` 和可选 `message`。状态为 disabled/loading/ready/partial/error，计数表示目标影像瓦片的 DEM 准备成功/失败数，而非网络请求数；影像和 DEM 分别报告结果。单块失败保留平面，全部失败仍可浏览影像与模型。未知高程基准只能使用相对预览。

影像先以平面显示，地形准备成功后替换网格；材质支持透明度、双面及地下观察。影像与 DEM 合计最多 6 个在途请求，每请求 15 秒超时，无自动重试，DEM 按实例去重并采用 64 MiB 缓存。透明度不触发新请求；改变模式、配准、Key 或转换函数引用会重建图层。请使用稳定的转换函数引用。关闭、切换模型和销毁会取消请求并清空缓存，迟到结果不回到场景。浏览器缺少 DEM 解压能力时地形失败但保留影像。

<a id="types"></a>

## 10. 公开类型索引

下列类型可从包根入口以 `import type` 导入。接口中的结构以发布包的 `.d.ts` 为准；它们是编译期类型，不能作为 JavaScript 运行时类实例化。

| 类型                      | 主要字段或用途                                                         | 相关章节                   |
| ------------------------- | ---------------------------------------------------------------------- | -------------------------- |
| `Point3`                  | `{ x, y, z }`                                                          | [模型坐标](#viewer-api)    |
| `Bounds`                  | `{ min, max, center }`                                                 | [构件查询](#viewer-api)    |
| `Anchor`                  | `'origin' \| 'center' \| 'bounds-top'`                                 | [锚点](#viewer-api)        |
| `ModelSource`             | `{ manifestUrl }`                                                      | [加载](#model-loading)     |
| `InitialView`             | `direction?`、`fitPadding?`                                            | [Props](#props)            |
| `CameraTransitionOptions` | `duration?`：毫秒，默认 800，0 即时定位                                | [定位与视角](#viewer-api)  |
| `FocusPointOptions`       | 继承相机过渡选项，增加 `distance?`，模型单位，省略保持当前距离            | [坐标定位](#viewer-api)    |
| `BackgroundOptions`       | 场景背景 `color?`、`imageUrl?`，默认纯色、图片居中 cover               | [背景](#props)             |
| `Appearance`              | 有效显隐、完整分支半透明汇总、颜色覆盖                                         | [外观](#appearance)        |
| `AppearancePatch`         | 可选外观字段，允许 `null` 取消覆盖                                     | [外观](#appearance)        |
| `AppearanceState`         | `own`、`effective`、`initial`                                          | [外观](#appearance)        |
| `ComponentNode`           | ID、源名称、结构、包围盒和元数据                                       | [构件查询](#viewer-api)    |
| `ComponentTree`           | `schemaVersion`、`modelId`、`revision`、`roots`                        | [构件查询](#viewer-api)    |
| `AppearanceUpdate`        | `{ id, patch }`                                                        | [批量外观](#appearance)    |
| `AppearanceChange`        | `{ id, original, current }`                                            | [差异](#appearance)        |
| `AppearanceChangeSet`     | 模型身份、版本和 `overrides`                                           | [保存与导入](#appearance)  |
| `OperationResult`         | `changedIds`、`unknownIds`、`skipped`、`error?`                        | [操作结果](#appearance)    |
| `AppearanceEvent`         | `source`、`before`、`after`、`result`                                  | [事件](#events-slots)      |
| `Marker`                  | ID、文本、位置、屏幕偏移及业务数据                                     | [标签](#markers)           |
| `ProjectedMarker`         | Marker 加屏幕 x/y、visible、modelPosition                              | [插槽](#events-slots)      |
| `MarkerOverlay`           | 投影标签数组、issues、视口宽高；内部布局数据的公开类型，无独立查询方法 | [标签](#markers)           |
| `ModelInfo`               | 模型身份、名称、URL、统计、warnings                                    | [加载事件](#model-loading) |
| `SceneAssociation`        | 可选 `nodes` 源节点索引，Loader 关联辅助类型，无独立查询方法           | [场景读取](#viewer-api)    |
| `NavigationOptions`       | `home?`、`cube?`、`componentTree?`，均默认 true                        | [导航](#navigation)        |
| `ViewDirection`           | 六个标准观察方向                                                       | [导航](#navigation)        |
| `ViewerApi`               | 组件 ref 暴露的 19 个方法                                              | [实例方法](#viewer-api)    |
| `GeographicCoordinate`    | `longitude`、`latitude`、`height?`                                     | [GIS](#gis)                |
| `SurveyCoordinate`        | `northing`、`easting`、`height?`                                       | [GIS](#gis)                |
| `GisControlPoint<T>`      | `{ model: Point3, map: T }`，T 默认 GeographicCoordinate               | [GIS](#gis)                |
| `GisPlacementOptions`     | 配准输入，CRS 决定地图点类型                                           | [GIS](#gis)                |
| `GisPlacement`            | 配准矩阵、位置、误差及坐标转换方法                                     | [GIS](#gis)                |
| `GisOptions`              | 可选影像与 DEM 配置，Key/配准/开关/透明度                              | [GIS](#gis)                |
| `GisStatus`               | 图层状态、瓦片计数与可选错误消息                                       | [GIS](#gis)                |
| `TerrainOptions`          | 相对预览或真实高程模式，独立 Key 与高程转换函数                        | [GIS](#gis)                |
| `TerrainStatus`           | 独立 DEM 状态、模式、目标瓦片准备计数及错误消息                        | [GIS](#gis)                |

`ModelMetadata`、`LoadedModel`、内部 `createViewer()` 等即使在源码文件中导出，也没有从 package 根入口公开，不作为宿主可直接导入的稳定 API。消费项目应通过包名和公开样式入口接入，不依赖源码路径或未声明的包子路径。

<a id="development"></a>

## 11. 模块入口与类型声明

### 11.1 分发内容与公开入口

安装包包含构建产物、公开类型声明、README、API 文档和许可证。消费项目通过包名及以下子路径接入，不依赖 SDK 源码或构建脚本：

| 入口                                       | 用途                               |
| ------------------------------------------ | ---------------------------------- |
| `@caojinyu111/vue-bim-viewer`              | ESM/CJS 运行导出与 TypeScript 声明 |
| `@caojinyu111/vue-bim-viewer/style.css`    | 组件样式，由应用前端构建工具处理   |
| `@caojinyu111/vue-bim-viewer/package.json` | 包信息                             |

ESM 使用命名导入；CommonJS 可使用：

```js
const {
  MineViewer,
  flattenComponentTree,
  createGisPlacement,
} = require('@caojinyu111/vue-bim-viewer')
```

样式需在前端入口导入，不在 Node 中通过 `require` 读取。遇到 Vue/Three 重复实例时，检查依赖树和本地链接；Vite 应用可按需设置 `resolve.dedupe: ['vue', 'three']`。Three.js 的 CommonJS 入口可能输出弃用提示。

### 11.2 JavaScript 与 TypeScript 支持

运行实现使用 JavaScript，公开 `.d.ts` 随包提供。JavaScript 应用无需配置 TypeScript；TypeScript 应用安装第 2 节的声明依赖后，可从包根入口导入公开类型。

类型声明覆盖组件 Props、事件、插槽、实例方法及工具函数。声明用于开发期检查，不代替运行时输入校验。将 JSON、存储记录或远程业务数据交给 SDK 前，仍需处理解析失败并检查 SDK 返回结果。

维护者应在源码工程中查阅 DEVELOPMENT.md，了解构建、验证和发布流程。

<a id="troubleshooting"></a>

## 12. 常见问题与限制

| 现象                          | 优先检查                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| 页面没有三维内容              | 父容器是否有非零宽高、是否引入样式、浏览器 WebGL2 是否可用、model-error 内容       |
| 地图没有加载                   | GIS 是否启用、浏览器是否支持 `fetch`、`createImageBitmap`、`AbortSignal.any`、`AbortSignal.timeout` 和 `OffscreenCanvas` |
| 模型加载失败                  | Manifest version、entry 后缀、HTTP 状态、CORS、地址是否实际返回 HTML、外部资源路径 |
| 模型能显示但属性缺失          | model-loaded.warnings、元数据格式、源名称是否唯一、源节点关联是否存在              |
| ref 有值但查询为 null         | 模型尚未成功就绪；在 component-tree-ready 后查询                                   |
| await reload 后没有新模型     | 查看 model-loaded/model-error；Promise 完成不保证加载成功，失败可能仍显示旧模型    |
| 调 API 提示未知 ID            | ID 是否来自当前模型和 revision；不要用名称直接代替 ID                              |
| 子节点设为可见仍不显示        | 祖先是否隐藏，或是否仍受初始状态/祖先外观影响                                      |
| 恢复父节点后子节点仍有颜色    | restoreComponent 的颜色与显隐仅恢复自身，后代独立颜色继续保留                                    |
| 导入记录未全量替换            | 导入是合并；空 overrides 不清空；检查 error、unknownIds 和 skipped                 |
| 标签不显示                    | ID 是否唯一、锚点是否存在、绑定构件是否隐藏、位置是否有限、是否在相机前和视口内    |
| 标签在物体后面仍显示          | 当前不做几何遮挡检测                                                               |
| 模型透明后标签仍显示          | 标签绑定 effective.visible，半透明状态不隐藏标签                                |
| 标签点与 GIS 控制点错位       | 是否误把对象原点、包围盒顶部或展示居中坐标当作真实测量点                           |
| bounds-top 不在预期顶部       | 当前固定取 Y 最大值，Z 向上模型需自行选择真实点位                                  |
| GIS 偏移很大或方向错误        | CRS、测量 X/Y 轴序、41 带号、模型竖直轴、单位、对应点是否一致                      |
| GIS 有水平位置但没有 height   | 尚未提供地图点高程；fallbackHeight 不算高程已配准                                  |
| GIS 高程与地形不一致          | 椭球高/正常高是否混用、GIS 引擎基准是否一致、竖直残差及地形高程来源                |
| 序列化 GIS 结果后无法转换坐标 | toGeographic 是函数；保存输入配置并重新调用 createGisPlacement                     |
| 版本更新后保存记录不匹配      | revision 随资源内容变化；按模型身份和版本分区保存，不盲目复用回退 ID               |

当前支持标准非压缩 GLB/glTF；没有在 Loader 中配置 Draco、KTX2、Meshopt 解码器，也不直接加载 IFC、RVT 等源 BIM 格式。当前包没有模型编辑、任意相机控制、动画播放、裁剪剖切、距离测量或业务模拟等公开能力。

Marker 使用 DOM 标签，没有海量标签布局优化；GIS 方法提供定位计算，SDK 支持可选有限范围的天地图影像及 DEM 地形（见 9.11），不加载注记或其他 GIS 引擎。新增需求应先区分是接入层业务功能，还是需要扩展 SDK 的公开能力。

### 12.1 实际适用范围

适合 Vue 3 网页中的静态三角网格 BIM 浏览、构件树查询、按节点选择/外观、业务标签，以及有限区域的 GIS 配准、天地图影像与 DEM 地形。IFC/RVT 等需要先在外部转换成标准非压缩 GLB/glTF。没有配置 Draco、KTX2、Meshopt 解码器；动画、编辑、测量、剖切不在当前公开能力内。InstancedMesh 按对象视为一个构件，不支持逐实例拾取与外观。Line/Points 不属于完整支持的构件外观与包围盒对象。

GIS 仅接受 EPSG:4529、4490、4326，采用局部水平刚性配准和已知单位换算，不自动拟合缩放或精密基准转换。DEM 默认关闭，不支持注记和无限漫游；真实高程模式需提供可靠高程配准及基准转换，测量使用前需以真实控制点、残差和独立检查点验收。

### 12.2 已知问题与调用约束

| 项目               | 影响与建议                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 恢复构件的参数     | `restoreComponent` 必须传入当前模型中的有效 ID；漏传或空 ID 返回 `error`，未知 ID 返回 `unknownIds`，全部恢复使用 `restoreAllComponents()`。 |
| 特殊对象的资源释放 | 释放以 Mesh 为主，Line/Points、Skeleton 骨骼纹理及 InstancedMesh 自身资源的 dispose 钩子覆盖不完整。反复加载此类模型可能累积 GPU 资源。 |
| Line/Points 外观   | 状态更新可能返回成功，但颜色、透明度及包围盒不具备完整支持；应使用静态 Mesh 模型。                                                      |
| 外观更新成本       | 每次修改会同步扫描节点，已克隆材质可能重复更新；大模型和高频批量修改需结合实际业务压测。                                                |
| 加载内存与并发     | 指纹同步计算，外部资源并行请求且采用 `cache: no-store`；切换时旧模型与候选模型同时驻留，会增加峰值内存。                                |
| 统计口径           | `stats.bytes` 仅含主文件，`stats.triangles` 不乘实例数，不代表全部下载量或真实绘制总量。                                                |
| Marker 容量与交互  | 无聚类、遮挡检测、避让或虚拟化。`marker` 插槽位于按钮内，避免嵌套交互控件；复杂操作放在弹窗插槽。                                       |
| Three.js 类型      | TypeScript 消费项目需额外安装匹配的 `@types/three`，见第 2 节。                                                                         |

### 12.3 应用验收建议

应用上线前，应使用真实模型验证目标浏览器、设备 GPU、内存峰值及长时间切换表现。模型加载、外观修改、Marker 数量和地图影像范围会影响性能，SDK 不承诺固定 FPS、最大模型大小或标签容量。

建议覆盖首次加载与失败重试、切换模型失败时保留旧场景、版本不匹配的外观导入、背景图片失败、地图部分失败及组件卸载。Safari、Firefox、移动设备和 WebGL 上下文中断应纳入应用自身的兼容性验收。
