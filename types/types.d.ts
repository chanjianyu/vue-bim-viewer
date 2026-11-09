import type { Object3D } from 'three'
/** 坐标均为模型原始坐标单位；内部展示居中不改变这个坐标空间。 */
export interface Point3 {
  x: number
  y: number
  z: number
}
export interface Bounds {
  min: Point3
  max: Point3
  center: Point3
}
export type Anchor = 'origin' | 'center' | 'bounds-top'
/** 入口地址由宿主配置；Manifest 中的资源路径相对此地址解析。 */
export interface ModelSource {
  manifestUrl: string
}
/** 可序列化的相机快照；坐标使用原模型空间，不包含展示居中偏移。 */
export interface ViewState {
  position: Point3
  target: Point3
  up: Point3
}
export interface CameraTransitionOptions {
  /** 过渡时长，毫秒；定位/导航默认 800，缩放默认 300；单次调用优先于组件配置，0 即时完成，必须为有限非负数。 */
  duration?: number
}
export interface FocusPointOptions extends CameraTransitionOptions {
  /** 相机到目标点的距离，沿用模型单位；省略则保持调用时距离，必须为有限正数。 */
  distance?: number
}
export interface ZoomOptions extends CameraTransitionOptions {
  /** 缩放倍率，默认 1.2；必须为有限且大于 1 的数值。 */
  factor?: number
  /** 过渡时长，毫秒；优先于 cameraTransition.duration，均未设置时默认 300，0 即时缩放。 */
  duration?: number
}
/** 普通静态背景图按容器居中 cover；加载期间或失败时显示纯色。 */
export interface BackgroundOptions {
  /** #RRGGBB；省略或非法时使用 #f4f7fb。 */
  color?: string
  /** 相对于消费页面的图片地址；省略或空字符串时使用纯色。 */
  imageUrl?: string
}
export interface Appearance {
  visible: boolean
  /** 半透明固定为原材质不透明度的 50%；false 保留原材质。 */
  translucent: boolean
  color: string | null
}
/** visible/color 设置自身覆盖；translucent 设置完整分支，null 恢复分支不透明。 */
export interface AppearancePatch {
  visible?: boolean | null
  translucent?: boolean | null
  color?: string | null
}
export interface AppearanceState {
  /** 节点自身覆盖；纯分组不保存 translucent。 */
  own: AppearancePatch
  /** translucent 表示完整几何分支全部半透明；混合或空分支为 false。 */
  effective: Appearance
  initial: Appearance
}
/** 普通数据快照；空节点也保留，bounds 汇总自身及后代的几何范围。 */
export interface ComponentNode {
  id: string
  name: string
  type: string
  parentId: string | null
  children: ComponentNode[]
  hasGeometry: boolean
  bounds: Bounds | null
  metadata: Record<string, unknown>
}
/** roots 支持多根；children 保留原始顺序与深度，revision 标识资源内容版本。 */
export interface ComponentTree {
  schemaVersion: 1
  modelId: string
  revision: string
  roots: ComponentNode[]
}
export interface AppearanceUpdate {
  id: string
  patch: AppearancePatch
}
export interface AppearanceChange {
  id: string
  original: AppearancePatch
  current: AppearancePatch
}
/** 精确记录节点自身覆盖；几何节点各自保存 translucent，不保存分组汇总状态。 */
export interface AppearanceChangeSet {
  schemaVersion: 2
  modelId: string
  revision: string
  overrides: AppearanceChange[]
}
/** changedIds 是自身覆盖实际变化的节点；未知 ID 与非法修改分别报告。 */
export interface OperationResult {
  changedIds: string[]
  unknownIds: string[]
  skipped: {
    id: string
    reason: string
  }[]
  error?: string
}
export interface AppearanceEvent {
  source: 'api' | 'restore' | 'import'
  before: AppearanceChangeSet
  after: AppearanceChangeSet
  result: OperationResult
}
/** 受宿主控制的标记数据；业务内容通过 data 交给 marker / marker-popup 插槽。 */
export interface Marker {
  id: string
  label: string
  position:
    | ({
        type: 'model'
      } & Point3)
    | {
        type: 'component'
        componentId: string
        anchor?: Anchor
        /** 在模型坐标轴上偏移，单位沿用模型原始坐标单位。 */
        offset?: Point3
      }
  /** CSS 像素：x 向右、y 向下，仅调整标签显示位置。 */
  screenOffset?: {
    x: number
    y: number
  }
  data?: Record<string, unknown>
}
export interface ProjectedMarker extends Marker {
  x: number
  y: number
  visible: boolean
  modelPosition: Point3
}
/** 按 CSS 屏幕距离聚合；默认关闭，非法半径回退为 48px。 */
export interface MarkerClusteringOptions {
  enabled?: boolean
  radius?: number
}
/** 聚合点击时的数据快照，不包含内部索引或 Three.js 对象。 */
export interface MarkerClusterInfo {
  id: string
  count: number
  memberIds: string[]
  x: number
  y: number
}
/** 聚合展示用成员视图；data 沿用宿主业务引用，按只读契约访问。 */
export interface MarkerClusterMember {
  readonly id: string
  readonly label: string
  readonly data?: Readonly<Record<string, unknown>>
}
/** 不包含内部投影成员、相机或缓存；id 仅标识当前 Viewer 的聚合。 */
export interface MarkerClusterRenderInfo {
  readonly id: string
  readonly count: number
  readonly memberIds: readonly string[]
  readonly members: readonly MarkerClusterMember[]
  readonly x: number
  readonly y: number
}
export interface MarkerClusterSlotProps {
  cluster: MarkerClusterRenderInfo
  disabled: boolean
  expanded: boolean
}
export interface MarkerOverlay {
  markers: ProjectedMarker[]
  issues: string[]
  width: number
  height: number
}
export interface ModelInfo {
  modelId: string
  revision: string
  label: string
  manifestUrl: string
  stats: {
    meshes: number
    triangles: number
    bytes: number
  }
  warnings: string[]
}
export interface SceneAssociation {
  nodes?: number
}
export interface NavigationOptions {
  /** 显示 Home 按钮，默认 true。 */
  home?: boolean
  /** 显示 26 方向导航骰子，默认 true。 */
  cube?: boolean
  /** 显示左上角构件目录按钮，默认 true；面板初始关闭。 */
  componentTree?: boolean
}
export type ViewDirection = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back'

