import { describe, it, expect } from 'vitest'
import {
  DEFAULT_END_PERCENT,
  DEFAULT_MARQUEE_SPEED,
  DEFAULT_END_SECONDS,
  DEFAULT_WARN_AMBER,
  DEFAULT_WARN_RED,
  endWarnSeconds,
  resolveStructurePrefs,
} from '../../../src/lib/structurePrefs'
import { DEFAULT_PHRASE_SIZE } from '../../../src/audio/structure'

describe('resolveStructurePrefs', () => {
  it('sin configuración da los valores de siempre', () => {
    expect(resolveStructurePrefs()).toEqual({
      show: true,
      marqueeSpeed: DEFAULT_MARQUEE_SPEED,
      titleFont: 'rounded',
      lcdFont: 'rounded',
      phraseSize: DEFAULT_PHRASE_SIZE,
      unit: 'kicks',
      warnAmber: DEFAULT_WARN_AMBER,
      warnRed: DEFAULT_WARN_RED,
      endWarn: {
        enabled: true,
        mode: 'seconds',
        seconds: DEFAULT_END_SECONDS,
        percent: DEFAULT_END_PERCENT,
      },
    })
  })

  it('respeta lo que el usuario haya elegido', () => {
    const p = resolveStructurePrefs({
      showStructure: false,
      phraseSize: 32,
      structureUnit: 'bars',
      structureWarnAmber: 8,
      structureWarnRed: 2,
      endWarnOn: false,
      endWarnMode: 'percent',
      endWarnPercent: 5,
    })
    expect(p.show).toBe(false)
    expect(p.phraseSize).toBe(32)
    expect(p.unit).toBe('bars')
    expect(p.warnAmber).toBe(8)
    expect(p.warnRed).toBe(2)
    expect(p.endWarn).toMatchObject({ enabled: false, mode: 'percent', percent: 5 })
  })

  it('la pantalla solo admite los dos modos que hay', () => {
    expect(resolveStructurePrefs({ lcdFont: 'lcd' }).lcdFont).toBe('lcd')
    expect(resolveStructurePrefs({ lcdFont: 'gótica' }).lcdFont).toBe('rounded')
    expect(resolveStructurePrefs({ titleFont: 'dot' }).titleFont).toBe('dot')
    expect(resolveStructurePrefs({ titleFont: 'lcd' }).titleFont).toBe('rounded')
    // El título va por su cuenta: son dos ajustes distintos
    expect(resolveStructurePrefs({ titleFont: 'dot' }).lcdFont).toBe('rounded')
  })

  it('lo que se eligió a mano cuando había cuatro modos se sigue entendiendo', () => {
    for (const viejo of ['segments', 'seg7', 'seg14', 'dot']) {
      expect(resolveStructurePrefs({ lcdFont: viejo }).lcdFont).toBe('lcd')
    }
    for (const viejo of ['segments', 'seg7', 'seg14']) {
      expect(resolveStructurePrefs({ titleFont: viejo }).titleFont).toBe('dot')
    }
  })

  it('la velocidad de la marquesina solo admite las que hay', () => {
    expect(resolveStructurePrefs({ marqueeSpeed: 0 }).marqueeSpeed).toBe(0)
    expect(resolveStructurePrefs({ marqueeSpeed: 60 }).marqueeSpeed).toBe(60)
    expect(resolveStructurePrefs({ marqueeSpeed: 999 }).marqueeSpeed).toBe(DEFAULT_MARQUEE_SPEED)
  })

  it('descarta valores imposibles en vez de aplicarlos', () => {
    const p = resolveStructurePrefs({
      phraseSize: 7,
      structureUnit: 'palmas',
      endWarnMode: 'lunas',
      endWarnSeconds: 9999,
      endWarnPercent: 0,
    })
    expect(p.phraseSize).toBe(DEFAULT_PHRASE_SIZE)
    expect(p.unit).toBe('kicks')
    expect(p.endWarn.mode).toBe('seconds')
    expect(p.endWarn.seconds).toBe(300)
    expect(p.endWarn.percent).toBe(1)
  })

  it('el aviso rojo nunca queda por encima del ámbar', () => {
    const p = resolveStructurePrefs({ structureWarnAmber: 8, structureWarnRed: 32 })
    expect(p.warnRed).toBe(8)
  })
})

describe('endWarnSeconds', () => {
  it('en modo segundos avisa a esos segundos del final', () => {
    const p = resolveStructurePrefs({ endWarnMode: 'seconds', endWarnSeconds: 30 })
    expect(endWarnSeconds(p.endWarn, 300)).toBe(30)
  })

  it('en modo porcentaje, la cuenta va con la duración', () => {
    const p = resolveStructurePrefs({ endWarnMode: 'percent', endWarnPercent: 10 })
    expect(endWarnSeconds(p.endWarn, 300)).toBe(30)
    expect(endWarnSeconds(p.endWarn, 120)).toBe(12)
  })

  it('en una pista más corta que el aviso, avisa desde el principio', () => {
    const p = resolveStructurePrefs({ endWarnMode: 'seconds', endWarnSeconds: 60 })
    expect(endWarnSeconds(p.endWarn, 20)).toBe(20)
  })

  it('apagado o sin duración, no avisa', () => {
    const p = resolveStructurePrefs({ endWarnOn: false })
    expect(endWarnSeconds(p.endWarn, 300)).toBe(0)
    expect(endWarnSeconds(resolveStructurePrefs().endWarn, 0)).toBe(0)
  })
})
