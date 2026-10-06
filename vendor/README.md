# Vendored libraries (no CDN, no build step)

| Directory | Library | Version | License | Source |
|---|---|---|---|---|
| `rough/` | rough.js (`bundled/rough.esm.js`) | 4.6.6 | MIT (`rough/LICENSE`) | npm `roughjs@4.6.6` |
| `opentype/` | opentype.js (`dist/opentype.mjs`) | 2.0.0 | MIT (`opentype/LICENSE`) | npm `opentype.js@2.0.0` |
| `mathjax/` | MathJax 3 (`es5/node-main.js`, `es5/tex-svg.js`, `es5/input/tex.js`, `es5/output/svg.js`, `es5/output/svg/fonts/tex.js`) | 3.2.2 | Apache-2.0 (`mathjax/LICENSE`) | npm `mathjax@3.2.2` |
| `fonts/` | Patrick Hand (`PatrickHand-Regular.ttf`) by Patrick Wagesreiter | 1.003 | SIL OFL 1.1 (`fonts/LICENSE-OFL.txt`) | github.com/google/fonts `ofl/patrickhand` |

Only the files the runtime needs are vendored. Node uses `mathjax/es5/node-main.js` (which loads
`input/tex.js`, `output/svg.js`, `output/svg/fonts/tex.js`); the browser loads `mathjax/es5/tex-svg.js`,
both with the identical configuration set in `shared/math.js`.
Slice 03 may add `vendor/dagre/` (MIT) with its LICENSE.
