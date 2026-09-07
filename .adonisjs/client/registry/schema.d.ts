/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'home': {
    methods: ["GET","HEAD"]
    pattern: '/'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/home_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/home_controller').default['index']>>>
    }
  }
  'new_account.create': {
    methods: ["GET","HEAD"]
    pattern: '/signup'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['create']>>>
    }
  }
  'new_account.store': {
    methods: ["POST"]
    pattern: '/signup'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').signupValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').signupValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'session.create': {
    methods: ["GET","HEAD"]
    pattern: '/login'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
    }
  }
  'session.store': {
    methods: ["POST"]
    pattern: '/login'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
    }
  }
  'password.create': {
    methods: ["GET","HEAD"]
    pattern: '/password/forgot'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['create']>>>
    }
  }
  'password.store': {
    methods: ["POST"]
    pattern: '/password/forgot'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/password_reset').requestResetValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/password_reset').requestResetValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'password.edit': {
    methods: ["GET","HEAD"]
    pattern: '/password/reset/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['edit']>>>
    }
  }
  'password.update': {
    methods: ["POST"]
    pattern: '/password/reset'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/password_reset').resetPasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/password_reset').resetPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'session.destroy': {
    methods: ["POST"]
    pattern: '/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
    }
  }
  'leagues.index': {
    methods: ["GET","HEAD"]
    pattern: '/leagues'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['index']>>>
    }
  }
  'leagues.create': {
    methods: ["GET","HEAD"]
    pattern: '/leagues/create'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['create']>>>
    }
  }
  'leagues.store': {
    methods: ["POST"]
    pattern: '/leagues'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/league').createLeagueValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/league').createLeagueValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'leagues.edit': {
    methods: ["GET","HEAD"]
    pattern: '/:league/settings'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['edit']>>>
    }
  }
  'leagues.update': {
    methods: ["PATCH"]
    pattern: '/:league'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/league').updateLeagueValidator)>>
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/league').updateLeagueValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'leagues.destroy': {
    methods: ["DELETE"]
    pattern: '/:league'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['destroy']>>>
    }
  }
  'leagues.clear': {
    methods: ["POST"]
    pattern: '/:league/clear'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['clear']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['clear']>>>
    }
  }
  'imports.index': {
    methods: ["GET","HEAD"]
    pattern: '/:league/imports'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['index']>>>
    }
  }
  'imports.store': {
    methods: ["POST"]
    pattern: '/:league/imports'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/import').importValidator)>>
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/import').importValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'imports.cancel': {
    methods: ["POST"]
    pattern: '/:league/imports/:import/cancel'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; import: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['cancel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['cancel']>>>
    }
  }
  'rankings.create': {
    methods: ["GET","HEAD"]
    pattern: '/:league/rankings/new'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['create']>>>
    }
  }
  'rankings.store': {
    methods: ["POST"]
    pattern: '/:league/rankings'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/ranking').createRankingValidator)>>
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/ranking').createRankingValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'rankings.locations': {
    methods: ["GET","HEAD"]
    pattern: '/:league/rankings/locations'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/location_suggestions_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/location_suggestions_controller').default['index']>>>
    }
  }
  'rankings.edit': {
    methods: ["GET","HEAD"]
    pattern: '/:league/rankings/:ranking/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; ranking: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['edit']>>>
    }
  }
  'rankings.update': {
    methods: ["PATCH"]
    pattern: '/:league/rankings/:ranking'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/ranking').updateRankingValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; ranking: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/ranking').updateRankingValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'rankings.recompute': {
    methods: ["POST"]
    pattern: '/:league/rankings/:ranking/recompute'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; ranking: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['recompute']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['recompute']>>>
    }
  }
  'rankings.eligibilityOverrides.store': {
    methods: ["POST"]
    pattern: '/:league/rankings/:ranking/eligibility-overrides'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/ranking_eligibility_override').addEligibilityOverrideValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; ranking: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/ranking_eligibility_override').addEligibilityOverrideValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['addEligibilityOverride']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['addEligibilityOverride']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'rankings.eligibilityOverrides.destroy': {
    methods: ["DELETE"]
    pattern: '/:league/rankings/:ranking/eligibility-overrides/:override'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { league: ParamValue; ranking: ParamValue; override: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['removeEligibilityOverride']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['removeEligibilityOverride']>>>
    }
  }
  'identity.update': {
    methods: ["POST"]
    pattern: '/:league/identity'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/identity').reassignAccountValidator)>>
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/identity').reassignAccountValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/identity_corrections_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/identity_corrections_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'players.merge': {
    methods: ["GET","HEAD"]
    pattern: '/:league/players/merge'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/player_merges_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/player_merges_controller').default['show']>>>
    }
  }
  'players.merge.store': {
    methods: ["POST"]
    pattern: '/:league/players/merge'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/identity').mergePlayersValidator)>>
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/identity').mergePlayersValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/player_merges_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/player_merges_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'players.update': {
    methods: ["PATCH"]
    pattern: '/:league/players/:player'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/player').updatePlayerValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; player: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/player').updatePlayerValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/players_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/players_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'players.attendance.store': {
    methods: ["POST"]
    pattern: '/:league/players/:player/attendance'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/player_event_attendance').addPlayerEventAttendanceValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; player: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/player_event_attendance').addPlayerEventAttendanceValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/players_controller').default['addAttendance']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/players_controller').default['addAttendance']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'players.attendance.destroy': {
    methods: ["DELETE"]
    pattern: '/:league/players/:player/attendance/:eventAttendance'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { league: ParamValue; player: ParamValue; eventAttendance: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/players_controller').default['removeAttendance']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/players_controller').default['removeAttendance']>>>
    }
  }
  'events.destroy': {
    methods: ["DELETE"]
    pattern: '/:league/events/:event'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; event: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/events_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/events_controller').default['destroy']>>>
    }
  }
  'events.tournament.destroy': {
    methods: ["DELETE"]
    pattern: '/:league/events/:event/tournament'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; event: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/events_controller').default['destroyTournament']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/events_controller').default['destroyTournament']>>>
    }
  }
  'events.update': {
    methods: ["PATCH"]
    pattern: '/:league/events/:event'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/event').updateEventValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; event: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/event').updateEventValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/events_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/events_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'credentials.index': {
    methods: ["GET","HEAD"]
    pattern: '/:league/credentials'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/league_credentials_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/league_credentials_controller').default['index']>>>
    }
  }
  'credentials.update': {
    methods: ["PUT"]
    pattern: '/:league/credentials/:platform'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; platform: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/league_credentials_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/league_credentials_controller').default['update']>>>
    }
  }
  'leagues.show': {
    methods: ["GET","HEAD"]
    pattern: '/:league'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/leagues_controller').default['show']>>>
    }
  }
  'rankings.index': {
    methods: ["GET","HEAD"]
    pattern: '/:league/rankings'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['index']>>>
    }
  }
  'rankings.show': {
    methods: ["GET","HEAD"]
    pattern: '/:league/rankings/:ranking'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; ranking: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rankings_controller').default['show']>>>
    }
  }
  'players.index': {
    methods: ["GET","HEAD"]
    pattern: '/:league/players'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/players_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/players_controller').default['index']>>>
    }
  }
  'players.show': {
    methods: ["GET","HEAD"]
    pattern: '/:league/players/:player'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; player: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/players_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/players_controller').default['show']>>>
    }
  }
  'events.index': {
    methods: ["GET","HEAD"]
    pattern: '/:league/events'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/events_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/events_controller').default['index']>>>
    }
  }
  'events.show': {
    methods: ["GET","HEAD"]
    pattern: '/:league/events/:event'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { league: ParamValue; event: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/events_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/events_controller').default['show']>>>
    }
  }
  'h2h.index': {
    methods: ["GET","HEAD"]
    pattern: '/:league/h2h'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { league: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/head_to_head_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/head_to_head_controller').default['index']>>>
    }
  }
}
