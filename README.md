# @caojinyu111/vue-bim-viewer

基于 Vue 3 与 Three.js 的 JavaScript BIM 模型浏览 SDK。当前版本 **0.3.5**，提供 ESM、CommonJS、独立样式与 TypeScript 类型声明。

适用于将静态 GLB/glTF 模型嵌入业务系统，通过组件参数、事件和实例方法实现构件查询、选择、外观控制及业务标记。

## 功能

- **模型浏览**：Manifest 资源加载、旋转、滚轮及 `zoomIn()` / `zoomOut()` 缩放、平移、构件/XYZ 坐标定位与平滑视角过渡。
- **视角导航**：Home 与切角骰子，支持面、边、角共 26 个方向，宿主可分别控制显隐。
- **构件访问**：保留源场景父子结构，查询构件树、元数据、包围盒和模型空间锚点。
- **构件目录**：左上角内置可搜索构件树，支持整组显隐、两档透明切换、选中定位及与宿主外观同步。
- **构件选择**：内置青绿色表面高亮与浅绿色细轮廓，支持三维点击、构件树及 API 选择；不需要宿主配置。
- **外观管理**：显隐、颜色、不透明/半透明两档状态、批量修改，以及外观差异的导出、合并导入和恢复。
- **业务标记**：模型坐标或构件锚点定位，支持自定义标签与弹窗插槽。
- **标记聚合**：可选按屏幕距离聚合，点击拉近；重合或无法拆分时显示分页成员列表，默认关闭。
- **场景背景**：响应式背景颜色与静态图片，居中等比裁剪，加载失败回退纯色。
- **GIS 配准**：三点及多点局部配准、误差报告和坐标转换。
- **地图与地形**：通过 three-tile 加载有限范围的天地图影像，可选 DEM 相对预览或真实高程对齐。

构件目录中，复选框控制显隐，正方体按钮切换透明状态，名称用于选中定位。整组全部半透明时正方体为空心，否则为灰色实心；点击实心设整组半透明，点击空心恢复整组不透明。隐藏构件也计入汇总，搜索和折叠不改变操作范围。

构件半透明固定使用原材质不透明度的 50%，不透明保留原材质。宿主通过 `setComponentAppearance(id, { translucent: true })` 或 `false` 设置完整分支，目录与宿主通过 `appearance-change` 同步。子分支可以独立切换，父级和兄弟几何体保持各自状态，不叠乘透明度。SDK 不持久化外观，成功重载模型后恢复初始状态；宿主可自行保存并回放布尔外观记录。

## 安装

```sh
npm install @caojinyu111/vue-bim-viewer@0.3.5
```

Vue **3.5.43** 和 Three.js **0.183.1** 是精确版本的共享 peerDependencies；npm 7+ 在宿主未安装时会自动补齐，保持单实例。three-tile **0.12.2** 与 GIS 投影依赖随 SDK 安装，three-tile 随 SDK 构建。

已有 Vue 或 Three.js 的项目需要先统一版本，避免依赖冲突：

```sh
npm install vue@3.5.43 three@0.183.1
```

TypeScript 项目另外安装匹配的 Three.js 类型声明：

```sh
npm install --save-dev @types/three@0.183.1
```

## 快速开始

在 Vue 单文件组件中导入组件和样式，为容器指定明确高度：

```vue
<script setup>
import { ref, shallowRef } from 'vue'
import { MineViewer, flattenComponentTree } from '@caojinyu111/vue-bim-viewer'
import '@caojinyu111/vue-bim-viewer/style.css'

const viewer = shallowRef(null)
const ready = ref(false)
const message = ref('')
const modelSource = { manifestUrl: '/models/manifest.json' }
const background = { color: '#f4f7fb' }

function onReady() {
  ready.value = true
  message.value = ''
}

function focusFirst() {
  const api = viewer.value
  if (!api) return
  const node = flattenComponentTree(api.getComponentTree()).find((item) => item.hasGeometry)
  if (!node) return
  api.selectComponent(node.id)
  api.focusComponent(node.id)
}
</script>

<template>
  <button type="button" :disabled="!ready" @click="focusFirst">定位首个构件</button>
  <p v-if="message" role="status">{{ message }}</p>
  <div style="width: 100%; height: 600px">
    <MineViewer
      ref="viewer"
      :model-source="modelSource"
      :background="background"
      @component-tree-ready="onReady"
      @model-error="message = $event.message"
      @background-error="message = $event.message"
    />
  </div>
</template>
```

