import { expect, test } from '@playwright/test'

// Visual regression for the surface convergence work.
//
// Pure-pixel snapshots are platform-sensitive (macOS dev vs Linux CI
// generate slightly different font metrics + WebGPU outputs), so the
// tests here assert *structural invariants* that depend on the
// biome / surface pipeline rather than locking exact pixels:
//
//   - The subsector grid renders the expected number of occupied
//     hexes + polities + routes for a fixed seed.
//   - The surface map paints a non-empty PNG background and surfaces
//     at least one land biome (proving the biome channel reached SVG).
//
// Future pixel-diff coverage can layer on top once CI is generating
// Linux-side baselines as part of an --update-snapshots step.

const SUBSECTOR_SEED = '51966' // 0xCAFE

test.describe('surface convergence regression', () => {
  test('subsector view is structurally stable for seed 51966', async ({ page }) => {
    await page.goto(`/#sub=${SUBSECTOR_SEED}&view=subsector`)
    await expect(page.locator('.planet-canvas')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.subsector-map')).toBeVisible({ timeout: 30_000 })

    // A full 32×40 sector (1280 hexes) at ~50% density lands near ~640
    // occupied for a stable seed. The exact count is part of the generator's
    // contract; if it drifts, this test fails and the dev confirms the change
    // is intentional before re-pinning the bounds.
    await expect.poll(
      () => page.locator('.hex-occupied').count(),
      { timeout: 15_000 },
    ).toBeGreaterThan(450)
    await expect.poll(() => page.locator('.hex-occupied').count()).toBeLessThan(900)
    await expect.poll(() => page.locator('.polity-capital').count()).toBeGreaterThan(0)
    await expect.poll(() => page.locator('.jump-route').count()).toBeGreaterThan(0)
  })

  test('surface map shows biome-coloured land', async ({ page }) => {
    await page.goto(`/#sub=${SUBSECTOR_SEED}&view=subsector`)
    await expect(page.locator('.subsector-map')).toBeVisible({ timeout: 30_000 })
    const firstOccupied = page.locator('.hex-occupied').first()
    await firstOccupied.waitFor({ state: 'visible' })
    // The first occupied hex can be a corner outside the pan/zoom viewport, so
    // dispatch the click directly rather than relying on a pointer hit.
    await firstOccupied.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const surfaceTab = page.getByRole('tab', { name: /cepheus hex world map/i })
    await expect(surfaceTab).toBeEnabled({ timeout: 15_000 })
    await surfaceTab.click({ force: true })
    await expect(page.locator('.surface-map')).toBeVisible({ timeout: 15_000 })

    // Keep the overlay at a readable paper-chart density. The terrain
    // background can stay detailed, but the pickable hex grid should
    // remain much coarser than the pre-bake.
    await expect.poll(
      () => page.locator('.surface-hex').count(),
      { timeout: 15_000 },
    ).toBeGreaterThan(700)
    await expect.poll(() => page.locator('.surface-hex').count()).toBeLessThan(1_400)

    // The biome-coloured background is a PNG `<image>` rendered from
    // the shared palette. Wait until its data URL is populated.
    await expect.poll(
      async () => await page.locator('.surface-map image').first().getAttribute('href'),
      { timeout: 15_000 },
    ).toMatch(/^data:image\/png/)

    // Biome variety: at least one cell must classify as a land biome
    // (Forest / Plain / Grassland / Hill / Desert). If the biome
    // channel disappeared or got remapped, every cell would read as
    // Ocean / Ice / Tundra and this would fail.
    const landSelectors = ['Forest', 'Plain', 'Grassland', 'Hill', 'Desert']
      .map((name) => `svg g[role="button"][aria-label*="${name}"]`)
      .join(', ')
    const landCount = await page.locator(landSelectors).count()
    expect(landCount, 'at least one land biome hex must exist').toBeGreaterThan(0)
  })
})
