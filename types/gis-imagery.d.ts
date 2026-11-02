import type { GisPlacement } from './gis.js'

/** 可选的有限矿区影像层。Key 与配准结果均由宿主提供，不加载地形或地图注记。 */
export interface GisOptions {
  enabled?: boolean
  placement: GisPlacement
  imagery: {
    key: string
  }
  /** 0–1，默认 0.65；透明地表便于同时观察地下巷道。 */
  opacity?: number
}
export interface GisStatus {
  status: 'disabled' | 'loading' | 'ready' | 'partial' | 'error'
  loaded: number
  failed: number
  total: number
  message?: string
}
