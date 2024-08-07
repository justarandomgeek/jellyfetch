#!/usr/bin/env node

import { Item, Jellyfin } from './jellyfin.js';
import { JFetch } from './jfetch.js';

import { program } from 'commander';
import * as inquirer from "@inquirer/prompts";

import { filesize } from 'filesize';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { posix as path } from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
const pipelineAsync = promisify(pipeline);
import progress_stream from "progress-stream";
import cliprog, { MultiBar } from "cli-progress";
import * as async from 'async';
import { makeNfo } from './nfowriter.js';

async function getAuthedJellyfinApi(server:string) {
  const jserver = await Jellyfin.getApiSession(
    server,
    undefined,
    async ()=>{
      return {
        username: await inquirer.input({
          message: "Username:",
        }),
        password: await inquirer.password({
          message: "Password:",
        }),
      };
    });
  return new JFetch(jserver);
}



const bars = Object.assign(new MultiBar({
  format: '[{bar}] | {percentage}% | {value} / {total} | {filename}  {speed}',
  formatValue: function(v, options, type) {
    switch (type) {
      case 'value':
      case 'total':
        return filesize(v).padStart(10);
      default:
        return cliprog.Format.ValueFormat(v, options, type);
    }
  },
  autopadding: true,
  forceRedraw: true,
}), {
  create_count: function(total:number, message:string, startValue:number=0, payload?:any, options?:cliprog.Options) {
    return bars.create(total, startValue,
      Object.assign({}, payload),
      Object.assign<cliprog.Options, cliprog.Options|undefined>({
        format: `[{bar}] | {percentage}% | {value}    / {total}    | ${message}`,
        formatValue: function(v, options, type) {
          switch (type) {
            case 'total':
              if (v===0) { return "?".padStart(7); }
            case 'value':
              return v.toString().padStart(7);
            default:
              return cliprog.Format.ValueFormat(v, options, type);
          }
        },
        emptyOnZero: true,
      }, options));
  },
});

function toHHMMSS(totalseconds:number) {
  const hours   = Math.floor(totalseconds / 3600);
  const minutes = Math.floor(totalseconds / 60) % 60;
  const seconds = totalseconds % 60;

  return [hours, minutes, seconds]
    .map(v=>v < 10 ? "0" + v : v)
    .filter((v, i)=>v !== "00" || i > 0)
    .join(":");
}

async function writeFileProgress(dest:string, file:string, data:string|Promise<NodeJS.ReadableStream>, size?:number) {
  const filepath = path.join(dest, file);
  const filename = path.basename(file);
  const dir = fsp.mkdir(path.dirname(filepath), {recursive: true});
  const bar = size && size > (1024*1024) && typeof data !== "string" &&
    bars.create(size, 0, {speed: "", filename: filename});
  const ps = progress_stream( 
    { time: 200 },
    progress=>bar && bar.update(progress.transferred, {speed: filesize(progress.speed)+"/s", filename: filename})
  );
  await dir;
  try {
    await pipelineAsync(await data, ps, fs.createWriteStream(filepath+".tmp"));
    await fsp.rename(filepath+".tmp", filepath);
  } catch (error) {
    try {
      fsp.unlink(filepath+".tmp");
    } catch (error) {

    }
  }
  const progress = ps.progress();
  if (bar) {
    bar.stop();
    bars.remove(bar);
  }
  bars.log(`${filesize(progress.transferred).padStart(10)} ${toHHMMSS(progress.runtime).padStart(8)}  ${file}\n`);
}

type FetchType = "nfo"|"media"|"image"|"external";
export abstract class FetchTask {
  abstract readonly type:FetchType; 
  constructor (
    readonly destpath:string,
  ) {}

  protected abstract get data() : string|Promise<NodeJS.ReadableStream>;
  public abstract get size() : number|undefined;

  public async Execute(dest:string) {
    return writeFileProgress(dest, this.destpath, this.data, this.size);
  }
}

export class NfoTask extends FetchTask {
  readonly type = "nfo";
  readonly data:string;

  constructor(
    readonly destpath:string,
    item:Item,
  ) {
    super(destpath);
    this.data = makeNfo(item);
  }

  public get size() {
    return this.data.length;
  }
}

export abstract class BaseStreamTask extends FetchTask {
  constructor(
    readonly destpath:string,
    private readonly datareq:()=>Promise<NodeJS.ReadableStream>,
    private readonly _size?: number,
  ) {
    super(destpath);
  }

  private _data?:Promise<NodeJS.ReadableStream>;
  protected get data() { 
    if (!this._data) {
      this._data = this.datareq();
    }
    return this._data; 
  }
  public get size() { return this._size; }
}

