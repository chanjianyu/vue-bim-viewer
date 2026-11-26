export interface ConnectionLineVisualOptions {
  /** 默认 classic 单层线路；cyber 启用光晕、轮廓和细高亮，动画仍需显式开启。 */
  preset?: 'classic' | 'cyber'
  /** 省略字段使用所选预设的默认值。 */
  core?: {
    /** #RRGGBB；classic 默认 #ffb347，cyber 默认 #d8a7ff。 */
    color?: string
    /** 有限正数，CSS 像素；classic 默认 3，cyber 默认 2.4。 */
    width?: number
    /** 0–1，默认 1；同时影响所有线路层。 */
    opacity?: number
  }
  /** 仅 cyber 绘制局部柔光，不启用全屏 Bloom。 */
  halo?: {
    /** cyber 默认 true。 */
    enabled?: boolean
    /** #RRGGBB，cyber 默认 #7b39ff。 */
    color?: string
    /** 有限正数，CSS 像素；默认 max(core.width * 3, 10)。 */
    width?: number
    /** 0–1，默认 0.42，再乘核心线透明度。 */
    opacity?: number
  }
  arrows?: {
    /** 默认 true。 */
    enabled?: boolean
    /** #RRGGBB；cyber 默认 #f3eaff，classic 默认核心线颜色。 */
    color?: string
    /** 仅 cyber：有限正数，CSS 像素，默认 9。classic 保留 10×8px。 */
    size?: number
    /** 仅 cyber：有限正数，CSS 像素，默认 80；受最小间距及数量预算限制。 */
    spacing?: number
  }
  pulse?: {
    /** 默认 false；仅 true 开启动画。 */
    enabled?: boolean
    /** #RRGGBB，默认 #ffffff。 */
    color?: string
    /** 包含柔光边缘的直径，有限正数，CSS 像素；classic 默认 8，cyber 默认 12。 */
    size?: number
    /** 基础单圈时长，毫秒，有限正数，默认 3000。 */
    duration?: number
    /** 有限正数，默认 1；实际周期为 duration / speed。 */
    speed?: number
    /** 有限非负数，屏幕尾迹长度 CSS 像素；cyber 默认 90，classic 默认 0。 */
    trail?: number
  }
}

/** 按构件 ID 顺序绘制开放折线；样式省略时恢复默认值。 */
export interface ConnectionLineOptions {
  id: string
  componentIds: string[]
  /** 默认 true，与构件显隐独立。 */
  visible?: boolean
  /** 唯一视觉配置入口；省略时使用 classic 默认值。 */
  visual?: ConnectionLineVisualOptions
}

export interface ConnectionLineResult {
  success: boolean
  error?: string
  unknownIds: string[]
  invalidAnchorIds: string[]
}
