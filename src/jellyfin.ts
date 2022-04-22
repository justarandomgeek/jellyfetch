import fetch, { BodyInit, Headers, RequestInit } from 'node-fetch';
import pkg from 'node-machine-id';
const { machineIdSync } = pkg;

export interface SessionInfo {
    Client:string
    DeviceId:string
    DeviceName:string
    Id:string
    IsActive:boolean
    ServerId:string
    UserId:string
    UserName:string
}
export interface User {
    name:string
    Id:string
    ServerId:string
}

export interface Item {
    Type:string
    Id:string
    Name?:string
    Path?:string
    Overview?:string
    OriginalTitle?:string
    ProductionYear?:string
    ProviderIds?:{
        Tvdb?:string
        Imdb?:string
        TvRage?:string
        Tmdb?:string
    }
    IndexNumber?:number
    ParentIndexNumber?:number
    SpecialFeatureCount?:number
    LocalTrailerCount?:number
    SeriesId?:string
    MediaSources:MediaSource[]
}

export interface MediaSource {
    Path:string
    Size:number
    Id:string
    MediaStreams:MediaStream[]
}

export interface MediaStream {
    Type:string
    Index:number
    Codec:string
    Path?:string
    IsExternal?:boolean
}

export interface ItemQueryResult {
    Items:Item[]
    TotalRecordCount:Number
    StartIndex:number
}

export class Jellyfin {
  private static readonly deviceId = machineIdSync();
  private session?:SessionInfo;
  public constructor(
        public readonly server:string,
        private accessToken?:string) {
  }

  public static async getApiSession(server:string, accessToken:string|undefined, credential_prompt:()=>Promise<{username:string;password:string}>) {
    const j = new Jellyfin(server, accessToken);
    if (accessToken) {
      j.session = (await j.getSessions())?.[0];
    }
    if (!j.session) {
      const {username, password} = await credential_prompt();
      const authres = await j.authenticateUserByName(username, password);
      j.session = authres.SessionInfo;
      j.accessToken = authres.AccessToken;
    }
    return j;
  }

  public get AccessToken() : string|undefined {
    return this.accessToken;
  }

  private get AuthorizationHeader() {
    return [
      `MediaBrowser Client="jellyfetch"`,
      `Device="jellyfetch"`,
      `DeviceId="${Jellyfin.deviceId}"`,
      `Version="0.0.1"`,
      `Token="${this.accessToken}"`,
    ].join(', ');
  }

  private async internalFetch(path:string, body?:BodyInit) {
    const options:RequestInit = {
      method: 'GET',
      headers: new Headers ({
        "X-Emby-Authorization": this.AuthorizationHeader,
      }),
    };
    if (body) {
      options.method = "POST";
      options.body = body;
      if (typeof body === 'string') {
        (<Headers>options.headers).append('Content-Type', 'application/json');
      }
    }
    return await fetch(new URL(path, this.server).toString(), options);
  }

  private async internalFetchJson<T>(path:string, body?:BodyInit) {
    const result = await this.internalFetch(path, body);
    if (!result.ok) { throw result.statusText; }
    return <Promise<T>> result.json();
  }
    

  public async authenticateUserByName(username:string, password:string) {
    const authres = await this.internalFetchJson<{
            AccessToken:string
            ServerId:string
            SessionInfo:SessionInfo
            User:User
        }>("/Users/AuthenticateByName", JSON.stringify({
          Username: username,
          Pw: password,
        }));
    this.accessToken = authres.AccessToken;
    return authres;
  }

  public async currentUser() {
    const result = await this.internalFetch("/Users/Me");
    if (result.status === 200 || result.status === 400) {
      return <Promise<User>>result.json();
    } else {
      throw result.statusText;
    }
  }

  public async getPhysicalPaths() {
    const result = await this.internalFetch("/Library/PhysicalPaths");
    if (!result.ok) { throw result.statusText; }
    return <Promise<[string]>>result.json();
  }

  public async getItem(itemId:string) {
    return this.internalFetchJson<Item>(`/Users/${this.session!.UserId}/Items/${itemId}`);
  }

  public async getItemChildren(parentId:string) {
    return this.internalFetchJson<ItemQueryResult>(`/Users/${this.session!.UserId}/Items?ParentId=${parentId}&fields=Path,ProviderIds,Overview,MediaSources,LocalTrailerCount,SpecialFeatureCount`);
  }

  public async getSeasons(seriesId:string) {
    return this.internalFetchJson<ItemQueryResult>(`/Shows/${seriesId}/Seasons?fields=Path,ProviderIds,Overview,LocalTrailerCount,SpecialFeatureCount`);
  }

  public async getEpisodes(seriesId:string, seasonId:string): Promise<any> {
    return this.internalFetchJson<ItemQueryResult>(`/Shows/${seriesId}/Episodes?seasonId=${seasonId}&fields=Path,ProviderIds,Overview,MediaSources,LocalTrailerCount,SpecialFeatureCount`);
  }

  public async getFile(id:string) {
    const result = await this.internalFetch(`/Items/${id}/File`);
    if (!result.ok) { throw result.statusText; }
    return result.body!;
  }

    
  public async getSubtitle(itemId:string, mediaSourceId:string, index:number, format:string) {
    const result = await this.internalFetch(`/Videos/${itemId}/${mediaSourceId}/Subtitles/${index}/Stream.${format}`);
    if (!result.ok) { throw result.statusText; }
    return result.body!;
  }

  public async getSessions() {
    const result = await this.internalFetchJson<SessionInfo[]>(`/Sessions?deviceId=${Jellyfin.deviceId}`);
    return result;
  }
}