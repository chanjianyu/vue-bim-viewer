/** 公开包入口：宿主只消费此处导出的方法、类型及独立 style.css。 */
export { default as MineViewer } from './MineViewer.vue'
export { flattenComponentTree } from './model/components.js'
export { createGisPlacement } from './gis/placement.js'
import './style.css'
