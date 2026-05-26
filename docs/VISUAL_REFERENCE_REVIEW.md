# Visual Reference Review

This note tracks the image references used to tune the renderer and the
remaining visual gaps. It is deliberately practical: compare against real
targets, land one measurable visual slice, then keep the next mismatches visible.

## Reference Anchors

- Jupiter / gas giants: NASA Juno true-colour Great Red Spot imagery.
  Reference traits: alternating light/dark equatorial bands, turbulent jet
  streaks, pale cloud filaments, one or more anticyclonic ovals, and a warmer
  red/orange storm core.
  <https://science.nasa.gov/photojournal/jupiters-great-red-spot-in-true-color/>
- Uranus / Neptune / ice giants: NASA ice-giant resources, Voyager and Webb
  imagery.
  Reference traits: Uranus is comparatively smooth and light blue-green;
  Neptune is deeper blue, with darker spots and bright methane cloud wisps.
  <https://science.nasa.gov/solar-system/resources/resource-packages/ice-giant-resources/>
- Asteroids: NASA OSIRIS-REx Bennu imagery.
  Reference traits: globally rough rubble-pile silhouette, dense boulders,
  dark low-albedo material, small bright facets / veins, and strong dependence
  on lighting angle.
  <https://science.nasa.gov/resource/bennus-boulders-and-limb-from-detailed-survey/>
- Stars: SDO / photosphere granulation imagery.
  Reference traits: visible convection cells, sunspots in active latitude
  bands, limb darkening, and a hot rim rather than a flat emissive disk.
  <https://scied.ucar.edu/image/photosphere-sunspots-granulation-images>
- Atmosphere research direction: Bruneton precomputed atmospheric scattering
  and Hillaire production atmosphere rendering.
  <https://ebruneton.github.io/precomputed_atmospheric_scattering/>
  <https://diglib.eg.org/items/8a3e5350-18b3-46bd-9274-3add5af88c75>

## Current Renderer Response

- Gas giants, ice giants, and mini-Neptunes now use distinct fluid submodes
  instead of one generic banded shader path.
- Gas giants add jet streaks, a large seeded storm, and smaller storm ovals so
  they read closer to Juno/Hubble Jupiter references.
- Ice giants reduce band contrast, bias toward methane-blue haze, and add sparse
  dark spots / pale cloud wisps so they differ from Jovian gas giants.
- Asteroids add extra silhouette rubble plus high-frequency boulder, pit, and
  vein colour detail to move toward Bennu's rough rubble-pile look.
- Stars add photosphere granulation, sunspot fields, limb darkening, faculae,
  and a subtle rim glow.

## Remaining Gaps

1. **Reference screenshot matrix.** Add automated visual captures for main
   world, hot rocky, cold rocky/super-Earth, gas giant, ice giant,
   mini-Neptune, star, and asteroid. Store small golden images or numeric
   image-quality probes so future shader work does not regress silently.
2. **Physically based atmosphere LUT.** The current atmosphere remains inline
   approximation. A small LUT path would better match Bruneton/Hillaire-style
   multi-scatter without paying the full cost per fragment.
3. **Gas giant flow continuity.** The band/storm shader is still procedural
   texture, not advected flow. Next step: precompute or cheaply sample a
   latitudinal velocity field so storms shear into surrounding jets.
4. **Asteroid geometry density.** The current asteroid silhouette is displaced
   by the sphere mesh. Real Bennu-like rubble needs either a higher-detail
   asteroid mesh profile or a cheap impostor layer for horizon boulders.
5. **Star exposure control.** Stars should drive bloom / glare differently from
   planets. Today the star shader is bright in the planet pass, but the render
   pipeline has no object-aware bloom or exposure adaptation.
6. **Material calibration.** Planet colour palettes should be compared against
   reference histograms, not just eyeballed. Use sampled NASA/JPL imagery to
   tune albedo ranges for Mars-like, icy, carbonaceous, Jovian, and Neptunian
   targets.
