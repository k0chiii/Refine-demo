import { describe, expect, it } from "vite-plus/test";
import { outsideShell, shellPrecache } from "../../pwa/shellPrecache";

describe("service worker shell precache", () => {
  it("puts only the entry, its static imports and their CSS in the shell", () => {
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

  it("preloads every JS and CSS and the icon font outside the shell and only carries the other hashed files", () => {
    const bundle = {
      "assets/index-abc.js": {
        type: "chunk",
        isEntry: true,
        imports: [],
        viteMetadata: { importedCss: new Set(["assets/index-abc.css"]) },
      },
      "assets/index-abc.css": { type: "asset" },
      "assets/route-make-ghi.js": { type: "chunk", isEntry: false, imports: [] },
      "assets/route-make-jkl.css": { type: "asset" },
      "assets/pdf.worker-xyz.mjs": { type: "asset" },
      "assets/noto-sans-jp-12-uvw.woff2": { type: "asset" },
      "assets/material-symbols-subset-mno.woff2": { type: "asset" },
      "sw.js": { type: "asset" },
    };
    const precache = shellPrecache(bundle, ["/manifest.webmanifest"]);
    expect(outsideShell(bundle, precache)).toEqual({
      preload: [
        "/assets/material-symbols-subset-mno.woff2",
        "/assets/route-make-ghi.js",
        "/assets/route-make-jkl.css",
      ],
      carry: ["/assets/noto-sans-jp-12-uvw.woff2", "/assets/pdf.worker-xyz.mjs"],
    });
  });
});
