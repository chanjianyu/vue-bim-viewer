/** 每条连接线一个循环光点，沿完整空间路径匀速移动。 */
export interface ConnectionFlowOptions {
  /** 默认 false；仅 true 开启动画。 */
  enabled?: boolean
  /** 单圈时长，毫秒，有限且大于 0，默认 3000。 */
  duration?: number
  /** 包含柔光边缘的直径，CSS 像素，有限且大于 0，默认 8。 */
  size?: number
  /** #RRGGBB，默认 #ffffff。 */
  color?: string
}

/** 按构件 ID 顺序绘制开放折线；样式省略时恢复默认值。 */
export interface ConnectionLineOptions {
  id: string
  componentIds: string[]
  /** #RRGGBB，默认 #ffb347。 */
  color?: string
  /** CSS 像素，有限且大于 0，默认 3。 */
  width?: number
  /** 0–1，默认 1；0 隐藏线、箭头及光点。 */
  opacity?: number
  /** 默认 true，与构件显隐独立。 */
  visible?: boolean
  /** 默认 true，每个有效线段中间显示一个静态箭头。 */
  showArrows?: boolean
  /** 默认关闭；成功替换连接线后从起点重新播放，失败保留原进度。 */
  flow?: ConnectionFlowOptions
}

export interface ConnectionLineResult {
  success: boolean
  error?: string
  unknownIds: string[]
  invalidAnchorIds: string[]
}
