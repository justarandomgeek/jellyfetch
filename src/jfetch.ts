import { Item, Jellyfin, MediaSource } from "./jellyfin";
import { makeNfo } from './nfowriter.js';
import { posix as path } from 'path';
import { FetchTask } from "./index.js";

const patterns = {
  Movie: "{Name} ({ProductionYear})",
  SeriesFolder: "{Name} ({ProductionYear})",
  SeasonFolder: "{Name}",
  StripChars: /[:*<>\"?|\\\/]/g,
};

export class JFetch {
  constructor(
    private readonly jserver:Jellyfin,
    private readonly dest:string
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

  public async fetchItem(itemSpec:Item|string, shallow?:boolean): Promise<FetchTask[]> {
    const item =  (typeof itemSpec === 'string') ? await this.fetchItemInfo(itemSpec) : itemSpec;
    switch (item.Type) {
      case "Series":
        return this.fetchSeries(item, shallow);
      case "Season":
        return this.fetchSeason(item, shallow);
      case "Episode":
        return this.fetchEpisode(item);
      case "Movie":
        return this.fetchMovie(item);
      case "BoxSet":
      case "Playlist":
      case "CollectionFolder":
        return this.fetchCollection(item, shallow);
      default:
        console.log(`Downloading ${item.Type} Items not yet supported`);
        return [];
    }
  }

  
  private async fetchCollection(item:Item, shallow?:boolean) {
    const children = await this.jserver.getItemChildren(item.Id);
    const result = [];
    for (const child of children.Items) {
      result.push(...await this.fetchItem(child, shallow));
    }
    return result;
  }

  private fetchMedia(item:Item, dirpath:string, media:MediaSource) {
    if (!media.Name) {
      console.log(`No name for media ${media.Id!} on Item ${item.Id}`);
      return;
    }
    const medianame = media.Name.replace(patterns.StripChars, '');
    const vidpath = path.join(dirpath, `${medianame}.${media.Container}`);
    
    const nfopath = path.join(dirpath, `${medianame}.nfo`);
    const nfo = new FetchTask(nfopath, makeNfo(item));
    const aux:FetchTask[] = [];
    for (const stream of media.MediaStreams!) {
      if (stream.IsExternal) {
        let streampath = path.join(dirpath, medianame);
        if (stream.Title) { streampath += `.${stream.Title}`; }
        if (stream.Language) { streampath += `.${stream.Language}`; }
        if (stream.IsDefault) { streampath += `.default`; }
        if (stream.IsForced) { streampath += `.forced`; }
        streampath += `.${stream.Codec}`;
        switch (stream.Type) {
          case "Subtitle":
            switch (stream.Codec) {
              case "srt":
                aux.push(new FetchTask(streampath, ()=>this.jserver.getSubtitle(item.Id, media.Id!, stream.Index, "srt")));
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
    return new FetchTask(vidpath, ()=>this.jserver.getFile(media.Id!), media.Size!, nfo, aux);
  }

  private async fetchMovie(movie:Item) {
    const dirpath = path.join(this.dest, await this.ItemPath(movie));
    const result = [];
    for (const media of movie.MediaSources!) {
      const m = this.fetchMedia(movie, dirpath, media);
      m && result.push(m);
    }
    return result;
  }

  private async fetchEpisode(episode:Item) {
    const dirpath = path.join(this.dest, ...await Promise.all([episode.SeriesId!, episode.SeasonId!].map(this.ItemPath, this)));
    const result = [];
    for (const media of episode.MediaSources!) {
      if (media.Type === "Default") {
        const m = this.fetchMedia(episode, dirpath, media);
        m && result.push(m);
      }
    }
    return result;
  }

  private async fetchSeason(season:Item, shallow?:boolean) {
    const result = [];

    const seasonnfo = path.join(this.dest, ...await Promise.all([season.SeriesId!, season].map(this.ItemPath, this)), "season.nfo");
    result.push(new FetchTask(seasonnfo, makeNfo(season)));

    if (!shallow) {
      const episodes = await this.jserver.getEpisodes(season.SeriesId!, season.Id);
      for (const episode of episodes.Items) {
        this.seenItems.set(episode.Id, episode);
        result.push(...await this.fetchEpisode(episode));
      }
    }
    return result;
  }

  private async fetchSeries(series:Item, shallow?:boolean) {
    const result = [];

    const seriesnfo = path.join(this.dest, await this.ItemPath(series), "tvshow.nfo");
    result.push(new FetchTask(seriesnfo, makeNfo(series)));

    if (!shallow) {
      const seasons = await this.jserver.getSeasons(series.Id);
      for (const season of seasons.Items) {
        this.seenItems.set(season.Id, season);
        result.push(...await this.fetchSeason(season));
      }
    }
    return result;
  }

}