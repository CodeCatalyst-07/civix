import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "sharp"],
  outputFileTracingIncludes: {
    "/api/analyze": [
      "./scripts/documents/parser.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
    ],
  },
};

export default nextConfig;
