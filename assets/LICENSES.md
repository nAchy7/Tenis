# Graphics asset sources and licenses

Verified on 2026-10-11. All downloaded network requests used standard TLS certificate verification. The files below are bundled locally; the application does not depend on their source servers at runtime.

## Poly Haven license verification

Original creator and publisher: **Poly Haven**. License: **CC0 1.0 Universal (public-domain dedication)**, permitting use, modification, and redistribution.

- Canonical publisher license: https://polyhaven.com/license
- Legal dedication: https://creativecommons.org/publicdomain/zero/1.0/
- Independently fetched publisher-owned license-page source: https://raw.githubusercontent.com/Poly-Haven/polyhaven.com/b1a6aa13afc03ae00860f6ac5fe6d5daf8e95356/public/locales/en/license.json
- Publisher-owned page source linking CC0 1.0: https://raw.githubusercontent.com/Poly-Haven/polyhaven.com/b1a6aa13afc03ae00860f6ac5fe6d5daf8e95356/pages/license.tsx

The publisher's license source explicitly states: "Our assets are all licensed as CC0, which is effectively Public Domain even in jurisdictions that do not support the Public Domain." It covers HDRIs, textures, and 3D models. Attribution is appreciated but not required.

The direct Poly Haven and ambientCG sites/CDNs were unavailable from this environment (HTTP proxy 403). Assets were therefore obtained from reachable public GitHub mirrors, with the publisher's CC0 license verified separately from the publisher-owned site source. No unverified ambientCG assets are included.

## Court material: Baseball Playground

Original asset: https://polyhaven.com/a/baseball_playground

This photographic set depicts fine earthy dirt suitable as a clay-court substrate. Its neutral brown albedo is tinted by the game's clay material. It has small granular detail and rake/scuff marks, with no large rocks or broad cracks. It is a real photographic PBR set, not a generated texture.

Mirror source: https://github.com/Papyszoo/CC0-Public-Domain-Textures/tree/84af0b4614c22c9028143da786fe6f9889bfee70/packs/polyhaven-textures/textures/baseball_playground

Mirror provenance and checksums: https://raw.githubusercontent.com/Papyszoo/CC0-Public-Domain-Textures/fcc4ff97a5a843dc2e242ec9e195389bc46ed7d2/packs/polyhaven-textures/store-manifest.json

That manifest names Poly Haven as creator, declares CC0, explicitly identifies the original `baseball_playground` source URL, and pins the source files at `84af0b4614c22c9028143da786fe6f9889bfee70`. The downloaded KTX2 SHA-256 values were checked against that manifest.

Mirror import method: https://raw.githubusercontent.com/Papyszoo/CC0-Public-Domain-Textures/fcc4ff97a5a843dc2e242ec9e195389bc46ed7d2/scripts/fetch-polyhaven-textures.mjs

The importer requests the original 1K maps and selects `nor_gl` before its fallback normal formats. This set's mirror is provided at 512×512 for small GPU memory use. We decoded KTX2 with Three.js's bundled Basis Universal transcoder and exported unmodified decoded RGB pixels to genuine JPEG (quality 95, no chroma subsampling). No upscaling was used. Albedo uses sRGB; normal and roughness are linear data maps. Physical coverage is not supplied by the reachable mirror; a 1.2–1.6 m repeat is an art-direction choice, not a claim about the capture scale.

| Bundled file | Actual format | Dimensions | Bytes | SHA-256 |
|---|---|---|---:|---|
| `assets/clay/clay_color.jpg` | JPEG RGB | 512×512 | 57,865 | `f5f7a948235c2660401c903ec7811836d75d41e48ee8cf54914016a0a00224e7` |
| `assets/clay/clay_normal_gl.jpg` | JPEG RGB | 512×512 | 230,737 | `66540e563f7cb720546f406661b202633532b3416da3668fc27e2211d720b6e2` |
| `assets/clay/clay_roughness.jpg` | JPEG RGB | 512×512 | 69,092 | `1d9e8f47af86919f0e00bd04dcd2be2f652bd34aafbb18d5481bd0991043af99` |

Original mirrored KTX2 files (decoded intermediates are not shipped):

