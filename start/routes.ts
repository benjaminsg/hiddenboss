/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'

router.get('/', [controllers.Home, 'index']).as('home')

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store'])

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])

    /**
     * Password recovery. Guest-only: somebody already signed in should change
     * their password rather than reset it, and the reset link logs its holder in.
     */
    router.get('password/forgot', [controllers.PasswordResets, 'create']).as('password.create')
    router.post('password/forgot', [controllers.PasswordResets, 'store']).as('password.store')
    router.get('password/reset/:token', [controllers.PasswordResets, 'edit']).as('password.edit')
    router.post('password/reset', [controllers.PasswordResets, 'update']).as('password.update')
  })
  .use(middleware.guest())

router
  .group(() => {
    router.post('logout', [controllers.Session, 'destroy'])

    router.get('leagues', [controllers.Leagues, 'index']).as('leagues.index')
    router.get('leagues/create', [controllers.Leagues, 'create']).as('leagues.create')
    router.post('leagues', [controllers.Leagues, 'store']).as('leagues.store')
  })
  .use(middleware.auth())

/**
 * League administration. The `manage` authorisation happens in middleware, so a
 * route added to this group is scoped and protected by construction.
 *
 * Registered before the public group because routes match in registration
 * order: `rankings/new` has to be seen before `rankings/:ranking`, or the
 * create page resolves as a ranking named "new".
 *
 * Both league groups sit at the end of this file for the same reason. A league
 * lives at `/:league`, so its parameter would otherwise swallow every literal
 * top-level path — and any new one added above must be added to
 * `RESERVED_LEAGUE_SLUGS`, or a league claiming that slug becomes unreachable.
 */
router
  .group(() => {
    router.get('settings', [controllers.Leagues, 'edit']).as('leagues.edit')
    router.patch('/', [controllers.Leagues, 'update']).as('leagues.update')
    router.delete('/', [controllers.Leagues, 'destroy']).as('leagues.destroy')
    router.post('clear', [controllers.Leagues, 'clear']).as('leagues.clear')

    router.get('imports', [controllers.Imports, 'index']).as('imports.index')
    router.post('imports', [controllers.Imports, 'store']).as('imports.store')
    router.post('imports/:import/cancel', [controllers.Imports, 'cancel']).as('imports.cancel')

    router.get('rankings/new', [controllers.Rankings, 'create']).as('rankings.create')
    router.post('rankings', [controllers.Rankings, 'store']).as('rankings.store')
    router
      .get('rankings/locations', [controllers.LocationSuggestions, 'index'])
      .as('rankings.locations')
    router.get('rankings/:ranking/edit', [controllers.Rankings, 'edit']).as('rankings.edit')
    router.patch('rankings/:ranking', [controllers.Rankings, 'update']).as('rankings.update')
    router
      .post('rankings/:ranking/recompute', [controllers.Rankings, 'recompute'])
      .as('rankings.recompute')
    router
      .post('rankings/:ranking/eligibility-overrides', [
        controllers.Rankings,
        'addEligibilityOverride',
      ])
      .as('rankings.eligibilityOverrides.store')
    router
      .delete('rankings/:ranking/eligibility-overrides/:override', [
        controllers.Rankings,
        'removeEligibilityOverride',
      ])
      .as('rankings.eligibilityOverrides.destroy')

    /**
     * Reassigning an imported account to a different player. Posted from the
     * event page, which is where the mistake is visible.
     */
    router.post('identity', [controllers.IdentityCorrections, 'update']).as('identity.update')

    /**
     * Merging two league players into one. Literal `players/merge` is registered
     * before the `players/:player` sibling so it is not read as a player slug.
     */
    router.get('players/merge', [controllers.PlayerMerges, 'show']).as('players.merge')
    router.post('players/merge', [controllers.PlayerMerges, 'store']).as('players.merge.store')

    /** Correcting a player's tag and location. Posted from the player page. */
    router.patch('players/:player', [controllers.Players, 'update']).as('players.update')

    /** Manual "this player attended this event" grants. */
    router
      .post('players/:player/attendance', [controllers.Players, 'addAttendance'])
      .as('players.attendance.store')
    router
      .delete('players/:player/attendance/:eventAttendance', [
        controllers.Players,
        'removeAttendance',
      ])
      .as('players.attendance.destroy')

    router.delete('events/:event', [controllers.Events, 'destroy']).as('events.destroy')

    /**
     * Deletes the whole tournament, not just a league's link to it.
     */
    router
      .delete('events/:event/tournament', [controllers.Events, 'destroyTournament'])
      .as('events.tournament.destroy')

    /**
     * Correcting tournament data
     */
    router.patch('events/:event', [controllers.Events, 'update']).as('events.update')

    router.get('credentials', [controllers.LeagueCredentials, 'index']).as('credentials.index')
    router
      .put('credentials/:platform', [controllers.LeagueCredentials, 'update'])
      .as('credentials.update')
  })
  .prefix(':league')
  .use([middleware.auth(), middleware.league({ authorize: 'manage' })])

/**
 * Public league pages. `middleware.league()` resolves and authorises the
 * `:league` parameter, so controllers never see a raw slug. Anonymous visitors
 * reach public leagues; private ones 404 rather than 403, so a rejected request
 * does not confirm the league exists.
 */
router
  .group(() => {
    router.get('/', [controllers.Leagues, 'show']).as('leagues.show')
    router.get('rankings', [controllers.Rankings, 'index']).as('rankings.index')
    router.get('rankings/:ranking', [controllers.Rankings, 'show']).as('rankings.show')
    router.get('players', [controllers.Players, 'index']).as('players.index')
    router.get('players/:player', [controllers.Players, 'show']).as('players.show')
    router.get('events', [controllers.Events, 'index']).as('events.index')
    router.get('events/:event', [controllers.Events, 'show']).as('events.show')
    router.get('h2h', [controllers.HeadToHead, 'index']).as('h2h.index')
  })
  .prefix(':league')
  .use(middleware.league())
