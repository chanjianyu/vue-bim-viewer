# @caojinyu111/vue-bim-viewer

基于 Vue 3 与 Three.js 的 JavaScript BIM 模型浏览 SDK。当前版本 **0.3.0**，提供 ESM、CommonJS、独立样式与 TypeScript 类型声明。

适用于将静态 GLB/glTF 模型嵌入业务系统，通过组件参数、事件和实例方法实现构件查询、选择、外观控制及业务标记。

## 功能

- **模型浏览**：Manifest 资源加载、旋转、缩放、平移、构件定位与平滑视角过渡。
- **构件访问**：保留源场景父子结构，查询构件树、元数据、包围盒和模型空间锚点。
- **外观管理**：显隐、颜色、透明度、批量修改，以及外观差异的导出、合并导入和恢复。
- **业务标记**：模型坐标或构件锚点定位，支持自定义标签与弹窗插槽。
- **场景背景**：响应式背景颜色与静态图片，居中等比裁剪，加载失败回退纯色。
- **GIS 配准**：三点及多点局部配准、误差报告、坐标转换和可选天地图平面影像。

## 安装

```sh
npm install @caojinyu111/vue-bim-viewer@0.3.0 vue@^3.5.0 three@^0.186.0
```

Vue 和 Three.js 由应用安装并共用实例。GIS 投影依赖随 SDK 安装。

TypeScript 项目另外安装匹配的 Three.js 类型声明：

```sh
npm install --save-dev @types/three@0.186.0
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

## 使用要求

| 项目     | 要求                                |
| -------- | ----------------------------------- |
| Vue      | 3.5+，保持 3.x                      |
| Three.js | 0.186.x                             |
| 浏览器   | 支持 WebGL2                         |
| 布局     | 显式导入样式，容器宽高均非零        |
| SSR      | 在客户端挂载组件                    |
| 模型     | 静态 GLB/glTF，未配置额外压缩解码器 |

IFC、RVT 等源 BIM 文件需先转换为支持的 GLB/glTF。GIS 影像为有限区域的平面预览；动画、测量、剖切和模型编辑不属于当前公开能力。具体兼容边界及已知问题见 [使用限制](./API.md#troubleshooting)。

## 文档

[API 使用文档](./API.md) 包含全部 6 项 Props、17 个实例方法、8 个事件、2 个插槽、工具函数、数据结构及接入示例。

## 0.3.0 更新

运行源码与 Vue 脚本迁移为 JavaScript，公开类型声明独立维护；保留现有功能、包入口和 API。使用文档按正式版本重新整理，默认采用 JavaScript 示例。

## 许可证

[MIT](./LICENSE)
