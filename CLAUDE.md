# hiddenboss — working notes

Open-source alternative to Braacket and start.gg leagues. Imports tournaments from multiple
platforms, resolves player identity, publishes rankings.

Read `docs/platform-adapters.md` before touching anything under `app/lib/platforms/`.

## Code comments

Comment only for non-trivial rationale — a non-obvious "why", a constraint, a gotcha, a workaround.
Do not add comments that restate what the code does. Prefer zero comments in a diff over narrating
each step.

## Environment

- **Node 24 is required.** `@adonisjs/core@7` and `@adonisjs/ace@14` declare `engines.node >=24`,
  and installing under Node 22 fails with `EBADENGINE`. The repo pins `24.11.1` in `.nvmrc`; run
  `nvm use` first, or prefix commands with
  `export PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH"`.
- **Postgres runs in Docker:** `docker compose up -d db` starts `hiddenboss-db` on port 5432 with
  both `hiddenboss` and `hiddenboss_test` databases. The test database is created by
  `docker/initdb/01-test-database.sh`, which only runs on first initialisation of the volume.
- **This is AdonisJS 7**, not 6 — Lucid 22, VineJS 4, Auth 10, TypeScript 6, React 19, Vite 7.
  Documentation written for Adonis 6 is often subtly wrong.

## Commands

```bash
npm run dev          # dev server on :3333
npm run typecheck    # tsc for both the app and the inertia project
npm run lint         # eslint (includes prettier as a rule)
npm run format       # prettier --write
node ace test unit   # single suite
node ace test        # all suites
node ace migration:fresh --force
```

Run `npx prettier --write <paths>` after generating files; eslint reports formatting as errors and
will otherwise fail the build on whitespace.

## Follow AdonisJS conventions

**Prefer the generators over hand-writing files.** `node ace make:model`, `make:migration`,
`make:controller`, `make:validator`, `make:job`, `make:policy`, `make:test`. They produce the right
filenames, paths and boilerplate. Hand-writing files is how we shipped a model without
`selfAssignPrimaryKey`.

Naming follows the framework: models are singular PascalCase in snake_case files
(`app/models/league_player.ts` → `LeaguePlayer`), controllers are plural, migrations are
`<timestamp>_<description>.ts`.

**Suffix classes with their role**, matching what the generators produce: `*Service`
(`app/services/rankings/ranking_recomputer_service.ts` → `RankingRecomputerService`), `*Job`,
`*Policy`, `*Controller`, `*Transformer`. `make:service` adds the suffix on its own; `make:job` does
not, so rename after generating one.

Platform adapters use `*Adapter` instead. Suffix by what the class is, not by which directory it sits
in.

Some generators prompt interactively and will hang without a TTY. Pass the flag instead — e.g.
`node ace make:middleware league --stack=named`.

Use subpath imports (`#models/*`, `#lib/*`, `#services/*`) rather than relative paths. New top-level
directories need an entry added to `imports` in `package.json`.

**Class members use TypeScript's `private`, not JavaScript `#` fields.** The framework itself uses
`#` in library code, but `private` is erased at build time, which keeps members reachable by bracket
access when a test genuinely needs it and keeps errors readable. Note the trade-off: `private` is
advisory at runtime, so encapsulation depends on reviewers rather than the engine. Prefer injecting
a collaborator through the constructor over reaching into a private from a test.

## `app/services` versus `app/lib`

A **service** interacts with the application: it queries the database, dispatches jobs, reads config,
or works from the request. Its collaborators are our own infrastructure, so it only means something
inside hiddenboss. Goes in `app/services/`, suffixed `*Service`.

A **lib module** does not reach into the application — everything it needs arrives as an argument, so
it would still make sense lifted into another project. `app/lib/rankings/` holds the rating
algorithms; `app/lib/platforms/` holds the whole platform adapter framework, which speaks only in the
canonical types from `canonical.ts` and never touches a table. Lib modules take no role suffix: they
are named for what they are, which is why `Elo` reads correctly beside the future `Glicko2`, and
adapters use `*Adapter`.

This is not about side effects. A lib module may hold state, read a clock, or make HTTP requests —
`createPlatformHttp` does all three. The line is whether it knows about our database, our queue, our
config or our HTTP layer.

