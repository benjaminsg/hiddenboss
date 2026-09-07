import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'home': { paramsTuple?: []; params?: {} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'password.create': { paramsTuple?: []; params?: {} }
    'password.store': { paramsTuple?: []; params?: {} }
    'password.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password.update': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'leagues.index': { paramsTuple?: []; params?: {} }
    'leagues.create': { paramsTuple?: []; params?: {} }
    'leagues.store': { paramsTuple?: []; params?: {} }
    'leagues.edit': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'leagues.update': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'leagues.destroy': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'leagues.clear': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'imports.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'imports.store': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'imports.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'import': ParamValue} }
    'rankings.create': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.store': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.locations': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'rankings.update': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'rankings.recompute': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'identity.update': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'players.merge': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'players.merge.store': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'players.update': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'player': ParamValue} }
    'events.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'event': ParamValue} }
    'events.update': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'event': ParamValue} }
    'credentials.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'credentials.update': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'platform': ParamValue} }
    'leagues.show': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.show': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'players.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'players.show': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'player': ParamValue} }
    'events.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'events.show': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'event': ParamValue} }
    'h2h.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
  }
  GET: {
    'home': { paramsTuple?: []; params?: {} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'password.create': { paramsTuple?: []; params?: {} }
    'password.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'leagues.index': { paramsTuple?: []; params?: {} }
    'leagues.create': { paramsTuple?: []; params?: {} }
    'leagues.edit': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'imports.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.create': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.locations': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'players.merge': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'credentials.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'leagues.show': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.show': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'players.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'players.show': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'player': ParamValue} }
    'events.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'events.show': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'event': ParamValue} }
    'h2h.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
  }
  HEAD: {
    'home': { paramsTuple?: []; params?: {} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'password.create': { paramsTuple?: []; params?: {} }
    'password.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'leagues.index': { paramsTuple?: []; params?: {} }
    'leagues.create': { paramsTuple?: []; params?: {} }
    'leagues.edit': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'imports.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.create': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.locations': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'players.merge': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'credentials.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'leagues.show': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.show': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'players.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'players.show': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'player': ParamValue} }
    'events.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'events.show': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'event': ParamValue} }
    'h2h.index': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
  }
  POST: {
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'password.store': { paramsTuple?: []; params?: {} }
    'password.update': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'leagues.store': { paramsTuple?: []; params?: {} }
    'leagues.clear': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'imports.store': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'imports.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'import': ParamValue} }
    'rankings.store': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.recompute': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'identity.update': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'players.merge.store': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
  }
  PATCH: {
    'leagues.update': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'rankings.update': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'ranking': ParamValue} }
    'players.update': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'player': ParamValue} }
    'events.update': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'event': ParamValue} }
  }
  DELETE: {
    'leagues.destroy': { paramsTuple: [ParamValue]; params: {'league': ParamValue} }
    'events.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'event': ParamValue} }
  }
  PUT: {
    'credentials.update': { paramsTuple: [ParamValue,ParamValue]; params: {'league': ParamValue,'platform': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}