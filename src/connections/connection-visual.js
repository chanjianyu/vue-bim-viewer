const record = (value) =>
  value !== null &&
  typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))
const color = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
const positive = (value) => Number.isFinite(value) && value > 0
const opacity = (value) => Number.isFinite(value) && value >= 0 && value <= 1

/** 视觉配置仅从 visual 解析一次，省略字段使用所选预设的默认值。 */
export function resolveConnectionVisual(input) {
  if (input !== undefined && !record(input)) return { error: 'visual 必须为普通配置对象' }
  for (const name of ['core', 'halo', 'arrows', 'pulse']) {
    if (input?.[name] !== undefined && !record(input[name]))
      return { error: `visual.${name} 必须为普通配置对象` }
  }
  const preset = input?.preset ?? 'classic'
  if (!['classic', 'cyber'].includes(preset))
    return { error: 'visual.preset 必须为 classic 或 cyber' }
  const cyber = preset === 'cyber'
  const core = {
    color: cyber ? '#d8a7ff' : '#ffb347',
    width: cyber ? 2.4 : 3,
    opacity: 1,
    ...input?.core,
  }
  const halo = {
    enabled: cyber,
    color: cyber ? '#7b39ff' : core.color,
    width: Math.max(core.width * 3, 10),
    opacity: 0.42,
    ...input?.halo,
  }
  const arrows = {
    enabled: true,
    color: cyber ? '#f3eaff' : core.color,
    size: 9,
    spacing: 80,
    ...input?.arrows,
  }
  const pulse = {
    enabled: false,
    color: '#ffffff',
    size: cyber ? 12 : 8,
    duration: 3000,
    speed: 1,
    trail: cyber ? 90 : 0,
    ...input?.pulse,
  }
  if (![core.color, halo.color, arrows.color, pulse.color].every(color))
    return { error: 'visual 中的颜色必须使用 #RRGGBB 格式' }
  if (![halo.enabled, arrows.enabled, pulse.enabled].every((flag) => typeof flag === 'boolean'))
    return { error: 'visual 中的 enabled 必须为布尔值' }
  if (
    ![
      core.width,
      halo.width,
      arrows.size,
      arrows.spacing,
      pulse.size,
      pulse.duration,
      pulse.speed,
    ].every(positive) ||
    !Number.isFinite(pulse.trail) ||
    pulse.trail < 0
  )
    return { error: 'visual 尺寸、间距、时长、速度必须为有限正数，trail 必须为有限非负数' }
  if (![core.opacity, halo.opacity].every(opacity))
    return { error: 'visual 中的 opacity 必须为 0–1 的有限数值' }
  const duration = pulse.duration / pulse.speed
  if (!positive(duration)) return { error: '流光时长与速度组合超出有效数值范围' }
  return { options: { preset, core, halo, arrows, pulse, duration } }
}
