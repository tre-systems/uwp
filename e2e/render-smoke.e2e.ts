import { expect, test, type Locator, type Page } from '@playwright/test'

test('detail and system views render with quality controls', async ({ page }) => {
  await openApp(page)

  const panel = await openPanel(page)
  await expect(panel.getByText('Performance', { exact: false })).toBeVisible()
  await expect(panel.locator('.perf-profile')).toContainText('auto')
  await expect
    .poll(() => fpsValue(panel), {
      message: 'FPS should be reported',
      timeout: 30_000,
    })
    .toBeGreaterThan(0)

  await selectQuality(panel, 'Low')
  await expect(panel.locator('.perf-profile')).toContainText('Low')
  await expect(panel.locator('.perf-fps-meta')).toContainText('target 30')
  await expect(panel.locator('.perf-grid')).toContainText('55%')
  const lowCanvas = await canvasSize(panel)
  expect(lowCanvas.width).toBeGreaterThan(0)
  expect(lowCanvas.height).toBeGreaterThan(0)

  await selectQuality(panel, 'High')
  await expect(panel.locator('.perf-profile')).toContainText('High')
  await expect(panel.locator('.perf-fps-meta')).toContainText('target 60')
  await expect(panel.locator('.perf-grid')).toContainText('100%')
  const highCanvas = await canvasSize(panel)
  expect(highCanvas.width).toBeGreaterThanOrEqual(lowCanvas.width)
  expect(highCanvas.height).toBeGreaterThanOrEqual(lowCanvas.height)

  await selectQuality(panel, 'Low')
  await page.getByRole('tab', { name: /overview of the current solar system/i }).click({ force: true })

  await expect(panel.locator('h1')).toHaveText('System')
  await expect(panel.getByText('Planets', { exact: false })).toBeVisible()
  await expect(panel.getByText('Performance', { exact: false })).toBeVisible()
  await expect(panel.locator('.perf-profile')).toContainText('Low')
})

