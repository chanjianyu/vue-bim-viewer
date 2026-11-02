import assert from 'node:assert/strict'
import test from 'node:test'
import { Scene, SRGBColorSpace, Texture, TextureLoader } from 'three'
import { createBackground } from '../src/background.js'

function setup(t) {
  const jobs = [],
    errors = [],
    disposed = []
  let frames = 0
  t.mock.method(TextureLoader.prototype, 'loadAsync', function (url) {
    assert.equal(this.crossOrigin, 'anonymous')
    return new Promise((resolve, reject) => jobs.push({ url, resolve, reject }))
  })
  const scene = new Scene()
  const background = createBackground(
    scene,
    () => frames++,
    (error) => errors.push(error),
  )
  t.after(() => background.dispose())
  function image(width = 1200, height = 600) {
    const texture = new Texture({ width, height })
    texture.addEventListener('dispose', () => disposed.push(texture))
    return texture
  }
  return { scene, background, jobs, errors, disposed, image, frames: () => frames }
}

test('默认背景保持原颜色，纯色配置实时生效，移除配置恢复默认', (t) => {
  const { scene, background, jobs, errors, frames } = setup(t)
  assert.equal(scene.background.getHexString(), 'f4f7fb')
  background.set({ color: '#123ABC' })
  assert.equal(scene.background.getHexString(), '123abc')
  background.set()
  assert.equal(scene.background.getHexString(), 'f4f7fb')
  assert.equal(jobs.length, 0)
  assert.deepEqual(errors, [])
  assert.equal(frames(), 2)
})

test('非法颜色回退默认并报告，非法图片地址使用纯色', (t) => {
  const { scene, background, jobs, errors } = setup(t)
  for (const color of ['red', '#123', '#12345678', '', null, 123]) {
    background.set({ color })
    assert.equal(scene.background.getHexString(), 'f4f7fb')
  }
  background.set({ color: '#234567', imageUrl: 42 })
  assert.equal(scene.background.getHexString(), '234567')
  assert.equal(jobs.length, 0)
  assert.equal(errors.length, 7)
  assert.ok(errors.every((error) => typeof error.message === 'string'))
})

test('图片加载期间使用颜色，成功后应用 sRGB 纹理，更新颜色与尺寸不重新下载', async (t) => {
  const { scene, background, jobs, errors, image } = setup(t)
  background.resize(900, 600)
  background.set({ color: '#112233', imageUrl: ' /background.png ' })
  assert.equal(scene.background.getHexString(), '112233')
  assert.equal(jobs[0].url, '/background.png')
  const texture = image()
  jobs[0].resolve(texture)
  await Promise.resolve()
  assert.equal(scene.background, texture)
  assert.equal(texture.colorSpace, SRGBColorSpace)
  assert.deepEqual(texture.repeat.toArray(), [0.75, 1])
  assert.deepEqual(texture.offset.toArray(), [0.125, 0])
  background.set({ color: '#445566', imageUrl: '/background.png' })
  background.resize(400, 800)
  assert.equal(scene.background, texture)
  assert.equal(jobs.length, 1)
  assert.deepEqual(errors, [])
})

test('cover 在横竖容器间切换保持居中比例，无效尺寸不污染纹理变换', async (t) => {
  const { background, jobs, image } = setup(t)
  background.set({ imageUrl: '/background.jpg' })
  const texture = image()
  jobs[0].resolve(texture)
  await Promise.resolve()
  background.resize(400, 800)
  assert.deepEqual(texture.repeat.toArray(), [0.25, 1])
  assert.deepEqual(texture.offset.toArray(), [0.375, 0])
  background.resize(2400, 600)
  assert.deepEqual(texture.repeat.toArray(), [1, 0.5])
  assert.deepEqual(texture.offset.toArray(), [0, 0.25])
  for (const [w, h] of [
    [0, 10],
    [10, 0],
    [-1, 100],
    [NaN, 1],
    [1, Infinity],
  ])
    background.resize(w, h)
  assert.deepEqual(texture.repeat.toArray(), [1, 0.5])
  assert.deepEqual(texture.offset.toArray(), [0, 0.25])
})