在应用的静态资源目录中放置 `models/manifest.json` 与模型文件：

```json
{
  "version": "1.0.0",
  "modelId": "building",
  "label": "建筑模型",
  "entry": "./model.glb"
}
```

模型入口相对于 Manifest 地址解析；glTF 外部资源相对于模型地址解析。资源必须可通过 HTTP/HTTPS 访问，跨域服务器需要配置 CORS。

## 构件目录、Home 与方向骰子

左上角默认显示构件目录按钮，右上角显示 Home 和导航骰子。宿主传入响应式配置即可分别调整显隐，不重载模型：

```vue
<script setup>
import { reactive } from 'vue'
const navigation = reactive({ home: true, cube: true, componentTree: true })
// navigation.home = false // 隐藏 Home
// navigation.cube = false // 隐藏骰子
// navigation.componentTree = false // 隐藏构件目录按钮并关闭面板
</script>

<template>
  <MineViewer ref="viewer" :model-source="modelSource" :navigation="navigation" />
</template>
```

未传配置或字段时默认显示。Home 调用 `resetView()`，按 `initialView` 快照恢复视角；未设置快照时自动适配全模型。骰子跟随主相机旋转，点击六面、十二条边或八个角时保留当前观察中心及距离。宿主也可调用 `viewer.value.setViewDirection('top', { duration: 400 })` 切换六个标准方向。方向切换默认沿用 `cameraTransition`；`duration: 0` 为立即切换。

构件目录默认收起，仅显示模型的实际构件层级。搜索名称会保留匹配路径，不改变场景显隐。复选框作用于完整分支：取消勾选隐藏整组，勾选显示整组及此前单独隐藏的子构件；部分显示时呈半选状态。点击名称使用内置效果选中并按当前观察方向定位；隐藏构件保持隐藏，空节点只选中并提示没有可定位几何。目录显隐修改沿用 `appearance-change` 事件和外观差异保存机制。

打开目录时按钮隐藏，首次打开的面板左上角与按钮原位置对齐，距场景顶部、左侧各 16px。按住标题文字或标题栏空白处可在场景内拖动，关闭按钮显示手形光标且不启动拖动。关闭后按钮恢复原位，再次打开保留关闭前的位置；同一组件实例内隐藏目录或重载模型也保留位置，刷新页面或重新挂载后恢复初始位置。打开和场景尺寸变化时自动修正越界位置。目录不设置自定义键盘快捷键，搜索输入及原生控件键盘行为正常保留；拖动不会操作模型，列表仍可独立滚动。

