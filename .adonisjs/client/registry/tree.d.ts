/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  home: typeof routes['home']
  newAccount: {
    create: typeof routes['new_account.create']
    store: typeof routes['new_account.store']
  }
  session: {
    create: typeof routes['session.create']
    store: typeof routes['session.store']
    destroy: typeof routes['session.destroy']
  }
  password: {
    create: typeof routes['password.create']
    store: typeof routes['password.store']
    edit: typeof routes['password.edit']
    update: typeof routes['password.update']
  }
  leagues: {
    index: typeof routes['leagues.index']
    create: typeof routes['leagues.create']
    store: typeof routes['leagues.store']
    edit: typeof routes['leagues.edit']
    update: typeof routes['leagues.update']
    destroy: typeof routes['leagues.destroy']
    clear: typeof routes['leagues.clear']
    show: typeof routes['leagues.show']
  }
  imports: {
    index: typeof routes['imports.index']
    store: typeof routes['imports.store']
    cancel: typeof routes['imports.cancel']
  }
  rankings: {
    create: typeof routes['rankings.create']
    store: typeof routes['rankings.store']
    locations: typeof routes['rankings.locations']
    edit: typeof routes['rankings.edit']
    update: typeof routes['rankings.update']
    recompute: typeof routes['rankings.recompute']
    eligibilityOverrides: {
      store: typeof routes['rankings.eligibilityOverrides.store']
      destroy: typeof routes['rankings.eligibilityOverrides.destroy']
    }
    index: typeof routes['rankings.index']
    show: typeof routes['rankings.show']
  }
  identity: {
    update: typeof routes['identity.update']
  }
  players: {
    merge: typeof routes['players.merge'] & {
      store: typeof routes['players.merge.store']
    }
    update: typeof routes['players.update']
    attendance: {
      store: typeof routes['players.attendance.store']
      destroy: typeof routes['players.attendance.destroy']
    }
    index: typeof routes['players.index']
    show: typeof routes['players.show']
  }
  events: {
    destroy: typeof routes['events.destroy']
    update: typeof routes['events.update']
    index: typeof routes['events.index']
    show: typeof routes['events.show']
  }
  credentials: {
    index: typeof routes['credentials.index']
    update: typeof routes['credentials.update']
  }
  h2H: {
    index: typeof routes['h2h.index']
  }
}
