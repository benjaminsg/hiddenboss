import { Job } from '@adonisjs/queue'
import { DateTime } from 'luxon'
import EventImport from '#models/event_import'
import MapIdentitiesJob from '#jobs/map_identities_job'
import { PlatformError } from '#lib/platforms/errors'
import { EventImporterService } from '#services/imports/event_importer_service'
import type { JobOptions } from '@adonisjs/queue/types'

type ImportTournamentPayload = {
  eventImportId: string
}

/**
 * A thin wrapper over EventImporterService.
 *
 * All logic lives in the service so it can be driven from an ace command
 * without a worker, and so a change to the queue package — which is still
 * marked experimental — only touches this file.
 */
export default class ImportEventJob extends Job<ImportTournamentPayload> {
  /**
   * `default` because `node ace queue:work` processes only that queue unless
   * told otherwise. A dedicated queue would mean a plain worker silently
   * processes nothing — worth revisiting when there is a reason to isolate
   * slow imports, and the worker command is updated to name both.
   */
  static options: JobOptions = {
    queue: 'default',
    maxRetries: 3,
  }

  async execute() {
    const eventImport = await new EventImporterService().run({
      eventImportId: this.payload.eventImportId,
    })

    if (eventImport.status === 'ok' && eventImport.eventId) {
      await MapIdentitiesJob.dispatch({
        leagueId: eventImport.leagueId,
        eventId: eventImport.eventId,
      })
    }
  }

  /**
   * Records why the import failed, without losing the reason.
   *
   * The queue replaces the thrown error with `E_JOB_MAX_ATTEMPTS_REACHED` before
   * calling this, so `error` here only ever says that retries ran out — never
   * what went wrong. `EventImporterService` writes the real cause onto the row
   * before rethrowing, so that is kept and this only fills in when the failure
   * happened before the service could record anything.
   *
   * A successful import is left alone: if the failure came from dispatching
   * identity mapping afterwards, the import itself did complete, and flipping it
   * to `failed` would send an admin looking for a problem that is not there.
   */
  async failed(error: Error) {
    const eventImport = await EventImport.find(this.payload.eventImportId)
    if (!eventImport) return

    if (eventImport.status !== 'ok' && eventImport.status !== 'cancelled') {
      eventImport.status = 'failed'
      eventImport.finishedAt = DateTime.now()
    }

    eventImport.error = eventImport.error ?? describe(error)
    await eventImport.save()
  }
}

/**
 * The queue's own exhausted-retries error names no cause, so it is rephrased to
 * say that much plainly rather than leaving an admin with a queue internal.
 */
function describe(error: Error): string {
  if (error instanceof PlatformError) return error.message

  if ('code' in error && error.code === 'E_JOB_MAX_ATTEMPTS_REACHED') {
    return 'The import failed repeatedly and gave up. Check the worker logs for the cause.'
  }

  return error.message
}
