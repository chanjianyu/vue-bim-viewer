import type { Point3 } from './types.js'
export interface GeographicCoordinate {
  longitude: number
  latitude: number
  /** 椭球高，米。测量正常高须由宿主按高程基准转换后传入。 */
  height?: number
}
export interface SurveyCoordinate {
  /** 测量 X，北坐标，米。 */
  northing: number
  /** 测量 Y，东坐标，米；EPSG:4529 必须保留 41 带号。 */
  easting: number
  height?: number
}
export interface GisControlPoint<T = GeographicCoordinate> {
  /** 原始模型坐标，与 getComponentAnchor 使用相同空间，不含展示居中偏移。 */
  model: Point3
  map: T
}
export type GisPlacementOptions = {
  /** 默认最小二乘；first-point 固定首点，其他点只等权确定方向，不拟合比例。 */
  horizontalAlignment?: 'least-squares' | 'first-point'
  /** glTF 通常 Y 向上；原始 Z 向上模型须显式指定 z。 */
  modelUpAxis?: 'y' | 'z'
  /** 每模型单位对应多少米；默认 1，毫米模型传 0.001，不自动拟合缩放。 */
  metersPerUnit?: number
  /** 无高程控制点时的预览竖直偏移，默认 0 米；不会将高程标记为已确定。 */
  fallbackHeight?: number
  /** 任一点水平误差超过此值时抛错，米；省略时通过结果报告误差。 */
  maxErrorMeters?: number
} & (
  | {
      sourceCrs: 'EPSG:4490' | 'EPSG:4326'
      controlPoints: readonly GisControlPoint[]
    }
  | {
      sourceCrs: 'EPSG:4529'
      controlPoints: readonly GisControlPoint<SurveyCoordinate>[]
    }
)
export interface GisPlacement {
  sourceCrs: GisPlacementOptions['sourceCrs']
  /** ENU 坐标系基准点，椭球面上；不是模型原点的位置。 */
  reference: Required<GeographicCoordinate>
  /** 模型原点的经纬度；没有高程控制点时不返回 height。 */
  position: GeographicCoordinate
  /** 模型水平 X 轴相对局部东方向的逆时针角度；不是罗盘航向。 */
  rotationDegrees: number
  metersPerUnit: number
  heightResolved: boolean
  /** Three.js 列主序：原模型坐标 -> reference 处 ENU 米制坐标（东、北、上）。 */
  localMatrix: number[]
  /** Three.js 列主序：原模型坐标 -> 所选基准的地心地固坐标（ECEF），米。 */
  ecefMatrix: number[]
  horizontalRmse: number
  maxHorizontalError: number
  verticalRmse: number | null
  residuals: {
    index: number
    horizontalError: number
    verticalError: number | null
  }[]
  /** 返回 sourceCrs 对应大地基准的经纬度；不执行 CGCS2000/WGS84 基准转换。 */
  toGeographic(modelPoint: Point3): GeographicCoordinate
}
/** 三点或多点水平配准：支持整体最小二乘和首点锚定，保持竖直及尺寸。 */
export declare function createGisPlacement(options: GisPlacementOptions): GisPlacement
