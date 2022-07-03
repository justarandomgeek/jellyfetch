import { ImageType, Item, Jellyfin, MediaSource } from "./jellyfin";
import { posix as path } from 'path';
import { FetchTask, ImageTask, MediaTask, NfoTask, ExternalStreamTask } from "./index.js";

const patterns = {
  Movie: "{Name} ({ProductionYear})",
  SeriesFolder: "{Name} ({ProductionYear})",
  SeasonFolder: "{Name}",
  StripChars: /[:*<>\"?|\\\/]/g,
};

export class JFetch {
  constructor(
    private readonly jserver:Jellyfin,
  ) {}

  private readonly seenItems = new Map<string, Item>();

  public async fetchItemInfo(id:string) {
    let item = this.seenItems.get(id);
    if (!item) {
      item = await this.jserver.getItem(id);
      this.seenItems.set(id, item);
    }
    return item;
  }

  private async ItemPath(itemSpec:Item|string) {
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

  public async *fetchItem(itemSpec:Item|string, shallow?:boolean): AsyncGenerator<FetchTask> {
    const item =  (typeof itemSpec === 'string') ? await this.fetchItemInfo(itemSpec) : itemSpec;
    switch (item.Type) {
      case "Series":
        yield *this.fetchSeries(item, shallow);
        break;
      case "Season":
        yield *this.fetchSeason(item, shallow);
        break;
      case "Episode":
        yield *this.fetchEpisode(item);
        break;
      case "Movie":
        yield *this.fetchMovie(item);
        break;
      case "BoxSet":
      case "Playlist":
      case "CollectionFolder":
        yield *this.fetchCollection(item, shallow);
        break;
      default:
        console.log(`Downloading ${item.Type} Items not yet supported`);
        break;
    }
  }

  
  private async *fetchCollection(item:Item, shallow?:boolean) {
    const children = await this.jserver.getItemChildren(item.Id);
    for (const child of children.Items) {
      yield* this.fetchItem(child, shallow);
    }
  }

  private async *fetchMedia(item:Item, dirpath:string, media:MediaSource, with_images?:boolean) {
    if (!media.Name) {
      console.log(`No name for media ${media.Id!} on Item ${item.Id}`);
      return;
    }
    const medianame = media.Name.replace(patterns.StripChars, '');
    const vidpath = path.join(dirpath, `${medianame}.${media.Container}`);
    
    const nfopath = path.join(dirpath, `${medianame}.nfo`);
    yield new NfoTask(nfopath, item);
    for (const stream of media.MediaStreams!) {
      if (stream.IsExternal) {
        let streampath = path.join(dirpath, medianame);
        if (stream.Title) { streampath += `.${stream.Title}`; }
        if (stream.Language) { streampath += `.${stream.Language}`; }
        if (stream.IsDefault) { streampath += `.default`; }
        if (stream.IsForced) { streampath += `.forced`; }
        switch (stream.Type) {
          case "Subtitle":
            switch (stream.Codec) {
              case "srt":
                yield new ExternalStreamTask(`${streampath}.srt`, ()=>this.jserver.getSubtitle(item.Id, media.Id!, stream.Index, "srt"));
                break;
              case "webvtt":
                yield new ExternalStreamTask(`${streampath}.vtt`, ()=>this.jserver.getSubtitle(item.Id, media.Id!, stream.Index, "vtt"));
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

    yield new MediaTask(vidpath, ()=>this.jserver.getFile(media.Id!), media.Size!);

    if (with_images) {
      yield* this.fetchImages(item, dirpath, `${medianame}-`);
    }
  }

  private async *fetchImages(item:Item, dirpath:string, prefix?:string) {
    const images = await this.jserver.getItemImageInfo(item.Id);
    for (const ii of images) {
      const headers = await this.jserver.getItemImageHeaders(item.Id, ii.ImageType, ii.ImageIndex);
      const contenttype = headers.get("content-type");
      const imageext = contenttype === "image/jpeg" ? "jpg" :
        undefined;
        
      const imagename = ii.ImageType==="Primary" ?
        (prefix?"thumb":"folder"):
        ii.ImageType.toLowerCase();

      const imagepath = path.join(
        dirpath,
        `${prefix??''}${imagename}${ii.ImageIndex?ii.ImageIndex:''}.${imageext}`
      );
      yield new ImageTask(imagepath, ()=>this.jserver.getItemImage(item.Id, ii.ImageType, ii.ImageIndex), ii.Size);
    }
  }

  private async *fetchMovie(movie:Item) {
    const dirpath = path.join(await this.ItemPath(movie));
    for (const media of movie.MediaSources!) {
      yield* this.fetchMedia(movie, dirpath, media);
    }
    yield* this.fetchImages(movie, dirpath);
  }

  private async *fetchEpisode(episode:Item) {
    const dirpath = path.join(...await Promise.all([episode.SeriesId!, episode.SeasonId!].map(this.ItemPath, this)));
    for (const media of episode.MediaSources!) {
      if (media.Type === "Default") {
        yield* this.fetchMedia(episode, dirpath, media, true);
      }
    }
  }

  private async *fetchSeason(season:Item, shallow?:boolean) {
    const dirpath = path.join(...await Promise.all([season.SeriesId!, season].map(this.ItemPath, this)));
    const seasonnfo = path.join(dirpath, "season.nfo");
    yield new NfoTask(seasonnfo, season);

    yield* this.fetchImages(season, dirpath);

    if (!shallow) {
      const episodes = await this.jserver.getEpisodes(season.SeriesId!, season.Id);
      for (const episode of episodes.Items) {
        this.seenItems.set(episode.Id, episode);
        yield* this.fetchEpisode(episode);
      }
    }
  }

  private async *fetchSeries(series:Item, shallow?:boolean) {
    const dirpath = await this.ItemPath(series);
    const seriesnfo = path.join(dirpath, "tvshow.nfo");
    yield new NfoTask(seriesnfo, series);

    yield* this.fetchImages(series, dirpath);

    if (!shallow) {
      const seasons = await this.jserver.getSeasons(series.Id);
      for (const season of seasons.Items) {
        this.seenItems.set(season.Id, season);
        yield* this.fetchSeason(season);
      }
    }
  }

}