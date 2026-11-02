import type { ComponentOptionsMixin, DefineComponent } from 'vue'
import type { GisOptions, GisStatus } from './gis-imagery.js'
import type {
  AppearanceEvent,
  BackgroundOptions,
  CameraTransitionOptions,
  ComponentNode,
  ComponentTree,
  InitialView,
  Marker,
  ModelInfo,
  ModelSource,
  ProjectedMarker,
  ViewerApi,
} from './types.js'

type Props = {
  modelSource: ModelSource
  markers?: Marker[]
  initialView?: InitialView
  cameraTransition?: CameraTransitionOptions
  gis?: GisOptions
  background?: BackgroundOptions
}

type Events = {
  'model-loaded': (info: ModelInfo) => void
  'model-error': (error: { message: string }) => void
  'component-tree-ready': (tree: ComponentTree) => void
  'component-select': (component: ComponentNode | null) => void
  'appearance-change': (event: AppearanceEvent) => void
  'marker-click': (marker: Marker) => void
  'gis-status': (status: GisStatus) => void
  'background-error': (error: { message: string }) => void
}

type Slots = {
  marker(props: { marker: ProjectedMarker; selected: boolean }): unknown
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