export class MediaTask extends BaseStreamTask {
  readonly type = "media";
}

export class ImageTask extends BaseStreamTask {
  readonly type = "image";
}

export class ExternalStreamTask extends BaseStreamTask {
  readonly type = "external";
}



type ProgramOptions = {
  dest:string
  list:boolean
  shallow:boolean
} & {[f in FetchType]:boolean};

program
  .version('0.0.1')
  .description("download content from a jellyfin server")
  .argument("<server>", "Base url of the server")
  .argument("<ids...>", "ItemIDs to fetch.")
  .option("-d, --dest <destination>", "Destination folder", ".")
  .option("-l, --list", "List files that will be downloaded.")
  .option("-s, --shallow", "When fetching Series or Season items, fetch only the specified item, not children.")
  .option("-n, --no-nfo", "Skip Nfo files.")
  .option("-m, --no-media", "Skip Media files.")
  .option("-i, --no-image", "Skip Image files.")
  .option("-x, --no-external", "Skip external media streams (usually subs).")

  .action(async (server:string, ids:string[])=>{
    const opts = program.opts<ProgramOptions>();
    const jfetch = await getAuthedJellyfinApi(server);

    const items = await Promise.all(ids.map(id=>jfetch.fetchItemInfo(id)));

    items.map(item=>{
      let message = item.Id;
      if (item.Type) { message += " " + item.Type; }
      if (item.SeriesName) { message += " " + item.SeriesName; }
      if (item.SeasonName) { message += " " + item.SeasonName; }
      if (item.Name) { message += " " + item.Name; }
      if (item.RecursiveItemCount) {
        message += ` [${item.RecursiveItemCount} items]`;
      }
      console.log(message);
    });

    let ptasks = [];
    const tbar = bars.create_count(0, "Collecting metadata...");
    for (const item of items) {
      for await (const task of jfetch.fetchItem(item, opts.shallow)) {
        if (opts[task.type]) {
          ptasks.push(fsp.stat(path.join(opts.dest, task.destpath))
            .catch(()=>undefined)
            .then(stat=>{
              tbar.increment();
              return {task: task, stat: stat};
            }));
        }
      }
    }

    let tasks = await Promise.all(ptasks);
    tbar.stop();
    bars.remove(tbar);
    bars.stop();

    if (opts.list) {
      tasks = (await inquirer.checkbox({
        message: `Files to download:`,
        loop: false,
        choices: tasks.map(task=>{
          const tasksize = 
            task.stat ? `${filesize(task.stat.size)} => ${task.task.size ? filesize(task.task.size): 'unknown'}` :
            task.task.size ? filesize(task.task.size) :
            '';
          return {
            name: `${task.task.destpath} ${tasksize}`,
            value: task,
            checked: !task.stat,
          };
        }),
      }));
    } else {
      const withstats = tasks.filter(t=>t.stat);
      if (withstats.length > 0) {
        const overwrite: typeof withstats = (await inquirer.checkbox({
          message: "Overwrite existing files?",
          loop: false,
          choices: withstats.map(t=>{
            return {
              name: `${t.task.destpath} ${filesize(t.stat!.size)} => ${t.task.size ? filesize(t.task.size): 'unknown'}`,
              value: t,
            };
          }),
        }));
        const skip = withstats.filter(s=>!overwrite.includes(s));
        tasks = tasks.filter(t=>!skip.includes(t));
      }

      if (!(await inquirer.confirm({
        message: `Download ${filesize(tasks.reduce((a, b)=>(a)+(b.task.size??0), 0))}?`,
      }))) {
        return;
      }
    }

    const grouped_tasks = tasks.map(t=>t.task).reduce(function (r, a) {
      r[a.type] = r[a.type] || [];
      r[a.type].push(a);
      return r;
    }, <{[k in FetchType]:FetchTask[]}>{} );

    const qs = [];
    for (const key in grouped_tasks) {
      if (Object.prototype.hasOwnProperty.call(grouped_tasks, key)) {
        const type = key as FetchType;
        const tasks = grouped_tasks[type];
        if (opts[type] && tasks.length > 0) {
          const tbar = bars.create_count(tasks.length, type);
          const q = async.queue<FetchTask>(async(task)=>{
            await task.Execute(opts.dest);
            tbar.increment();
          }, 1);
          q.push(tasks);
          q.drain(()=>{
            tbar.stop();
            bars.remove(tbar);
          });
          qs.push(q);
        }
      }
    }

    await Promise.all(qs.map(q=>q.drain()));
    bars.stop();
  })
  .parseAsync();