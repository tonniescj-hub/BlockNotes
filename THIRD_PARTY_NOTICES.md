# Third-party notices

This source repository and the local Minecraft resource pack have separate origins and permissions.

## BlockNotes project code

Original project code is licensed under the root `LICENSE` (MIT).
Third-party material retains its own notices and terms; the project MIT license
does not extend to Minecraft game assets. The generated application icon's
provenance is recorded in `docs/icon-design.md`.
BlockNotes is not an official Minecraft product and is not approved by or
associated with Mojang or Microsoft.

## PrismarineJS / prismarine-viewer

The six face corner/UV definitions in `src/minecraft/model.ts` are adapted from `viewer/lib/models.js`, upstream commit `8a3ce60b40f1ff7a26422a8f8904fbedbe808688` (checked 2026-10-09).
Source: https://github.com/PrismarineJS/prismarine-viewer/tree/8a3ce60b40f1ff7a26422a8f8904fbedbe808688

MIT License

Copyright (c) 2020 PrismarineJS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Renderer and editor packages

React 19.3.0, React DOM 19.3.0, Three.js 0.180.0, react-three-fiber 9.8.1,
Tiptap 3.31.4 / ProseMirror and their production dependency licenses are retained
in `docs/licenses/`. `scripts/collect-licenses.mjs` reproduces this inventory from
the installed locked dependency tree. Electron 44.7.0 retains its LICENSE and
LICENSES.chromium.html beside the executable. Pixel font conversion uses
opentype.js 2.0.0 (MIT) and pngjs 7.0.0 (MIT) in the packaged first-launch worker
and development tooling. Resource archive parsing uses yauzl 3.4.0 (MIT).
Their licenses are retained in `docs/licenses/`; none grants permission to
redistribute game assets.

## Streaming backup dependencies

`stream-json` 3.7.0 and `stream-chain` 4.2.6 are used for streamed JSON parsing
in a Node worker, without importing gameplay systems. Their BSD-3-Clause
license texts are retained in `docs/licenses/`. Upstream parser and assembler
API reference: https://github.com/uhop/stream-json/wiki/Assembler

## Local game resource pack

The ignored `public/minecraft/` folder is extracted from the official Minecraft
Java Edition 1.21 client for this user's local visual research and personal prototype.
It is not covered by the MIT licenses above. Minecraft assets and marks retain
their Mojang / Microsoft rights. No public redistribution authorization is asserted.
Default build packaging excludes `dist/minecraft/**`; the explicitly named local
build copies the separate resource pack into `resources/minecraft`. Nothing has
been published or uploaded.

Official client: https://piston-data.mojang.com/v1/objects/0e9a07b9bb3390602f977073aa12884a4ce12431/client.jar
SHA-1: `0e9a07b9bb3390602f977073aa12884a4ce12431`.

The local DOM bitmap font is regenerated from the client's Latin bitmap and
GNU Unifont 15.1.05 glyph source from the official Minecraft asset index. Its
Unifont license (GPL v2 or later with font embedding exception; compiled fonts
also offer SIL OFL 1.1) and glyph source accompany the local pack in `font/`.
This converted combination also contains the original game Latin glyphs and
is not represented as an independently licensed public font.
Source asset SHA-1: `666999116c467f10622db1527a06ddc0a6efad2a`.

The local sound pack also contains 17 unmodified original OGG samples selected
from Minecraft 1.21 asset index 17. Original `sounds.json` SHA-1:
`09eab141cce7550f9a74c65db0e9abbb342cf50f`. Each OGG hash and original event
definition is retained in the ignored `sounds/manifest.json`; the download script
checks it against the official resource index. These recordings are original
game assets, not software licensed under the dependency MIT notices.

User-supplied screenshots are design references; no screenshot is used as the
room background or shipped as a texture.


## Reading documents (2026-11-13)

PDF.js (`pdfjs-dist` 6.5.438, Apache-2.0), Mammoth (1.13.0, BSD-2-Clause), docx (9.15.3, MIT), sanitize-html (2.18.2, MIT), and Cheerio (1.2.0, MIT) are used as dependencies. Their original license texts and production dependency notices are retained in `docs/licenses/`; sources and reuse scope are recorded in `docs/reuse-map.md`. PDF.js CMaps, standard fonts and WebAssembly resources remain third-party assets under their accompanying upstream terms. No third-party books or user documents are bundled.
