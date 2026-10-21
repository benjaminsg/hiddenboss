/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'home': {
    methods: ["GET","HEAD"],
    pattern: '/',
    tokens: [{"old":"/","type":0,"val":"/","end":""}],
    types: placeholder as Registry['home']['types'],
  },
  'new_account.create': {
    methods: ["GET","HEAD"],
    pattern: '/signup',
    tokens: [{"old":"/signup","type":0,"val":"signup","end":""}],
    types: placeholder as Registry['new_account.create']['types'],
  },
  'new_account.store': {
    methods: ["POST"],
    pattern: '/signup',
    tokens: [{"old":"/signup","type":0,"val":"signup","end":""}],
    types: placeholder as Registry['new_account.store']['types'],
  },
  'session.create': {
    methods: ["GET","HEAD"],
    pattern: '/login',
    tokens: [{"old":"/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['session.create']['types'],
  },
  'session.store': {
    methods: ["POST"],
    pattern: '/login',
    tokens: [{"old":"/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['session.store']['types'],
  },
  'password.create': {
    methods: ["GET","HEAD"],
    pattern: '/password/forgot',
    tokens: [{"old":"/password/forgot","type":0,"val":"password","end":""},{"old":"/password/forgot","type":0,"val":"forgot","end":""}],
    types: placeholder as Registry['password.create']['types'],
  },
  'password.store': {
    methods: ["POST"],
    pattern: '/password/forgot',
    tokens: [{"old":"/password/forgot","type":0,"val":"password","end":""},{"old":"/password/forgot","type":0,"val":"forgot","end":""}],
    types: placeholder as Registry['password.store']['types'],
  },
  'password.edit': {
    methods: ["GET","HEAD"],
    pattern: '/password/reset/:token',
    tokens: [{"old":"/password/reset/:token","type":0,"val":"password","end":""},{"old":"/password/reset/:token","type":0,"val":"reset","end":""},{"old":"/password/reset/:token","type":1,"val":"token","end":""}],
    types: placeholder as Registry['password.edit']['types'],
  },
  'password.update': {
    methods: ["POST"],
    pattern: '/password/reset',
    tokens: [{"old":"/password/reset","type":0,"val":"password","end":""},{"old":"/password/reset","type":0,"val":"reset","end":""}],
    types: placeholder as Registry['password.update']['types'],
  },
  'session.destroy': {
    methods: ["POST"],
    pattern: '/logout',
    tokens: [{"old":"/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['session.destroy']['types'],
  },
  'leagues.index': {
    methods: ["GET","HEAD"],
    pattern: '/leagues',
    tokens: [{"old":"/leagues","type":0,"val":"leagues","end":""}],
    types: placeholder as Registry['leagues.index']['types'],
  },
  'leagues.create': {
    methods: ["GET","HEAD"],
    pattern: '/leagues/create',
    tokens: [{"old":"/leagues/create","type":0,"val":"leagues","end":""},{"old":"/leagues/create","type":0,"val":"create","end":""}],
    types: placeholder as Registry['leagues.create']['types'],
  },
  'leagues.store': {
    methods: ["POST"],
    pattern: '/leagues',
    tokens: [{"old":"/leagues","type":0,"val":"leagues","end":""}],
    types: placeholder as Registry['leagues.store']['types'],
  },
  'leagues.edit': {
    methods: ["GET","HEAD"],
    pattern: '/:league/settings',
    tokens: [{"old":"/:league/settings","type":1,"val":"league","end":""},{"old":"/:league/settings","type":0,"val":"settings","end":""}],
    types: placeholder as Registry['leagues.edit']['types'],
  },
  'leagues.update': {
    methods: ["PATCH"],
    pattern: '/:league',
    tokens: [{"old":"/:league","type":1,"val":"league","end":""}],
    types: placeholder as Registry['leagues.update']['types'],
  },
  'leagues.destroy': {
    methods: ["DELETE"],
    pattern: '/:league',
    tokens: [{"old":"/:league","type":1,"val":"league","end":""}],
    types: placeholder as Registry['leagues.destroy']['types'],
  },
  'leagues.clear': {
    methods: ["POST"],
    pattern: '/:league/clear',
    tokens: [{"old":"/:league/clear","type":1,"val":"league","end":""},{"old":"/:league/clear","type":0,"val":"clear","end":""}],
    types: placeholder as Registry['leagues.clear']['types'],
  },
  'imports.index': {
    methods: ["GET","HEAD"],
    pattern: '/:league/imports',
    tokens: [{"old":"/:league/imports","type":1,"val":"league","end":""},{"old":"/:league/imports","type":0,"val":"imports","end":""}],
    types: placeholder as Registry['imports.index']['types'],
  },
  'imports.store': {
    methods: ["POST"],
    pattern: '/:league/imports',
    tokens: [{"old":"/:league/imports","type":1,"val":"league","end":""},{"old":"/:league/imports","type":0,"val":"imports","end":""}],
    types: placeholder as Registry['imports.store']['types'],
  },
  'imports.cancel': {
    methods: ["POST"],
    pattern: '/:league/imports/:import/cancel',
    tokens: [{"old":"/:league/imports/:import/cancel","type":1,"val":"league","end":""},{"old":"/:league/imports/:import/cancel","type":0,"val":"imports","end":""},{"old":"/:league/imports/:import/cancel","type":1,"val":"import","end":""},{"old":"/:league/imports/:import/cancel","type":0,"val":"cancel","end":""}],
    types: placeholder as Registry['imports.cancel']['types'],
  },
  'rankings.create': {
    methods: ["GET","HEAD"],
    pattern: '/:league/rankings/new',
    tokens: [{"old":"/:league/rankings/new","type":1,"val":"league","end":""},{"old":"/:league/rankings/new","type":0,"val":"rankings","end":""},{"old":"/:league/rankings/new","type":0,"val":"new","end":""}],
    types: placeholder as Registry['rankings.create']['types'],
  },
  'rankings.store': {
    methods: ["POST"],
    pattern: '/:league/rankings',
    tokens: [{"old":"/:league/rankings","type":1,"val":"league","end":""},{"old":"/:league/rankings","type":0,"val":"rankings","end":""}],
    types: placeholder as Registry['rankings.store']['types'],
  },
  'rankings.locations': {
    methods: ["GET","HEAD"],
    pattern: '/:league/rankings/locations',
    tokens: [{"old":"/:league/rankings/locations","type":1,"val":"league","end":""},{"old":"/:league/rankings/locations","type":0,"val":"rankings","end":""},{"old":"/:league/rankings/locations","type":0,"val":"locations","end":""}],
    types: placeholder as Registry['rankings.locations']['types'],
  },
  'rankings.edit': {
    methods: ["GET","HEAD"],
    pattern: '/:league/rankings/:ranking/edit',
    tokens: [{"old":"/:league/rankings/:ranking/edit","type":1,"val":"league","end":""},{"old":"/:league/rankings/:ranking/edit","type":0,"val":"rankings","end":""},{"old":"/:league/rankings/:ranking/edit","type":1,"val":"ranking","end":""},{"old":"/:league/rankings/:ranking/edit","type":0,"val":"edit","end":""}],
    types: placeholder as Registry['rankings.edit']['types'],
  },
  'rankings.update': {
    methods: ["PATCH"],
    pattern: '/:league/rankings/:ranking',
    tokens: [{"old":"/:league/rankings/:ranking","type":1,"val":"league","end":""},{"old":"/:league/rankings/:ranking","type":0,"val":"rankings","end":""},{"old":"/:league/rankings/:ranking","type":1,"val":"ranking","end":""}],
    types: placeholder as Registry['rankings.update']['types'],
  },
  'rankings.recompute': {
    methods: ["POST"],
    pattern: '/:league/rankings/:ranking/recompute',
    tokens: [{"old":"/:league/rankings/:ranking/recompute","type":1,"val":"league","end":""},{"old":"/:league/rankings/:ranking/recompute","type":0,"val":"rankings","end":""},{"old":"/:league/rankings/:ranking/recompute","type":1,"val":"ranking","end":""},{"old":"/:league/rankings/:ranking/recompute","type":0,"val":"recompute","end":""}],
    types: placeholder as Registry['rankings.recompute']['types'],
  },
  'rankings.eligibilityOverrides.store': {
    methods: ["POST"],
    pattern: '/:league/rankings/:ranking/eligibility-overrides',
    tokens: [{"old":"/:league/rankings/:ranking/eligibility-overrides","type":1,"val":"league","end":""},{"old":"/:league/rankings/:ranking/eligibility-overrides","type":0,"val":"rankings","end":""},{"old":"/:league/rankings/:ranking/eligibility-overrides","type":1,"val":"ranking","end":""},{"old":"/:league/rankings/:ranking/eligibility-overrides","type":0,"val":"eligibility-overrides","end":""}],
    types: placeholder as Registry['rankings.eligibilityOverrides.store']['types'],
  },
  'rankings.eligibilityOverrides.destroy': {
    methods: ["DELETE"],
    pattern: '/:league/rankings/:ranking/eligibility-overrides/:override',
    tokens: [{"old":"/:league/rankings/:ranking/eligibility-overrides/:override","type":1,"val":"league","end":""},{"old":"/:league/rankings/:ranking/eligibility-overrides/:override","type":0,"val":"rankings","end":""},{"old":"/:league/rankings/:ranking/eligibility-overrides/:override","type":1,"val":"ranking","end":""},{"old":"/:league/rankings/:ranking/eligibility-overrides/:override","type":0,"val":"eligibility-overrides","end":""},{"old":"/:league/rankings/:ranking/eligibility-overrides/:override","type":1,"val":"override","end":""}],
    types: placeholder as Registry['rankings.eligibilityOverrides.destroy']['types'],
  },
  'identity.update': {
    methods: ["POST"],
    pattern: '/:league/identity',
    tokens: [{"old":"/:league/identity","type":1,"val":"league","end":""},{"old":"/:league/identity","type":0,"val":"identity","end":""}],
    types: placeholder as Registry['identity.update']['types'],
  },
  'players.merge': {
    methods: ["GET","HEAD"],
    pattern: '/:league/players/merge',
    tokens: [{"old":"/:league/players/merge","type":1,"val":"league","end":""},{"old":"/:league/players/merge","type":0,"val":"players","end":""},{"old":"/:league/players/merge","type":0,"val":"merge","end":""}],
    types: placeholder as Registry['players.merge']['types'],
  },
  'players.merge.store': {
    methods: ["POST"],
    pattern: '/:league/players/merge',
    tokens: [{"old":"/:league/players/merge","type":1,"val":"league","end":""},{"old":"/:league/players/merge","type":0,"val":"players","end":""},{"old":"/:league/players/merge","type":0,"val":"merge","end":""}],
    types: placeholder as Registry['players.merge.store']['types'],
  },
  'players.update': {
    methods: ["PATCH"],
    pattern: '/:league/players/:player',
    tokens: [{"old":"/:league/players/:player","type":1,"val":"league","end":""},{"old":"/:league/players/:player","type":0,"val":"players","end":""},{"old":"/:league/players/:player","type":1,"val":"player","end":""}],
    types: placeholder as Registry['players.update']['types'],
  },
  'players.attendance.store': {
    methods: ["POST"],
    pattern: '/:league/players/:player/attendance',
    tokens: [{"old":"/:league/players/:player/attendance","type":1,"val":"league","end":""},{"old":"/:league/players/:player/attendance","type":0,"val":"players","end":""},{"old":"/:league/players/:player/attendance","type":1,"val":"player","end":""},{"old":"/:league/players/:player/attendance","type":0,"val":"attendance","end":""}],
    types: placeholder as Registry['players.attendance.store']['types'],
  },
  'players.attendance.destroy': {
    methods: ["DELETE"],
    pattern: '/:league/players/:player/attendance/:eventAttendance',
    tokens: [{"old":"/:league/players/:player/attendance/:eventAttendance","type":1,"val":"league","end":""},{"old":"/:league/players/:player/attendance/:eventAttendance","type":0,"val":"players","end":""},{"old":"/:league/players/:player/attendance/:eventAttendance","type":1,"val":"player","end":""},{"old":"/:league/players/:player/attendance/:eventAttendance","type":0,"val":"attendance","end":""},{"old":"/:league/players/:player/attendance/:eventAttendance","type":1,"val":"eventAttendance","end":""}],
    types: placeholder as Registry['players.attendance.destroy']['types'],
  },
  'events.destroy': {
    methods: ["DELETE"],
    pattern: '/:league/events/:event',
    tokens: [{"old":"/:league/events/:event","type":1,"val":"league","end":""},{"old":"/:league/events/:event","type":0,"val":"events","end":""},{"old":"/:league/events/:event","type":1,"val":"event","end":""}],
    types: placeholder as Registry['events.destroy']['types'],
  },
  'events.tournament.destroy': {
    methods: ["DELETE"],
    pattern: '/:league/events/:event/tournament',
    tokens: [{"old":"/:league/events/:event/tournament","type":1,"val":"league","end":""},{"old":"/:league/events/:event/tournament","type":0,"val":"events","end":""},{"old":"/:league/events/:event/tournament","type":1,"val":"event","end":""},{"old":"/:league/events/:event/tournament","type":0,"val":"tournament","end":""}],
    types: placeholder as Registry['events.tournament.destroy']['types'],
  },
  'events.update': {
    methods: ["PATCH"],
    pattern: '/:league/events/:event',
    tokens: [{"old":"/:league/events/:event","type":1,"val":"league","end":""},{"old":"/:league/events/:event","type":0,"val":"events","end":""},{"old":"/:league/events/:event","type":1,"val":"event","end":""}],
    types: placeholder as Registry['events.update']['types'],
  },
  'credentials.index': {
    methods: ["GET","HEAD"],
    pattern: '/:league/credentials',
    tokens: [{"old":"/:league/credentials","type":1,"val":"league","end":""},{"old":"/:league/credentials","type":0,"val":"credentials","end":""}],
    types: placeholder as Registry['credentials.index']['types'],
  },
  'credentials.update': {
    methods: ["PUT"],
    pattern: '/:league/credentials/:platform',
    tokens: [{"old":"/:league/credentials/:platform","type":1,"val":"league","end":""},{"old":"/:league/credentials/:platform","type":0,"val":"credentials","end":""},{"old":"/:league/credentials/:platform","type":1,"val":"platform","end":""}],
    types: placeholder as Registry['credentials.update']['types'],
  },
  'leagues.show': {
    methods: ["GET","HEAD"],
    pattern: '/:league',
    tokens: [{"old":"/:league","type":1,"val":"league","end":""}],
    types: placeholder as Registry['leagues.show']['types'],
  },
  'rankings.index': {
    methods: ["GET","HEAD"],
    pattern: '/:league/rankings',
    tokens: [{"old":"/:league/rankings","type":1,"val":"league","end":""},{"old":"/:league/rankings","type":0,"val":"rankings","end":""}],
    types: placeholder as Registry['rankings.index']['types'],
  },
  'rankings.show': {
    methods: ["GET","HEAD"],
    pattern: '/:league/rankings/:ranking',
    tokens: [{"old":"/:league/rankings/:ranking","type":1,"val":"league","end":""},{"old":"/:league/rankings/:ranking","type":0,"val":"rankings","end":""},{"old":"/:league/rankings/:ranking","type":1,"val":"ranking","end":""}],
    types: placeholder as Registry['rankings.show']['types'],
  },
  'players.index': {
    methods: ["GET","HEAD"],
    pattern: '/:league/players',
    tokens: [{"old":"/:league/players","type":1,"val":"league","end":""},{"old":"/:league/players","type":0,"val":"players","end":""}],
    types: placeholder as Registry['players.index']['types'],
  },
  'players.show': {
    methods: ["GET","HEAD"],
    pattern: '/:league/players/:player',
    tokens: [{"old":"/:league/players/:player","type":1,"val":"league","end":""},{"old":"/:league/players/:player","type":0,"val":"players","end":""},{"old":"/:league/players/:player","type":1,"val":"player","end":""}],
    types: placeholder as Registry['players.show']['types'],
  },
  'events.index': {
    methods: ["GET","HEAD"],
    pattern: '/:league/events',
    tokens: [{"old":"/:league/events","type":1,"val":"league","end":""},{"old":"/:league/events","type":0,"val":"events","end":""}],
    types: placeholder as Registry['events.index']['types'],
  },
  'events.show': {
    methods: ["GET","HEAD"],
    pattern: '/:league/events/:event',
    tokens: [{"old":"/:league/events/:event","type":1,"val":"league","end":""},{"old":"/:league/events/:event","type":0,"val":"events","end":""},{"old":"/:league/events/:event","type":1,"val":"event","end":""}],
    types: placeholder as Registry['events.show']['types'],
  },
  'h2h.index': {
    methods: ["GET","HEAD"],
    pattern: '/:league/h2h',
    tokens: [{"old":"/:league/h2h","type":1,"val":"league","end":""},{"old":"/:league/h2h","type":0,"val":"h2h","end":""}],
    types: placeholder as Registry['h2h.index']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