Framework-role directories stay where the generators put them even when they would satisfy the lib
rule: `app/validators/` imports nothing but Vine, but `make:validator` writes there and controllers
consume it through `request.validateUsing`.

The boundary is enforced, not advisory: `eslint.config.js` restricts imports under `app/lib/**`, so
reaching for `#models/*`, `#services/*`, `#jobs/*`, Lucid or `HttpContext` fails lint with a message
saying to make it a service instead. That is what now holds adapters to the canonical types rather
than trusting them to. Dependencies run one way — services use lib, never the reverse.

## Database

**Migrations are the source of truth. `database/schema.ts` is generated — never edit it.** Adonis 7
introspects the database after each migration and writes base model classes there. Models extend
those:

```ts
export default class League extends compose(LeagueSchema, withUuid) {}
```

Re-run `node ace migration:run` (or `migration:fresh --force`) after changing a migration, or the
generated classes go stale and typecheck will lie to you. `database/schema.ts` is listed in
`.prettierignore` (which `eslint-plugin-prettier` honours), so the generator's formatting never
fails lint.

The whole Tier 0 schema is one migration, `create_initial_schema`. That holds only until the first
release; after that, changes get their own files as usual.

**`database/schema_rules.ts` is only loaded if `schemaGeneration.rulesPaths` is set in
`config/database.ts`.** Without that entry the file is silently ignored — no warning, no error, the
rules just never apply. Rules are keyed by the generator's _internal_ type names (`jsonb`, `bigint`,
`uuid`, `decimal`), not Postgres type names, so `citext` and `numeric` are not valid keys. Columns
whose type the introspector does not recognise fall back to `any`; `citext` slugs are fixed with a
per-column rule.

**Primary keys are application-generated UUIDv7** via the `withUuid` mixin
(`app/models/mixins/with_uuid.ts`), which also sets `static selfAssignPrimaryKey = true`. That flag
is mandatory: Lucid defaults it to `false` and then locates rows for update and delete using the
wrong source. Every new model must compose `withUuid`.

**Postgres only.** We depend on `pg_trgm` for fuzzy gamertag matching, `citext` for slugs, `jsonb`
operators for ranking configuration, and advisory locks for job concurrency. Do not add a second
database driver.

`TournamentSet` (`app/models/tournament_set.ts`) maps to the `sets` table and declares
`static table = 'sets'` explicitly, because naming the model `Set` would shadow the JS global and
Lucid would otherwise infer `tournament_sets`.

## Controllers, routes and pages

Name every route (`.as('leagues.show')`) and refer to routes by name everywhere — never by
hardcoded path:

- server: `response.redirect().toRoute('leagues.show', { league: slug })`
- client: `<Link route="leagues.show" routeParams={{ league: slug }}>` and
  `<Form route="leagues.update" routeParams={{ league: slug }}>` from `@adonisjs/inertia/react`

Those components resolve the URL and HTTP method from the route name and validate it at compile
time, which is why hardcoded paths are a regression rather than a style preference.

**Inertia page props must be declared with `type`, never `interface`.** `inertia.render()`
constrains props to a serializable object shape, and a TypeScript interface has no implicit index
signature — so an interface-typed prop makes the page resolve to `never` at the call site, with the
error pointing at the controller rather than the page. Type the component as `React.FC<Props>`;
a plain function declaration also resolves to `never`, because the generated registry extracts props
via `React.FC`.

Anything under `#generated/*` (`controllers`, `policies`, `pages.d.ts`, `routes.d.ts`) is produced
by codegen hooks. After adding a controller, policy or page, run `node ace test unit` before
`npm run typecheck`, or typecheck will fail on modules that do not exist yet.

**Route types are the exception: `routes.d.ts` only regenerates under `node ace serve`.** Running
the test suite is not enough, so after adding a named route, start the dev server once before
typechecking or `route="..."` will not typecheck.

Routes match in **registration order**, so a literal path must be registered before a parameterised
sibling — `rankings/new` before `rankings/:ranking`, or the create page resolves as a ranking named
"new". This is why the admin group is registered before the public group in `start/routes.ts`.

`npm run typecheck` runs two `tsc` passes joined by `&&`. When the first fails the second never
runs, so Inertia-side errors stay hidden until the app side is clean.

## Authorisation

Bouncer policies live in `app/policies/`. Two things the generator does not tell you:

