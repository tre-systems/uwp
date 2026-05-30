// A small, self-contained sample sector in canonical T5SS tab-delimited form.
// Used by the import panel's "Load sample" button and mirrored in
// docs/sector-data-format.md. Every world is invented; names and allegiance
// codes are deliberately neutral.

const HEADER = [
  'Sector', 'SS', 'Hex', 'Name', 'UWP', 'Bases', 'Remarks', 'Zone', 'PBG',
  'Allegiance', 'Stars', '{Ix}', '(Ex)', '[Cx]',
]

function row(
  hex: string,
  name: string,
  uwp: string,
  bases: string,
  remarks: string,
  zone: string,
  pbg: string,
  alleg: string,
  stars: string,
): string {
  return ['Kestrel', 'A', hex, name, uwp, bases, remarks, zone, pbg, alleg, stars, '', '', ''].join('\t')
}

/** Paste-ready sample: a 7-world 8×10 subsector. Mirrors the docs sample. */
export const SAMPLE_SECTOR_TEXT =
  [
    '# Kestrel — sample 8x10 subsector',
    HEADER.join('\t'),
    row('0103', 'Aenir', 'B564789-9', 'N', 'Ag Ni', '', '703', 'Na', 'G2 V'),
    row('0207', 'Boraul', 'C7A5354-8', 'S', 'Fl', 'A', '102', 'Na', 'M0 V'),
    row('0305', 'Cassia', 'A8B5887-C', 'NS', 'Ri', '', '223', 'Na', 'F7 V'),
    row('0408', 'Dovrin', 'E430612-7', '', 'De Po', '', '101', 'Na', 'K1 V'),
    row('0502', 'Ennis', 'X544300-5', '', 'Lo', 'R', '504', 'Na', 'M3 V'),
    row('0609', 'Faltine', 'D200577-8', 'S', 'Va Ni', '', '610', 'Na', 'G8 V'),
    row('0704', 'Gesh', 'B6747A9-A', 'N', 'Ag', '', '823', 'Fd', 'K5 V'),
  ].join('\n') + '\n'
