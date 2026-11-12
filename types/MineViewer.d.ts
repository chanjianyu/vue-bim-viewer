import type { ComponentOptionsMixin, DefineComponent } from 'vue'
import type { GisOptions, GisStatus, TerrainStatus } from './gis-imagery.js'
import type {
  AppearanceEvent,
  BackgroundOptions,
  CameraTransitionOptions,
  ComponentNode,
  ComponentTree,
  ViewState,
  Marker,
  MarkerClusteringOptions,
  MarkerClusterInfo,
  MarkerClusterSlotProps,
  ModelInfo,
  ModelSource,
  NavigationOptions,
  ProjectedMarker,
  RenderingOptions,
  ViewerApi,
} from './types.js'

type Props = {
  modelSource: ModelSource
  markers?: Marker[]
  markerClustering?: MarkerClusteringOptions
  initialView?: ViewState
  cameraTransition?: CameraTransitionOptions
  gis?: GisOptions
  background?: BackgroundOptions
  rendering?: RenderingOptions
  navigation?: NavigationOptions
}

type Events = {
  'model-loaded': (info: ModelInfo) => void
  'model-error': (error: { message: string }) => void
  'component-tree-ready': (tree: ComponentTree) => void
  'component-select': (component: ComponentNode | null) => void
  'appearance-change': (event: AppearanceEvent) => void
  'marker-click': (marker: Marker) => void
  'marker-cluster-click': (cluster: MarkerClusterInfo) => void
  'gis-status': (status: GisStatus) => void
  'terrain-status': (status: TerrainStatus) => void
  'background-error': (error: { message: string }) => void
}

type Slots = {
  marker(props: { marker: ProjectedMarker; selected: boolean }): unknown
  'marker-cluster'(props: MarkerClusterSlotProps): unknown
  'marker-popup'(props: { marker: ProjectedMarker; close: () => void }): unknown
}

declare const MineViewer: DefineComponent<
  Props,
  ViewerApi,
  {},
  {},
  {},
  ComponentOptionsMixin,
  ComponentOptionsMixin,
  Events
> & {
  new (): { $slots: Slots }
}

export default MineViewer
