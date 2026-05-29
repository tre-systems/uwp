import { expect, test, type Page } from '@playwright/test'

// A small T5SS tab-delimited paste (tabs explicit). All worlds sit in
// subsector A, so the import collapses to a single 8×10 grid.
const SAMPLE = [
  'Hex\tName\tUWP\tBases\tRemarks\tZone\tPBG\tAllegiance',
  '0101\tAlpha\tA788899-A\t\tGa\t\t613\tImDi',
  '0102\tBeta\tC4207B9-A\t\tDe\tA\t603\tImDi',
  '0203\tGamma\tB563664-B\tKM\tNi Ri\t\t910\tNaHu',
].join('\n')

test('imports pasted T5SS data, renders it, and opens an imported world', async ({ page }) => {
  await page.goto('/#view=detail')
  await expect(page.locator('.planet-canvas')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('tab', { name: /browse the subsector hex grid/i }).click({ force: true })
  await expect(page.locator('.subsector-map')).toBeVisible({ timeout: 30_000 })

  const panel = await openControls(page)
  await panel.getByRole('button', { name: 'Import…' }).click()
  await panel.locator('#sector-import-textarea').fill(SAMPLE)
  await panel.getByRole('button', { name: 'Import', exact: true }).click()

  // Exactly the three pasted worlds, flagged as imported.
  await expect.poll(() => page.locator('.hex-occupied').count()).toBe(3)
  await expect(panel.locator('.sys-source-tag')).toContainText('Imported')
  await expect(page.locator('.hex-occupied[data-coord="0101"]')).toHaveCount(1)
  await expect(page.locator('.hex-occupied[data-coord="0203"]')).toHaveCount(1)

  // The imported UWP survives a round-trip into the hex's accessible label.
  await expect(page.locator('.hex-occupied[data-coord="0101"]')).toHaveAttribute(
    'aria-label',
    /A788899-A/,
  )

  // Drilling into an imported world opens its (synthesized) system view.
  await page
    .locator('.hex-occupied[data-coord="0101"]')
    .evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await expect(
    page.getByRole('tab', { name: /overview of the current solar system/i }),
  ).toHaveAttribute('aria-selected', 'true')
})

async function openControls(page: Page) {
  const toggle = page.getByRole('button', { name: /show controls/i })
  if ((await toggle.count()) > 0) await toggle.click()
  const panel = page.locator('#controls-panel')
  await expect(panel).toBeVisible()
  return panel
}
