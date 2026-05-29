import { expect, test, type Page } from '@playwright/test'

const SUBSECTOR_SEED = '51966'

test('surface region detail is nonblank and uses the right responsive layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openSurfaceMap(page)
  await openRegion(page)

  await expect(page.locator('.region-backdrop')).toBeVisible()
  await expectRegionCanvasHasDetail(page)
  await expectFullScreenRegion(page, { width: 1280, height: 820 })

  await page.getByLabel('Close region view').click()
  await expect(page.locator('.region-backdrop')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 1000 })
  await openRegion(page)
  await expectRegionCanvasHasDetail(page)
  await expectPortraitSheet(page, 1000)

  await page.getByLabel('Close region view').click()
  await expect(page.locator('.region-backdrop')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await openRegion(page)
  await expectRegionCanvasHasDetail(page)
  await expectFullScreenRegion(page, { width: 390, height: 844 })
})

async function openSurfaceMap(page: Page) {
  await page.goto(`/#sub=${SUBSECTOR_SEED}&view=subsector`)
  await expect(page.locator('.subsector-map')).toBeVisible({ timeout: 30_000 })

  await page.locator('.hex-occupied').first().waitFor({ state: 'visible' })
  // Drill into a world with mixed land + water (hydrographics 3-8) so the
  // region landscape has real terrain variety; a barren or ocean world would
  // be near-monochrome and fail the detail check. Fall back to the first
  // occupied hex if none qualifies. Dispatch the click directly since the hex
  // can sit outside the pan/zoom viewport.
  const target = await page.locator('.hex-occupied').evaluateAll((nodes) => {
    const uwp = (n: Element) => (n as SVGElement).getAttribute('aria-label')?.match(/UWP .(.)(.)(.)/)
    const digit = (c: string | undefined) => (c ? parseInt(c, 36) : NaN)
    // Prefer a garden world (breathable atmosphere + substantial oceans): its
    // temperate blue-water shorelines give the strongest colour + luma
    // contrast. Fall back to any water+land world, then the first occupied hex.
    const garden = nodes.find((n) => {
      const m = uwp(n)
      const atm = digit(m?.[2])
      const hydro = digit(m?.[3])
      return atm >= 5 && atm <= 9 && hydro >= 4 && hydro <= 8
    })
    const watery = nodes.find((n) => {
      const hydro = digit(uwp(n)?.[3])
      return hydro >= 3 && hydro <= 8
    })
    return ((garden ?? watery ?? nodes[0]) as SVGElement | undefined)?.getAttribute('data-coord') ?? null
  })
  expect(target).toMatch(/^\d{4}$/)
  await page
    .locator(`.hex-occupied[data-coord="${target}"]`)
    .evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))

  const surfaceTab = page.getByRole('tab', { name: /cepheus hex world map/i })
  await expect(surfaceTab).toBeEnabled({ timeout: 15_000 })
  await surfaceTab.click({ force: true })
  await expect(page.locator('.surface-map')).toBeVisible({ timeout: 15_000 })
  await expect.poll(
    async () => await page.locator('.surface-map image').first().getAttribute('href'),
    { timeout: 15_000 },
  ).toMatch(/^data:image\/png/)
  await expect.poll(
    () => page.locator('.surface-hex').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(700)
}

async function openRegion(page: Page) {
  // Prefer a shoreline (land meets water = guaranteed colour + hillshade
  // variety), then forest/hill, then any hex. A flat plain or open ocean hex
  // is near-monochrome and would fail expectRegionCanvasHasDetail.
  const byPriority = ['.surface-shoreline', '.surface-forest', '.surface-hill', '.surface-plain', '.surface-hex']
  let target = page.locator('.surface-hex').first()
  for (const sel of byPriority) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) > 0) {
      target = loc
      break
    }
  }
  await target.dblclick({ force: true })
  await expect(page.locator('.region-canvas')).toBeVisible({ timeout: 10_000 })
}

async function expectRegionCanvasHasDetail(page: Page) {
  await expect.poll(
    async () => {
      const stats = await page.locator('.region-canvas').evaluate((node) => {
        const canvas = node as HTMLCanvasElement
        const ctx = canvas.getContext('2d')
        if (!ctx || canvas.width === 0 || canvas.height === 0) return { colors: 0, lumaRange: 0 }
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        const colors = new Set<string>()
        let minLuma = 255
        let maxLuma = 0
        const x0 = Math.floor(canvas.width * 0.24)
        const x1 = Math.floor(canvas.width * 0.76)
        const y0 = Math.floor(canvas.height * 0.20)
        const y1 = Math.floor(canvas.height * 0.80)
        for (let y = y0; y < y1; y += 18) {
          for (let x = x0; x < x1; x += 18) {
            const i = (y * canvas.width + x) * 4
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const luma = r * 0.2126 + g * 0.7152 + b * 0.0722
            if (luma < 8) continue
            colors.add(`${r >> 4}:${g >> 4}:${b >> 4}`)
            minLuma = Math.min(minLuma, luma)
            maxLuma = Math.max(maxLuma, luma)
          }
        }
        return { colors: colors.size, lumaRange: maxLuma - minLuma }
      })
      return Math.min(stats.colors, stats.lumaRange)
    },
    { timeout: 15_000 },
  // min(distinct colours, luma range) over the canvas centre. A blank or
  // flat-fill region scores ~0-4 and a barren world ~6; a rendered terrain
  // hex (shoreline/forest/hill) scores ~10+. The threshold rejects the
  // blank/flat failure modes while staying robust across the responsive
  // canvas sizes and whatever world the seeded subsector happens to surface.
  ).toBeGreaterThan(6)
}

async function expectFullScreenRegion(page: Page, viewport: { width: number; height: number }) {
  const backdrop = await page.locator('.region-backdrop').boundingBox()
  const modal = await page.locator('.region-modal').boundingBox()
  expect(backdrop?.x).toBeLessThanOrEqual(2)
  expect(backdrop?.y).toBeLessThanOrEqual(2)
  expect(backdrop?.width).toBeGreaterThanOrEqual(viewport.width - 4)
  expect(backdrop?.height).toBeGreaterThanOrEqual(viewport.height - 4)
  expect(modal?.width).toBeGreaterThan(viewport.width * 0.90)
  expect(modal?.height).toBeGreaterThan(viewport.height * 0.88)
}

async function expectPortraitSheet(page: Page, viewportHeight: number) {
  const backdrop = await page.locator('.region-backdrop').boundingBox()
  const modal = await page.locator('.region-modal').boundingBox()
  expect(backdrop?.y).toBeGreaterThan(viewportHeight * 0.48)
  expect(backdrop?.height).toBeLessThan(viewportHeight * 0.55)
  expect(modal?.y).toBeGreaterThan(viewportHeight * 0.48)
  expect(modal?.height).toBeLessThan(viewportHeight * 0.55)
}