for (const viewport of [
  { name: 'desktop', size: { width: 1280, height: 820 } },
  { name: 'mobile', size: { width: 390, height: 844 } },
] as const) {
  test(`sector map renders a 32x40 grid with subsector blocks and opens a system on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport.size)
    await openApp(page)

    await page.getByRole('tab', { name: /browse the subsector hex grid/i }).click({ force: true })
    await expect(page.locator('.subsector-map')).toBeVisible()
    // Wait for the 8x10 grid to populate, then drive selection + overrides off
    // any occupied hex.
    await expect(page.locator('.hex-occupied').first()).toBeVisible({ timeout: 30_000 })
    // A full sector tiles a 4×4 block of lettered subsectors: 3 vertical + 3
    // horizontal dividers, plus 16 A–P labels.
    await expect(page.locator('.subsector-seam')).toHaveCount(6)
    await expect(page.locator('.subsector-letter')).toHaveCount(16)
    await expect(page.locator('.polity-borders')).toHaveCount(1)
    await expect.poll(() => page.locator('.polity-border-line').count()).toBeGreaterThan(0)
    await expect.poll(() => page.locator('.polity-capital').count()).toBeGreaterThan(0)
    await expect.poll(() => page.locator('.hex-empty[data-allegiance]').count()).toBeGreaterThan(0)

    const targetCoord = await page.locator('.hex-occupied').evaluateAll((nodes) => {
      const coords = nodes
        .map((node) => (node as SVGElement).dataset.coord ?? '')
        .filter((coord) => /^\d{4}$/.test(coord))
        .sort()
      return coords[0] ?? null
    })
    expect(targetCoord).toMatch(/^\d{4}$/)

    // Dispatch the click directly: the picked hex can sit outside the pan/zoom
    // viewport (e.g. a corner hex), which would block a real pointer click.
    await page
      .locator(`.hex-occupied[data-coord="${targetCoord}"]`)
      .evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await expect(page.getByRole('tab', { name: /overview of the current solar system/i })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: /browse the subsector hex grid/i }).click({ force: true })
    await expect(page.locator(`.hex-occupied[data-coord="${targetCoord}"]`)).toHaveClass(/hex-selected/)

    const panel = await openPanel(page)
    await expect(panel.locator('dt').filter({ hasText: /^Polities$/ })).toBeVisible()
    await expect(panel.getByText(/shown · \d+ comms · \d+ trade/)).toBeVisible()
    await expect(panel.locator('dt').filter({ hasText: /^Allegiance$/ })).toBeVisible()
    await expect(panel.locator('dt').filter({ hasText: /^Routes$/ })).toBeVisible()

    await panel.getByLabel('Override travel zone').selectOption('Red')
    await expect(page.locator(`.hex-occupied[data-coord="${targetCoord}"] .zone-ring-red`)).toHaveCount(1)
    await expect(panel.locator('.zone-tag-red')).toHaveText('Red')

    await panel.getByRole('checkbox', { name: 'Research' }).check()
    await panel.getByRole('checkbox', { name: 'Aid' }).check()
    await expect(page.locator(`.hex-occupied[data-coord="${targetCoord}"] .base-research`)).toHaveCount(1)
    await expect(page.locator(`.hex-occupied[data-coord="${targetCoord}"] .base-aid`)).toHaveCount(1)

    const allegianceSelect = panel.getByLabel('Override allegiance')
    const nextAllegiance = await allegianceSelect.evaluate((select) => {
      const el = select as HTMLSelectElement
      return [...el.options].find((option) => option.value !== el.value)?.value ?? el.value
    })
    await allegianceSelect.selectOption(nextAllegiance)
    await expect(page.locator(`.hex-occupied[data-coord="${targetCoord}"]`)).toHaveAttribute('aria-label', new RegExp(`allegiance ${nextAllegiance}`))

    const routeId = await page.locator('.jump-route').first().getAttribute('data-route')
    expect(routeId).toMatch(/^\d{4}-\d{4}$/)
    const routeFrom = routeId?.slice(0, 4) ?? ''
    await page
      .locator(`.hex-occupied[data-coord="${routeFrom}"]`)
      .evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await expect(page.getByRole('tab', { name: /overview of the current solar system/i })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: /browse the subsector hex grid/i }).click({ force: true })

    // Hiding a route via its override removes exactly one line from the map;
    // resetting restores it. Panel rows are ordered by neighbour hex, not the
    // map's draw order, so assert on the count delta rather than a specific id.
    const routeControls = panel.locator('fieldset.route-override-row').first()
    await expect(routeControls).toBeVisible()
    const shownBefore = await page.locator('.jump-route').count()
    await routeControls.getByLabel('Show').uncheck()
    await expect.poll(() => page.locator('.jump-route').count()).toBe(shownBefore - 1)
    await routeControls.getByRole('button', { name: /reset route/i }).click()
    await expect.poll(() => page.locator('.jump-route').count()).toBe(shownBefore)
  })
}

async function openApp(page: Page) {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message)
  })

  await page.goto('/#view=detail')
  await expect(page.locator('.planet-canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.error-overlay')).toHaveCount(0)
  await expect.poll(() => consoleErrors, { message: 'No browser console/page errors' }).toEqual([])
}

async function openPanel(page: Page) {
  const panel = page.locator('#controls-panel')
  const expanded = await page.getByRole('button', { name: /show controls|hide controls/i }).getAttribute('aria-expanded')
  if (expanded !== 'true') {
    await page.getByRole('button', { name: /show controls/i }).click()
  }
  await expect(panel).toBeVisible()
  return panel
}

function qualityButton(panel: Locator, label: string) {
  return panel.locator('button.quality-segment').filter({ hasText: label })
}

async function selectQuality(panel: Locator, label: string) {
  const button = qualityButton(panel, label)
  await expect(button).toBeEnabled()
  // The performance section sits at the bottom of a scrollable panel; the
  // segmented control's last cell can stay clipped under the panel's
  // scrollbar even after a scrollIntoView. Fire the click via JS so the
  // viewport check never trips us up.
  await button.evaluate((el) => (el as HTMLButtonElement).click())
}

async function fpsValue(panel: Locator) {
  const text = await panel.locator('.perf-fps-value').innerText()
  const match = text.match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

async function canvasSize(panel: Locator) {
  const text = await panel.locator('.perf-grid').innerText()
  const match = text.match(/Canvas\s+(\d+)\s*[×x]\s*(\d+)/)
  if (!match) return { width: 0, height: 0 }
  return { width: Number(match[1]), height: Number(match[2]) }
}
