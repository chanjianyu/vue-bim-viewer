# @caojinyu111/vue-bim-viewer

基于 Vue 3 与 Three.js 的 JavaScript BIM 模型浏览 SDK。当前版本 **0.3.2**，提供 ESM、CommonJS、独立样式与 TypeScript 类型声明。

适用于将静态 GLB/glTF 模型嵌入业务系统，通过组件参数、事件和实例方法实现构件查询、选择、外观控制及业务标记。

## 功能

- **模型浏览**：Manifest 资源加载、旋转、缩放、平移、构件定位与平滑视角过渡。
- **视角导航**：Home 与切角骰子，支持面、边、角共 26 个方向，宿主可分别控制显隐。
- **构件访问**：保留源场景父子结构，查询构件树、元数据、包围盒和模型空间锚点。
- **外观管理**：显隐、颜色、透明度、批量修改，以及外观差异的导出、合并导入和恢复。
- **业务标记**：模型坐标或构件锚点定位，支持自定义标签与弹窗插槽。
- **场景背景**：响应式背景颜色与静态图片，居中等比裁剪，加载失败回退纯色。
- **GIS 配准**：三点及多点局部配准、误差报告和坐标转换。
- **地图与地形**：通过 three-tile 加载有限范围的天地图影像，可选 DEM 相对预览或真实高程对齐。

## 安装

```sh
npm install @caojinyu111/vue-bim-viewer@0.3.2
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

## Home 与方向骰子

右上角默认显示 Home 和导航骰子。宿主传入响应式配置即可实时调整，不重载模型：

```vue
<script setup>
import { reactive } from 'vue'
const navigation = reactive({ home: true, cube: true })
// navigation.home = false // 隐藏 Home
// navigation.cube = false // 隐藏骰子；两项均 false 时不占位
</script>

<template>
  <MineViewer ref="viewer" :model-source="modelSource" :navigation="navigation" />
</template>
```

未传配置或字段时默认显示。Home 调用 `resetView()`，按 `initialView` 恢复全模型视角；骰子跟随主相机旋转，点击六面、十二条边或八个角时保留当前观察中心及距离。宿主也可调用 `viewer.value.setViewDirection('top', { duration: 400 })` 切换六个标准方向。方向切换默认沿用 `cameraTransition`；`duration: 0` 为立即切换。

导航为包内独立封装，不额外导出组件，不依赖其他地图或 BIM 平台 SDK。更多方向约定与边界见 [API 导航说明](./API.md#navigation)。

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

地图默认关闭。开启地图但省略 `terrain` 时显示平面影像；开启 DEM 后默认使用 `relative` 相对预览，以配准参考点的 DEM 高程为基准显示地形起伏。`absolute` 真实高程模式要求 `placement.heightResolved === true`，并提供将 DEM 原始高程转换为配准所用椭球高的 `toEllipsoidHeight` 函数。相对预览不能作为真实地表对齐或测量依据。

影像与地形分别通过 `gis-status`、`terrain-status` 报告加载结果，DEM 缺测瓦片保留平面影像。地图覆盖模型水平范围外扩 1000 米后的瓦片区域，优先 16 级、最多 256 张，不随相机缩放切换精度，不支持无限漫游、注记或地形碰撞。完整配置和服务限制见 [API 地图说明](./API.md#gis-terrain)。

## 使用要求

| 项目     | 要求                                |
| -------- | ----------------------------------- |
| Vue      | 精确 3.5.43                         |
| Three.js | 精确 0.183.1                        |
| 浏览器   | 支持 WebGL2                         |
| 布局     | 显式导入样式，容器宽高均非零        |
| SSR      | 在客户端挂载组件                    |
| 模型     | 静态 GLB/glTF，未配置额外压缩解码器 |

IFC、RVT 等源 BIM 文件需先转换为支持的 GLB/glTF。地图请求需要浏览器支持 `fetch`、`createImageBitmap`、`AbortSignal.any/timeout`；DEM 还需要 `DecompressionStream`。动画播放、测量、剖切和模型编辑不属于公开能力。具体兼容边界及已知问题见 [使用限制](./API.md#troubleshooting)。

## 文档

[API 使用文档](./API.md) 包含全部 7 项 Props、18 个实例方法、9 个事件、2 个插槽、工具函数、数据结构及接入示例。

维护者可在源码仓库中查阅 `DEVELOPMENT.md`，了解构建、宿主联调和发布流程；该文件不包含在 npm 分发包中。

## 许可证

[MIT](./LICENSE)
