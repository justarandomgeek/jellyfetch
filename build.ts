import * as fsp from 'fs/promises';
import { build, analyzeMetafile } from "esbuild";

import { program } from 'commander';

program
  .option("--map")
  .option("--watch")
  .option("--meta")
  .option("--minify")
  .option("--analyze")
  .action(async (options: { map?: boolean; watch?: boolean; meta?: boolean; minify?: boolean; analyze?: boolean })=>{
    const result = await build({
      tsconfig: "./tsconfig.json",
      entryPoints: {
        index: "./src/index.ts",
      },
      external: [
        "keytar",
      ],
      platform: "node",
      bundle: true,
      format: "cjs",
      outdir: "dist",
      logLevel: "info",
      watch: options.watch,
      sourcemap: options.map,
      sourcesContent: false,
      metafile: options.meta || options.analyze,
      minify: options.minify,
      plugins: [],
    }).catch(()=>process.exit(1));
    if (options.meta) {
      await fsp.writeFile('./out/meta.json', JSON.stringify(result.metafile));
    }
    if (options.analyze) {
      console.log(await analyzeMetafile(result.metafile!, { color: true, verbose: true }));
    }
  }).parseAsync();