- **Guests are denied by default.** An ability reachable by logged-out visitors needs `@allowGuest()`
  and a `User | null` first parameter, or anonymous requests fail regardless of the policy body.
- `AuthorizerResponse` is `boolean | AuthorizationResponse` and does not include a promise, so an
  async policy method must be typed `Promise<AuthorizerResponse>`.

**League scoping is enforced by middleware, not by controllers.** `middleware.league()` resolves the
`:league` parameter, authorises it, and puts it on `ctx.league`. Controllers derive every query from
`ctx.league` and never read a slug or id off the request. A controller mounted without the
middleware has no league to work from, so forgetting to scope fails loudly.

`tests/functional/league_scoping.spec.ts` discovers `/:league` routes from the router and asserts
each one rejects non-members, so a new route is covered the moment it is registered. Do not replace
that discovery with a hardcoded list.

A private league returns **404, not 403**, to anyone who cannot see it — a 403 would confirm it
exists.

## Testing

- Japa. Specs live in `tests/unit/` and `tests/functional/`, named `*.spec.ts`.
- `tests/bootstrap.ts` migrates the test database once per run via `testUtils.db().migrate()`.
  Individual tests wrap in `testUtils.db().withGlobalTransaction()` for isolation.
- Platform adapters are tested offline against recorded fixtures. No test may require API
  credentials or network access.
- Adapter tests run through `runAdapter()` (`tests/unit/platforms/run_adapter.ts`), which wraps
  `ValidatingSink` as the pipeline does, so contract violations fail the adapter's own tests.

Record fixtures with:

```bash
node ace record:platform-fixtures startgg <url> --credentials='{"token":"..."}'
```

Recording is the only step that needs a real API token; replaying needs none, so contributors
without a key for a platform can still change its adapter. Fixtures are keyed by a hash of method,
URL and body, so a fixture can never answer a request it was not recorded for. Headers are
deliberately not recorded — that is what keeps tokens out of the committed files.

Pick a **small** tournament that covers awkward shapes rather than a major. The start.gg fixture is
a 17-entrant local with a 4-team doubles bracket, which exercises multi-participant entrants,
sponsor prefixes, and the same person appearing in two events — all in 92K.

## Platform adapters

**"Platform", never "provider".** `providers/` is AdonisJS's service-provider directory; using that
word for tournament platforms creates a permanent collision.

**Nothing platform-specific may exist outside `app/lib/platforms/<key>/`.** Core, the import pipeline,
identity resolution, the ranking engine and the UI must not know that start.gg exists. Adding a
platform is writing an adapter and registering it — no core changes, no migration. If a platform
needs a change elsewhere, that is a defect in the contract; fix the contract.

**Adapters never call global `fetch`.** They call `context.http`, which applies the declared rate
limit per credential, retries transient failures, honours `Retry-After`, and maps errors onto the
shared taxonomy. This is also what makes offline fixture testing possible.

**Adapters never write rows either.** `fetchEvent` receives an `ImportSink` and calls
`sink.event(...)`, `sink.bracket(...)` and so on as it pages. The pipeline passes a sink backed by
`TournamentWriterService`; tests pass `RecordingSink`, which is why adapter tests need no database.
Every sink call must be awaited and its errors must propagate — the sink is how backpressure and
cancellation reach the adapter.

**The sink contract is enforced at runtime, not by a test suite.** `ValidatingSink` wraps the sink on
every import and rejects ordering violations, duplicate entrants or sets, and any set referencing an
entrant that was never announced. There is no conformance suite: the invariants hold for every
adapter, including one with no tests, and an unknown entrant reference fails the import instead of
being written as null and silently dropped from rankings.

**Capabilities are observed, not declared.** There is no capability field on an adapter; the
`CapabilityObserver` records what actually arrived during an import. Platform-level declarations
would be wrong at the edges — start.gg reports character data for some games and not others.

Platform keys are strings validated against the registry, never database enums, so adding a
platform never requires a migration.

## Domain rules that are easy to get wrong

- **An event is the unit of import, not a tournament.** A tournament runs several events and a
  league usually wants one of them, so `matchUrl` resolves an event link and `league_events` is what
  ties a league to what it counts. Importing an event hydrates its tournament as the parent, so a
  sibling event imported later joins the same tournament row. A tournament link is recognised but
  rejected by the adapter with the event names to choose from — returning null there would report a
  valid start.gg URL as unsupported. `ValidatingSink` rejects a second event, so the granularity is
  enforced rather than assumed.