/** 高级接口返回活的 Three 对象；只读使用，不能存入 localStorage。 */
export interface ViewerApi {
  /** 返回独立的完整树快照；就绪前为 null，修改快照不影响运行状态。 */
  getComponentTree(): ComponentTree | null
  /** 返回源节点结构快照，去掉业务元数据；不包含展示 wrapper。 */
  getSceneTree(): ComponentTree | null
  /** 返回 Loader 场景根节点，不包含 SDK 为居中添加的 wrapper。 */
  getSceneRoot(): Object3D | null
  /** 根据当前模型中的 Object3D 引用查 ID；其他场景对象返回 null。 */
  getComponentId(node: Object3D): string | null
  /** 返回该节点及其后代的独立快照；未知 ID 或未就绪时返回 null。 */
  getComponent(id: string): ComponentNode | null
  /** 按 ID 取源模型空间锚点，单位沿用模型；默认对象原点；无几何不能查询包围盒锚点。 */
  getComponentAnchor(id: string, anchor?: Anchor): Point3 | null
  /** own 为自身覆盖；effective 的显隐/颜色含继承，translucent 为完整分支汇总。 */
  getComponentAppearance(id: string): AppearanceState | null
  /** translucent 设置整组两档状态；color 为 #RRGGBB，visible/color 的 null 删除自身覆盖。 */
  setComponentAppearance(id: string, patch: AppearancePatch): OperationResult
  /** 按顺序批量设置，重叠分支以后者为准；非法项跳过，批末最多一次变更事件。 */
  setComponentAppearances(updates: AppearanceUpdate[]): OperationResult
  /** 相对初始状态的净差异；原始材质颜色以 null 表示，不合并临时选择高亮。 */
  getAppearanceChanges(): AppearanceChangeSet | null
  /** schemaVersion 2 精确合并自身覆盖；旧格式/含数值 opacity 的记录静默忽略。其他无效记录不部分应用。 */
  applyAppearanceChanges(value: unknown): OperationResult
  /** 恢复整组不透明，仅删除本节点颜色和显隐覆盖；漏传/空 ID 返回 error，未知 ID 返回 unknownIds。 */
  restoreComponent(id: string): OperationResult
  /** 删除全部自身覆盖，回到模型初始外观。 */
  restoreAllComponents(): OperationResult
  /** 内置青绿色高亮与细轮廓，不计入外观差异；null 清除，未就绪或 ID 无效返回 false。 */
  selectComponent(id: string | null): boolean
  /** 平滑定位构件；空节点使用原点，未知 ID、未就绪或非法时长返回 false。 */
  focusComponent(id: string, options?: CameraTransitionOptions): boolean
  /** 按原模型坐标聚焦并保持观察方向；无效参数或未就绪时返回 false，不打断有效动画。 */
  focusPoint(point: Point3, options?: FocusPointOptions): boolean
  /** 围绕当前观察中心拉近视角；非法、不可用或目标已达边界时返回 false，不打断有效动画。 */
  zoomIn(options?: ZoomOptions): boolean
  /** 围绕当前观察中心拉远视角；返回 true 仅表示接受改变目标视距的请求。 */
  zoomOut(options?: ZoomOptions): boolean
  /** 读取当前实际视角；未就绪、上下文丢失或销毁时返回 null。 */
  getViewState(): ViewState | null
  /** 应用模型坐标中的视角快照；未就绪或非法时返回 false，不打断有效动画。 */
  setViewState(state: ViewState, options?: CameraTransitionOptions): boolean
  /** 按 initialView 平滑适配整个模型；未就绪或非法时长返回 false。 */
  resetView(options?: CameraTransitionOptions): boolean
  /** 切换六个标准方向，保持观察目标和距离；未就绪、非法方向或时长返回 false。 */
  setViewDirection(direction: ViewDirection, options?: CameraTransitionOptions): boolean
  /** 取消上一次未完成加载；候选失败时保留最后成功的场景。 */
  reload(): Promise<void>
}
