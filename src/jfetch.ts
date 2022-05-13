import { Item, Jellyfin, MediaSource } from "./jellyfin";
import { makeNfo } from './nfowriter.js';
import filesize from 'filesize';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { posix as path } from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
const pipelineAsync = promisify(pipeline);
import progress_stream from "progress-stream";
import cliprog, { SingleBar } from "cli-progress";

const patterns = {
  Movie: "{Name} ({ProductionYear})",
  SeriesFolder: "{Name} ({ProductionYear})",
  SeasonFolder: "{Name}",
  StripChars: /[:*<>\"?|\\\/]/g,
};


async function writeFile(filepath:string, data:string|NodeJS.ReadableStream|Promise<string>|Promise<NodeJS.ReadableStream>) {
  await fsp.mkdir(path.dirname(filepath), {recursive: true});
  return fsp.writeFile(filepath, await data);
}

const bar = new SingleBar({
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
});

async function writeFileProgress(filepath:string, data:NodeJS.ReadableStream|Promise<NodeJS.ReadableStream>, size:number) {
  const dir = fsp.mkdir(path.dirname(filepath), {recursive: true});
  const filename = path.basename(filepath);
  bar.start(size, 0, {speed: "", filename: filename});
  const ps = progress_stream( 
    {length: size, time: 200 },
    progress=>bar.update(progress.transferred, {speed: filesize(progress.speed)+"/s", filename: filename})
  );
  await dir;
  await pipelineAsync(await data, ps, fs.createWriteStream(filepath));
  const progress = ps.progress();
  bar.update(progress.transferred, {speed: filesize(progress.speed)+"/s", filename: filename});
  bar.stop();
}

export class JFetch {
  constructor(
    readonly jserver:Jellyfin,
    readonly dest:string,
    readonly list?:boolean,
    readonly nfo?:boolean,
    readonly shallow?:boolean
  ) {}

  readonly seenItems = new Map<string, Item>();

  
  async fetchItemInfo(id:string) {
    let item = this.seenItems.get(id);
    if (!item) {
      item = await this.jserver.getItem(id);
      this.seenItems.set(id, item);
    }
    return item;
  }

  async ItemPath(itemSpec:Item|string) {
    const item =  (typeof itemSpec === 'string') ? await this.fetchItemInfo(itemSpec) : itemSpec;
    let pattern:string;
    switch (item.Type) {
      case "Series":
        pattern = patterns.SeriesFolder;
        break;
      case "Season":
        pattern = patterns.SeasonFolder;
        break;
      case "Movie":
        pattern = patterns.Movie;
        break;
      default:
        throw `No path pattern for ${item.Type} Items`;
    }
    return pattern.replace(/\{([a-zA-Z]+)\}/g, (s, token:string)=>{
      if (token === "Index") {
        let index = `S${item.ParentIndexNumber?.toString().padStart(2, '0')}`;
        if (typeof item.IndexNumber === 'number') {
          index += `E${item.IndexNumber?.toString().padStart(2, '0')}`;
          if (typeof item.IndexNumberEnd === 'number') {
            index += `-E${item.IndexNumberEnd.toString().padStart(2, '0')}`;
          }
        }
        return index;
      }

      if (item.hasOwnProperty(token)) {
        const tok = item[<keyof Item>token];
        if (typeof tok === 'string') {
          return tok.replace(patterns.StripChars, '');
        }
        if (typeof tok === 'number') {
          return tok.toString();
        }
      }
      return s;
    });
  }

  async fetchItem(itemSpec:Item|string) {
    const item =  (typeof itemSpec === 'string') ? await this.fetchItemInfo(itemSpec) : itemSpec;
    switch (item.Type) {
      case "Series":
        return this.fetchSeries(item);
      case "Season":
        return this.fetchSeason(item);
      case "Episode":
        return this.fetchEpisode(item);
      case "Movie":
        return this.fetchMovie(item);
      case "BoxSet":
      case "Playlist":
      case "CollectionFolder":
        return this.fetchCollection(item);
      default:
        console.log(`Downloading ${item.Type} Items not yet supported`);
        break;
    }
  }

  
  async fetchCollection(item:Item) {
    const children = await this.jserver.getItemChildren(item.Id);
    for (const child of children.Items) {
      await this.fetchItem(child);
    }
  }

  async fetchMedia(item:Item, dirpath:string, media:MediaSource) {
    if (!media.Name) {
      console.log(`No name for media ${media.Id!} on Item ${item.Id}`);
      return;
    }
    const medianame = media.Name.replace(patterns.StripChars, '');
    const vidpath = path.join(dirpath, `${medianame}.${media.Container}`);
    
    const nfopath = path.join(dirpath, `${medianame}.nfo`);

    console.log(`${item.Type!} Video Metadata ${nfopath}`);
    if (!this.list) {
      await writeFile(nfopath, makeNfo(item));
    }
    
    console.log(`Video File: ${vidpath} ${media.Size?filesize(media.Size):""}`);
    if (!this.list && !this.nfo) {
      const file = this.jserver.getFile(media.Id!);
      await writeFileProgress(vidpath, file, media.Size!);
    }
    
    for (const stream of media.MediaStreams!) {
      if (stream.IsExternal) {
        let streampath = path.join(dirpath, medianame);
        if (stream.Title) {
          streampath += `.${stream.Title}`;
        }
        if (stream.Language) {
          streampath += `.${stream.Language}`;
        }
        if (stream.IsDefault) {
          streampath += `.default`;
        }
        if (stream.IsForced) {
          streampath += `.forced`;
        }
        streampath += `.${stream.Codec}`;
        console.log(`External ${stream.Type} Stream ${stream.Index}: ${streampath}`);
        switch (stream.Type) {
          case "Subtitle":
            switch (stream.Codec) {
              case "srt":
                if (!this.list && !this.nfo) {
                  const subs = this.jserver.getSubtitle(item.Id, media.Id!, stream.Index, "srt");
                  await writeFile(streampath, subs);
                }
                break;
              default:
                console.log(`Downloading ${stream.Codec} Subtitle streams not yet supported`);
                break;
            }
            break;
          default:
            console.log(`Downloading ${stream.Type} streams not yet supported`);
            break;
        }
      }
    }
  }

  async fetchMovie(movie:Item) {
    const dirpath = path.join(this.dest, await this.ItemPath(movie));
    for (const media of movie.MediaSources!) {
      await this.fetchMedia(movie, dirpath, media);
    }
    movie.SpecialFeatureCount && console.log(`SpecialFeatureCount ${movie.SpecialFeatureCount}`);
    movie.LocalTrailerCount && console.log(`LocalTrailerCount ${movie.LocalTrailerCount}`);
  }

  async fetchEpisode(episode:Item) {
    const dirpath = path.join(this.dest, ...await Promise.all([episode.SeriesId!, episode.SeasonId!].map(this.ItemPath, this)));
    for (const media of episode.MediaSources!) {
      if (media.Type === "Default") {
        await this.fetchMedia(episode, dirpath, media);
      } else {
        console.log(`Skipping ${media.Type} media ${media.Id} on ${episode.Id}`);
      }
    }
  }

  async fetchSeason(season:Item) {
    const seasonnfo = path.join(this.dest, ...await Promise.all([season.SeriesId!, season].map(this.ItemPath, this)), "season.nfo");
    console.log(`Season Metadata ${seasonnfo}`);
    if (!this.list) {
      await writeFile(seasonnfo, makeNfo(season));
    }

    if (!this.shallow && !this.nfo) {
      const episodes = await this.jserver.getEpisodes(season.SeriesId!, season.Id);
      for (const episode of episodes.Items) {
        this.seenItems.set(episode.Id, episode);
        await this.fetchEpisode(episode);
      }
    }
  }

  async fetchSeries(series:Item) {
    const seriesnfo = path.join(this.dest, await this.ItemPath(series), "tvshow.nfo");
    console.log(`Series Metadata ${seriesnfo}`);
    if (!this.list) {
      await writeFile(seriesnfo, makeNfo(series));
    }

    if (!this.shallow) {
      const seasons = await this.jserver.getSeasons(series.Id);
      for (const season of seasons.Items) {
        this.seenItems.set(season.Id, season);
        await this.fetchSeason(season);
      }
    }
  }

}