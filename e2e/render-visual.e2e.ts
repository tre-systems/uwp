import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

// Per-body-class visual regression for the WebGPU renderer.
//
// Headless Chromium can't composite the WebGPU canvas into a page screenshot
// (it captures black), so each case reads the rendered frame straight back from
// the GPU (window.uwp.readPixels) after freezing it at a fixed sim-time
// (window.uwp.setFrozen) — a byte-stable capture independent of the DOM. The
// raw RGBA is wrapped in a PNG and compared to a committed baseline.
//
// Run on demand with `npm run test:visual` — it's excluded from the pre-push
// e2e gate (and CI doesn't run e2e), so baselines are generated and compared on
// the same machine. After an *intentional* render change, regenerate with
//   npm run test:visual -- --update-snapshots
// and eyeball the diff before committing.

interface BodyTarget {
  kind: 'planet' | 'star' | 'belt'
  index: number
}

// Fixed sim-time for the frozen frame. Any constant works; the freeze hook
// makes time + rotation a pure function of this value.
const FREEZE_MS = 4000

interface Case {
  name: string
  seed: number
  target: BodyTarget
  bodyType?: string // expected planet body_type, for self-validation
  nonTerrain?: boolean // body renders with a non-zero body_visual_mode (giant/star/belt)
}

// Body indices are all NON-main-world, so focusing them applies the body's own
// render mode (focusSystemTarget) rather than the main-world terrain fallback.
const CASES: Case[] = [
  { name: 'terrain-ocean', seed: 11, target: { kind: 'planet', index: 4 }, bodyType: 'Terrestrial' },
  { name: 'frozen', seed: 4, target: { kind: 'planet', index: 4 }, bodyType: 'Frozen' },
  { name: 'gas-giant', seed: 11, target: { kind: 'planet', index: 7 }, bodyType: 'GasGiant', nonTerrain: true },
  { name: 'ice-giant', seed: 4, target: { kind: 'planet', index: 5 }, bodyType: 'IceGiant', nonTerrain: true },
  { name: 'mini-neptune', seed: 4, target: { kind: 'planet', index: 3 }, bodyType: 'MiniNeptune', nonTerrain: true },
  { name: 'star', seed: 4, target: { kind: 'star', index: 0 }, nonTerrain: true },
  { name: 'asteroid-belt', seed: 4, target: { kind: 'belt', index: 0 }, nonTerrain: true },
]

// Tagged @visual so the pre-push e2e gate (`test:e2e`) skips it — it's slow
// (per-case cold load + readback). Run it deliberately on render changes.
test.describe('render visual regression @visual', () => {
  for (const c of CASES) {
    test(`${c.name} renders a stable frame`, async ({ page }) => {
      // Cold load generates a default sector and the system regenerates per
      // seed — heavy work; give the case 3× the default budget.
      test.slow()
      await page.setViewportSize({ width: 800, height: 600 })
      await page.goto('/')
      await expect(page.locator('.planet-canvas')).toBeVisible({ timeout: 30_000 })

      // The cold load generates a default sector and auto-selects a system a few
      // seconds in. Wait for that selection to settle (two equal reads) before
      // setting our own seed, or the late selection overrides it.
      let prevSeed: number | null = null
      await expect
        .poll(
          async () => {
            const cur = await page.evaluate(() => window.uwp?.getSystem()?.seed ?? null)
            const settled = cur != null && cur === prevSeed
            prevSeed = cur
            return settled
          },
          { timeout: 60_000, intervals: [800] },
        )
        .toBe(true)

      // Generate the target system (a distinct seed, so the signal actually
      // changes and the renderer regenerates), then wait for the renderer.
      await page.evaluate((seed) => window.uwp?.setSeed(seed), c.seed)
      await expect
        .poll(() => page.evaluate(() => window.uwp?.getSystem()?.seed ?? null), { timeout: 30_000 })
        .toBe(c.seed)
      await assertBodyClass(page, c)
      // Re-focus until the renderer reports the body's render mode. focusBody
      // reads the currentSystem signal, which can briefly trail getSystem();
      // until it catches up, a giant focuses the stale main world (terrain,
      // mode 0). Retrying until a non-terrain body reports a non-zero
      // body_visual_mode makes the focus deterministic.
      await expect
        .poll(
          async () => {
            await page.evaluate((target) => window.uwp?.focusBody(target), c.target)
            const mode = await page.evaluate(() => window.uwp?.detailMode() ?? 0)
            return c.nonTerrain ? mode !== 0 : mode === 0
          },
          { timeout: 20_000, intervals: [400, 400, 600] },
        )
        .toBe(true)

      // Detail view makes the canvas GPU-active (drops the inert class).
      await expect(page.locator('.planet-canvas.planet-canvas-inert')).toHaveCount(0, { timeout: 20_000 })

      await openPanel(page)
      await waitForChartIdle(page) // body + surface generation finished
      await pinHighQuality(page)
      await waitForChartIdle(page)

      // Freeze → identical frame every tick; let a couple of frames present.
      await page.evaluate((ms) => window.uwp?.setFrozen(ms), FREEZE_MS)
      await page.waitForTimeout(500)

      const frame = await captureFrame(page)
      expect(frame).toMatchSnapshot(`${c.name}.png`, { maxDiffPixelRatio: 0.02, threshold: 0.2 })
    })
  }
})

