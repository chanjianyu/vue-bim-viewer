import { Color, SRGBColorSpace, TextureLoader } from 'three'

/** 普通屏幕背景；纹理只由这里持有，不参与模型、GIS 或外观的生命周期。 */
export function createBackground(scene, invalidate, onError) {
  const color = new Color('#f4f7fb')
  const loader = new TextureLoader().setCrossOrigin('anonymous')
  let texture
  let imageUrl = '',
    generation = 0,
    destroyed = false,
    imageAspect = 1,
    width = 1,
    height = 1
  scene.background = color

  function cover() {
    if (!texture) return
    const aspect = width / height
    texture.repeat.set(Math.min(1, aspect / imageAspect), Math.min(1, imageAspect / aspect))
    texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2)
  }

  async function load(url, id) {
    let candidate
    try {
      candidate = await loader.loadAsync(url)
      if (destroyed || id !== generation) {
        candidate.dispose()
        return
      }
      const image = candidate.image
      if (
        !image ||
        !Number.isFinite(image.width) ||
        !Number.isFinite(image.height) ||
        image.width <= 0 ||
        image.height <= 0
      )
        throw new Error('背景图片尺寸无效')
      imageAspect = image.width / image.height
      candidate.colorSpace = SRGBColorSpace
      texture = candidate
      cover()
      scene.background = texture
      invalidate()
    } catch {
      candidate?.dispose()
      if (destroyed || id !== generation) return
      scene.background = color
      onError({ message: '背景图片加载失败，请检查图片地址、格式及跨域配置' })
      invalidate()
    }
  }

  return {
    set(options) {
      if (destroyed) return
      const input = options?.color
      const validColor =
        input === undefined || (typeof input === 'string' && /^#[\da-f]{6}$/i.test(input))
      color.set(validColor && input !== undefined ? input : '#f4f7fb')
      if (!validColor) onError({ message: '背景颜色必须为 #RRGGBB，已使用默认颜色 #f4f7fb' })
      const image = options?.imageUrl
      const validImage = image === undefined || typeof image === 'string'
      const nextUrl = validImage ? image?.trim() || '' : ''
      if (!validImage) onError({ message: '背景图片地址必须为字符串，已使用纯色背景' })
      if (nextUrl === imageUrl) {
        scene.background = texture || color
        invalidate()
        return
      }
      imageUrl = nextUrl
      const id = ++generation
      texture?.dispose()
      texture = undefined
      scene.background = color
      invalidate()
      // ponytail: TextureLoader 不取消已发起的下载；序号拦截旧结果并释放迟到纹理。
      if (imageUrl) void load(imageUrl, id)
    },
    resize(nextWidth, nextHeight) {
      if (
        destroyed ||
        !Number.isFinite(nextWidth) ||
        !Number.isFinite(nextHeight) ||
        nextWidth <= 0 ||
        nextHeight <= 0
      )
        return
      width = nextWidth
      height = nextHeight
      cover()
      if (texture) invalidate()
    },
    dispose() {
      if (destroyed) return
      destroyed = true
      generation++
      texture?.dispose()
      texture = undefined
      scene.background = null
    },
  }
}
