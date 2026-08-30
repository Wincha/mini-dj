import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PadButton from '../../src/components/PadButton'

const led = (boton) => boton.querySelector('span[aria-hidden]')

describe('PadButton', () => {
  it('pinta dentro lo que se le pase', () => {
    render(<PadButton>÷2</PadButton>)
    expect(screen.getByRole('button')).toHaveTextContent('÷2')
  })

  it('sin testigo no pinta luz', () => {
    render(<PadButton>1</PadButton>)
    expect(led(screen.getByRole('button'))).toBeNull()
  })

  it('el testigo apagado y encendido usan el color que se le dé', () => {
    const { rerender } = render(
      <PadButton led color="#38bdf8">
        Q
      </PadButton>
    )
    const boton = screen.getByRole('button')
    expect(led(boton)).not.toBeNull()
    // Apagado: punto oscuro, sin halo y sin color en el botón
    expect(led(boton)).toHaveStyle({ backgroundColor: '#3f3f46' })
    expect(boton.style.boxShadow).toBe('')

    rerender(
      <PadButton led active color="#38bdf8">
        Q
      </PadButton>
    )
    expect(led(boton)).toHaveStyle({ backgroundColor: '#38bdf8' })
    // Encendido: el botón coge el color y se enciende con halo
    expect(boton.style.borderColor).toBe('rgb(56, 189, 248)')
    expect(boton.style.boxShadow).toContain('#38bdf8')
  })

  it('la segunda línea se reserva aunque venga vacía, para que nada baile', () => {
    const { rerender, container } = render(
      <PadButton sub="">
        1
      </PadButton>
    )
    const lineas = () => container.querySelectorAll('button > span:not([aria-hidden])')
    expect(lineas()).toHaveLength(2)

    rerender(<PadButton sub="drop">1</PadButton>)
    expect(lineas()).toHaveLength(2)
    expect(screen.getByRole('button')).toHaveTextContent('drop')
  })

  it('sin `sub` no hay segunda línea', () => {
    const { container } = render(<PadButton>1</PadButton>)
    expect(container.querySelectorAll('button > span:not([aria-hidden])')).toHaveLength(1)
  })

  it('deshabilitado no llama al click', () => {
    const onClick = vi.fn()
    render(
      <PadButton disabled onClick={onClick}>
        ×2
      </PadButton>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('deja pasar los eventos que necesita el roll y el borrado de un cue', () => {
    const onPointerDown = vi.fn()
    const onContextMenu = vi.fn()
    render(
      <PadButton
        title="roll"
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
      >
        1/8
      </PadButton>
    )
    const boton = screen.getByTitle('roll')
    fireEvent.pointerDown(boton)
    fireEvent.contextMenu(boton)
    expect(onPointerDown).toHaveBeenCalled()
    expect(onContextMenu).toHaveBeenCalled()
  })

  it('cada tamaño tiene su ancho fijo', () => {
    const { rerender } = render(<PadButton size="xs">a</PadButton>)
    expect(screen.getByRole('button').className).toContain('w-6')
    rerender(<PadButton size="cue">a</PadButton>)
    expect(screen.getByRole('button').className).toContain('w-9')
  })
})
