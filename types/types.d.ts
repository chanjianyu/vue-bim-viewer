import type { Object3D } from 'three'
/** 坐标均为模型原始米制坐标；内部展示居中不改变这个坐标空间。 */
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
export interface InitialView {
  /** 初始观察方向向量，无量纲；fitPadding 是包围盒适配的留白倍率。 */
  direction?: Point3
  fitPadding?: number
}
export interface CameraTransitionOptions {
  /** 过渡时长，毫秒；默认 800，0 即时定位，必须为有限非负数。 */
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
  opacity: number
  color: string | null
}
/** null 撤销自身覆盖并恢复继承；原始材质透明度仍由渲染层保留。 */
export interface AppearancePatch {
  visible?: boolean | null
  opacity?: number | null
  color?: string | null
}
export interface AppearanceState {
  own: AppearancePatch
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
/** 只记录节点自身的净覆盖差异；父级影响不展开为每个后代的重复记录。 */
export interface AppearanceChangeSet {
  schemaVersion: 1
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
        /** 在模型坐标轴上偏移，单位沿用模型（glTF 约定米）。 */
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
  /** 按 ID 取模型空间锚点（米），默认对象原点；无几何不能查询包围盒锚点。 */
  getComponentAnchor(id: string, anchor?: Anchor): Point3 | null
  /** own 为自身覆盖，effective 包含父级继承，initial 为逻辑初始状态。 */
  getComponentAppearance(id: string): AppearanceState | null
  /** opacity 为 0–1 倍率，color 为 #RRGGBB；null 删除对应覆盖。 */
  setComponentAppearance(id: string, patch: AppearancePatch): OperationResult
  /** 批量设置；非法项跳过，有效项仍应用，结果分别列出。 */
  setComponentAppearances(updates: AppearanceUpdate[]): OperationResult
  /** 相对初始状态的净差异；原始材质颜色以 null 表示，不合并临时选择高亮。 */
  getAppearanceChanges(): AppearanceChangeSet | null
  /** 合并导入；先检查模型身份、资源版本与所有字段，失败时不产生部分修改。 */
  applyAppearanceChanges(value: unknown): OperationResult
  /** 仅恢复该节点自身覆盖，后代独立覆盖继续保留。 */
  restoreComponent(id: string): OperationResult
  /** 删除全部自身覆盖，回到模型初始外观。 */
  restoreAllComponents(): OperationResult
  /** null 清除选择；返回 false 表示当前未就绪或构件不存在。 */
  selectComponent(id: string | null): boolean
  /** 平滑定位构件；空节点使用原点，未知 ID、未就绪或非法时长返回 false。 */
  focusComponent(id: string, options?: CameraTransitionOptions): boolean
  /** 按 initialView 平滑适配整个模型；未就绪或非法时长返回 false。 */
  resetView(options?: CameraTransitionOptions): boolean
  /** 取消上一次未完成加载；候选失败时保留最后成功的场景。 */
  reload(): Promise<void>
}
