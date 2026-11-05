import type { GeographicCoordinate, GisPlacement } from './gis.js'

/** 可选的有限矿区影像与地形。Key 和配准结果由宿主提供。 */
export interface GisOptions {
  enabled?: boolean
  placement: GisPlacement
  imagery: {
    key: string
  }
  /** 0–1，默认 0.65；透明地表便于同时观察地下巷道。 */
  opacity?: number
  /** 默认关闭；启用后默认相对预览，不改变模型原始坐标。 */
  terrain?: TerrainOptions
}
export type TerrainOptions = {
  enabled?: boolean
  /** 省略时使用 imagery.key。 */
  key?: string
} & (
  | { mode?: 'relative' }
  | {
      mode: 'absolute'
      /** DEM 原始高程（米）转换为配准所用基准的椭球高（米）；必须同步返回有限 number，不接受类型转换。 */
      toEllipsoidHeight: (point: Required<GeographicCoordinate>) => number
    }
)
/** 计数为目标影像瓦片的地形准备结果，不是 HTTP 请求数量；与影像状态独立。 */
export interface TerrainStatus extends GisStatus {
  mode: 'relative' | 'absolute'
}
export interface GisStatus {
  status: 'disabled' | 'loading' | 'ready' | 'partial' | 'error'
  loaded: number
  failed: number
  total: number
  message?: string
}
