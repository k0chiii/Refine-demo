import { describe, expect, it } from "vite-plus/test";
import { carriedAssets, shellPrecache } from "../../pwa/shellPrecache";

describe("service worker shell precache", () => {
  it("installs the entry shell and leaves route chunks to the runtime cache", () => {
    const list = shellPrecache(
      {
        "assets/index-abc.js": {
          type: "chunk",
          isEntry: true,
          imports: ["assets/vendor-def.js"],
          viteMetadata: { importedCss: new Set(["assets/index-abc.css"]) },
        },
        "assets/vendor-def.js": {
          type: "chunk",
          isEntry: false,
          imports: [],
          viteMetadata: { importedCss: new Set(["assets/vendor-def.css"]) },
        },
        "assets/route-make-ghi.js": {
          type: "chunk",
          isEntry: false,
          imports: [],
          viteMetadata: { importedCss: new Set(["assets/route-make.css"]) },
        },
        "assets/index-abc.css": { type: "asset" },
        "assets/pdf.worker-xyz.js": { type: "asset" },
      },
      ["/manifest.webmanifest", "/icons/icon-192.png"],
    );
    expect(list).toEqual([
      "/index.html",
      "/assets/index-abc.css",
      "/assets/index-abc.js",
      "/assets/vendor-def.css",
      "/assets/vendor-def.js",
      "/manifest.webmanifest",
      "/icons/icon-192.png",
    ]);
  });

  it("carries the hashed files outside the shell over from the previous version", () => {
    const bundle = {
      "assets/index-abc.js": {
        type: "chunk",
        isEntry: true,
        imports: [],
        viteMetadata: { importedCss: new Set(["assets/index-abc.css"]) },
      },
      "assets/index-abc.css": { type: "asset" },
      "assets/route-make-ghi.js": { type: "chunk", isEntry: false, imports: [] },
      "assets/pdf.worker-xyz.mjs": { type: "asset" },
      "assets/noto-sans-jp-12-uvw.woff2": { type: "asset" },
      "sw.js": { type: "asset" },
    };
    const precache = shellPrecache(bundle, ["/manifest.webmanifest"]);
    expect(carriedAssets(bundle, precache)).toEqual([
      "/assets/noto-sans-jp-12-uvw.woff2",
      "/assets/pdf.worker-xyz.mjs",
      "/assets/route-make-ghi.js",
    ]);
  });
});
