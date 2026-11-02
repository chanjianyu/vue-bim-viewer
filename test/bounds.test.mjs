import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
} from 'three'
import { createComponents } from '../src/components.js'
import { disposeScene } from '../src/model.js'
import { projectMarkers } from '../src/markers.js'

function nearPoint(actual, expected) {
  for (const key of ['x', 'y', 'z'])
    assert.ok(
      Math.abs(actual[key] - expected[key]) < 1e-9,
      `${key}: ${actual[key]} ≠ ${expected[key]}`,
    )
}

function checkMarkers(index, id, offset, center) {
  const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 1000)
  const target = new Vector3(center.x, center.y, center.z).add(offset)
  camera.position.copy(target).add(new Vector3(0, 0, 100))
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  const result = projectMarkers(
    ['center', 'bounds-top'].map((anchor) => ({
      id: anchor,
      label: anchor,
      position: { type: 'component', componentId: id, anchor },
    })),
    index,
    { get: () => ({ effective: { visible: true } }) },
    offset,
    camera,
    800,
    600,
  )
  assert.deepEqual(result.issues, [])
  for (const marker of result.markers) {
    const anchor = index.getAnchor(id, marker.id)
    assert.deepEqual(marker.modelPosition, anchor)
    const projected = new Vector3(anchor.x, anchor.y, anchor.z).add(offset).project(camera)
    assert.ok(Math.abs(marker.x - (projected.x + 1) * 400) < 1e-9)
    assert.ok(Math.abs(marker.y - (1 - projected.y) * 300) < 1e-9)
    assert.equal(marker.visible, true)
  }
  assert.ok(Math.abs(result.markers[0].x - 400) < 1e-9)
  assert.ok(Math.abs(result.markers[0].y - 300) < 1e-9)
}

test('两个平移实例范围 X=99～201、中心 150，集合仍是一个构件且原点不变', (t) => {
  const mesh = new InstancedMesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial(), 2)
  mesh.userData.componentId = 'instances'
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(100, 0, 0))
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(200, 0, 0))
  mesh.updateMatrixWorld(true)
  t.after(() => {
    mesh.dispose()
    disposeScene(mesh)
  })
  const index = createComponents([mesh], { modelId: 'test', revision: 'r' })
  assert.equal(index.byId.size, 1)
  assert.deepEqual(index.tree.roots[0].bounds, {
    min: { x: 99, y: -1, z: -1 },
    max: { x: 201, y: 1, z: 1 },
    center: { x: 150, y: 0, z: 0 },
  })
  assert.deepEqual(index.getAnchor('instances'), { x: 0, y: 0, z: 0 })
  assert.deepEqual(index.getAnchor('instances', 'center'), { x: 150, y: 0, z: 0 })
  assert.deepEqual(index.getAnchor('instances', 'bounds-top'), { x: 150, y: 1, z: 0 })
  checkMarkers(index, 'instances', new Vector3(), { x: 150, y: 0, z: 0 })
})

test('实例旋转缩放、父级变换、展示偏移、普通兄弟节点和空节点', (t) => {
  const wrapper = new Group(),
    parent = new Group(),
    empty = new Group()
  const offset = new Vector3(-120, -30, -40)
  wrapper.position.copy(offset)
  parent.position.set(10, 20, 30)
  parent.rotation.y = Math.PI / 2
  parent.userData.componentId = 'parent'
  empty.userData.componentId = 'empty'
  const geometry = new BoxGeometry(2, 4, 6),
    material = new MeshBasicMaterial()
  const instances = new InstancedMesh(geometry, material, 2)
  instances.userData.componentId = 'instances'
  instances.setMatrixAt(0, new Matrix4().makeRotationZ(Math.PI / 2).setPosition(100, 0, 0))
  instances.setMatrixAt(1, new Matrix4().makeScale(2, 3, 4).setPosition(200, 0, 0))
  const ordinary = new Mesh(geometry, material)
  ordinary.position.set(-10, 0, 0)
  ordinary.userData.componentId = 'ordinary'
  parent.add(instances, ordinary, empty)
  wrapper.add(parent)
  wrapper.updateMatrixWorld(true)
  t.after(() => {
    instances.dispose()
    disposeScene(wrapper)
  })
  const index = createComponents([parent], { modelId: 'test', revision: 'r', offset })
  const bounds = index.byId.get('instances').bounds
  nearPoint(bounds.min, { x: -2, y: 14, z: -172 })
  nearPoint(bounds.max, { x: 22, y: 26, z: -68 })
  nearPoint(bounds.center, { x: 10, y: 20, z: -120 })
  nearPoint(index.getAnchor('instances'), { x: 10, y: 20, z: 30 })
  nearPoint(index.getAnchor('instances', 'bounds-top'), { x: 10, y: 26, z: -120 })
  nearPoint(index.byId.get('parent').bounds.min, { x: -2, y: 14, z: -172 })
  nearPoint(index.byId.get('parent').bounds.max, { x: 22, y: 26, z: 41 })
  assert.equal(index.byId.get('empty').bounds, null)
  assert.equal(index.getAnchor('empty', 'center'), null)
  assert.equal(index.tree.roots[0].children.length, 3)
  nearPoint(index.byId.get('ordinary').bounds.min, { x: 7, y: 18, z: 39 })
  nearPoint(index.byId.get('ordinary').bounds.max, { x: 13, y: 22, z: 41 })
  nearPoint(index.getAnchor('ordinary', 'center'), { x: 10, y: 20, z: 40 })
  nearPoint(index.getAnchor('ordinary', 'bounds-top'), { x: 10, y: 22, z: 40 })
  checkMarkers(index, 'instances', offset, bounds.center)
  checkMarkers(index, 'ordinary', offset, { x: 10, y: 20, z: 40 })
})

test('索引时重新计算实例范围，零实例不产生虚假几何范围', (t) => {
  const mesh = new InstancedMesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial(), 1)
  mesh.userData.componentId = 'instances'
  mesh.computeBoundingBox()
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(100, 0, 0))
  mesh.updateMatrixWorld(true)
  t.after(() => {
    mesh.dispose()
    disposeScene(mesh)
  })
  const index = () => createComponents([mesh], { modelId: 'test', revision: 'r' })
  assert.equal(index().byId.get('instances').bounds.center.x, 100)
  mesh.count = 0
  assert.equal(index().byId.get('instances').bounds, null)
})
