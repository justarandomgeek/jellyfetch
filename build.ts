import * as fsp from 'fs/promises';
import { build, analyzeMetafile, BuildOptions, context } from "esbuild";

import { program } from 'commander';

program
  .option("--map")
  .option("--watch")
  .option("--meta")
  .option("--minify")
  .option("--analyze")
  .action(async (options: { map?: boolean; watch?: boolean; meta?: boolean; minify?: boolean; analyze?: boolean })=>{
    const buildopts:BuildOptions = {
      tsconfig: "./tsconfig.json",
      entryPoints: {
        index: "./src/index.ts",
      },
      platform: "node",
      bundle: true,
      format: "cjs",
      outdir: "dist",
      logLevel: "info",
      sourcemap: options.map,
      sourcesContent: false,
      metafile: options.meta || options.analyze,
      minify: options.minify,
      plugins: [],
    };
  
    if (options.watch) {
      await (await context(buildopts)).watch();
    } else {
      const result = await build(buildopts).catch(()=>process.exit(1));
      if (options.meta) {
        await fsp.writeFile('./out/meta.json', JSON.stringify(result.metafile));
      }
      if (options.analyze) {
        console.log(await analyzeMetafile(result.metafile!, { color: true, verbose: true }));
      }
    }
  }).parseAsync();