- [baseball_playground_albedo.ktx2](https://raw.githubusercontent.com/Papyszoo/CC0-Public-Domain-Textures/84af0b4614c22c9028143da786fe6f9889bfee70/packs/polyhaven-textures/textures/baseball_playground/baseball_playground_albedo.ktx2) — SHA-256 `2b9ccfdcc46a92538083f74ae0891dd0f9bda25ab7186eef3a0be4c898b96a67`.
- [baseball_playground_normal.ktx2](https://raw.githubusercontent.com/Papyszoo/CC0-Public-Domain-Textures/84af0b4614c22c9028143da786fe6f9889bfee70/packs/polyhaven-textures/textures/baseball_playground/baseball_playground_normal.ktx2) — SHA-256 `19c491876cbe8aa519d81dfb7f33269988a011ce42c55c13b2abf8d6d748844d`.
- [baseball_playground_roughness.ktx2](https://raw.githubusercontent.com/Papyszoo/CC0-Public-Domain-Textures/84af0b4614c22c9028143da786fe6f9889bfee70/packs/polyhaven-textures/textures/baseball_playground/baseball_playground_roughness.ktx2) — SHA-256 `b7e329e9250a3c7bfe94105cf0bb9fc8a2c77fd5da98fd7af965f69b7031835a`.

## Daylight environment: Quarry 01

Original asset: https://polyhaven.com/a/quarry_01

Poly Haven outdoor daylight HDRI, distributed here unchanged as `assets/environment/daylight.hdr`. Downloaded from the official Three.js example asset mirror:

https://raw.githubusercontent.com/mrdoob/three.js/f12e7868b4cb9d491512d7f0f372e329a5d2bc0f/examples/textures/equirectangular/quarry_01_1k.hdr

Actual format: Radiance HDR / RGBE, `FORMAT=32-bit_rle_rgbe`; image header `-Y 512 +X 1024`. Dimensions: **1024×512**. Size: **1,477,951 bytes**. SHA-256: `a3101f0ae89ed847dbed88da3ffa3ddb17b5acf8063099b26ceae08f640eea9b`.

It is intended for reflection and ambient lighting. The application separately renders its own blue sky and direct sun. The HDRI contributes the outdoor color and luminance distribution; it does not replace the sun-shadow light.

## Tree model: Quaternius CommonTree_4

Original creator: **Quaternius**. Asset pack: **Ultimate Nature Pack**. License for this specific legacy pack: **CC0 1.0 Universal**.

- Canonical pack page: https://quaternius.com/packs/ultimatenature.html
- Verified publisher-owned historical pack-page source from 2024-09-23: https://raw.githubusercontent.com/Quaternius/quaternius.github.io/827dca3194430637d3cce52bf62e01e6ba33d6aa/packs/ultimatenature.html
- That specific page explicitly labels the pack **CC0** and links https://creativecommons.org/publicdomain/zero/1.0/.
- Source model mirror and conversion project: https://github.com/trebeljahr/quaternius-showcase
- Pinned model download (unchanged bytes): https://raw.githubusercontent.com/trebeljahr/quaternius-showcase/60a0ad906b2b72667e76b1355122ae5f5c85ab29/public/glb/nature_pack/CommonTree_4.glb
- Mirror import commit: https://github.com/trebeljahr/quaternius-showcase/commit/60a0ad906b2b72667e76b1355122ae5f5c85ab29 (2022-12-06; "Split up glb files into folders").

The historical pack page, rather than Quaternius's newer general license page, establishes the CC0 dedication for this legacy pack. This model was already mirrored in 2022. The newer general license applies to newer releases and is not used as the license evidence for this file.

Bundled path: `assets/vegetation/tree.glb`. Actual format: binary glTF 2.0 / GLB, generated by FBX2glTF v0.9.7. Size: **76,780 bytes**. SHA-256: `054cc2c5c4bf4071df577646ce32aadc05e04ae4cd87e43484586d2377f5f6bf`.

The file contains **2 nodes**, **1 mesh**, **3 triangle primitives**, **3 opaque materials** (`Wood`, `Green`, `DarkGreen`), and **1,351 triangles** total. It contains no image textures, external URIs, animations, skins, or required glTF extensions; all geometry and material colors are embedded. Thirty instances total 40,530 model triangles. Materials are recolored and made matte at runtime for the game lighting.

The original node has a 100× scale and a −90° X rotation, which GLTFLoader applies. Measured world-space bounds after loading: minimum `[-1.102151, -0.109857, -1.118350]`; maximum `[0.476495, 2.674581, 0.682347]`; overall size `[1.578646, 2.784438, 1.800697]`. The runtime normalizes the foot to the ground and places instances independently.

A rendered local preview confirmed a shaped asymmetrical crown, two separate foliage masses, and a branching trunk. It remains a deliberately low-poly untextured tree; it improves silhouette and branching rather than adding detailed leaf textures.