test('更换图片立即释放旧纹理，移除图片恢复最新颜色，空配置不发起下载', async (t) => {
  const { scene, background, jobs, image, disposed } = setup(t)
  background.set({ imageUrl: '/a.png' })
  const first = image()
  jobs[0].resolve(first)
  await Promise.resolve()
  background.set({ color: '#445566', imageUrl: '/b.png' })
  assert.deepEqual(disposed, [first])
  assert.equal(scene.background.getHexString(), '445566')
  const second = image()
  jobs[1].resolve(second)
  await Promise.resolve()
  background.set({ color: '#667788', imageUrl: '  ' })
  assert.equal(scene.background.getHexString(), '667788')
  assert.deepEqual(disposed, [first, second])
  background.set()
  assert.equal(jobs.length, 2)
})

test('图片失败保留纯色且报告错误，同 URL 修改颜色不重试，移除再配置可重试', async (t) => {
  const { scene, background, jobs, errors, image } = setup(t)
  background.set({ color: '#112233', imageUrl: '/missing.jpg' })
  jobs[0].reject(new Error('private URL details'))
  await Promise.resolve()
  assert.equal(scene.background.getHexString(), '112233')
  assert.equal(errors.length, 1)
  assert.ok(!errors[0].message.includes('private'))
  background.set({ color: '#abcdef', imageUrl: '/missing.jpg' })
  assert.equal(jobs.length, 1)
  assert.equal(scene.background.getHexString(), 'abcdef')
  background.set()
  background.set({ imageUrl: '/missing.jpg' })
  assert.equal(jobs.length, 2)
  const texture = image()
  jobs[1].resolve(texture)
  await Promise.resolve()
  assert.equal(scene.background, texture)
})

test('乱序成功结果释放且不覆盖新图片，过时错误不再上报', async (t) => {
  const { scene, background, jobs, errors, image, disposed } = setup(t)
  background.set({ imageUrl: '/a.png' })
  background.set({ imageUrl: '/b.png' })
  const latest = image()
  jobs[1].resolve(latest)
  await Promise.resolve()
  const stale = image()
  jobs[0].resolve(stale)
  await Promise.resolve()
  assert.equal(scene.background, latest)
  assert.deepEqual(disposed, [stale])
  background.set({ imageUrl: '/c.png' })
  background.set({ color: '#654321' })
  jobs[2].reject(new Error('stale'))
  await Promise.resolve()
  assert.equal(scene.background.getHexString(), '654321')
  assert.deepEqual(errors, [])
})

test('卸载释放当前及迟到纹理，卸载后不调度帧、不上报错误、不发起下载', async (t) => {
  const { scene, background, jobs, errors, image, disposed, frames } = setup(t)
  background.set({ imageUrl: '/a.png' })
  const current = image()
  jobs[0].resolve(current)
  await Promise.resolve()
  background.dispose()
  assert.deepEqual(disposed, [current])
  assert.equal(scene.background, null)
  background.dispose()
  assert.deepEqual(disposed, [current])

  const second = setup(t)
  second.background.set({ imageUrl: '/late.png' })
  second.background.dispose()
  const before = second.frames()
  const late = second.image()
  second.jobs[0].resolve(late)
  await Promise.resolve()
  second.background.set({ imageUrl: '/ignored.png' })
  second.background.resize(100, 100)
  assert.equal(second.frames(), before)
  assert.equal(second.jobs.length, 1)
  assert.deepEqual(second.disposed, [late])
  assert.deepEqual(second.errors, [])
  const beforeFirst = frames()
  background.set({ imageUrl: '/ignored.png' })
  assert.equal(frames(), beforeFirst)
  assert.deepEqual(errors, [])
})

test('无效图片尺寸释放候选并回退纯色，保持可继续配置', async (t) => {
  const { scene, background, jobs, errors, image, disposed } = setup(t)
  background.set({ color: '#123456', imageUrl: '/invalid.png' })
  const invalid = image(0, 600)
  jobs[0].resolve(invalid)
  await Promise.resolve()
  assert.deepEqual(disposed, [invalid])
  assert.equal(scene.background.getHexString(), '123456')
  assert.equal(errors.length, 1)
  background.set({ color: '#abcdef' })
  assert.equal(scene.background.getHexString(), 'abcdef')
})