// Read the frozen GPU frame back as RGBA8 and wrap it in a PNG buffer. The bytes
// are base64'd in the page to cross the evaluate boundary cheaply.
async function captureFrame(page: Page): Promise<Buffer> {
  const shot = await page.evaluate(async () => {
    const { width, height, data } = await window.uwp!.readPixels()
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < data.length; i += CHUNK) {
      bin += String.fromCharCode(...data.subarray(i, Math.min(i + CHUNK, data.length)))
    }
    return { width, height, b64: btoa(bin) }
  })
  const png = new PNG({ width: shot.width, height: shot.height })
  Buffer.from(shot.b64, 'base64').copy(png.data)
  return PNG.sync.write(png)
}

async function assertBodyClass(page: Page, c: Case) {
  const info = await page.evaluate(() => {
    const sys = window.uwp?.getSystem()
    return {
      planets: (sys?.planets ?? []).map((p) => p.body_type),
      belts: sys?.belts?.length ?? 0,
      hasStar: Boolean(sys?.star),
    }
  })

  if (c.target.kind === 'planet') {
    expect(info.planets[c.target.index], `${c.name}: planet ${c.target.index} body_type`).toBe(c.bodyType)
  } else if (c.target.kind === 'belt') {
    expect(info.belts, `${c.name}: belt count`).toBeGreaterThan(c.target.index)
  } else {
    expect(info.hasStar, `${c.name}: star present`).toBe(true)
  }
}

async function openPanel(page: Page) {
  const expanded = await page.getByRole('button', { name: /show controls|hide controls/i }).getAttribute('aria-expanded')
  if (expanded !== 'true') {
    await page.getByRole('button', { name: /show controls/i }).click()
  }
  await expect(page.locator('#controls-panel')).toBeVisible()
}

// Panel controls are disabled while chart work (system load + body/surface
// generation) is pending. Waiting for the always-present glossary button to
// re-enable means the body has finished generating and is being rendered.
async function waitForChartIdle(page: Page) {
  await expect(page.locator('#controls-panel .glossary-trigger')).toBeEnabled({ timeout: 30_000 })
}

async function pinHighQuality(page: Page) {
  const panel = page.locator('#controls-panel')
  const high = panel.locator('button.quality-segment').filter({ hasText: 'High' })
  await expect(high).toBeEnabled()
  // Fire via JS so a clipped segment under the panel scrollbar can't block it.
  await high.evaluate((el) => (el as HTMLButtonElement).click())
  await expect(panel.locator('.perf-profile')).toContainText('High')
}
