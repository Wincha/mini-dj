import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfigDialog from '../../src/components/ConfigDialog'
import { renderWithI18n, t } from '../helpers/render.jsx'

const abrir = (props = {}) => {
  const onConfigChange = vi.fn()
  const onClose = vi.fn()
  const utils = renderWithI18n(
    <ConfigDialog open onClose={onClose} config={{}} onConfigChange={onConfigChange} {...props} />
  )
  return { ...utils, onConfigChange, onClose }
}

const pestaña = (nombre) => screen.getByRole('tab', { name: nombre })

beforeEach(async () => {
  // La pestaña activa se recuerda entre aperturas: se vuelve a la primera
  const { unmount } = abrir()
  await userEvent.setup().click(pestaña(t('tabAudio')))
  unmount()
})

describe('apertura', () => {
  it('cerrado no pinta nada', () => {
    const { container } = renderWithI18n(
      <ConfigDialog open={false} onClose={() => {}} config={{}} onConfigChange={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('el aspa y el fondo cierran; el propio panel no', async () => {
    const user = userEvent.setup()
    const { onClose, container } = abrir()

    await user.click(within(container.firstChild).getByRole('heading', { name: t('configHeading') }))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByTitle(t('close')))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('pestañas', () => {
  it('ofrece las cinco y arranca en audio', () => {
    const nombres = screen.queryAllByRole('tab')
    expect(nombres).toHaveLength(0) // aún no hay diálogo abierto en este test
    abrir()
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual([
      t('tabAudio'),
      t('tabLibrary'),
      t('tabDisplay'),
      t('tabSafety'),
      t('tabLog'),
    ])
    expect(pestaña(t('tabAudio'))).toHaveAttribute('aria-selected', 'true')
  })

  it('cada pestaña enseña sus ajustes y esconde los de las demás', async () => {
    const user = userEvent.setup()
    abrir()
    expect(screen.getByText(t('audioOutputs'))).toBeInTheDocument()

    await user.click(pestaña(t('tabLibrary')))
    expect(screen.getByText(t('analysisHeading'))).toBeInTheDocument()
    expect(screen.queryByText(t('audioOutputs'))).toBeNull()

    await user.click(pestaña(t('tabSafety')))
    expect(screen.getByText(t('safetyHeading'))).toBeInTheDocument()
    expect(screen.queryByText(t('analysisHeading'))).toBeNull()
    expect(pestaña(t('tabSafety'))).toHaveAttribute('aria-selected', 'true')
    expect(pestaña(t('tabLibrary'))).toHaveAttribute('aria-selected', 'false')
  })

  it('al volver a abrir el diálogo sigue en la pestaña donde se dejó', async () => {
    const user = userEvent.setup()
    const { unmount } = abrir()
    await user.click(pestaña(t('tabDisplay')))
    unmount()

    abrir()
    expect(pestaña(t('tabDisplay'))).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(t('vuHeading'))).toBeInTheDocument()
  })
})

describe('ajustes', () => {
  const irA = async (user, tab) => user.click(pestaña(tab))

  it('el bloqueo de carga viene activado de fábrica', async () => {
    const user = userEvent.setup()
    const { onConfigChange } = abrir()
    await irA(user, t('tabSafety'))

    const casilla = screen.getByLabelText(t('lockLoadWhilePlaying'))
    expect(casilla).toBeChecked()

    await user.click(casilla)
    expect(onConfigChange).toHaveBeenCalledWith({ lockLoadWhilePlaying: false })
  })

  it('refleja lo que ya estaba guardado', async () => {
    const user = userEvent.setup()
    abrir({ config: { lockLoadWhilePlaying: false, showKey: false } })
    await irA(user, t('tabSafety'))
    expect(screen.getByLabelText(t('lockLoadWhilePlaying'))).not.toBeChecked()

    await irA(user, t('tabLibrary'))
    expect(screen.getByLabelText(t('showKey'))).not.toBeChecked()
    expect(screen.getByLabelText(t('showArtwork'))).toBeChecked()
  })

  it('cambia el modo de análisis sin perder el resto de la configuración', async () => {
    const user = userEvent.setup()
    const { onConfigChange } = abrir({ config: { masterOut: 'tarjeta-1', vuMode: 'led' } })
    await irA(user, t('tabLibrary'))

    await user.click(screen.getByLabelText(t('analysisDeck')))
    expect(onConfigChange).toHaveBeenCalledWith({
      masterOut: 'tarjeta-1',
      vuMode: 'led',
      analysisMode: 'deck',
    })
  })

  it('cambia el modo de los VU', async () => {
    const user = userEvent.setup()
    const { onConfigChange } = abrir()
    await irA(user, t('tabDisplay'))

    // Por defecto, LED: es lo que se parece a una mesa de verdad
    expect(screen.getByLabelText(t('vuModeLed'))).toBeChecked()
    await user.click(screen.getByLabelText(t('vuModeContinuous')))
    expect(onConfigChange).toHaveBeenCalledWith({ vuMode: 'continuous' })
  })

  it('cada cambio manda la configuración ENTERA, no solo la clave tocada', async () => {
    const user = userEvent.setup()
    const previa = { lockLoadWhilePlaying: false, analysisMode: 'deck', cueOut: 'auriculares' }
    const { onConfigChange } = abrir({ config: previa })
    await irA(user, t('tabLibrary'))

    await user.click(screen.getByLabelText(t('showKey')))
    expect(onConfigChange).toHaveBeenCalledWith({ ...previa, showKey: false })
  })
})

describe('registro de errores', () => {
  it('sin errores lo dice', async () => {
    const user = userEvent.setup()
    abrir()
    await user.click(pestaña(t('tabLog')))
    expect(screen.getByText(t('logEmpty'))).toBeInTheDocument()
  })

  it('enseña los errores guardados, el último arriba', async () => {
    const { ERRORS, logError, clearLog } = await import('../../src/lib/log')
    clearLog()
    logError(ERRORS.TRACK_LOAD, new Error('boom'), { deck: 'A' })
    logError(ERRORS.ANALYSIS_BEATS, new Error('otra'), { deck: 'B' })

    const user = userEvent.setup()
    abrir()
    await user.click(pestaña(t('tabLog')))

    const texto = screen.getByText(/ANALYSIS-BEATS/).textContent
    expect(texto).toContain('TRACK-LOAD')
    expect(texto.indexOf('ANALYSIS-BEATS')).toBeLessThan(texto.indexOf('TRACK-LOAD'))
    clearLog()
  })
})
