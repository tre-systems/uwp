import { expect, test, type Locator, type Page } from '@playwright/test'

test('detail and system views render with quality controls', async ({ page }) => {
  await openApp(page)

  const panel = await openPanel(page)
  await expect(panel.getByText('PERFORMANCE')).toBeVisible()
  await expect(panel.locator('.perf-grid')).toContainText('Auto ->')
  await expect.poll(() => fpsValue(panel), { message: 'FPS should be reported' }).toBeGreaterThan(0)

  await selectQuality(panel, 'Low')
  await expect(panel.locator('.perf-grid')).toContainText('Low')
  await expect(panel.locator('.perf-grid')).toContainText('30 fps')
  await expect(panel.locator('.perf-grid')).toContainText('35%')
  const lowCanvas = await canvasSize(panel)
  expect(lowCanvas.width).toBeGreaterThan(0)
  expect(lowCanvas.height).toBeGreaterThan(0)

  await selectQuality(panel, 'High')
  await expect(panel.locator('.perf-grid')).toContainText('High')
  await expect(panel.locator('.perf-grid')).toContainText('60 fps')
  await expect(panel.locator('.perf-grid')).toContainText('100%')
  const highCanvas = await canvasSize(panel)
  expect(highCanvas.width).toBeGreaterThan(lowCanvas.width)
  expect(highCanvas.height).toBeGreaterThan(lowCanvas.height)

  await selectQuality(panel, 'Low')
  await page.getByRole('button', { name: /system/i }).click()

  await expect(panel.locator('h1')).toHaveText('System')
  await expect(panel.getByText('PLANETS')).toBeVisible()
  await expect(panel.getByText('PERFORMANCE')).toBeVisible()
  await expect(panel.locator('.perf-grid')).toContainText('Low')
})

async function openApp(page: Page) {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message)
  })

  await page.goto('/')
  await expect(page.locator('.planet-canvas')).toBeVisible()
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
  return panel.locator('button.quality-btn').filter({ hasText: label })
}

async function selectQuality(panel: Locator, label: string) {
  const button = qualityButton(panel, label)
  await expect(button).toBeEnabled()
  await button.click({ force: true })
}

async function fpsValue(panel: Locator) {
  const text = await panel.locator('.perf-grid').innerText()
  const match = text.match(/FPS\s+(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

async function canvasSize(panel: Locator) {
  const text = await panel.locator('.perf-grid').innerText()
  const match = text.match(/Canvas\s+(\d+)\s+x\s+(\d+)/)
  if (!match) return { width: 0, height: 0 }
  return { width: Number(match[1]), height: Number(match[2]) }
}
