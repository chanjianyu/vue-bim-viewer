export { default as MineViewer } from './MineViewer.js'
export type * from './types.js'
export type * from './gis.js'
export type { GisOptions, GisStatus } from './gis-imagery.js'

import type { ComponentNode, ComponentTree } from './types.js'
import type { GisPlacement, GisPlacementOptions } from './gis.js'

/** 按源顺序深度优先展开；返回新数组，节点沿用输入引用。 */
export declare function flattenComponentTree(tree: ComponentTree | null): ComponentNode[]
/** 根据模型与地图控制点计算水平配准和可选高程。 */
export declare function createGisPlacement(options: GisPlacementOptions): GisPlacement