- **Identity resolution is scoped to the imported event.** Scoping it to the tournament pulled every
  other event's field into the league's players.
- **An entrant is 1..N players.** Identity resolution joins entrant → participants → platform
  accounts → league players. Never map an entrant directly to a player; doubles and crews break.
- **Ratings are derived, never patched in place.** Sets are the source of truth and a recompute
  replays them in order. Rating systems are order-dependent, so incremental mutation drifts the
  first time somebody corrects a merge.
- **Replay order is chronological: `completed_at` first, bracket position only as a fallback.**
  start.gg's `CALL_ORDER` is the order sets are _called to stations_, which for a finished bracket
  runs roughly backwards — finals are called first. It is not play order. Tournaments still group as
  the outer sort so each one's sets stay contiguous, because the per-tournament standing boundary
  depends on it.
- **Two history grains, and they are not interchangeable.** `ranking_set_deltas` is per rated set
  (`value_before`/`value_after`/`delta`, linked to the causing set — _why_ a rating moved).
  `ranking_tournament_standings` is per tournament and carries `rank` (_where a player stood_,
  plotted against time). Rank cannot be derived from the deltas without re-sorting the whole field,
  and per-set deltas do not exist at all for circuit points, so neither table can replace the other.
  lichess makes the same split: per-game `ratingDiff` on the game, plus a separate daily history
  collection for charts.
- **Both are keyed by `ranking_id`, not `ranking_recompute_id`, and writes are incremental.**
  `rankings.tournament_hashes` holds a running hash of every set replayed up to each tournament; a
  recompute rewrites only tournaments whose hash moved and deletes those whose sets have gone.
  Appending a tournament touches nothing earlier, because a rating at tournament T depends only on
  the sets before it.
- **`ranking_standings` stays keyed by `ranking_recompute_id` deliberately.** Pointing
  `latest_recompute_id` at a fully-written recompute stops readers seeing a half-filled table, and at
  roughly 500 rows per recompute the duplication is negligible.
- **Recompute is manual by default.** An import marks rankings stale; an admin triggers the
  recompute. Rankings can opt into `auto`.
- **A recompute request arriving mid-recompute must not be dropped.** Workers capture the start time
  before reading anything and re-queue if `recompute_requested_at` has advanced past it. Queue-level
  deduplication alone silently loses the second request and leaves standings permanently wrong.
- **Activity windows are applied at read time**, not baked into a recompute — a player becomes inactive
  because the calendar moved, not because data changed.
- **Identity is three-tiered**: entrant → league player (admin-owned, league-scoped) → global player
  (instance-wide, confirmed evidence only). League edits never mutate the global tier.
- **Merges must be reversible.** Reassign and tombstone via `merged_into_id`; never delete edges,
  and always write an `identity_events` row.

## Deployment

The hosted instance runs on **Coolify** on a Hetzner VPS. Coolify is an open-source self-hostable
PaaS: it deploys our Docker Compose stack, manages Traefik as reverse proxy, issues and renews
Let's Encrypt certificates, injects environment variables, and handles persistent volumes and
backups.

This does not change what we build. `docker-compose.yml` stays the artifact, and Coolify deploys
the same file a self-hoster runs by hand — so the self-host path is exercised by our own production
rather than being a second, untested topology.

Practical consequences for the compose file:

- Multiple services in one stack are supported, so web + worker + Postgres deploy together and
  reach each other over the stack network by service name.
- Do not hardcode secrets or the public URL. Coolify injects environment variables, including
  generated values for things like `APP_KEY`.
- Ports are not published to the host; a domain is assigned to the web service in the Coolify UI
  and Traefik terminates TLS.
- Volumes use standard compose syntax. Postgres data must be on a named volume or a deploy
  destroys the database.

Keep the local `db` service usable standalone (`docker compose up -d db`), since that is how tests
and development run.

## Plan

`docs/` holds the architecture. The tiered implementation plan lives outside the repo at
`~/.claude/plans/`. Tier 0 is a walking skeleton: log in, create a league, paste a link, import,
Elo ranking on a public page.