导航为包内独立封装，不额外导出组件，不依赖其他地图或 BIM 平台 SDK。更多方向约定与边界见 [API 导航说明](./API.md#navigation)。

## XYZ 坐标聚焦

通过组件 ref 调用 `focusPoint()`，坐标与 `type: 'model'` Marker 相同，使用原模型的原点、轴向和单位，无需补偿展示居中偏移：

```js
viewer.value.focusPoint({ x: 100, y: 20, z: -50 }) // 保持当前方向和距离
viewer.value.focusPoint({ x: 100, y: 20, z: -50 }, { distance: 30, duration: 800 })
viewer.value.focusPoint({ x: 100, y: 20, z: -50 }, { duration: 0 }) // 立即定位
```

目标点移到视窗中心并成为后续旋转中心；可选 `distance` 为有限正数，单位沿用模型。时长沿用 `cameraTransition`，单次 `duration` 优先。允许模型内部及包围盒外的点，不自动处理几何遮挡。返回 `true` 表示接受操作；无效参数、未就绪、销毁或上下文丢失返回 `false`，不打断有效动画。详见 [API 定位说明](./API.md#viewer-api)。

## 视角快照

`getViewState()` 返回当前实际视角的模型坐标快照，包含 `position`、`target` 和 `up`。宿主可以保存这个普通对象，并在下一次挂载时直接传给 `initialView`：

```js
const savedView = viewer.value.getViewState()
// 保存 savedView 后，下次挂载：
// <MineViewer :initial-view="savedView" />

viewer.value.setViewState(savedView, { duration: 0 })
```

0.3.5 起 `initialView` 只接受 `ViewState`，旧的 `direction / fitPadding` 配置不再支持。省略 `initialView` 时 SDK 自动适配；视角快照使用原模型坐标，宿主应按模型 `modelId` 和 `revision` 管理保存记录。

## 视角缩放

宿主通过组件 ref 调用独立封装的缩放能力，可自行提供按钮：

```js
viewer.value.zoomIn()
viewer.value.zoomOut()
viewer.value.zoomIn({ factor: 1.5, duration: 200 })
viewer.value.zoomOut({ duration: 0 })
```

缩放围绕当前观察中心并保持方向，默认倍率 `1.2`；放大时相机距离除以倍率，缩小时乘以倍率。`factor` 必须为有限且大于 `1` 的数值。时长优先取单次 `duration`，其次为 `cameraTransition.duration`，均未设置时默认 `300ms`；`0` 或系统减少动态效果设置下即时完成。

连续点击累计目标距离，滚轮、拖动或其他相机操作接管时清除旧目标。SDK 按完整模型包围球、相机有效视场角和视口短边估算用户缩小上限，包围球投影直径的最小比例为 8%；该限制只作用于滚轮缩小和 `zoomOut()`。到达上限后相机夹在边界，继续 `zoomOut()` 返回 `false`。滚轮与方法缩放均自动维护模型远裁剪范围，避免拉远后被远裁剪面裁掉。

`focusComponent()`、`focusPoint()`、`setViewState()`、`initialView` 和 `resetView()` 仍可使用更远的程序化视角；超出用户上限时继续向外缩放保持当前位置，向内缩放可恢复。模型重载及桌面、窄屏视口变化会重新计算上限，尺寸变化本身不移动相机。包围球比例用于防止过度拉远，不保证被隐藏、遮挡或平移出视口的模型仍可见。非法参数或不可用状态不打断有效动画。返回 `true` 仅表示接受请求。公开类型为 `ZoomOptions`，完整规则见 [API 实例方法](./API.md#viewer-api)。

## 天地图影像与 DEM

`gis` 需要宿主提供天地图 Key 和 `createGisPlacement()` 的配准结果：

```js
const gis = {
  enabled: true,
  placement,
  imagery: { key: tiandituKey },
  opacity: 0.65,
  terrain: { enabled: true, mode: 'relative' },
}
// <MineViewer :model-source="modelSource" :gis="gis" @terrain-status="onTerrain" />
```

配准控制点中的模型坐标沿用源模型单位，SDK 不会自动判断米或毫米；通过 `metersPerUnit` 声明一个模型单位对应多少米。默认最小二乘模式需要水平分散且不共线的控制点，`first-point` 模式由首点确定位置、其余点确定方向。

地图默认关闭。开启地图但省略 `terrain` 时显示平面影像；开启 DEM 后默认使用 `relative` 相对预览，以配准参考点的 DEM 高程为基准显示地形起伏。`absolute` 真实高程模式要求 `placement.heightResolved === true`，并提供将 DEM 原始高程转换为配准所用椭球高的 `toEllipsoidHeight` 函数。相对预览不能作为真实地表对齐或测量依据。

影像与地形分别通过 `gis-status`、`terrain-status` 报告加载结果，DEM 缺测瓦片保留平面影像。地图覆盖模型水平范围外扩 1000 米后的瓦片区域，优先 16 级、最多 256 张，不随相机缩放切换精度，不支持无限漫游、注记或地形碰撞。完整配置和服务限制见 [API 地图说明](./API.md#gis-terrain)。

## Marker 聚合

聚合默认关闭，可通过宿主配置启用，半径使用 CSS 像素并支持动态调整：

```vue
<MineViewer
  :model-source="modelSource"
  :markers="markers"
  :marker-clustering="{ enabled: true, radius: 48 }"
/>
```

点击数量按钮尝试保持方向拉近；坐标重合或无法拆分时显示分页成员列表，选择成员继续使用原有 Marker 弹窗。聚合按包含屏幕偏移的显示位置计算，不区分业务类型或楼层，不处理模型遮挡与标签矩形重叠。详细规则及 `marker-cluster-click` 事件见 [API Marker 说明](./API.md#markers)。

通过 `marker-cluster` 插槽自定义聚合标签，SDK 继续负责定位、鼠标点击和默认成员列表：

```vue
<MineViewer
  :model-source="modelSource"
  :markers="markers"
  :marker-clustering="{ enabled: true }"
>
  <template #marker-cluster="{ cluster, disabled, expanded }">
    <span
      class="business-cluster"
      :class="{
        alarm: cluster.members.some(member => member.data?.status === 'alarm'),
        disabled,
        expanded,
      }"
    >
      {{ cluster.count }} 个点位
    </span>
  </template>
</MineViewer>
```

`cluster.members` 提供只读的 `id`、`label`、`data` 视图；业务变化通过原始 `markers` 更新。插槽位于 SDK 按钮内部，请使用展示元素或组件，不嵌套按钮、链接或输入框，也无需再次绑定定位。未提供插槽时保留默认数量圆点；默认皮肤可通过宿主 CSS 覆盖配色和尺寸，图标及业务内容可通过自定义插槽实现；按钮尺寸不影响聚合半径，详见 [插槽及样式契约](./API.md#cluster-slot)。

## 0.3.5 变化与接入注意事项

- 提供 `zoomIn()` / `zoomOut()` 实例方法，支持倍率、过渡时长和连续调用，宿主自行提供缩放按钮。
- 提供可选 Marker 聚合、分页成员列表和 `marker-cluster` 展示插槽；聚合默认关闭，默认半径为 48 CSS 像素。
- 聚合默认外观通过 CSS 覆盖，自定义内容通过插槽。如果宿主曾配置开发阶段的 `--mv-cluster-*` 变量，请迁移为 CSS 覆盖；0.3.5 不读取这些变量。其他功能的 CSS 变量保持不变。

完整参数、默认值和调用约束见 [API 文档](./API.md)。

## 使用要求

| 项目     | 要求                                |
| -------- | ----------------------------------- |
| Vue      | 精确 3.5.43                         |
| Three.js | 精确 0.183.1                        |
| 浏览器   | 基础模型显示支持 WebGL2；GIS 需要额外浏览器 API |
| 布局     | 显式导入样式，容器宽高均非零        |
| SSR      | 在客户端挂载组件                    |
| 模型     | 静态 GLB/glTF，未配置额外压缩解码器 |

IFC、RVT 等源 BIM 文件需先转换为支持的 GLB/glTF。基础模型显示需要 WebGL2；启用 GIS 地图还需要 `fetch`、`createImageBitmap`、`AbortSignal.any`、`AbortSignal.timeout` 和 `OffscreenCanvas`；启用 DEM 还需要 `DecompressionStream`。这些是地图和地形的附加要求，基础模型显示不一定需要全部能力。SSR 只能在客户端挂载组件。动画播放、测量、剖切和模型编辑不属于公开能力。具体兼容边界及已知问题见 [使用限制](./API.md#troubleshooting)。

## 文档

[API 使用文档](./API.md) 包含全部 8 项 Props、23 个实例方法、10 个事件、3 个插槽、工具函数、数据结构及接入示例。

维护者可在源码仓库中查阅 `DEVELOPMENT.md`，了解构建、宿主联调和发布流程；该文件不包含在 npm 分发包中。

## 许可证

[MIT](./LICENSE)
