# Typography

- UI: [Pretendard Variable v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9), using the official dynamic subset stylesheet on jsDelivr. See the [SIL OFL 1.1 license](https://github.com/orioncactus/pretendard/blob/v1.3.9/LICENSE).
- Circuit notation: [Libertinus Math v7.051](https://github.com/alerque/libertinus/releases/tag/v7.051), using the original `static/WOFF2/LibertinusMath-Regular.woff2` from the pinned commit URL in `index.ts`. Its SHA-256 is `28dfeb45e0b34d2c2dbc970b0bcebb0b22f745f90bb37a245a4313264e87c963`. The source copy is used by tests. The license is in [OFL.txt](OFL.txt).
- The app registers the downloaded Libertinus Math bytes as a browser font. Standalone SVG and the SVG used for PNG and 3D textures embed those same bytes. Output layout uses the in-page font and synchronous geometry.
