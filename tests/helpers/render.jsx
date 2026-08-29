// Render con el proveedor de idioma puesto: casi todos los componentes usan
// useI18n y sin él lanzan.
import { render } from '@testing-library/react'
import { I18nProvider } from '../../src/i18n'
import { translate } from '../../src/i18n/context'

export function renderWithI18n(ui, options) {
  return render(ui, { wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider>, ...options })
}

// Texto tal y como lo verá el usuario, sin copiar literales en los tests: si
// se reescribe una traducción, el test sigue valiendo.
export const t = (key, params) => translate('en', key, params)
